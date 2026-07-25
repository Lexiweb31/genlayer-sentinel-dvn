import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {composeRuntime} from "../../../dist/services/coordinator/src/compose-runtime.js";
import {SqliteJobStore} from "../../../dist/services/coordinator/src/job-store.js";
import {SqliteListenerStore} from "../../../dist/services/coordinator/src/listener-store.js";
import {SqliteRecoveryStore} from "../../../dist/services/coordinator/src/recovery-store.js";

const a=n=>`0x${n.repeat(40)}`,h=n=>`0x${n.repeat(64)}`,b=n=>`0x${"0".repeat(24)}${n.repeat(40)}`;
const authorized=[a("1"),a("2"),a("3"),a("4"),a("5")];
function config(path){return{mode:"TESTNET_PROTOTYPE",pathway:{name:"test",sourceChainId:11155111,destinationChainId:421614,srcEid:40161,dstEid:40231,endpoint:a("1"),sendLibrary:a("2"),sourceOApp:h("3"),destinationOApp:b("4"),sentinelDvn:a("5"),startBlock:1n,confirmations:15n,rpcUrls:["https://rpc-a.example","https://rpc-b.example"]},destination:{rpcUrls:["https://dst-a.example","https://dst-b.example"],chainId:421614,srcEid:40161,endpoint:a("7"),receiveLibrary:a("8"),oapp:a("4"),adapter:a("9"),useDefaultReceiveLibrary:false,confirmations:64n,requiredDvns:[a("a")],optionalDvns:[a("9"),a("b")],optionalDvnThreshold:1,authorizedSigners:authorized,quorum:3,signatureTtlSeconds:300},evidence:{uri:"https://governance.example/auth",allowedHost:"governance.example",policy:"exact authorization",ttlSeconds:300,maximumBytes:262144},genlayer:{endpoint:"https://genlayer.example/api",policyContract:a("6")},storage:{sqlitePath:path},runtime:{pollIntervalMs:5000,maxIngestionAttempts:3},status:{host:"127.0.0.1",port:0}}}
function capabilities(){let signerCalls=0,destinationCalls=0;const value={genlayer:{writeContract:async()=>h("7"),getTransaction:async()=>({}),readContract:async()=>""},signers:authorized.map(address=>({address,sign:async()=>{signerCalls++;throw new Error("unexpected signer call")}})),destinationSubmitter:{used:async()=>{destinationCalls++;return false},submitVerification:async()=>{destinationCalls++;return h("8")}},destinationRpc:async()=>{destinationCalls++;throw new Error("unexpected destination RPC")},presentationMode:"LOCAL_TEST"};return{value,signerCalls:()=>signerCalls,destinationCalls:()=>destinationCalls}}

test("composes the complete loopback runtime without eager account, signer, or network work",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"sentinel-runtime-")),socketCalls=[],caps=capabilities(),originalFetch=globalThis.fetch;let genlayerFetches=0;globalThis.fetch=async()=>{genlayerFetches++;throw new Error("unexpected network call")};
  try{
    const value=composeRuntime(config(join(dir,"state.db")),caps.value,resolve("apps/dashboard"),console.error,{listen:async(_server,port,host)=>socketCalls.push(["listen",port,host]),close:async()=>socketCalls.push(["close"])});
    assert.equal(value.coordinator.signers.length,5);assert.deepEqual(await value.outbox.list(),[]);assert.ok(value.planner);assert.ok(value.destinationWorker);assert.deepEqual(await value.recovery.listDead(),[]);
    await value.runtime.start();assert.equal(value.runtime.status.started,true);await value.runtime.stop();assert.equal(value.runtime.status.started,false);
    assert.equal(genlayerFetches,0);assert.equal(caps.signerCalls(),0);assert.equal(caps.destinationCalls(),0);assert.deepEqual(socketCalls,[["listen",0,"127.0.0.1"],["close"]]);await assert.rejects(value.outbox.list());
  }finally{globalThis.fetch=originalFetch;rmSync(dir,{recursive:true,force:true})}
});

test("rejects capability signer identities that do not exactly match the manifest",()=>{const dir=mkdtempSync(join(tmpdir(),"sentinel-runtime-")),caps=capabilities();try{assert.throws(()=>composeRuntime(config(join(dir,"state.db")),{...caps.value,signers:caps.value.signers.slice(0,4)},resolve("apps/dashboard")),/signer identities/)}finally{rmSync(dir,{recursive:true,force:true})}});

test("closes every acquired store in reverse order when composition fails",()=>{
  const dir=mkdtempSync(join(tmpdir(),"sentinel-runtime-")),path=join(dir,"state.db"),caps=capabilities(),closed=[];
  const tracked=(name,store)=>{const close=store.close.bind(store);store.close=()=>{closed.push(name);close()};return store};
  const stores={job:value=>tracked("job",new SqliteJobStore(value)),listener:value=>tracked("listener",new SqliteListenerStore(value)),recovery:value=>tracked("recovery",new SqliteRecoveryStore(value)),outbox:()=>{throw new Error("outbox construction failed")}};
  try{assert.throws(()=>composeRuntime(config(path),caps.value,resolve("apps/dashboard"),console.error,undefined,stores),/outbox construction failed/);assert.deepEqual(closed,["recovery","listener","job"])}finally{rmSync(dir,{recursive:true,force:true})}
});
