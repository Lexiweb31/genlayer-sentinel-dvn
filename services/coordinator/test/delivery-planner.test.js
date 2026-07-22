import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {concat,keccak256,solidityPackedKeccak256} from "ethers";
import {encodePacketV1} from "../../../dist/packages/core/src/packet-v1.js";
import {SentinelJob} from "../../../dist/packages/core/src/state-machine.js";
import {Coordinator} from "../../../dist/services/coordinator/src/coordinator.js";
import {DeliveryPlanner} from "../../../dist/services/coordinator/src/delivery-planner.js";
import {executionDigest} from "../../../dist/services/coordinator/src/signing.js";
import {Uln302IntentFactory} from "../../../dist/services/coordinator/src/uln302-intent.js";
import {SqliteVerificationOutbox} from "../../../dist/services/coordinator/src/verification-outbox.js";

const a=n=>`0x${n.repeat(40)}`,h=n=>`0x${n.repeat(64)}`,b=n=>`0x${"0".repeat(24)}${n.repeat(40)}`;
const authorized=[a("1"),a("2"),a("3"),a("4"),a("5")];
const path={observedBlockNumber:127n,observedBlockHash:h("d"),chainId:421614n,srcEid:40161,endpoint:a("7"),receiveLibrary:a("8"),oapp:a("4"),adapter:a("9"),confirmations:64n,requiredDvns:[a("a")],optionalDvns:[a("9"),a("b")],optionalDvnThreshold:1,authorizedSigners:authorized,quorum:3,configurationDigest:h("c")};

function policy(index=1,decision="ALLOW"){
  const nonce=BigInt(index),srcEid=40161,dstEid=40231,sender=h(String(index)),receiver=b("4"),message=`0x${String(index).repeat(2)}`,guid=solidityPackedKeccak256(["uint64","uint32","bytes32","uint32","bytes32"],[nonce,srcEid,sender,dstEid,receiver]),payloadHash=keccak256(concat([guid,message])),encoded=encodePacketV1({nonce,srcEid,sender,dstEid,receiver,guid,message});
  const packet={guid,srcEid,dstEid,nonce,sender,receiver,message,payloadHash,encodedPayloadHash:keccak256(encoded),txHash:h("e"),blockHash:h("f"),blockNumber:10n},evidence={uri:"https://governance.example/auth",digest:h("7"),observedAt:900,validUntil:2000},request={packet,evidence,decodedAction:"authorized action",policy:"exact authorization"},result={guid,packetDigest:payloadHash,evidenceDigest:evidence.digest,decision,reasonCode:`GENLAYER_FINALIZED_${decision}`,finalizedAt:950,policyVersion:"v1"};
  return{request,result};
}

function setup(t,{online=true,onSign,refuseGuid}={}){
  const dir=mkdtempSync(join(tmpdir(),"sentinel-planner-")),outbox=new SqliteVerificationOutbox(join(dir,"state.db"),authorized,3),state={online},signers=authorized.map((address,index)=>({address,sign:async envelope=>{await onSign?.(envelope);if(!state.online||envelope.guid===refuseGuid)throw new Error("signer offline");return{address,digest:executionDigest(envelope),signature:`0x${String(index+1).repeat(130)}`}}})),coordinator=new Coordinator({verify:async()=>[]},{submit:async()=>"",finalized:async()=>undefined},signers,3),reports=[],pathVerifier={verify:async()=>path},planner=new DeliveryPlanner(coordinator,outbox,pathVerifier,new Uln302IntentFactory(300),authorized,error=>reports.push(error),()=>1000);
  t.after(()=>{outbox.close();rmSync(dir,{recursive:true,force:true})});
  return{dir,outbox,state,coordinator,reports,pathVerifier,planner};
}

function seed(coordinator,value){coordinator.jobs.set(value.request.packet.guid,SentinelJob.restore({packet:value.request.packet,stage:value.result.decision==="ALLOW"?"POLICY_FINALIZED":"REJECTED",verifications:[],signers:[],result:value.result}));coordinator.requests.set(value.request.packet.guid,value.request)}

