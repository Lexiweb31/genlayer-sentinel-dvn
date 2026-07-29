import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { solidityBuildConfig } from "./solidity-build-config.mjs";

const execFileAsync = promisify(execFile);
const setupInstruction = "assurance environment is missing; run npm run setup:assurance";
const requiredConfig = Object.freeze({
  version: 1,
  requirementsSha256: "b911699b9e21ffe7b1152d5d2ada51f67bc80d17ed12ca6fc2256b28924658d9",
  versions: Object.freeze({
    python: ">=3.12.0 <3.13.0",
    slither: "0.11.5",
    solc: solidityBuildConfig.version,
  }),
  platforms: Object.freeze({
    "darwin-arm64": Object.freeze({
      url: "https://binaries.soliditylang.org/macosx-amd64/solc-macosx-amd64-v0.8.30+commit.73712a01",
      sha256: "738dcdc6afddeb505ee4e4ef24f1c1fdba2b8c924e614cbbf5801a5b062dd683",
      execution: "ROSETTA_X86_64",
    }),
    "linux-x64": Object.freeze({
      url: "https://binaries.soliditylang.org/linux-amd64/solc-linux-amd64-v0.8.30+commit.73712a01",
      sha256: "f3e987dc6ecebd4bd350c48edcbc320b46cf9e3109bd3fc3d88f1acaf4c428f7",
      execution: "NATIVE",
    }),
  }),
});

export const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected, label) {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  for (const key of Object.keys(expected)) {
    if (!Object.hasOwn(value, key)) throw new Error(`${label} is missing key: ${key}`);
  }
  for (const key of Object.keys(value)) {
    if (!Object.hasOwn(expected, key)) throw new Error(`${label} has unexpected key: ${key}`);
  }
}

function assertExpected(value, expected, label) {
  exactKeys(value, expected, label);
  for (const [key, expectedValue] of Object.entries(expected)) {
    const actualValue = value[key];
    if (isRecord(expectedValue)) {
      assertExpected(actualValue, expectedValue, `${label} ${key}`);
    } else if (actualValue !== expectedValue) {
      throw new Error(`${label}: expected ${key} ${expectedValue}`);
    }
  }
}

export function loadAssuranceConfig(value) {
  exactKeys(value, requiredConfig, "toolchain config");
  exactKeys(value.versions, requiredConfig.versions, "toolchain config versions");
  exactKeys(value.platforms, requiredConfig.platforms, "toolchain config platforms");
  for (const [id, platform] of Object.entries(value.platforms)) {
    exactKeys(platform, requiredConfig.platforms[id], `toolchain config platforms ${id}`);
    if (!/^[a-f0-9]{64}$/.test(platform.sha256)) {
      throw new Error(`toolchain config ${id} has invalid SHA-256`);
    }
    const parsed = new URL(platform.url);
    if (parsed.protocol !== "https:" || parsed.hostname !== "binaries.soliditylang.org") {
      throw new Error(`toolchain config ${id} has invalid compiler URL`);
    }
  }
  if (!/^[a-f0-9]{64}$/.test(value.requirementsSha256)) {
    throw new Error("toolchain config has invalid requirements SHA-256");
  }
  assertExpected(value, requiredConfig, "toolchain config");
  return structuredClone(value);
}

export async function readAssuranceConfig(configPath = assurancePaths(repositoryRoot).config) {
  let raw;
  try {
    raw = await fsp.readFile(configPath, "utf8");
  } catch {
    throw new Error("assurance toolchain config is missing or unreadable");
  }
  try {
    return loadAssuranceConfig(JSON.parse(raw));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error("assurance toolchain config is not valid JSON");
    }
    throw error;
  }
}

export function selectAssurancePlatform(
  config,
  host = { platform: process.platform, arch: process.arch },
) {
  const id = `${host.platform}-${host.arch}`;
  const selected = config.platforms[id];
  if (!selected) throw new Error(`unsupported assurance platform: ${id}`);
  return { id, ...selected };
}

