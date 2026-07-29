import { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import {
  assuranceEnvironment,
  assurancePaths,
  findPython312,
  hostPlatform,
  readAssuranceConfig,
  repositoryRoot,
  runAssuranceFile,
  selectAssurancePlatform,
  sha256File,
  parsePythonVersion,
  validateRequirementsLock,
  verifyAssuranceInstallation,
} from "./contract-assurance-toolchain.mjs";

async function pathExists(target) {
  try {
    await fsp.access(target);
    return true;
  } catch {
    return false;
  }
}

export async function downloadToFile(url, destination, { maxRedirects = 0 } = {}) {
  if (maxRedirects !== 0) throw new Error("assurance compiler redirects must remain disabled");
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.hostname !== "binaries.soliditylang.org") {
    throw new Error("assurance compiler URL is not an approved Solidity host");
  }
  await new Promise((resolve, reject) => {
    const request = https.get(parsed, {
      headers: { "user-agent": "genlayer-sentinel-contract-assurance/1" },
      timeout: 30_000,
    }, async (response) => {
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        response.resume();
        reject(new Error("assurance compiler download redirect refused"));
        return;
      }
      if (status !== 200) {
        response.resume();
        reject(new Error(`assurance compiler download failed with HTTP ${status}`));
        return;
      }
      try {
        await pipeline(response, fs.createWriteStream(destination, {
          flags: "wx",
          mode: 0o600,
        }));
        resolve();
      } catch {
        reject(new Error("assurance compiler download failed"));
      }
    });
    request.once("timeout", () => request.destroy(new Error("assurance compiler download timed out")));
    request.once("error", () => reject(new Error("assurance compiler download failed")));
  });
}

export async function downloadVerifiedCompiler(platform, paths, capabilities = {}) {
  const mkdir = capabilities.mkdir ?? fsp.mkdir;
  const exists = capabilities.pathExists ?? pathExists;
  const download = capabilities.downloadToFile ?? downloadToFile;
  const hashFile = capabilities.hashFile ?? sha256File;
  const chmod = capabilities.chmod ?? fsp.chmod;
  const rename = capabilities.rename ?? fsp.rename;
  const remove = capabilities.remove ?? ((target) => fsp.rm(target, { force: true }));
  const randomId = capabilities.randomId ?? randomUUID;

  await mkdir(paths.solcRoot, { recursive: true });
  if (await exists(paths.solc)) {
    if (await hashFile(paths.solc) === platform.sha256) {
      await chmod(paths.solc, 0o755);
      return { reused: true };
    }
    await remove(paths.solc);
  }

  const staged = `${paths.solc}.${randomId()}.part`;
  try {
    await download(platform.url, staged, { maxRedirects: 0 });
    if (await hashFile(staged) !== platform.sha256) {
      throw new Error("downloaded compiler checksum mismatch");
    }
    await chmod(staged, 0o755);
    await rename(staged, paths.solc);
    return { reused: false };
  } finally {
    await remove(staged);
  }
}

async function validateLockFile(paths, config) {
  if (await sha256File(paths.lock) !== config.requirementsSha256) {
    throw new Error("assurance requirements lock checksum mismatch");
  }
  const lockText = await fsp.readFile(paths.lock, "utf8");
  validateRequirementsLock(lockText, config.versions.slither);
}

async function createSetupIsolation(paths) {
  await fsp.mkdir(paths.cacheRoot, { recursive: true });
  const root = await fsp.mkdtemp(path.join(paths.cacheRoot, "setup-"));
  const xdgConfigHome = path.join(root, "xdg");
  const netrc = path.join(root, ".netrc");
  await fsp.mkdir(xdgConfigHome, { recursive: true });
  await fsp.writeFile(netrc, "", { mode: 0o600 });
  return { root, netrc, xdgConfigHome };
}

async function removeSetupIsolation(isolation) {
  await fsp.rm(isolation.root, { recursive: true, force: true });
}

export async function setupContractAssurance(options = {}) {
  const root = options.root ?? repositoryRoot;
  const host = options.host ?? hostPlatform();
  const paths = assurancePaths(root, host.platform);
  const config = options.config ?? await readAssuranceConfig(paths.config);
  const platform = selectAssurancePlatform(config, host);
  const validateLock = options.validateLock ?? validateLockFile;
  const exists = options.pathExists ?? pathExists;
  const findPython = options.findPython ?? findPython312;
  const runFile = options.runFile ?? runAssuranceFile;
  const downloadCompiler = options.downloadCompiler ?? downloadVerifiedCompiler;
  const verifyInstallation = options.verifyInstallation ?? verifyAssuranceInstallation;
  const createIsolation = options.createSetupIsolation ?? createSetupIsolation;
  const removeIsolation = options.removeSetupIsolation ?? removeSetupIsolation;

  await validateLock(paths, config);
  const isolation = await createIsolation(paths);
  try {
    const env = {
      ...assuranceEnvironment(paths, options.environmentInput ?? process.env),
      HOME: isolation.root,
      XDG_CONFIG_HOME: isolation.xdgConfigHome,
      PIP_CONFIG_FILE: os.devNull,
      NETRC: isolation.netrc,
      PIP_KEYRING_PROVIDER: "disabled",
    };
    if (!await exists(paths.venvPython)) {
      const python = await findPython({ env });
      await runFile(python, ["-m", "venv", paths.venvRoot], { env });
    }
    const pythonVersion = await runFile(paths.venvPython, ["--version"], { env });
    parsePythonVersion(`${pythonVersion.stdout}${pythonVersion.stderr}`);
    await runFile(paths.venvPython, [
      "-I",
      "-m",
      "pip",
      "--isolated",
      "--keyring-provider",
      "disabled",
      "install",
      "--require-hashes",
      "-r",
      paths.lock,
    ], { env });
    if (platform.execution === "ROSETTA_X86_64") {
      await runFile("/usr/bin/arch", ["-x86_64", "/usr/bin/true"], { env });
    }
    await downloadCompiler(platform, paths);
    return await verifyInstallation(paths, config, platform);
  } finally {
    await removeIsolation(isolation);
  }
}

function isDirectExecution() {
  return process.argv[1]
    && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
}

if (isDirectExecution()) {
  const versions = await setupContractAssurance();
  console.log(`Assurance platform: ${versions.platform}`);
  console.log(`Python: ${versions.python}`);
  console.log(`Slither: ${versions.slither}`);
  console.log(`solc: ${versions.solc}`);
  console.log(`Environment: ${path.relative(repositoryRoot, assurancePaths(repositoryRoot).venvRoot)}`);
  console.log(`Compiler: ${path.relative(repositoryRoot, assurancePaths(repositoryRoot).solc)}`);
}
