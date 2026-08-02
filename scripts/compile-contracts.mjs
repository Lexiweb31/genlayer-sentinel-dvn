import fs from "node:fs";
import {
  compileSentinelSolidity,
  sentinelSoliditySources,
} from "./compile-sentinel-solidity.mjs";

const root = process.cwd();
const { output, buildManifest } = compileSentinelSolidity(root);
fs.mkdirSync("dist/contracts", { recursive: true });
for (const [file, contracts] of Object.entries(output.contracts)) {
  for (const [name, artifact] of Object.entries(contracts)) {
    if (sentinelSoliditySources.includes(file)) {
      fs.writeFileSync(`dist/contracts/${name}.json`, JSON.stringify(artifact, null, 2));
    }
  }
}
fs.writeFileSync(
  "dist/contracts/build-manifest.json",
  `${JSON.stringify(buildManifest, null, 2)}\n`,
  { encoding: "utf8", mode: 0o600 },
);
console.log(
  `compiled ${sentinelSoliditySources.length} Solidity sources with solc ${buildManifest.compiler.version}`,
);
