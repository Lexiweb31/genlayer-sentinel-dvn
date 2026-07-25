import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Wallet,getBytes} from "ethers";
import {executionDigest} from "../../../dist/services/coordinator/src/signing.js";
import {SqliteVerificationOutbox} from "../../../dist/services/coordinator/src/verification-outbox.js";
import {DestinationWorker} from "../../../dist/services/coordinator/src/destination-worker.js";

const h=n=>`0x${n.repeat(64)}`,a=n=>`0x${n.repeat(40)}`;
const envelope={chainId:421614n,adapter:a("1"),verificationTarget:a("2"),guid:h("3"),packetDigest:h("4"),evidenceDigest:h("5"),callData:"0x1234",expiry:200n},digest=executionDigest(envelope),wallets=[1,2,3,4,5].map(value=>new Wallet(`0x${value.toString(16).padStart(64,"0")}`)).sort((left,right)=>left.address.toLowerCase().localeCompare(right.address.toLowerCase())),authorized=wallets.map(wallet=>wallet.address.toLowerCase());
const makeShares=bound=>Promise.all(wallets.slice(0,3).map(async(wallet,index)=>({address:authorized[index],signature:await wallet.signMessage(getBytes(bound)),digest:bound})));

async function fixture(){const dir=mkdtempSync(join(tmpdir(),"sentinel-worker-")),store=new SqliteVerificationOutbox(join(dir,"state.db"),authorized,3);await prepare(store,envelope,100);return{dir,store,close(){store.close();rmSync(dir,{recursive:true,force:true})}}}
async function prepare(store,value,now){const bound=executionDigest(value);await store.plan(value.guid,value,now);await store.recordQuorum(value.guid,await makeShares(bound),now)}
const path={verify:async()=>({})};
const coordinatorDefaults={assertDeliveryReady:async()=>{},confirmExecution:async()=>{}};
const create=(store,adapter,verifier,coordinator=coordinatorDefaults,options={})=>new DestinationWorker(store,adapter,verifier,options.path??path,{...coordinatorDefaults,...coordinator},options.report??(()=>{}),options.clock??(()=>110));

test("persists submission intent before broadcast and then the transaction hash",async()=>{const f=await fixture(),calls=[],adapter={used:async()=>false,submitVerification:async()=>{calls.push((await f.store.get(envelope.guid)).state);return h("a")}},worker=create(f.store,adapter,{confirm:async()=>({status:"PENDING"})});assert.equal(await worker.pollOnce(),1);const record=await f.store.get(envelope.guid);assert.equal(record.state,"SUBMITTED");assert.equal(record.transactionHash,h("a"));assert.deepEqual(calls,["ATTEMPTING"]);f.close()});
test("waits for confirmation then advances destination execution without rechecking path",async()=>{const f=await fixture();await f.store.transition(envelope.guid,"READY",{state:"ATTEMPTING",updatedAt:105});await f.store.transition(envelope.guid,"ATTEMPTING",{state:"SUBMITTED",transactionHash:h("a"),updatedAt:106});const advanced=[],pathCalls=[],worker=create(f.store,{used:async()=>true,submitVerification:async()=>{throw new Error("must not submit")}}, {confirm:async()=>({status:"CONFIRMED",confirmations:15n})},{confirmExecution:async guid=>advanced.push(guid)},{path:{verify:async()=>pathCalls.push("path")}});await worker.pollOnce();assert.equal((await f.store.get(envelope.guid)).state,"CONFIRMED");assert.deepEqual(advanced,[envelope.guid]);assert.deepEqual(pathCalls,[]);f.close()});
test("leaves pending receipts unchanged and records known failures",async()=>{for(const result of[{status:"PENDING"},{status:"FAILED",code:"EVENT_MISMATCH"}]){const f=await fixture();await f.store.transition(envelope.guid,"READY",{state:"ATTEMPTING",updatedAt:105});await f.store.transition(envelope.guid,"ATTEMPTING",{state:"SUBMITTED",transactionHash:h("a"),updatedAt:106});const worker=create(f.store,{used:async()=>true,submitVerification:async()=>h("b")},{confirm:async()=>result});await worker.pollOnce();assert.equal((await f.store.get(envelope.guid)).state,result.status==="PENDING"?"SUBMITTED":"FAILED");f.close()}});
test("never rebroadcasts an ambiguous attempt or an already-used digest without receipt proof",async()=>{for(const setup of[async store=>store.transition(envelope.guid,"READY",{state:"ATTEMPTING",updatedAt:105}),async()=>{}]){const f=await fixture();await setup(f.store);let submissions=0;const worker=create(f.store,{used:async()=>true,submitVerification:async()=>{submissions++;return h("a")}},{confirm:async()=>({status:"PENDING"})});await worker.pollOnce();assert.equal((await f.store.get(envelope.guid)).state,"RECOVERY_REQUIRED");assert.equal(submissions,0);f.close()}});

