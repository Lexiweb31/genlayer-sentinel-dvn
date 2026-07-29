import fs from "node:fs";
import path from "node:path";
import solc from "solc";
import {
  assertSolcJsVersion,
  compilationSettings,
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
console.log(`compiled ${files.length} Solidity sources with solc ${solc.version()}`);
