import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {Wallet,getBytes} from "ethers";
import {executionDigest} from "../../../dist/services/coordinator/src/signing.js";
import {SqliteVerificationOutbox} from "../../../dist/services/coordinator/src/verification-outbox.js";

const h=n=>`0x${n.repeat(64)}`,a=n=>`0x${n.repeat(40)}`;
const envelope={chainId:421614n,adapter:a("1"),verificationTarget:a("2"),guid:h("3"),packetDigest:h("4"),evidenceDigest:h("5"),callData:"0x1234",expiry:200n};
const digest=executionDigest(envelope),wallets=[1,2,3,4,5].map(value=>new Wallet(`0x${value.toString(16).padStart(64,"0")}`)).sort((left,right)=>left.address.toLowerCase().localeCompare(right.address.toLowerCase())),authorized=wallets.map(wallet=>wallet.address.toLowerCase()),outsider=new Wallet(`0x${"9".padStart(64,"0")}`);
const share=async(wallet,bound=digest,address=wallet.address.toLowerCase())=>({address,signature:await wallet.signMessage(getBytes(bound)),digest:bound});
const shares=await Promise.all(wallets.slice(0,3).map(wallet=>share(wallet))),fourth=await share(wallets[3]),outsiderShare=await share(outsider),impostor={...outsiderShare,address:authorized[2]};
const recoveryOperators=[a("a"),a("b"),a("c")],candidate=h("f"),audit={actionId:h("6"),kind:"DESTINATION_CONFIRM",deploymentDigest:h("7"),subject:envelope.guid,preconditionDigest:h("8"),candidateTransactionHash:candidate,operators:recoveryOperators,preparedAt:100,executeAfter:1000,expiresAt:3700,resultCode:"DESTINATION_CONFIRMED"};

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
    [...shares,fourth],
    [...shares].reverse(),
    [shares[0],shares[0],shares[2]],
    [shares[0],shares[1],outsiderShare],
    [shares[0],shares[1],await share(wallets[2],h("9"))],
    [shares[0],shares[1],impostor],
    [shares[0],shares[1],{...shares[2],signature:"0x12"}]
  ];
  for(const value of invalid)await assert.rejects(store.recordQuorum(envelope.guid,value,110));
  await store.recordQuorum(envelope.guid,shares,110);
  await assert.rejects(store.recordQuorum(envelope.guid,[shares[0],shares[1],fourth],111),/conflict/);
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

test("rejects expired quorum attachment and impossible confirmation shortcuts",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"sentinel-outbox-")),store=new SqliteVerificationOutbox(join(dir,"state.db"),authorized,3);
  await store.plan(envelope.guid,envelope,100);
  await assert.rejects(store.recordQuorum(envelope.guid,shares,200),/expired/i);
  await store.recordQuorum(envelope.guid,shares,199);
  await assert.rejects(store.transition(envelope.guid,"READY",{state:"CONFIRMED",confirmations:1n,updatedAt:199}));
  store.close();rmSync(dir,{recursive:true,force:true});
});

test("rejects persisted records that violate their restored state invariants",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"sentinel-outbox-")),path=join(dir,"state.db");
  let store=new SqliteVerificationOutbox(path,authorized,3);await store.plan(envelope.guid,envelope,100);await store.recordQuorum(envelope.guid,shares,110);store.close();
  const db=new DatabaseSync(path),row=db.prepare("SELECT record_json FROM verification_outbox WHERE guid=?").get(envelope.guid),record=JSON.parse(row.record_json);record.shares=[];db.prepare("UPDATE verification_outbox SET record_json=? WHERE guid=?").run(JSON.stringify(record),envelope.guid);db.close();
  store=new SqliteVerificationOutbox(path,authorized,3);await assert.rejects(store.get(envelope.guid),/invariant/);store.close();rmSync(dir,{recursive:true,force:true});
});

test("atomically confirms an ambiguous transaction without the general transition map",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"sentinel-outbox-")),store=new SqliteVerificationOutbox(join(dir,"state.db"),authorized,3);
  await store.plan(envelope.guid,envelope,100);await store.recordQuorum(envelope.guid,shares,110);
  await store.transition(envelope.guid,"READY",{state:"RECOVERY_REQUIRED",failureCode:"SUBMISSION_AMBIGUOUS",transactionHash:candidate,updatedAt:120});
  const recovered=await store.recoverConfirmed(envelope.guid,digest,"SUBMISSION_AMBIGUOUS",candidate,15n,audit,1100);
  assert.equal(recovered.record.state,"CONFIRMED");assert.equal(recovered.record.transactionHash,candidate);assert.equal(recovered.record.confirmations,15n);assert.equal(recovered.record.failureCode,undefined);
  assert.deepEqual(recovered.record.envelope,envelope);assert.deepEqual(recovered.record.shares,shares);assert.deepEqual(await store.listRecoveryReceipts(),[recovered.receipt]);
  assert.deepEqual(await store.recoverConfirmed(envelope.guid,digest,"SUBMISSION_AMBIGUOUS",candidate,15n,audit,1200),recovered);
  store.close();rmSync(dir,{recursive:true,force:true});
});

test("leaves ambiguous records and the ledger unchanged when protected inputs drift",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"sentinel-outbox-")),store=new SqliteVerificationOutbox(join(dir,"state.db"),authorized,3);
  await store.plan(envelope.guid,envelope,100);await store.recordQuorum(envelope.guid,shares,110);
  await store.transition(envelope.guid,"READY",{state:"RECOVERY_REQUIRED",failureCode:"SUBMISSION_AMBIGUOUS",transactionHash:candidate,updatedAt:120});
  const failures=[
    [h("9"),digest,"SUBMISSION_AMBIGUOUS",candidate,15n,audit,1100],
    [envelope.guid,h("9"),"SUBMISSION_AMBIGUOUS",candidate,15n,audit,1100],
    [envelope.guid,digest,"OTHER_FAILURE",candidate,15n,audit,1100],
    [envelope.guid,digest,"SUBMISSION_AMBIGUOUS",h("9"),15n,audit,1100],
    [envelope.guid,digest,"SUBMISSION_AMBIGUOUS",candidate,0n,audit,1100]
  ];
  for(const args of failures)await assert.rejects(store.recoverConfirmed(...args));
  assert.equal((await store.get(envelope.guid)).state,"RECOVERY_REQUIRED");assert.equal((await store.listRecoveryReceipts()).length,0);
  store.close();rmSync(dir,{recursive:true,force:true});
});
