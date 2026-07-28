import test from "node:test";
import assert from "node:assert/strict";
import {
  decodeGenLayerRecord,
  genLayerRequestBinding,
  GENLAYER_RECORD_SCHEMA,
} from "../../../dist/services/coordinator/src/genlayer-record.js";

const h=n=>`0x${n.repeat(64)}`;
const request={
  packet:{
    guid:h("1"),
    srcEid:40161,
    dstEid:40231,
    nonce:1n,
    sender:h("2"),
    receiver:h("3"),
    message:"0x",
    payloadHash:h("4"),
    encodedPayloadHash:h("8"),
    txHash:h("5"),
    blockHash:h("6"),
    blockNumber:1n,
  },
  evidence:{
    uri:"https://governance.example/proposal/1",
    digest:h("7"),
    observedAt:9,
    validUntil:100,
  },
  decodedAction:"transfer 1 token",
  policy:"authorization required",
};
const binding="0xff5fc20f93d80fcfdac310a2ce93ccd8a3167711c656e8f034e36295a25e41c9";
const crossLanguageBinding="0xe8539dc6d81fbd8491d86ca707cccc0d0e3a91629565eda34e7e1b5a85693b42";

test("binds the exact registered request with a hand-checked digest",()=>{
  assert.equal(GENLAYER_RECORD_SCHEMA,"sentinel-policy-record/v1");
  assert.equal(genLayerRequestBinding(request,"v1"),binding);
  assert.notEqual(genLayerRequestBinding({...request,policy:"different"},"v1"),binding);
  assert.notEqual(genLayerRequestBinding({...request,decodedAction:"different"},"v1"),binding);
});

test("matches the Intelligent Contract request-binding proof vector",()=>{
  const canonicalRequest={
    ...request,
    evidence:{
      ...request.evidence,
      uri:"https://governance.example/proposal/7",
      digest:"0x576cf0b57420ca62f3ec30ae7fcd8b628ed284c717c586d6eb6ceb007127ec1b",
    },
    decodedAction:"transfer 1 token",
    policy:"Require an exact, unexpired governance authorization.",
  };
  assert.equal(
    genLayerRequestBinding(canonicalRequest,"treasury-v1"),
    crossLanguageBinding,
  );
});

test("decodes a versioned bound record without treating the reason as authorization",()=>{
  assert.deepEqual(
    decodeGenLayerRecord(`v1|ALLOW|${h("4")}|${h("7")}|v1|${binding}|authorization|proposal-7`,request),
    {decision:"ALLOW",policyVersion:"v1",requestBinding:binding,reason:"authorization|proposal-7"},
  );
  assert.equal(
    decodeGenLayerRecord(`v1|DENY|${h("4")}|${h("7")}|v1|${binding}|expired`,request).decision,
    "DENY",
  );
});

test("rejects malformed, oversized, or contradictory records",()=>{
  const records=[
    "",
    `v2|ALLOW|${h("4")}|${h("7")}|v1|${binding}|reason`,
    `v1|MAYBE|${h("4")}|${h("7")}|v1|${binding}|reason`,
    `v1|ALLOW|${h("0")}|${h("7")}|v1|${binding}|reason`,
    `v1|ALLOW|${h("4")}|${h("0")}|v1|${binding}|reason`,
    `v1|ALLOW|${h("4")}|${h("7")}|bad version|${binding}|reason`,
    `v1|ALLOW|${h("4")}|${h("7")}|v1|${h("0")}|reason`,
    `v1|ALLOW|${h("4")}|${h("7")}|v1|${binding}|`,
    `v1|ALLOW|${h("4")}|${h("7")}|v1|${binding}|${"é".repeat(513)}`,
  ];
  for(const raw of records){
    assert.throws(()=>decodeGenLayerRecord(raw,request),/GenLayer record binding mismatch/);
  }
  assert.throws(()=>decodeGenLayerRecord({decision:"ALLOW"},request),/invalid GenLayer policy record/);
});

test("rejects a valid-looking record bound to different action or policy inputs",()=>{
  assert.throws(
    ()=>decodeGenLayerRecord(`v1|ALLOW|${h("4")}|${h("7")}|v1|${binding}|reason`,{...request,decodedAction:"transfer 2 tokens"}),
    /GenLayer record binding mismatch/,
  );
  assert.throws(
    ()=>decodeGenLayerRecord(`v1|ALLOW|${h("4")}|${h("7")}|v1|${binding}|reason`,{...request,policy:"authorization optional"}),
    /GenLayer record binding mismatch/,
  );
});
