import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
import { AbiCoder, Interface, zeroPadValue } from "ethers";
import { decodePacketV1 } from "../../dist/packages/core/src/packet-v1.js";
import { startLocalEvm } from "../test/local-evm.js";
import {
  bytes32Arbitrary,
  campaign,
  deploy,
  withEvmSnapshot,
} from "./property-support.js";

const oappExecution = { seed: 610839776, numRuns: 24 };
const oappRejection = { seed: 195948557, numRuns: 32 };
const zeroBytes32 = "0x".padEnd(66, "0");
const nonzeroBytes32 = bytes32Arbitrary.filter((value) => value !== zeroBytes32);
const actionCoder = AbiCoder.defaultAbiCoder();
const actionType = "tuple(bytes32 authorizationId,address target,uint256 value,bytes data)";
const targetInterface = new Interface(["function record(bytes32 value)"]);

async function fixture(t) {
  const evm = await startLocalEvm(10);
  t.after(evm.close);
  const { signers } = evm;
  const epA = await deploy("MockEndpointV2", signers[0], 40161);
  const epB = await deploy("MockEndpointV2", signers[1], 40231);
  await (await epA.setOptionalDvn(await signers[8].getAddress())).wait();
  await (await epB.setOptionalDvn(await signers[8].getAddress())).wait();
  const a = await deploy(
    "TreasuryPolicyOApp",
    signers[2],
    await epA.getAddress(),
    await signers[2].getAddress(),
  );
  const b = await deploy(
    "TreasuryPolicyOApp",
    signers[3],
    await epB.getAddress(),
    await signers[3].getAddress(),
  );
  const target = await deploy("ActionTarget", signers[4]);
  const unauthorizedTarget = await deploy("ActionTarget", signers[5]);
  const revertingTarget = await deploy("RevertingActionTarget", signers[6]);
  const peerA = zeroPadValue(await a.getAddress(), 32);
  const peerB = zeroPadValue(await b.getAddress(), 32);
  await (await a.connect(signers[2]).setPeer(40231, peerB)).wait();
  await (await b.connect(signers[3]).setPeer(40161, peerA)).wait();
  for (const oapp of [a.connect(signers[2]), b.connect(signers[3])]) {
    await (await oapp.setAuthorizedTarget(await target.getAddress(), true)).wait();
  }
  await (
    await b.connect(signers[3]).setAuthorizedTarget(
      await revertingTarget.getAddress(),
      true,
    )
  ).wait();
  return {
    ...evm,
    a,
    b,
    epA,
    epB,
    target,
    unauthorizedTarget,
    revertingTarget,
    peerA,
    peerB,
  };
}

function encodeAction(action) {
  return actionCoder.encode([actionType], [action]);
}

function parseLog(contract, log) {
  try {
    return contract.interface.parseLog(log);
  } catch {
    return null;
  }
}

async function deliverRejected(endpoint, receiver, origin, guid, message) {
  await assert.rejects(async () => {
    const transaction = await endpoint.deliver(receiver, origin, guid, message);
    await transaction.wait();
  });
}

