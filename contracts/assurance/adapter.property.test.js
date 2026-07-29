import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
import { Interface, getBytes } from "ethers";
import { executionDigest as coordinatorDigest } from "../../dist/services/coordinator/src/signing.js";
import { startLocalEvm } from "../test/local-evm.js";
import {
  artifact,
  bytes32Arbitrary,
  campaign,
  deploy,
  withEvmSnapshot,
} from "./property-support.js";

const adapterAuthorization = { seed: 1597463007, numRuns: 32 };
const adapterAtomicity = { seed: 324508639, numRuns: 24 };
const targetInterface = new Interface([
  "function verify(bytes32 value)",
  "function fail()",
]);

async function fixture(t) {
  const evm = await startLocalEvm(10);
  t.after(evm.close);
  const { signers } = evm;
  const target = await deploy("MockVerificationTarget", signers[0]);
  const signerRecords = await Promise.all(
    signers.slice(2, 7).map(async (signer) => ({
      signer,
      address: (await signer.getAddress()).toLowerCase(),
    })),
  );
  signerRecords.sort((left, right) => left.address.localeCompare(right.address));
  const outsiderRecords = await Promise.all(
    signers.slice(7, 10).map(async (signer) => ({
      signer,
      address: (await signer.getAddress()).toLowerCase(),
    })),
  );
  outsiderRecords.sort((left, right) => left.address.localeCompare(right.address));
  const adapterArtifact = artifact("SentinelDVNAdapter");
  const adapter = await deploy(
    adapterArtifact,
    signers[1],
    await signers[0].getAddress(),
    await target.getAddress(),
    40231,
    signerRecords.map(({ address }) => address),
    3,
  );
  return {
    ...evm,
    adapter: adapter.connect(signers[1]),
    target,
    signerRecords,
    outsiderRecords,
  };
}

async function signatures(records, digest) {
  const signed = await Promise.all(records.map(async ({ signer, address }) => ({
    address,
    signature: await signer.signMessage(getBytes(digest)),
  })));
  signed.sort((left, right) => left.address.localeCompare(right.address));
  return signed.map(({ signature }) => signature);
}

async function rejected(adapter, args, shares) {
  await assert.rejects(async () => {
    const transaction = await adapter.submitVerification(...args, shares);
    await transaction.wait();
  });
}

test("generated authorized 3-of-5 quorums execute exactly once", async (t) => {
  const context = await fixture(t);
  const generated = fc.record({
    values: fc.uniqueArray(bytes32Arbitrary, { minLength: 4, maxLength: 4 }),
    signerIndexes: fc.subarray([0, 1, 2, 3, 4], { minLength: 3, maxLength: 5 }),
    expiryOffset: fc.integer({ min: 60, max: 3_600 }),
  });

  await campaign(
    "adapter authorization",
    generated,
    async ({ values: [guid, packetDigest, evidenceDigest, callValue], signerIndexes, expiryOffset }) => {
      await withEvmSnapshot(context.provider, async () => {
        const callData = targetInterface.encodeFunctionData("verify", [callValue]);
        const block = await context.provider.getBlock("latest");
        const expiry = BigInt(block.timestamp + expiryOffset);
        const digest = await context.adapter.executionDigest(
          guid,
          packetDigest,
          evidenceDigest,
          callData,
          expiry,
        );
        assert.equal(
          digest,
          coordinatorDigest({
            chainId: 31337n,
            adapter: await context.adapter.getAddress(),
            verificationTarget: await context.target.getAddress(),
            guid,
            packetDigest,
            evidenceDigest,
            callData,
            expiry,
          }),
        );
        const selected = signerIndexes.map((index) => context.signerRecords[index]);
        const shares = await signatures(selected, digest);
        const args = [guid, packetDigest, evidenceDigest, callData, expiry];

        assert.equal(await context.adapter.used(digest), false);
        assert.equal(await context.target.calls(), 0n);
        await (await context.adapter.submitVerification(...args, shares)).wait();
        assert.equal(await context.adapter.used(digest), true);
        assert.equal(await context.target.calls(), 1n);
        assert.equal(await context.target.last(), callValue);
        await rejected(context.adapter, args, shares);
        assert.equal(await context.target.calls(), 1n);
      });
    },
    adapterAuthorization,
  );
});

