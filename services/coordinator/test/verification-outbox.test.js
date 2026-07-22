import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {executionDigest} from "../../../dist/services/coordinator/src/signing.js";
import {SqliteVerificationOutbox} from "../../../dist/services/coordinator/src/verification-outbox.js";

const h=n=>`0x${n.repeat(64)}`,a=n=>`0x${n.repeat(40)}`;
const envelope={chainId:421614n,adapter:a("1"),verificationTarget:a("2"),guid:h("3"),packetDigest:h("4"),evidenceDigest:h("5"),callData:"0x1234",expiry:200n};
const digest=executionDigest(envelope),authorized=[a("6"),a("7"),a("8"),a("9"),a("a")];
const share=(address,digit="1",bound=digest)=>({address,signature:`0x${digit.repeat(130)}`,digest:bound});
const shares=[share(a("6"),"1"),share(a("7"),"2"),share(a("8"),"3")];

test("persists an immutable signing plan before attaching a durable quorum",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"sentinel-outbox-")),path=join(dir,"state.db");
  let store=new SqliteVerificationOutbox(path,authorized,3);
  const signing=await store.plan(envelope.guid,envelope,100);
  assert.equal(signing.state,"SIGNING");
  assert.deepEqual(signing.shares,[]);
  assert.equal(signing.envelope.chainId,421614n);
  assert.deepEqual(await store.plan(envelope.guid,envelope,101),signing);
  store.close();
  store=new SqliteVerificationOutbox(path,authorized,3);
  assert.equal((await store.get(envelope.guid)).state,"SIGNING");
  const ready=await store.recordQuorum(envelope.guid,shares,110);
  assert.equal(ready.state,"READY");
  assert.equal(ready.shares.length,3);
  assert.deepEqual(await store.recordQuorum(envelope.guid,shares,111),ready);
  store.close();rmSync(dir,{recursive:true,force:true});
});

test("rejects conflicting plans and invalid or changed quorum material",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"sentinel-outbox-")),store=new SqliteVerificationOutbox(join(dir,"state.db"),authorized,3);
  await assert.rejects(store.recordQuorum(envelope.guid,shares,100),/unknown/);
  await store.plan(envelope.guid,envelope,100);
  await assert.rejects(store.plan(envelope.guid,{...envelope,callData:"0x5678"},101),/conflict/);
  const invalid=[
    shares.slice(0,2),
    [...shares,share(a("9"),"4")],
    [...shares].reverse(),
    [shares[0],shares[0],shares[2]],
    [shares[0],shares[1],share(a("b"),"3")],
    [shares[0],shares[1],share(a("8"),"3",h("9"))],
    [shares[0],shares[1],{...shares[2],signature:"0x12"}]
  ];
  for(const value of invalid)await assert.rejects(store.recordQuorum(envelope.guid,value,110));
  await store.recordQuorum(envelope.guid,shares,110);
  await assert.rejects(store.recordQuorum(envelope.guid,[shares[0],shares[1],share(a("9"),"4")],111),/conflict/);
  store.close();rmSync(dir,{recursive:true,force:true});
});

test("enforces signing expiry and monotonic delivery transitions",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"sentinel-outbox-")),path=join(dir,"state.db"),expiredGuid=h("b"),store=new SqliteVerificationOutbox(path,authorized,3);
  await store.plan(expiredGuid,{...envelope,guid:expiredGuid},100);
  await assert.rejects(store.transition(expiredGuid,"SIGNING",{state:"FAILED",failureCode:"OTHER_FAILURE",updatedAt:110}));
  assert.equal((await store.transition(expiredGuid,"SIGNING",{state:"FAILED",failureCode:"SIGNING_EXPIRED",updatedAt:110})).state,"FAILED");
  await store.plan(envelope.guid,envelope,100);await store.recordQuorum(envelope.guid,shares,105);
  let record=await store.transition(envelope.guid,"READY",{state:"ATTEMPTING",updatedAt:110});assert.equal(record.state,"ATTEMPTING");
  record=await store.transition(envelope.guid,"ATTEMPTING",{state:"SUBMITTED",transactionHash:h("a"),updatedAt:120});assert.equal(record.transactionHash,h("a"));
  record=await store.transition(envelope.guid,"SUBMITTED",{state:"CONFIRMED",confirmations:15n,updatedAt:130});assert.equal(record.confirmations,15n);
  await assert.rejects(store.transition(envelope.guid,"SUBMITTED",{state:"FAILED",failureCode:"RECEIPT_FAILED",updatedAt:140}),/state/);
  await assert.rejects(store.transition(envelope.guid,"CONFIRMED",{state:"READY",updatedAt:140}),/transition/);
  store.close();rmSync(dir,{recursive:true,force:true});
});

test("rejects persisted records that violate their restored state invariants",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"sentinel-outbox-")),path=join(dir,"state.db");
  let store=new SqliteVerificationOutbox(path,authorized,3);await store.plan(envelope.guid,envelope,100);await store.recordQuorum(envelope.guid,shares,110);store.close();
  const db=new DatabaseSync(path),row=db.prepare("SELECT record_json FROM verification_outbox WHERE guid=?").get(envelope.guid),record=JSON.parse(row.record_json);record.shares=[];db.prepare("UPDATE verification_outbox SET record_json=? WHERE guid=?").run(JSON.stringify(record),envelope.guid);db.close();
  store=new SqliteVerificationOutbox(path,authorized,3);await assert.rejects(store.get(envelope.guid),/invariant/);store.close();rmSync(dir,{recursive:true,force:true});
});