test("generated trusted actions execute once and outbound packets retain exact bindings", async (t) => {
  const context = await fixture(t);
  const generated = fc.record({
    values: fc.uniqueArray(nonzeroBytes32, { minLength: 5, maxLength: 5 }),
    nonce: fc.integer({ min: 1, max: 1_000_000 }),
  });

  await campaign(
    "OApp execution and replay",
    generated,
    async ({ values: [authorizationId, guid, recordValue, secondGuid, outboundValue], nonce }) => {
      await withEvmSnapshot(context.provider, async () => {
        const data = targetInterface.encodeFunctionData("record", [recordValue]);
        const action = {
          authorizationId,
          target: await context.target.getAddress(),
          value: 0n,
          data,
        };
        const message = encodeAction(action);
        const origin = { srcEid: 40161, sender: context.peerA, nonce };
        await (
          await context.epB.deliver(
            await context.b.getAddress(),
            origin,
            guid,
            message,
          )
        ).wait();
        assert.equal(await context.target.recorded(), recordValue);
        assert.equal(await context.target.calls(), 1n);
        assert.equal(await context.b.executedGuid(guid), true);
        assert.equal(await context.b.executedAuthorization(authorizationId), true);
        await deliverRejected(
          context.epB,
          await context.b.getAddress(),
          origin,
          guid,
          message,
        );
        await deliverRejected(
          context.epB,
          await context.b.getAddress(),
          { ...origin, nonce: nonce + 1 },
          secondGuid,
          message,
        );
        assert.equal(await context.target.calls(), 1n);

        const outboundData = targetInterface.encodeFunctionData("record", [outboundValue]);
        const outboundAction = { ...action, data: outboundData };
        const quoted = await context.a.quoteAction(40231, outboundAction, "0x", false);
        const transaction = await context.a.connect(context.signers[2]).sendAction(
          40231,
          outboundAction,
          "0x",
          { nativeFee: quoted.nativeFee, lzTokenFee: quoted.lzTokenFee },
          { value: quoted.nativeFee },
        );
        const receipt = await transaction.wait();
        const actionEvent = receipt.logs
          .map((log) => parseLog(context.a, log))
          .find((log) => log?.name === "ActionSent");
        const packetEvent = receipt.logs
          .map((log) => parseLog(context.epA, log))
          .find((log) => log?.name === "PacketSent");
        assert.ok(actionEvent);
        assert.ok(packetEvent);
        const packet = decodePacketV1(packetEvent.args.encodedPayload);
        const [decoded] = actionCoder.decode([actionType], packet.message);
        assert.equal(actionEvent.args.authorizationId, authorizationId);
        assert.equal(actionEvent.args.guid, packet.guid);
        assert.equal(actionEvent.args.dstEid, 40231n);
        assert.equal(actionEvent.args.target.toLowerCase(), action.target.toLowerCase());
        assert.equal(actionEvent.args.value, 0n);
        assert.equal(packet.srcEid, 40161);
        assert.equal(packet.dstEid, 40231);
        assert.equal(packet.sender, zeroPadValue(await context.a.getAddress(), 32));
        assert.equal(packet.receiver, context.peerB);
        assert.equal(decoded.authorizationId, authorizationId);
        assert.equal(decoded.target.toLowerCase(), action.target.toLowerCase());
        assert.equal(decoded.value, 0n);
        assert.equal(decoded.data, outboundData);
      });
    },
    oappExecution,
  );
});

test("generated invalid actions and reverting targets leave no execution state", async (t) => {
  const context = await fixture(t);
  const generated = fc.record({
    values: fc.uniqueArray(nonzeroBytes32, { minLength: 4, maxLength: 4 }),
    nonce: fc.integer({ min: 1, max: 1_000_000 }),
  });

  await campaign(
    "OApp rejection and rollback",
    generated,
    async ({ values: [authorizationId, guid, recordValue, otherGuid], nonce }) => {
      await withEvmSnapshot(context.provider, async () => {
        const data = targetInterface.encodeFunctionData("record", [recordValue]);
        const targetAddress = await context.target.getAddress();
        const receiver = await context.b.getAddress();
        const origin = { srcEid: 40161, sender: context.peerA, nonce };
        const validAction = {
          authorizationId,
          target: targetAddress,
          value: 0n,
          data,
        };
        const attackerPeer = zeroPadValue(
          await context.signers[7].getAddress(),
          32,
        );
        await deliverRejected(
          context.epB,
          receiver,
          { ...origin, sender: attackerPeer },
          guid,
          encodeAction(validAction),
        );
        await deliverRejected(
          context.epB,
          receiver,
          origin,
          guid,
          encodeAction({ ...validAction, authorizationId: zeroBytes32 }),
        );
        await deliverRejected(
          context.epB,
          receiver,
          origin,
          guid,
          encodeAction({
            ...validAction,
            target: "0x0000000000000000000000000000000000000000",
          }),
        );
        await deliverRejected(
          context.epB,
          receiver,
          origin,
          guid,
          encodeAction({
            ...validAction,
            target: await context.unauthorizedTarget.getAddress(),
          }),
        );
        await deliverRejected(context.epB, receiver, origin, guid, "0x1234");
        await deliverRejected(
          context.epB,
          receiver,
          origin,
          otherGuid,
          encodeAction({
            ...validAction,
            target: await context.revertingTarget.getAddress(),
          }),
        );

        const quoted = await context.a.quoteAction(40231, validAction, "0x", false);
        await assert.rejects(
          context.a.connect(context.signers[7]).sendAction(
            40231,
            validAction,
            "0x",
            { nativeFee: quoted.nativeFee, lzTokenFee: quoted.lzTokenFee },
            { value: quoted.nativeFee },
          ),
        );
        await assert.rejects(
          context.b.connect(context.signers[7]).setAuthorizedTarget(
            targetAddress,
            false,
          ),
        );

        assert.equal(await context.b.executedGuid(guid), false);
        assert.equal(await context.b.executedGuid(otherGuid), false);
        assert.equal(await context.b.executedAuthorization(authorizationId), false);
        assert.equal(await context.target.calls(), 0n);
        assert.equal(await context.revertingTarget.calls(), 0n);
      });
    },
    oappRejection,
  );
});