test("generated invalid shares and reverting targets remain atomic", async (t) => {
  const context = await fixture(t);
  const insufficientQuorum = fc.integer({ min: 0, max: 2 }).chain(
    (authorizedCount) => fc.record({
      authorizedIndexes: fc.subarray([0, 1, 2, 3, 4], {
        minLength: authorizedCount,
        maxLength: authorizedCount,
      }),
      outsiderIndexes: fc.subarray([0, 1, 2], {
        minLength: 3 - authorizedCount,
        maxLength: 3 - authorizedCount,
      }),
    }),
  );
  const generated = fc.record({
    values: fc.uniqueArray(bytes32Arbitrary, { minLength: 8, maxLength: 8 }),
    expiryOffset: fc.integer({ min: 60, max: 3_600 }),
    insufficientQuorum,
  });

  await campaign(
    "adapter atomicity",
    generated,
    async ({ values, expiryOffset, insufficientQuorum: shareMix }) => {
      await withEvmSnapshot(context.provider, async () => {
        const [
          guid,
          packetDigest,
          evidenceDigest,
          callValue,
          otherPacket,
          otherEvidence,
          otherCallValue,
          otherGuid,
        ] = values;
        const callData = targetInterface.encodeFunctionData("verify", [callValue]);
        const otherCallData = targetInterface.encodeFunctionData("verify", [otherCallValue]);
        const block = await context.provider.getBlock("latest");
        const expiry = BigInt(block.timestamp + expiryOffset);
        const args = [guid, packetDigest, evidenceDigest, callData, expiry];
        const digest = await context.adapter.executionDigest(...args);
        const twoAuthorized = await signatures(context.signerRecords.slice(0, 2), digest);
        const insufficientRecords = [
          ...shareMix.authorizedIndexes.map((index) => context.signerRecords[index]),
          ...shareMix.outsiderIndexes.map((index) => context.outsiderRecords[index]),
        ].sort((left, right) => left.address.localeCompare(right.address));
        const duplicateQuorumLength = [
          context.signerRecords[0],
          context.signerRecords[0],
          context.signerRecords[1],
        ];
        const otherwiseValidQuorum = await signatures(
          context.signerRecords.slice(0, 3),
          digest,
        );

        await rejected(context.adapter, args, twoAuthorized);
        await rejected(
          context.adapter,
          args,
          await signatures(insufficientRecords, digest),
        );
        await rejected(
          context.adapter,
          args,
          await signatures(duplicateQuorumLength, digest),
        );
        await rejected(context.adapter, args, [...otherwiseValidQuorum, "0x1234"]);

        for (const changed of [
          { packetDigest: otherPacket },
          { evidenceDigest: otherEvidence },
          { callData: otherCallData },
        ]) {
          const wrongDigest = coordinatorDigest({
            chainId: 31337n,
            adapter: await context.adapter.getAddress(),
            verificationTarget: await context.target.getAddress(),
            guid,
            packetDigest: changed.packetDigest ?? packetDigest,
            evidenceDigest: changed.evidenceDigest ?? evidenceDigest,
            callData: changed.callData ?? callData,
            expiry,
          });
          await rejected(
            context.adapter,
            args,
            await signatures(context.signerRecords.slice(0, 3), wrongDigest),
          );
        }

        for (const domain of [
          {
            chainId: 31338n,
            adapter: await context.adapter.getAddress(),
          },
          {
            chainId: 31337n,
            adapter: context.outsiderRecords[1].address,
          },
        ]) {
          const wrongDigest = coordinatorDigest({
            ...domain,
            verificationTarget: await context.target.getAddress(),
            guid,
            packetDigest,
            evidenceDigest,
            callData,
            expiry,
          });
          await rejected(
            context.adapter,
            args,
            await signatures(context.signerRecords.slice(0, 3), wrongDigest),
          );
        }

        const valid = await signatures(context.signerRecords.slice(0, 3), digest);
        await rejected(context.adapter, args, [...valid].reverse());

        const expired = BigInt(block.timestamp - 1);
        const expiredArgs = [otherGuid, packetDigest, evidenceDigest, callData, expired];
        const expiredDigest = await context.adapter.executionDigest(...expiredArgs);
        await rejected(
          context.adapter,
          expiredArgs,
          await signatures(context.signerRecords.slice(0, 3), expiredDigest),
        );

        const revertingCall = targetInterface.encodeFunctionData("fail");
        const revertingArgs = [otherGuid, packetDigest, evidenceDigest, revertingCall, expiry];
        const revertingDigest = await context.adapter.executionDigest(...revertingArgs);
        await rejected(
          context.adapter,
          revertingArgs,
          await signatures(context.signerRecords.slice(0, 3), revertingDigest),
        );

        assert.equal(await context.adapter.used(digest), false);
        assert.equal(await context.adapter.used(expiredDigest), false);
        assert.equal(await context.adapter.used(revertingDigest), false);
        assert.equal(await context.target.calls(), 0n);
        assert.equal(await context.target.last(), "0x".padEnd(66, "0"));
      });
    },
    adapterAtomicity,
  );
});
