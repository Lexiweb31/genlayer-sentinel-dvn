import test from "node:test";
import assert from "node:assert/strict";
import {SourceBoundPacketVerifier} from "../../../dist/services/coordinator/src/source-bound-packet-verifier.js";

const h=n=>`0x${n.repeat(64)}`;
const packet={guid:h("1"),srcEid:40161,dstEid:40231,nonce:1n,sender:h("2"),receiver:h("3"),message:"0x",payloadHash:h("4"),encodedPayloadHash:h("5"),txHash:h("6"),blockHash:h("7"),blockNumber:8n};
const receipts=["https://a.example","https://b.example"].map(provider=>({provider,blockHash:packet.blockHash,payloadHash:packet.payloadHash,confirmations:15n}));
const path={configurationDigest:h("c")};

test("attaches one historical source configuration digest to both receipt proofs",async()=>{
  const verifier=new SourceBoundPacketVerifier({verify:async()=>receipts},{verify:async()=>path});
  assert.deepEqual(await verifier.verify(packet),receipts.map(value=>({...value,configurationDigest:h("c")})));
});

test("refuses deterministic confirmation when either receipt or source pathway proof fails",async()=>{
  await assert.rejects(new SourceBoundPacketVerifier({verify:async()=>{throw new Error("receipt failed")}},{verify:async()=>path}).verify(packet),/receipt failed/);
  await assert.rejects(new SourceBoundPacketVerifier({verify:async()=>receipts},{verify:async()=>{throw new Error("path failed")}}).verify(packet),/path failed/);
});

test("requires at least two independent receipt proofs before attaching the path digest",async()=>{
  await assert.rejects(new SourceBoundPacketVerifier({verify:async()=>receipts.slice(0,1)},{verify:async()=>path}).verify(packet),/two receipt verifications/);
});
