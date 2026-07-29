import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {composeRuntime} from "../../../dist/services/coordinator/src/compose-runtime.js";
import {SqliteJobStore} from "../../../dist/services/coordinator/src/job-store.js";
import {SqliteListenerStore} from "../../../dist/services/coordinator/src/listener-store.js";
import {SqliteRecoveryStore} from "../../../dist/services/coordinator/src/recovery-store.js";
import {SqliteRuntimeLease} from "../../../dist/services/coordinator/src/runtime-lease.js";
import {SqliteVerificationOutbox} from "../../../dist/services/coordinator/src/verification-outbox.js";

const a=n=>`0x${n.repeat(40)}`,h=n=>`0x${n.repeat(64)}`,b=n=>`0x${"0".repeat(24)}${n.repeat(40)}`;
const authorized=[a("1"),a("2"),a("3"),a("4"),a("5")];
function config(path){return{mode:"TESTNET_PROTOTYPE",pathway:{name:"test",sourceChainId:11155111,destinationChainId:421614,srcEid:40161,dstEid:40231,endpoint:a("1"),sendLibrary:a("2"),sourceOApp:b("3"),sourceOAppAddress:a("3"),destinationOApp:b("4"),sentinelDvn:a("5"),executor:a("6"),maxMessageSize:10000,deadDvn:a("d"),requiredDvns:[a("a")],optionalDvns:[a("5"),a("b")],optionalDvnThreshold:1,startBlock:1n,confirmations:15n,rpcUrls:["https://rpc-a.example","https://rpc-b.example"]},destination:{rpcUrls:["https://dst-a.example","https://dst-b.example"],chainId:421614,srcEid:40161,endpoint:a("7"),receiveLibrary:a("8"),oapp:a("4"),adapter:a("9"),useDefaultReceiveLibrary:false,confirmations:64n,requiredDvns:[a("a")],optionalDvns:[a("9"),a("b")],optionalDvnThreshold:1,authorizedSigners:authorized,quorum:3,signatureTtlSeconds:300},evidence:{uri:"https://governance.example/auth",allowedHost:"governance.example",policy:"exact authorization",ttlSeconds:300,maximumBytes:262144},genlayer:{endpoint:"https://genlayer.example/api",policyContract:a("6")},recovery:{operators:[a("6"),a("7"),a("8"),a("9"),a("c")],quorum:3,minimumDelaySeconds:900,maximumLifetimeSeconds:3600},storage:{sqlitePath:path},runtime:{pollIntervalMs:5000,maxIngestionAttempts:3},status:{host:"127.0.0.1",port:0}}}
function capabilities(){let signerCalls=0,destinationCalls=0,genlayerCalls=0;const value={genlayer:{writeContract:async()=>{genlayerCalls++;return h("7")},getTransaction:async()=>({}),readContract:async()=>""},sourceRpc:async()=>{throw new Error("source RPC fixture invoked")},signers:authorized.map(address=>({address,sign:async()=>{signerCalls++;throw new Error("unexpected signer call")}})),destinationSubmitter:{used:async()=>{destinationCalls++;return false},submitVerification:async()=>{destinationCalls++;return h("8")}},destinationRpc:async()=>{destinationCalls++;throw new Error("unexpected destination RPC")},presentationMode:"LOCAL_TEST"};return{value,signerCalls:()=>signerCalls,destinationCalls:()=>destinationCalls,genlayerCalls:()=>genlayerCalls}}
function serverJson(server,path){
  return new Promise((resolveResponse,reject)=>{
    const listener=server.listeners("request")[0];
    if(typeof listener!=="function"){reject(new Error("request listener unavailable"));return}
    const response={
      statusCode:0,
      headers:new Map(),
      setHeader(name,value){this.headers.set(name,value)},
      end(body){resolveResponse({status:this.statusCode,body:JSON.parse(String(body))})}
    };
    Promise.resolve(listener({method:"GET",url:path},response)).catch(reject);
  });
}

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

test("uses the injected source transport and blocks GenLayer submission when deterministic source proof fails",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"sentinel-runtime-")),caps=capabilities(),originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>{throw new Error("default source transport used")};
  const value=composeRuntime(config(join(dir,"state.db")),caps.value,resolve("apps/dashboard"));
  const packet={guid:h("1"),srcEid:40161,dstEid:40231,nonce:1n,sender:b("3"),receiver:b("4"),message:"0x",payloadHash:h("2"),encodedPayloadHash:h("3"),txHash:h("4"),blockHash:h("5"),blockNumber:10n};
  const request={packet,evidence:{uri:"https://governance.example/auth",digest:h("6"),observedAt:9,validUntil:100},decodedAction:"{}",policy:"exact authorization"};
  try{
    await assert.rejects(value.coordinator.detect(request,10),/source RPC fixture invoked|source pathway RPC unavailable/);
    assert.equal(caps.genlayerCalls(),0);
  }finally{globalThis.fetch=originalFetch;await value.runtime.stop();rmSync(dir,{recursive:true,force:true})}
});

