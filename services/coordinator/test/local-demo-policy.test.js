import test from "node:test";
import assert from "node:assert/strict";
import {Interface,id,sha256,toUtf8Bytes} from "ethers";
import {
  LOCAL_DEMO_EVIDENCE_URI,
  LocalDemoEvidenceSource,
  LocalDemoFinality
} from "../../../dist/services/coordinator/src/local-demo-policy.js";

const h=value=>`0x${value.repeat(64)}`;
const address=value=>`0x${value.repeat(40)}`;
const authorizationId=h("5");
const target=address("6");
const record=new Interface(["function record(bytes32)"]);
const selector=record.getFunction("record").selector;
const approvedCalldata=record.encodeFunctionData("record",[id("approved")]);
const changedCalldata=record.encodeFunctionData("record",[id("changed")]);
const evidenceBody=JSON.stringify({
  authorizationId,
  target,
  value:"0",
  selector,
  calldata:approvedCalldata,
  status:"AUTHORIZED",
  policyVersion:"local-demo-v1"
});
const authority={authorizationId,target,selector,approvedCalldata,policyVersion:"local-demo-v1",evidenceBody};
const packet={guid:h("1"),srcEid:40161,dstEid:40231,nonce:1n,sender:h("2"),receiver:h("3"),message:"0x",payloadHash:h("4"),encodedPayloadHash:h("8"),txHash:h("9"),blockHash:h("a"),blockNumber:90n};
const action=overrides=>JSON.stringify({authorizationId,target,value:"0",selector,calldata:approvedCalldata,...overrides});
const request=overrides=>({
  packet,
  evidence:{uri:LOCAL_DEMO_EVIDENCE_URI,digest:sha256(toUtf8Bytes(evidenceBody)),observedAt:900,validUntil:1100},
  decodedAction:action({}),
  policy:"exact local governance authorization required",
  ...overrides
});

async function finalize(finality,value){
  const requestId=await finality.submit(value);
  assert.equal(await finality.finalized(requestId),undefined);
  return{requestId,result:await finality.finalized(requestId)};
}

test("returns pending once and then a stable finalized allow bound to the canonical request",async()=>{
  const finality=new LocalDemoFinality(authority,()=>1000);
  const first=await finalize(finality,request());
  const second=await finality.finalized(first.requestId);
  assert.equal(first.result.decision,"ALLOW");
  assert.equal(first.result.reasonCode,"LOCAL_FIXTURE_ALLOW");
  assert.equal(first.result.guid,packet.guid);
  assert.equal(first.result.packetDigest,packet.payloadHash);
  assert.equal(first.result.evidenceDigest,request().evidence.digest);
  assert.equal(first.result.policyVersion,"local-demo-v1");
  assert.equal(first.result.finalizedAt,1000);
  assert.deepEqual(second,first.result);

  const repeated=await finality.submit(request());
  assert.equal(repeated,first.requestId);
  assert.deepEqual(await finality.finalized(repeated),first.result);
});

test("finalizes valid semantic mismatches as denial before anything becomes signable",async()=>{
  const variations=[
    {calldata:changedCalldata},
    {authorizationId:h("b")},
    {target:address("c")},
    {value:"1"},
    {selector:"0x12345678",calldata:`0x12345678${"00".repeat(32)}`}
  ];
  for(const changed of variations){
    const finality=new LocalDemoFinality(authority,()=>1000);
    const {result}=await finalize(finality,request({decodedAction:action(changed)}));
    assert.equal(result.decision,"DENY");
    assert.equal(result.reasonCode,"LOCAL_FIXTURE_DENY");
  }
});

test("fails closed on stale or inconsistently bound evidence and malformed actions",async()=>{
  const finality=new LocalDemoFinality(authority,()=>1000);
  await assert.rejects(finality.submit(request({evidence:{...request().evidence,validUntil:1000}})),/expired/);
  await assert.rejects(finality.submit(request({evidence:{...request().evidence,digest:h("d")}})),/evidence digest/);
  for(const decodedAction of[
    "not json",
    JSON.stringify({authorizationId,target,value:"0",selector}),
    JSON.stringify({authorizationId,target,value:"0",selector,calldata:approvedCalldata,extra:true}),
    JSON.stringify({authorizationId,target,value:"00",selector,calldata:approvedCalldata}),
    JSON.stringify({authorizationId,target,value:"0",selector,calldata:"0x1234"})
  ])await assert.rejects(finality.submit(request({decodedAction})),/decoded action/);
});

test("restores only the exact deterministic request binding",async()=>{
  const original=new LocalDemoFinality(authority,()=>1000);
  const requestId=await original.submit(request());
  const restored=new LocalDemoFinality(authority,()=>1000);
  restored.register(requestId,request());
  assert.equal(await restored.finalized(requestId),undefined);
  assert.equal((await restored.finalized(requestId)).decision,"ALLOW");
  assert.throws(()=>restored.register(requestId,request({packet:{...packet,guid:h("e")}})),/request binding mismatch/);
  assert.throws(()=>restored.register(requestId,request({policy:"changed"})),/binding conflict/);
  await assert.rejects(restored.finalized(h("f")),/unknown local fixture request/);
});

test("serves one immutable canonical evidence document without network access",async()=>{
  const source=new LocalDemoEvidenceSource(evidenceBody);
  assert.equal(await source.read(LOCAL_DEMO_EVIDENCE_URI),evidenceBody);
  await assert.rejects(source.read("https://governance.fixture.invalid/other"),/unsupported local evidence URI/);
  assert.throws(()=>new LocalDemoEvidenceSource('{"status":"AUTHORIZED" }'),/canonical JSON/);
});