test("fails closed on pathway drift while allowing another ready record to progress",async()=>{
  const f=await fixture(),second={...envelope,guid:h("b"),packetDigest:h("c")};await prepare(f.store,second,100);let pathCalls=0,adapterCalls=0;const reports=[],worker=create(f.store,{used:async()=>{adapterCalls++;return false},submitVerification:async value=>{adapterCalls++;return value.guid===second.guid?h("d"):h("e")}},{confirm:async()=>({status:"PENDING"})},{confirmExecution:async()=>{}},{path:{verify:async()=>{pathCalls++;if(pathCalls===1)throw new Error("secret RPC path")}},report:error=>reports.push(error.message)});
  assert.equal(await worker.pollOnce(),2);
  assert.equal((await f.store.get(envelope.guid)).state,"READY");
  assert.equal((await f.store.get(second.guid)).state,"SUBMITTED");
  assert.equal(adapterCalls,2);
  assert.deepEqual(reports,["destination pathway configuration unavailable"]);
  f.close();
});

test("blocks broadcast until the coordinator has durably recorded the exact quorum",async()=>{
  const f=await fixture(),reports=[];let adapterCalls=0,pathCalls=0;const worker=create(f.store,{used:async()=>{adapterCalls++;return false},submitVerification:async()=>{adapterCalls++;return h("a")}},{confirm:async()=>({status:"PENDING"})},{assertDeliveryReady:async()=>{throw new Error("disk full")},confirmExecution:async()=>{}},{path:{verify:async()=>{pathCalls++}},report:error=>reports.push(error.message)});
  await worker.pollOnce();assert.equal((await f.store.get(envelope.guid)).state,"READY");assert.equal(pathCalls,0);assert.equal(adapterCalls,0);assert.deepEqual(reports,["destination coordinator quorum unavailable"]);f.close();
});

test("fails an expired READY authorization before pathway or adapter RPC",async()=>{
  const f=await fixture();let calls=0;const worker=create(f.store,{used:async()=>{calls++;return false},submitVerification:async()=>{calls++;return h("a")}},{confirm:async()=>({status:"PENDING"})},coordinatorDefaults,{clock:()=>200,path:{verify:async()=>{calls++}}});
  await worker.pollOnce();const record=await f.store.get(envelope.guid);assert.equal(record.state,"FAILED");assert.equal(record.failureCode,"SIGNING_EXPIRED");assert.equal(calls,0);f.close();
});

test("rechecks expiry after pathway observation immediately before broadcast",async()=>{
  const f=await fixture();let now=199,submissions=0;const worker=create(f.store,{used:async()=>false,submitVerification:async()=>{submissions++;return h("a")}},{confirm:async()=>({status:"PENDING"})},coordinatorDefaults,{clock:()=>now,path:{verify:async()=>{now=200}}});
  await worker.pollOnce();const record=await f.store.get(envelope.guid);assert.equal(record.state,"FAILED");assert.equal(record.failureCode,"SIGNING_EXPIRED");assert.equal(submissions,0);f.close();
});

test("sanitizes destination adapter state transport failures",async()=>{
  const f=await fixture(),reports=[];const worker=create(f.store,{used:async()=>{throw new Error("https://user:secret@rpc.example/private")},submitVerification:async()=>h("a")},{confirm:async()=>({status:"PENDING"})},coordinatorDefaults,{report:error=>reports.push(error.message)});
  await worker.pollOnce();assert.equal((await f.store.get(envelope.guid)).state,"READY");assert.deepEqual(reports,["destination adapter state unavailable"]);f.close();
});
