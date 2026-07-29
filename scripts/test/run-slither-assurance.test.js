import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { assurancePaths } from "../contract-assurance-toolchain.mjs";
import {
  analyzeContract,
  runSlitherAssurance,
  slitherArguments,
} from "../run-slither-assurance.mjs";

const root = "/sentinel";
const paths = assurancePaths(root, "linux");
const target = "contracts/src/SentinelDVNAdapter.sol";
const reportPath = "/private/tmp/sentinel-slither-fixed/slither.json";
const cleanReport = JSON.stringify({
  success: true,
  error: null,
  results: { detectors: [] },
});

test("builds an explicit native-solc invocation for one production target", () => {
  assert.deepEqual(slitherArguments(target, reportPath, root, paths), [
    target,
    "--solc",
    paths.solc,
    "--solc-working-dir",
    root,
    "--solc-args",
    `--base-path ${root} --include-path ${path.join(root, "node_modules")} --evm-version shanghai --optimize --optimize-runs 200`,
    "--exclude-dependencies",
    "--json",
    reportPath,
    "--json-types",
    "detectors",
    "--disable-color",
    "--fail-none",
  ]);
});

test("analyzes with a sanitized environment and removes its report directory", async () => {
  const calls = [];
  const findings = await analyzeContract(target, {
    root,
    paths,
    makeTempDirectory: async (prefix) => {
      calls.push(["makeTempDirectory", prefix]);
      return "/private/tmp/sentinel-slither-fixed";
    },
    runFile: async (command, args, options) => {
      calls.push(["runFile", command, args, options]);
      return { stdout: "", stderr: "", code: 0 };
    },
    readText: async (actualPath) => {
      calls.push(["readText", actualPath]);
      return cleanReport;
    },
    removeDirectory: async (actualPath) => calls.push(["removeDirectory", actualPath]),
    environmentInput: {
      PATH: "/usr/bin:/bin",
      PRIVATE_KEY: "never-forward",
      RPC_URL: "https://rpc.example",
      AWS_SECRET_ACCESS_KEY: "never-forward",
    },
  });
  assert.deepEqual(findings, []);
  assert.equal(calls[0][0], "makeTempDirectory");
  assert.deepEqual(calls[1].slice(0, 3), [
    "runFile",
    paths.slither,
    slitherArguments(target, reportPath, root, paths),
  ]);
  assert.equal(calls[1][3].cwd, root);
  assert.equal(calls[1][3].env.PRIVATE_KEY, undefined);
  assert.equal(calls[1][3].env.RPC_URL, undefined);
  assert.equal(calls[1][3].env.PATH, `${paths.venvBin}:/usr/bin:/bin`);
  assert.deepEqual(calls.at(-1), [
    "removeDirectory",
    "/private/tmp/sentinel-slither-fixed",
  ]);
});

test("parses a successful report after a finding-related child exit", async () => {
  let removed = false;
  const findings = await analyzeContract(target, {
    root,
    paths,
    makeTempDirectory: async () => "/private/tmp/sentinel-slither-nonzero",
    runFile: async () => {
      const error = new Error("subprocess failed");
      error.code = 255;
      throw error;
    },
    readText: async () => cleanReport,
    removeDirectory: async () => {
      removed = true;
    },
    environmentInput: { PATH: "/usr/bin:/bin" },
  });
  assert.deepEqual(findings, []);
  assert.equal(removed, true);
});

test("sanitizes analyzer failure and cleans temporary output", async () => {
  let removed = false;
  await assert.rejects(
    analyzeContract(target, {
      root,
      paths,
      makeTempDirectory: async () => "/private/tmp/sentinel-slither-failure",
      runFile: async () => {
        throw new Error("/Users/operator/private/project compilation failed");
      },
      readText: async () => {
        throw new Error("/Users/operator/private/report missing");
      },
      removeDirectory: async () => {
        removed = true;
      },
      environmentInput: { PATH: "/usr/bin:/bin" },
    }),
    (error) => {
      assert.equal(error.message, "contract static analysis failed");
      assert.doesNotMatch(error.message, /operator|compilation|report/);
      return true;
    },
  );
  assert.equal(removed, true);
});

test("verifies once and analyzes exactly the two production targets in order", async () => {
  const calls = [];
  const result = await runSlitherAssurance({
    root,
    paths,
    config: {
      version: 1,
      requirementsSha256: "a".repeat(64),
      versions: {
        python: ">=3.12.0 <3.13.0",
        slither: "0.11.5",
        solc: "0.8.30",
      },
      platforms: {
        "linux-x64": {
          url: "https://binaries.soliditylang.org/linux-amd64/solc-linux-amd64-v0.8.30+commit.73712a01",
          sha256: "b".repeat(64),
          execution: "NATIVE",
        },
      },
    },
    platform: {
      id: "linux-x64",
      url: "https://binaries.soliditylang.org/linux-amd64/solc-linux-amd64-v0.8.30+commit.73712a01",
      sha256: "b".repeat(64),
      execution: "NATIVE",
    },
    verifyInstallation: async () => {
      calls.push(["verifyInstallation"]);
      return {
        python: "3.12.13",
        slither: "0.11.5",
        solc: "0.8.30+commit.73712a01",
        platform: "linux-x64",
      };
    },
    loadAllowlist: async () => ({ version: 1, entries: [] }),
    analyze: async (actualTarget) => {
      calls.push(["analyze", actualTarget]);
      return [];
    },
    loadSource: async (actualPath) => {
      calls.push(["loadSource", actualPath]);
      return Buffer.from("");
    },
    now: "2026-07-29",
  });
  assert.deepEqual(calls, [
    ["verifyInstallation"],
    ["analyze", "contracts/src/SentinelDVNAdapter.sol"],
    ["analyze", "contracts/src/TreasuryPolicyOApp.sol"],
  ]);
  assert.deepEqual(result, {
    versions: {
      python: "3.12.13",
      slither: "0.11.5",
      solc: "0.8.30+commit.73712a01",
      platform: "linux-x64",
    },
    targets: [
      "contracts/src/SentinelDVNAdapter.sol",
      "contracts/src/TreasuryPolicyOApp.sol",
    ],
    counts: { High: 0, Medium: 0, Low: 0, Informational: 0 },
    acceptedDetectorIds: [],
  });
});