test("closes every acquired store in reverse order when composition fails",()=>{
  const dir=mkdtempSync(join(tmpdir(),"sentinel-runtime-")),path=join(dir,"state.db"),caps=capabilities(),closed=[];
  const tracked=(name,store)=>{const close=store.close.bind(store);store.close=()=>{closed.push(name);close()};return store};
  const stores={job:value=>tracked("job",new SqliteJobStore(value)),listener:value=>tracked("listener",new SqliteListenerStore(value)),recovery:value=>tracked("recovery",new SqliteRecoveryStore(value)),outbox:()=>{throw new Error("outbox construction failed")}};
  try{assert.throws(()=>composeRuntime(config(path),caps.value,resolve("apps/dashboard"),console.error,undefined,stores),/outbox construction failed/);assert.deepEqual(closed,["recovery","listener","job"])}finally{rmSync(dir,{recursive:true,force:true})}
});

test("binds HTTP before claiming the runtime lease and releases it before store close",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"sentinel-runtime-")),path=join(dir,"state.db"),caps=capabilities(),calls=[];
  const lease={claimRuntime:async()=>calls.push("claim"),heartbeatRuntime:async()=>calls.push("heartbeat"),releaseRuntime:async()=>calls.push("release"),assertReleased:async()=>{},acquireRecovery:async()=>{},releaseRecovery:async()=>{},close:()=>calls.push("close-lease")};
  const stores={job:value=>new SqliteJobStore(value),listener:value=>new SqliteListenerStore(value),recovery:value=>new SqliteRecoveryStore(value),outbox:(value,signers,quorum)=>new SqliteVerificationOutbox(value,signers,quorum),lease:()=>lease};
  const socket={listen:async()=>calls.push("listen"),close:async()=>calls.push("close-http")};
  try{
    const value=composeRuntime(config(path),caps.value,resolve("apps/dashboard"),console.error,socket,stores);
    assert.deepEqual(calls,[]);
    await value.runtime.start();assert.deepEqual(calls.slice(0,2),["listen","claim"]);
    await value.runtime.stop();assert.deepEqual(calls.slice(-3),["close-http","release","close-lease"]);
  }finally{rmSync(dir,{recursive:true,force:true})}
});

test("shares one leased runtime observation with the production dashboard",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"sentinel-runtime-")),path=join(dir,"state.db"),caps=capabilities();
  let server,startingStatus;
  const socket={
    listen:async value=>{
      server=value;
      startingStatus=await serverJson(server,"/api/runtime-status");
    },
    close:async()=>{}
  };
  const value=composeRuntime(config(path),caps.value,resolve("apps/dashboard"),console.error,socket);
  try{
    await value.runtime.start();
    const{observedAt,...starting}=startingStatus.body;
    assert.equal(Number.isSafeInteger(observedAt),true);
    assert.deepEqual(starting,{
      version:1,
      lifecycle:"STARTING",
      lease:"NOT_CLAIMED",
      recoveryPosture:"REQUIRES_OFFLINE_VERIFICATION",
      tick:{active:false,phase:"IDLE",lastOutcome:"NEVER"}
    });
    const running=await serverJson(server,"/api/runtime-status");
    assert.equal(running.status,200);
    assert.equal(running.body.lifecycle,"RUNNING");
    assert.equal(running.body.lease,"CLAIMED");
    assert.equal(running.body.recoveryPosture,"BLOCKED_BY_ACTIVE_RUNTIME");
  }finally{await value.runtime.stop();rmSync(dir,{recursive:true,force:true})}
});

test("fails startup closed when another live runtime owns the durable lease",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"sentinel-runtime-")),path=join(dir,"state.db"),caps=capabilities(),owner=new SqliteRuntimeLease(path,60),socketCalls=[];
  await owner.claimRuntime("other-runtime",Math.floor(Date.now()/1000),false);
  const value=composeRuntime(config(path),caps.value,resolve("apps/dashboard"),console.error,{listen:async()=>socketCalls.push("listen"),close:async()=>socketCalls.push("close")});
  try{await assert.rejects(value.runtime.start(),/runtime active/);assert.deepEqual(socketCalls,["listen","close"]);await assert.rejects(value.outbox.list())}
  finally{await owner.releaseRuntime("other-runtime",Math.floor(Date.now()/1000));owner.close();rmSync(dir,{recursive:true,force:true})}
});
