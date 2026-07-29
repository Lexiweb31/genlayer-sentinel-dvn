import fs from "node:fs";
import fc from "fast-check";
import { ContractFactory, hexlify } from "ethers";

export function artifact(name) {
  const value = JSON.parse(fs.readFileSync(`dist/contracts/${name}.json`, "utf8"));
  if (!Array.isArray(value.abi)
    || typeof value.evm?.bytecode?.object !== "string"
    || value.evm.bytecode.object.length === 0) {
    throw new Error(`invalid compiled contract artifact: ${name}`);
  }
  return value;
}

export async function deploy(nameOrArtifact, signer, ...args) {
  const value = typeof nameOrArtifact === "string"
    ? artifact(nameOrArtifact)
    : nameOrArtifact;
  const contract = await new ContractFactory(
    value.abi,
    value.evm.bytecode.object,
    signer,
  ).deploy(...args);
  await contract.waitForDeployment();
  return contract;
}

export const bytes32Arbitrary = fc
  .uint8Array({ minLength: 32, maxLength: 32 })
  .map((value) => hexlify(value));

export async function withEvmSnapshot(provider, operation) {
  const snapshot = await provider.send("evm_snapshot", []);
  try {
    return await operation();
  } finally {
    const reverted = await provider.send("evm_revert", [snapshot]);
    if (reverted !== true) throw new Error("property EVM snapshot revert failed");
  }
}

export async function campaign(name, arbitrary, property, { seed, numRuns }) {
  if (typeof name !== "string" || name.length === 0
    || !Number.isSafeInteger(seed)
    || !Number.isSafeInteger(numRuns)
    || numRuns < 1) {
    throw new Error("invalid property campaign configuration");
  }
  console.log(`property campaign: ${name}; seed=${seed}; runs=${numRuns}`);
  await fc.assert(
    fc.asyncProperty(arbitrary, property),
    {
      seed,
      numRuns,
      verbose: true,
    },
  );
}
