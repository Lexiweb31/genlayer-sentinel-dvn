import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assuranceEnvironment,
  assurancePaths,
  hostPlatform,
  readAssuranceConfig,
  repositoryRoot,
  runAssuranceFile,
  selectAssurancePlatform,
  verifyAssuranceInstallation,
} from "./contract-assurance-toolchain.mjs";
import {
  createDependencyAudit,
  enforceSlitherFindings,
  mergeDependencyAudits,
  normalizeSlitherReport,
  validateAllowlist,
} from "./slither-findings.mjs";
import {
  nativeSolcArguments,
  solidityBuildConfig,
} from "./solidity-build-config.mjs";

export const productionTargets = Object.freeze([
  "contracts/src/SentinelDVNAdapter.sol",
  "contracts/src/TreasuryPolicyOApp.sol",
]);

export function slitherArguments(target, reportPath, root, paths) {
  if (!productionTargets.includes(target)) {
    throw new Error("unreviewed Slither target");
  }
  const solcArguments = nativeSolcArguments(
    root,
    path.join(root, "node_modules"),
  ).join(" ");
  return [
    target,
    "--solc",
    paths.solc,
    "--solc-working-dir",
    root,
    "--solc-args",
    solcArguments,
    "--exclude-dependencies",
    "--json",
    reportPath,
    "--json-types",
    "detectors",
    "--show-ignored-findings",
    "--disable-color",
    "--fail-none",
  ];
}

async function makeTempDirectory(prefix) {
  return fsp.mkdtemp(prefix);
}

async function removeDirectory(directory) {
  await fsp.rm(directory, { recursive: true, force: true });
}

export async function analyzeContract(target, capabilities = {}) {
  const root = capabilities.root ?? repositoryRoot;
  const paths = capabilities.paths ?? assurancePaths(root);
  const makeTemp = capabilities.makeTempDirectory ?? makeTempDirectory;
  const runFile = capabilities.runFile ?? runAssuranceFile;
  const readText = capabilities.readText ?? ((file) => fsp.readFile(file, "utf8"));
  const remove = capabilities.removeDirectory ?? removeDirectory;
  const env = assuranceEnvironment(paths, capabilities.environmentInput ?? process.env);
  const directory = await makeTemp(path.join(os.tmpdir(), "sentinel-slither-"));
  const reportPath = path.join(directory, "slither.json");
  try {
    let childFailed = false;
    try {
      await runFile(
        paths.slither,
        slitherArguments(target, reportPath, root, paths),
        { cwd: root, env },
      );
    } catch {
      childFailed = true;
    }

    let raw;
    try {
      raw = JSON.parse(await readText(reportPath));
    } catch {
      throw new Error("contract static analysis failed");
    }
    try {
      const dependencyAudit = createDependencyAudit();
      const findings = normalizeSlitherReport(raw, root, {
        dependencyMode: "partition",
        dependencyAudit,
      });
      if (childFailed && raw.success !== true) {
        throw new Error("contract static analysis failed");
      }
      return { findings, dependencyAudit };
    } catch (error) {
      if (error.message === "Slither analysis failed") {
        throw new Error("contract static analysis failed");
      }
      throw error;
    }
  } finally {
    await remove(directory);
  }
}

async function loadAllowlist(root) {
  const raw = JSON.parse(
    await fsp.readFile(path.join(root, "config", "slither-allowlist.json"), "utf8"),
  );
  return validateAllowlist(raw);
}

async function loadSource(root, relative) {
  return fsp.readFile(path.join(root, relative));
}

export function formatDependencyAudit(audit) {
  const normalized = mergeDependencyAudits([audit]);
  const detectorCounts = new Map();
  for (const detector of normalized.detectorIds) {
    detectorCounts.set(detector, (detectorCounts.get(detector) ?? 0) + 1);
  }
  const detectors = [...detectorCounts]
    .map(([detector, count]) => `${detector}:${count}`)
    .join(",");
  return [
    "Excluded dependency-only findings:",
    `High=${normalized.excludedFindings.High}`,
    `Medium=${normalized.excludedFindings.Medium}`,
    `Low=${normalized.excludedFindings.Low}`,
    `Informational=${normalized.excludedFindings.Informational};`,
    `elements=${normalized.excludedElements};`,
    `mixed=${normalized.mixedFindings};`,
    `detectors=${detectors || "none"}`,
  ].join(" ");
}

export async function runSlitherAssurance(options = {}) {
  const root = options.root ?? repositoryRoot;
  const paths = options.paths ?? assurancePaths(root);
  const config = options.config ?? await readAssuranceConfig(paths.config);
  const platform = options.platform
    ?? selectAssurancePlatform(config, options.host ?? hostPlatform());
  const verifyInstallation = options.verifyInstallation ?? verifyAssuranceInstallation;
  const analyze = options.analyze
    ?? ((target) => analyzeContract(target, { root, paths }));
  const readAllowlist = options.loadAllowlist ?? (() => loadAllowlist(root));
  const readSource = options.loadSource ?? ((relative) => loadSource(root, relative));
  const now = options.now ?? new Date().toISOString().slice(0, 10);

  if (config.versions.solc !== solidityBuildConfig.version) {
    throw new Error("Solidity compiler configuration drift");
  }
  const versions = await verifyInstallation(paths, config, platform);
  const allowlist = validateAllowlist(await readAllowlist());
  const findings = [];
  const dependencyAudits = [];
  for (const target of productionTargets) {
    const analysis = await analyze(target);
    if (analysis === null || typeof analysis !== "object"
      || !Array.isArray(analysis.findings)) {
      throw new Error("contract static analysis returned an invalid result");
    }
    findings.push(...analysis.findings);
    dependencyAudits.push(analysis.dependencyAudit);
  }
  const sources = new Map();
  for (const finding of findings) {
    for (const element of finding.elements) {
      if (!sources.has(element.path)) {
        sources.set(element.path, await readSource(element.path));
      }
    }
  }
  const enforced = enforceSlitherFindings(findings, allowlist, sources, now);
  return {
    versions,
    targets: [...productionTargets],
    ...enforced,
    dependencyAudit: mergeDependencyAudits(dependencyAudits),
  };
}

function isDirectExecution() {
  return process.argv[1]
    && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
}

if (isDirectExecution()) {
  try {
    const result = await runSlitherAssurance();
    console.log(`Slither ${result.versions.slither}; solc ${result.versions.solc}`);
    console.log(`Analyzed production targets: ${result.targets.length}`);
    console.log(
      `Findings: High=${result.counts.High} Medium=${result.counts.Medium} Low=${result.counts.Low} Informational=${result.counts.Informational}`,
    );
    console.log(
      `Accepted detector IDs: ${result.acceptedDetectorIds.length
        ? result.acceptedDetectorIds.join(",")
        : "none"}`,
    );
    console.log(formatDependencyAudit(result.dependencyAudit));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "contract static analysis failed");
    process.exitCode = 1;
  }
}