export function parsePythonVersion(output) {
  const match = /^Python (\d+)\.(\d+)\.(\d+)\s*$/.exec(String(output));
  if (!match) throw new Error("invalid Python version");
  const version = {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
  if (version.major !== 3 || version.minor !== 12) {
    throw new Error("contract assurance requires Python 3.12.x");
  }
  return version;
}

export async function findPython312({
  candidates = [
    "/opt/homebrew/bin/python3.12",
    "/usr/local/bin/python3.12",
    "/usr/bin/python3.12",
    "python3.12",
    "python3",
  ],
  runFile = runAssuranceFile,
  env,
} = {}) {
  if (!isRecord(env)) throw new Error("Python discovery requires a sanitized environment");
  const allowedEnvironmentKeys = new Set([
    "PATH",
    "LANG",
    "LC_ALL",
    "VIRTUAL_ENV",
    "PYTHONHASHSEED",
    "PIP_DISABLE_PIP_VERSION_CHECK",
    "PYTHONDONTWRITEBYTECODE",
    "PYTHONNOUSERSITE",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "REQUESTS_CA_BUNDLE",
    "HOME",
    "XDG_CONFIG_HOME",
    "PIP_CONFIG_FILE",
    "NETRC",
    "PIP_KEYRING_PROVIDER",
  ]);
  for (const key of Object.keys(env)) {
    if (!allowedEnvironmentKeys.has(key)) {
      throw new Error(`Python discovery environment is not sanitized: ${key}`);
    }
  }
  for (const candidate of candidates) {
    try {
      const result = await runFile(candidate, ["--version"], { env });
      parsePythonVersion(`${result.stdout}${result.stderr}`);
      return candidate;
    } catch {
      // Continue through the fixed candidate list.
    }
  }
  throw new Error("Python 3.12.x was not found; install it before running npm run setup:assurance");
}

export function assurancePaths(root, platform = process.platform) {
  const windows = platform === "win32";
  const venvRoot = path.join(root, ".venv-assurance");
  const venvBin = path.join(venvRoot, windows ? "Scripts" : "bin");
  return {
    root,
    venvRoot,
    venvBin,
    venvPython: path.join(venvBin, windows ? "python.exe" : "python"),
    slither: path.join(venvBin, windows ? "slither.exe" : "slither"),
    cacheRoot: path.join(root, ".cache", "contract-assurance"),
    solcRoot: path.join(root, ".cache", "contract-assurance", "solc"),
    solc: path.join(root, ".cache", "contract-assurance", "solc", "solc-0.8.30"),
    config: path.join(root, "config", "contract-assurance-toolchain.json"),
    lock: path.join(root, "requirements", "contract-assurance.lock"),
  };
}

function hasCredentialUri(value) {
  return /[a-z][a-z\d+.-]*:\/\/[^/\s:@]+:[^/@\s]+@/i.test(value);
}

export function assuranceEnvironment(paths, input = process.env) {
  const retained = {};
  for (const key of [
    "PATH",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "REQUESTS_CA_BUNDLE",
  ]) {
    if (typeof input[key] !== "string" || input[key].length === 0) continue;
    if (hasCredentialUri(input[key])) throw new Error("unsafe retained environment value");
    retained[key] = input[key];
  }
  const safeSystemPath = retained.PATH
    ?? ["/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(path.delimiter);
  return {
    ...retained,
    PATH: `${paths.venvBin}${path.delimiter}${safeSystemPath}`,
    LANG: "C",
    LC_ALL: "C",
    VIRTUAL_ENV: paths.venvRoot,
    PYTHONHASHSEED: "0",
    PIP_DISABLE_PIP_VERSION_CHECK: "1",
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONNOUSERSITE: "1",
  };
}

function requirementBlocks(lockText) {
  const blocks = [];
  let current = null;
  for (const rawLine of String(lockText).split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (/^\s/.test(line)) {
      if (current) current.push(trimmed);
      continue;
    }
    if (trimmed.startsWith("--")) {
      throw new Error("contract assurance lock contains an unsupported global option");
    }
    current = [trimmed];
    blocks.push(current);
  }
  return blocks;
}

export function validateRequirementsLock(lockText, expectedSlither = "0.11.5") {
  const requirements = [];
  let slitherVersion;
  for (const block of requirementBlocks(lockText)) {
    const head = block[0].replace(/\s*\\$/, "");
    const match = /^([A-Za-z0-9_.-]+)==([A-Za-z0-9_.+!-]+)$/.exec(head);
    if (!match) throw new Error(`requirement is not exactly pinned: ${head}`);
    if (!block.some((line) => /--hash=sha256:[a-f0-9]{64}(?:\s*\\)?$/.test(line))) {
      throw new Error(`requirement is missing SHA-256 hash: ${match[1]}`);
    }
    const normalizedName = match[1].toLowerCase().replaceAll("_", "-");
    if (normalizedName === "slither-analyzer") slitherVersion = match[2];
    requirements.push(`${match[1]}==${match[2]}`);
  }
  if (slitherVersion !== expectedSlither) {
    throw new Error(`expected slither-analyzer ${expectedSlither}`);
  }
  if (requirements.length === 0) throw new Error("contract assurance lock has no requirements");
  return { requirements };
}

export async function sha256File(filePath) {
  const bytes = await fsp.readFile(filePath);
  return createHash("sha256").update(bytes).digest("hex");
}

async function requireFiles(paths) {
  for (const candidate of [paths.venvPython, paths.slither, paths.solc, paths.lock]) {
    try {
      await fsp.access(candidate, fs.constants.R_OK);
    } catch {
      throw new Error(setupInstruction);
    }
  }
}

export async function verifyAssuranceInstallation(
  paths,
  config,
  platform,
  { runFile = runAssuranceFile, hashFile = sha256File } = {},
) {
  await requireFiles(paths);
  const lockDigest = await hashFile(paths.lock);
  if (lockDigest !== config.requirementsSha256) {
    throw new Error("assurance requirements lock checksum mismatch");
  }
  const lockText = await fsp.readFile(paths.lock, "utf8");
  validateRequirementsLock(lockText, config.versions.slither);
  const digest = await hashFile(paths.solc);
  if (digest !== platform.sha256) throw new Error("assurance compiler checksum mismatch");

  const env = assuranceEnvironment(paths);
  const python = await runFile(paths.venvPython, ["--version"], { env });
  const pythonVersion = parsePythonVersion(`${python.stdout}${python.stderr}`);
  const slither = await runFile(paths.slither, ["--version"], { env });
  if (String(slither.stdout).trim() !== config.versions.slither) {
    throw new Error("assurance Slither version mismatch");
  }
  const solc = await runFile(paths.solc, ["--version"], { env });
  if (!String(solc.stdout).includes(solidityBuildConfig.nativeVersion)) {
    throw new Error("assurance solc version mismatch");
  }
  return {
    python: `${pythonVersion.major}.${pythonVersion.minor}.${pythonVersion.patch}`,
    slither: config.versions.slither,
    solc: solidityBuildConfig.nativeVersion,
    platform: platform.id,
  };
}

function bounded(value, limit = 16_384) {
  const text = String(value ?? "");
  return text.length > limit ? `${text.slice(0, limit)}\n[output truncated]` : text;
}

export async function runAssuranceFile(command, args, options = {}) {
  if (typeof command !== "string" || command.length === 0 || !Array.isArray(args)) {
    throw new TypeError("runAssuranceFile requires a command and argument array");
  }
  try {
    const result = await execFileAsync(command, args, {
      cwd: options.cwd,
      env: options.env,
      encoding: "utf8",
      maxBuffer: 1_048_576,
      timeout: options.timeout ?? 120_000,
      windowsHide: true,
    });
    return { stdout: bounded(result.stdout), stderr: bounded(result.stderr), code: 0 };
  } catch (error) {
    const publicError = new Error("contract assurance subprocess failed");
    publicError.code = Number.isInteger(error?.code) ? error.code : 1;
    publicError.stdout = bounded(error?.stdout);
    publicError.stderr = bounded(error?.stderr);
    throw publicError;
  }
}

export function hostPlatform() {
  return { platform: os.platform(), arch: os.arch() };
}