test("persists SIGNING before signer contact and advances only after durable READY",async t=>{
  let fixture,sawSigning=false;const value=policy(),holder={};fixture=setup(t,{onSign:async envelope=>{sawSigning=(await holder.outbox.get(envelope.guid)).state==="SIGNING"}});holder.outbox=fixture.outbox;seed(fixture.coordinator,value);
  assert.equal(await fixture.planner.pollOnce(),1);
  assert.equal(sawSigning,true);
  assert.equal((await fixture.outbox.get(value.request.packet.guid)).state,"READY");
  assert.equal(fixture.coordinator.jobs.get(value.request.packet.guid).snapshot.stage,"QUORUM_REACHED");
});

test("retries the identical durable digest after signer outage",async t=>{
  let pathCalls=0;const fixture=setup(t,{online:false}),value=policy();fixture.pathVerifier.verify=async()=>{pathCalls++;return path};seed(fixture.coordinator,value);
  await fixture.planner.pollOnce();const signing=await fixture.outbox.get(value.request.packet.guid);assert.equal(signing.state,"SIGNING");assert.equal(fixture.reports.length,1);
  fixture.state.online=true;await fixture.planner.pollOnce();const ready=await fixture.outbox.get(value.request.packet.guid);assert.equal(ready.state,"READY");assert.equal(ready.digest,signing.digest);assert.equal(pathCalls,1);
});

test("recovers READY without resigning, expires stale plans, and ignores DENY",async t=>{
  let signerCalls=0;const fixture=setup(t,{onSign:async()=>{signerCalls++}}),allowed=policy(),denied=policy(2,"DENY");seed(fixture.coordinator,allowed);seed(fixture.coordinator,denied);
  const envelope=new Uln302IntentFactory(300).create(allowed.request,allowed.result,path,1000),digest=executionDigest(envelope),shares=authorized.slice(0,3).map((address,index)=>({address,digest,signature:`0x${String(index+1).repeat(130)}`}));await fixture.outbox.plan(envelope.guid,envelope,1000);await fixture.outbox.recordQuorum(envelope.guid,shares,1000);
  await fixture.planner.pollOnce();assert.equal(signerCalls,0);assert.equal(fixture.coordinator.jobs.get(envelope.guid).snapshot.stage,"QUORUM_REACHED");assert.equal(await fixture.outbox.get(denied.request.packet.guid),undefined);
  const expiring=policy(3);seed(fixture.coordinator,expiring);const expiredEnvelope={...new Uln302IntentFactory(300).create(expiring.request,expiring.result,path,1000),expiry:1000n};await fixture.outbox.plan(expiredEnvelope.guid,expiredEnvelope,1000);await fixture.planner.pollOnce();const failed=await fixture.outbox.get(expiredEnvelope.guid);assert.equal(failed.state,"FAILED");assert.equal(failed.failureCode,"SIGNING_EXPIRED");
});

test("isolates one job failure and rejects impossible restored relationships",async t=>{
  const refused=policy(),accepted=policy(2),fixture=setup(t,{refuseGuid:refused.request.packet.guid});seed(fixture.coordinator,refused);seed(fixture.coordinator,accepted);await fixture.planner.pollOnce();assert.equal((await fixture.outbox.get(refused.request.packet.guid)).state,"SIGNING");assert.equal((await fixture.outbox.get(accepted.request.packet.guid)).state,"READY");assert.equal(fixture.reports.length,1);
  const missing=setup(t),missingValue=policy(3);seed(missing.coordinator,missingValue);missing.coordinator.jobs.get(missingValue.request.packet.guid).snapshot.stage="QUORUM_REACHED";await assert.rejects(missing.planner.reconcile(),/quorum/i);
  const rejected=setup(t),rejectedValue=policy(4,"DENY");seed(rejected.coordinator,rejectedValue);const fake={chainId:421614n,adapter:path.adapter,verificationTarget:path.receiveLibrary,guid:rejectedValue.request.packet.guid,packetDigest:rejectedValue.request.packet.payloadHash,evidenceDigest:rejectedValue.request.evidence.digest,callData:"0x1234",expiry:1300n};await rejected.outbox.plan(fake.guid,fake,1000);await assert.rejects(rejected.planner.reconcile(),/rejected/i);
});
