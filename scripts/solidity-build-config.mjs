import { createHash } from "node:crypto";

export const solidityBuildConfig = Object.freeze({
  version: "0.8.30",
  nativeVersion: "0.8.30+commit.73712a01",
  solcJsVersion: "0.8.30+commit.73712a01.Emscripten.clang",
  evmVersion: "shanghai",
  optimizer: Object.freeze({ enabled: true, runs: 200 }),
});

export function assertSolcJsVersion(actual) {
  if (actual !== solidityBuildConfig.solcJsVersion) {
    throw new Error(
      `solc-js version drift: expected ${solidityBuildConfig.solcJsVersion}`,
    );
  }
}

export function compilationSettings(outputSelection) {
  return {
    evmVersion: solidityBuildConfig.evmVersion,
    optimizer: { ...solidityBuildConfig.optimizer },
    outputSelection,
  };
}

export function nativeSolcArguments(
  root,
  includePath,
  buildConfig = solidityBuildConfig,
) {
  if (buildConfig.optimizer.enabled !== true) {
    throw new Error("native optimizer must remain enabled");
  }
  return [
    "--base-path",
    root,
    "--include-path",
    includePath,
    "--evm-version",
    buildConfig.evmVersion,
    "--optimize",
    "--optimize-runs",
    String(buildConfig.optimizer.runs),
  ];
}

const productionContracts = Object.freeze([
  Object.freeze({
    name: "SentinelDVNAdapter",
    source: "contracts/src/SentinelDVNAdapter.sol",
  }),
  Object.freeze({
    name: "TreasuryPolicyOApp",
    source: "contracts/src/TreasuryPolicyOApp.sol",
  }),
]);

export function contractBuildManifest(input) {
  try {
    exactKeys(input, ["compilerVersion", "settings", "contracts"]);
    exactKeys(input.settings, ["evmVersion", "optimizer"]);
    exactKeys(input.settings.optimizer, ["enabled", "runs"]);
    if (
      input.compilerVersion !== solidityBuildConfig.solcJsVersion ||
      input.settings.evmVersion !== solidityBuildConfig.evmVersion ||
      input.settings.optimizer.enabled !== true ||
      input.settings.optimizer.runs !== solidityBuildConfig.optimizer.runs ||
      !Array.isArray(input.contracts) ||
      input.contracts.length !== productionContracts.length
    ) {
      invalidManifest();
    }
    const contracts = input.contracts.map((contract, index) => {
      exactKeys(contract, [
        "name",
        "source",
        "sourceText",
        "abi",
        "creationBytecode",
      ]);
      const expected = productionContracts[index];
      if (
        !expected ||
        contract.name !== expected.name ||
        contract.source !== expected.source ||
        typeof contract.sourceText !== "string" ||
        !Array.isArray(contract.abi) ||
        typeof contract.creationBytecode !== "string" ||
        !/^(?:[0-9a-f]{2})+$/.test(contract.creationBytecode)
      ) {
        invalidManifest();
      }
      const abiText = JSON.stringify(contract.abi);
      if (typeof abiText !== "string") invalidManifest();
      return {
        name: expected.name,
        source: expected.source,
        sourceSha256: sha256(Buffer.from(contract.sourceText, "utf8")),
        abiSha256: sha256(Buffer.from(abiText, "utf8")),
        creationBytecodeSha256: sha256(
          Buffer.from(contract.creationBytecode, "hex"),
        ),
      };
    });
    return {
      schemaVersion: 1,
      compiler: {
        version: solidityBuildConfig.solcJsVersion,
        evmVersion: solidityBuildConfig.evmVersion,
        optimizer: { ...solidityBuildConfig.optimizer },
      },
      contracts,
    };
  } catch (error) {
    if (error?.message === "invalid contract build manifest") throw error;
    invalidManifest();
  }
}

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalidManifest();
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    invalidManifest();
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function invalidManifest() {
  throw new Error("invalid contract build manifest");
}
