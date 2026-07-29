import fs from "node:fs";
import path from "node:path";
import solc from "solc";
import {
  assertSolcJsVersion,
  compilationSettings,
  contractBuildManifest,
  solidityBuildConfig,
} from "./solidity-build-config.mjs";

const root = process.cwd();
const files = [
  "contracts/src/SentinelDVNAdapter.sol",
  "contracts/src/TreasuryPolicyOApp.sol",
  "contracts/test/MockVerificationTarget.sol",
  "contracts/test/MockEndpointV2.sol",
  "contracts/test/ActionTarget.sol",
  "contracts/test/RevertingActionTarget.sol",
];
const sources = Object.fromEntries(
  files.map((file) => [file, { content: fs.readFileSync(file, "utf8") }]),
);

function findImports(name) {
  for (const base of [root, path.join(root, "node_modules")]) {
    const candidate = path.join(base, name);
    if (fs.existsSync(candidate)) {
      return { contents: fs.readFileSync(candidate, "utf8") };
    }
  }
  return { error: `not found: ${name}` };
}

assertSolcJsVersion(solc.version());
const input = {
  language: "Solidity",
  sources,
  settings: compilationSettings({
    "*": { "*": ["abi", "evm.bytecode.object"] },
  }),
};
const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
const errors = (output.errors ?? []).filter((entry) => entry.severity === "error");
if (errors.length) {
  for (const error of errors) console.error(error.formattedMessage);
  process.exit(1);
}
fs.mkdirSync("dist/contracts", { recursive: true });
for (const [file, contracts] of Object.entries(output.contracts)) {
  for (const [name, artifact] of Object.entries(contracts)) {
    if (files.includes(file)) {
      fs.writeFileSync(`dist/contracts/${name}.json`, JSON.stringify(artifact, null, 2));
    }
  }
}
const productionContracts = [
  ["contracts/src/SentinelDVNAdapter.sol", "SentinelDVNAdapter"],
  ["contracts/src/TreasuryPolicyOApp.sol", "TreasuryPolicyOApp"],
].map(([file, name]) => {
  const artifact = output.contracts[file]?.[name];
  if (!artifact) throw new Error("production contract artifact missing");
  return {
    name,
    source: file,
    sourceText: sources[file].content,
    abi: artifact.abi,
    creationBytecode: artifact.evm.bytecode.object,
  };
});
const buildManifest = contractBuildManifest({
  compilerVersion: solc.version(),
  settings: {
    evmVersion: solidityBuildConfig.evmVersion,
    optimizer: { ...solidityBuildConfig.optimizer },
  },
  contracts: productionContracts,
});
fs.writeFileSync(
  "dist/contracts/build-manifest.json",
  `${JSON.stringify(buildManifest, null, 2)}\n`,
  { encoding: "utf8", mode: 0o600 },
);
console.log(`compiled ${files.length} Solidity sources with solc ${solc.version()}`);
