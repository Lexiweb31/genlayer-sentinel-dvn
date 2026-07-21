import test from "node:test";
import assert from "node:assert/strict";
import { SentinelJob } from "../../../dist/packages/core/src/state-machine.js";

const h = n => `0x${n.repeat(64)}`;
const packet = {guid:h("1"),srcEid:40161,dstEid:40231,nonce:1n,sender:h("2"),receiver:h("3"),message:"0x",payloadHash:h("4"),txHash:h("5"),blockHash:h("6"),blockNumber:1n};
test("requires two agreeing RPCs and finalized allow before quorum", () => {
  const j = new SentinelJob(packet);
  j.addVerification({provider:"a",blockHash:h("6"),payloadHash:h("4"),confirmations:15n},15n);
  assert.throws(() => j.requestPolicy());
  j.addVerification({provider:"b",blockHash:h("6"),payloadHash:h("4"),confirmations:15n},15n);
  j.requestPolicy();
  j.finalize({guid:h("1"),packetDigest:h("4"),evidenceDigest:h("7"),decision:"ALLOW",reasonCode:"AUTHORIZED",finalizedAt:10,policyVersion:"1"},11);
  j.addSigner("0xA",3); j.addSigner("0xB",3); j.addSigner("0xC",3);
  assert.equal(j.snapshot.stage,"QUORUM_REACHED");
});
test("fails closed on RPC disagreement and denied policy", () => {
  const j = new SentinelJob(packet);
  assert.throws(() => j.addVerification({provider:"a",blockHash:h("9"),payloadHash:h("4"),confirmations:15n},15n));
  const k = new SentinelJob(packet);
  for (const provider of ["a","b"]) k.addVerification({provider,blockHash:h("6"),payloadHash:h("4"),confirmations:15n},15n);
  k.requestPolicy(); k.finalize({guid:h("1"),packetDigest:h("4"),evidenceDigest:h("7"),decision:"DENY",reasonCode:"NOT_AUTHORIZED",finalizedAt:10,policyVersion:"1"},11);
  assert.equal(k.snapshot.stage,"REJECTED"); assert.throws(() => k.addSigner("0xA",1));
});
