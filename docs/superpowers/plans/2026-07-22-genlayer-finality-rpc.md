# GenLayer Finality RPC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate Sentinel policy results on GenLayer's official `gen_getTransactionStatus` response and finalized contract state while removing the unnecessary GenLayerJS runtime dependency.

**Architecture:** Add a small read-only JSON-RPC status reader owned by Sentinel and inject it into a renamed finality adapter. Keep account-aware submission, transaction execution lookup and finalized contract reads behind a structural client interface; compose the status reader from the validated manifest endpoint.

**Tech Stack:** Node.js 22.13+ native `fetch`, TypeScript 5.8, Node test runner, GenLayer JSON-RPC 2.0, npm lockfile v3.

## Global Constraints

- Only the exact `FINALIZED`/`7` status pair can open the policy-record gate.
- `ACCEPTED`/`5`, `READY_TO_FINALIZE`/`11` and every other valid status remain pending.
- The policy record must be read with `transactionHashVariant: "latest-final"`.
- Network, protocol, execution and binding failures must fail closed without exposing endpoint URLs or response bodies.
- No account key, provider construction, deployment, funding, cloud resource or GitHub publication.
- No custom GenLayer transaction encoder, nonce manager or raw signer.
- All behavior changes follow red-green-refactor TDD.

---

### Task 1: Audited GenLayer status reader

**Files:**
- Create: `services/coordinator/src/genlayer-status-reader.ts`
- Create: `services/coordinator/test/genlayer-status-reader.test.js`

**Interfaces:**
- Produces: `GenLayerConsensusStatus { status: GenLayerStatusName; statusCode: number }`.
- Produces: `GenLayerStatusReader.getTransactionStatus(txId: Hex): Promise<GenLayerConsensusStatus>`.
- Produces: `JsonRpcGenLayerStatusReader(endpoint, fetcher?, timeoutMs?, nextId?)`.

- [ ] **Step 1: Write failing request and mapping tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import {JsonRpcGenLayerStatusReader} from "../../../dist/services/coordinator/src/genlayer-status-reader.js";

const h=n=>`0x${n.repeat(64)}`;
const response=value=>new Response(JSON.stringify(value),{status:200,headers:{"content-type":"application/json"}});

test("sends the documented status request and accepts FINALIZED/7",async()=>{
  const calls=[];
  const reader=new JsonRpcGenLayerStatusReader("https://genlayer.example/rpc",async(url,init)=>{
    calls.push({url:String(url),init});
    return response({jsonrpc:"2.0",id:41,result:{status:"FINALIZED",statusCode:7}});
  },1000,()=>41);
  assert.deepEqual(await reader.getTransactionStatus(h("1")),{status:"FINALIZED",statusCode:7});
  assert.equal(calls[0].url,"https://genlayer.example/rpc");
  assert.deepEqual(JSON.parse(calls[0].init.body),{jsonrpc:"2.0",method:"gen_getTransactionStatus",params:[{txId:h("1")}],id:41});
});

test("accepts every documented internally consistent status pair",async()=>{
  const names=["UNINITIALIZED","PENDING","PROPOSING","COMMITTING","REVEALING","ACCEPTED","UNDETERMINED","FINALIZED","CANCELED","APPEAL_REVEALING","APPEAL_COMMITTING","READY_TO_FINALIZE","VALIDATORS_TIMEOUT","LEADER_TIMEOUT"];
  for(const [statusCode,status] of names.entries()){
    const reader=new JsonRpcGenLayerStatusReader("https://genlayer.example",async()=>response({jsonrpc:"2.0",id:1,result:{status,statusCode}}),1000,()=>1);
    assert.deepEqual(await reader.getTransactionStatus(h("2")),{status,statusCode});
  }
});
```

- [ ] **Step 2: Run the focused tests and verify the missing-module failure**

Run: `npm run build && node --test services/coordinator/test/genlayer-status-reader.test.js`  
Expected: FAIL because `genlayer-status-reader.js` does not exist.

- [ ] **Step 3: Implement the status reader and exact status table**

```ts
import type {Hex} from "../../../packages/core/src/types.js";

export const GENLAYER_STATUS_NAMES=["UNINITIALIZED","PENDING","PROPOSING","COMMITTING","REVEALING","ACCEPTED","UNDETERMINED","FINALIZED","CANCELED","APPEAL_REVEALING","APPEAL_COMMITTING","READY_TO_FINALIZE","VALIDATORS_TIMEOUT","LEADER_TIMEOUT"] as const;
export type GenLayerStatusName=typeof GENLAYER_STATUS_NAMES[number];
export interface GenLayerConsensusStatus{status:GenLayerStatusName;statusCode:number}
export interface GenLayerStatusReader{getTransactionStatus(txId:Hex):Promise<GenLayerConsensusStatus>}
export type FetchLike=(input:string|URL|Request,init?:RequestInit)=>Promise<Response>;

export class JsonRpcGenLayerStatusReader implements GenLayerStatusReader{
  private readonly endpoint:string;
  constructor(endpoint:string,private fetcher:FetchLike=fetch,private timeoutMs=10_000,private nextId=sequence()){
    let url:URL;try{url=new URL(endpoint)}catch{throw new Error("GenLayer status endpoint must be credential-free HTTPS")}
    if(url.protocol!=="https:"||url.username||url.password)throw new Error("GenLayer status endpoint must be credential-free HTTPS");
    if(!Number.isSafeInteger(timeoutMs)||timeoutMs<=0)throw new Error("GenLayer status timeout must be positive");
    this.endpoint=url.href;
  }
  async getTransactionStatus(txId:Hex):Promise<GenLayerConsensusStatus>{
    if(!/^0x[0-9a-fA-F]{64}$/.test(txId))throw new Error("invalid GenLayer transaction ID");
    const id=this.nextId();
    let response:Response;
    try{response=await this.fetcher(this.endpoint,{method:"POST",headers:{"content-type":"application/json","accept":"application/json"},redirect:"error",signal:AbortSignal.timeout(this.timeoutMs),body:JSON.stringify({jsonrpc:"2.0",method:"gen_getTransactionStatus",params:[{txId}],id})})}catch{throw new Error("GenLayer status transport failed")}
    if(!response.ok)throw new Error("GenLayer status HTTP failure");
    let raw:unknown;try{raw=await response.json()}catch{throw new Error("invalid GenLayer status response")}
    return parseStatus(raw,id);
  }
}

function sequence():()=>number{let id=0;return()=>++id}
function parseStatus(raw:unknown,id:number):GenLayerConsensusStatus{
  if(!raw||typeof raw!=="object"||Array.isArray(raw))throw new Error("invalid GenLayer status response");
  const value=raw as Record<string,unknown>;
  if(value.jsonrpc!=="2.0"||value.id!==id)throw new Error("invalid GenLayer status response");
  if(value.error!==undefined)throw new Error("GenLayer status RPC failure");
  if(!value.result||typeof value.result!=="object"||Array.isArray(value.result))throw new Error("invalid GenLayer status response");
  const result=value.result as Record<string,unknown>;
  if(typeof result.status!=="string"||typeof result.statusCode!=="number"||!Number.isInteger(result.statusCode))throw new Error("invalid GenLayer status response");
  const expected=GENLAYER_STATUS_NAMES[result.statusCode as number];
  if(expected===undefined||expected!==result.status)throw new Error("GenLayer status contradiction");
  return{status:expected,statusCode:result.statusCode as number};
}
```

- [ ] **Step 4: Add failing protocol and transport tests**

```js
test("rejects malformed, erroneous and contradictory RPC responses",async()=>{
  const bodies=[
    {jsonrpc:"2.0",id:2,result:{status:"FINALIZED",statusCode:7}},
    {jsonrpc:"2.0",id:1,error:{code:-32000,message:"secret upstream detail"}},
    {jsonrpc:"2.0",id:1,result:{status:"FINALIZED",statusCode:99}},
    {jsonrpc:"2.0",id:1,result:{status:"ACCEPTED",statusCode:7}}
  ];
  for(const body of bodies){
    const reader=new JsonRpcGenLayerStatusReader("https://genlayer.example",async()=>response(body),1000,()=>1);
    await assert.rejects(reader.getTransactionStatus(h("3")),error=>!error.message.includes("genlayer.example")&&!error.message.includes("secret upstream detail"));
  }
  const malformed=new JsonRpcGenLayerStatusReader("https://genlayer.example",async()=>new Response("{",{status:200}),1000,()=>1);
  await assert.rejects(malformed.getTransactionStatus(h("3")),/invalid GenLayer status response/);
});

test("rejects HTTP and transport failures with sanitized errors",async()=>{
  const http=new JsonRpcGenLayerStatusReader("https://genlayer.example",async()=>new Response("upstream secret",{status:500}),1000,()=>1);
  await assert.rejects(http.getTransactionStatus(h("4")),error=>error.message==="GenLayer status HTTP failure");
  const transport=new JsonRpcGenLayerStatusReader("https://genlayer.example",async()=>{throw new Error("token=secret")},1000,()=>1);
  await assert.rejects(transport.getTransactionStatus(h("4")),error=>error.message==="GenLayer status transport failed");
});

test("validates endpoint, timeout and transaction ID before fetching",async()=>{
  assert.throws(()=>new JsonRpcGenLayerStatusReader("http://genlayer.example"),/credential-free HTTPS/);
  assert.throws(()=>new JsonRpcGenLayerStatusReader("https://genlayer.example",fetch,0),/timeout must be positive/);
  const reader=new JsonRpcGenLayerStatusReader("https://genlayer.example",async()=>{throw new Error("must not fetch")});
  await assert.rejects(reader.getTransactionStatus("0x01"),/invalid GenLayer transaction ID/);
});
```

- [ ] **Step 5: Run the focused tests and verify they pass**

Run: `npm run build && node --test services/coordinator/test/genlayer-status-reader.test.js`  
Expected: all status-reader tests PASS with no network call.

- [ ] **Step 6: Commit the reader**

```bash
git add services/coordinator/src/genlayer-status-reader.ts services/coordinator/test/genlayer-status-reader.test.js
git commit -m "feat: add GenLayer finality status reader"
```

### Task 2: Finalized-state policy adapter

**Files:**
- Modify: `services/coordinator/src/genlayer-finality.ts`
- Modify: `services/coordinator/test/genlayer-finality.test.js`

**Interfaces:**
- Consumes: `GenLayerStatusReader.getTransactionStatus(txId)` from Task 1.
- Produces: `GenLayerContractClient` with `writeContract`, `getTransaction` and `readContract` structural methods.
- Produces: `GenLayerRpcFinality(client, statusReader, contractAddress, clock?)`.

- [ ] **Step 1: Replace SDK-enum fixtures with failing RPC-boundary tests**

```js
function clients(status={status:"FINALIZED",statusCode:7},tx={txExecutionResultName:"FINISHED_WITH_RETURN"},record=`ALLOW|${h("4")}|${h("7")}|v1|authorized`){
  const calls=[];
  return{
    status:{getTransactionStatus:async id=>{calls.push(["status",id]);return status}},
    contract:{writeContract:async a=>{calls.push(["write",a]);return h("9")},getTransaction:async a=>{calls.push(["transaction",a]);return tx},readContract:async a=>{calls.push(["read",a]);return record}},
    calls
  };
}

test("requires FINALIZED/7, successful execution and a latest-final bound record",async()=>{
  const c=clients();
  const finality=new GenLayerRpcFinality(c.contract,c.status,h("a"),()=>20);
  const id=await finality.submit(request);
  assert.equal((await finality.finalized(id)).decision,"ALLOW");
  assert.equal(c.calls.find(call=>call[0]==="read")[1].transactionHashVariant,"latest-final");
});

test("keeps every documented non-final status away from transaction and record reads",async()=>{
  const names=["UNINITIALIZED","PENDING","PROPOSING","COMMITTING","REVEALING","ACCEPTED","UNDETERMINED","CANCELED","APPEAL_REVEALING","APPEAL_COMMITTING","READY_TO_FINALIZE","VALIDATORS_TIMEOUT","LEADER_TIMEOUT"];
  for(const status of names){
    const statusCode=["UNINITIALIZED","PENDING","PROPOSING","COMMITTING","REVEALING","ACCEPTED","UNDETERMINED","FINALIZED","CANCELED","APPEAL_REVEALING","APPEAL_COMMITTING","READY_TO_FINALIZE","VALIDATORS_TIMEOUT","LEADER_TIMEOUT"].indexOf(status);
    const c=clients({status,statusCode}),finality=new GenLayerRpcFinality(c.contract,c.status,h("a"));
    const id=await finality.submit(request);
    assert.equal(await finality.finalized(id),undefined);
    assert.equal(c.calls.some(call=>call[0]==="transaction"||call[0]==="read"),false);
  }
});

test("fails closed after finality when execution or record binding is invalid",async()=>{
  for(const tx of [{},{txExecutionResultName:"FINISHED_WITH_ERROR"}]){
    const c=clients({status:"FINALIZED",statusCode:7},tx),finality=new GenLayerRpcFinality(c.contract,c.status,h("a")),id=await finality.submit(request);
    await assert.rejects(finality.finalized(id),/execution did not succeed/);
  }
  const c=clients({status:"FINALIZED",statusCode:7},{txExecutionResultName:"FINISHED_WITH_RETURN"},`ALLOW|${h("0")}|${h("7")}|v1|bad`),finality=new GenLayerRpcFinality(c.contract,c.status,h("a")),id=await finality.submit(request);
  await assert.rejects(finality.finalized(id),/record binding mismatch/);
});

test("restores exactly one durable request binding without resubmission",async()=>{
  const c=clients(),finality=new GenLayerRpcFinality(c.contract,c.status,h("a"),()=>20);
  finality.register(h("9"),request);
  assert.equal((await finality.finalized(h("9"))).decision,"ALLOW");
  assert.equal(c.calls.some(call=>call[0]==="write"),false);
  assert.throws(()=>finality.register(h("9"),{...request,policy:"different"}),/binding conflict/);
});
```

- [ ] **Step 2: Run the finality test and verify the renamed-class failure**

Run: `npm run build && node --test services/coordinator/test/genlayer-finality.test.js`  
Expected: FAIL because `GenLayerRpcFinality` and `GenLayerContractClient` do not exist.

- [ ] **Step 3: Implement the split finality adapter**

```ts
import type {Hex,PolicyRequest,PolicyResult} from "../../../packages/core/src/types.js";
import type {GenLayerFinality} from "./coordinator.js";
import type {GenLayerStatusReader} from "./genlayer-status-reader.js";

type TransactionExecution={txExecutionResultName?:string};
export interface GenLayerContractClient{
  writeContract(args:{address:Hex;functionName:string;args:unknown[];value:bigint}):Promise<Hex>;
  getTransaction(args:{hash:Hex}):Promise<TransactionExecution>;
  readContract(args:{address:Hex;functionName:string;args:unknown[];transactionHashVariant:"latest-final"}):Promise<unknown>;
}

export class GenLayerRpcFinality implements GenLayerFinality{
  private requests=new Map<string,PolicyRequest>();
  constructor(private client:GenLayerContractClient,private statusReader:GenLayerStatusReader,private contractAddress:Hex,private clock=()=>Math.floor(Date.now()/1000)){}
  async submit(request:PolicyRequest):Promise<string>{
    const p=request.packet,e=request.evidence;
    const hash=await this.client.writeContract({address:this.contractAddress,functionName:"evaluate",args:[p.guid,p.payloadHash,e.uri,e.digest,request.decodedAction,request.policy],value:0n});
    this.register(hash,request);return hash;
  }
  register(requestId:string,request:PolicyRequest):void{
    const key=requestId.toLowerCase(),existing=this.requests.get(key);
    if(existing&&binding(existing)!==binding(request))throw new Error("GenLayer request binding conflict");
    this.requests.set(key,request);
  }
  async finalized(requestId:string):Promise<PolicyResult|undefined>{
    const request=this.requests.get(requestId.toLowerCase());if(!request)throw new Error("unknown GenLayer request");
    const status=await this.statusReader.getTransactionStatus(requestId as Hex);
    if(status.status!=="FINALIZED"||status.statusCode!==7)return undefined;
    const tx=await this.client.getTransaction({hash:requestId as Hex});
    if(tx.txExecutionResultName!=="FINISHED_WITH_RETURN")throw new Error("finalized GenLayer execution did not succeed");
    const raw=await this.client.readContract({address:this.contractAddress,functionName:"get_record",args:[request.packet.guid],transactionHashVariant:"latest-final"});
    if(typeof raw!=="string")throw new Error("invalid GenLayer policy record");
    const [decision,packetDigest,evidenceDigest,policyVersion]=raw.split("|",5);
    if((decision!=="ALLOW"&&decision!=="DENY")||packetDigest?.toLowerCase()!==request.packet.payloadHash.toLowerCase()||evidenceDigest?.toLowerCase()!==request.evidence.digest.toLowerCase()||!policyVersion)throw new Error("GenLayer record binding mismatch");
    return{guid:request.packet.guid,packetDigest:request.packet.payloadHash,evidenceDigest:request.evidence.digest,decision,reasonCode:`GENLAYER_FINALIZED_${decision}`,finalizedAt:this.clock(),policyVersion};
  }
}
function binding(request:PolicyRequest):string{return JSON.stringify(request,(_,value)=>typeof value==="bigint"?value.toString():value)}
```

- [ ] **Step 4: Run the focused status and finality tests**

Run: `npm run build && node --test services/coordinator/test/genlayer-status-reader.test.js services/coordinator/test/genlayer-finality.test.js`  
Expected: all tests PASS and `rg -n "genlayer-js" services packages apps contracts` returns no matches.

- [ ] **Step 5: Commit the adapter**

```bash
git add services/coordinator/src/genlayer-finality.ts services/coordinator/test/genlayer-finality.test.js
git commit -m "feat: require finalized GenLayer policy state"
```

### Task 3: Runtime composition uses the audited endpoint

**Files:**
- Modify: `services/coordinator/src/compose-runtime.ts`
- Modify: `services/coordinator/test/compose-runtime.test.js`
- Modify: `docs/OPERATIONS.md`

**Interfaces:**
- Consumes: `JsonRpcGenLayerStatusReader(config.genlayer.endpoint)` from Task 1.
- Consumes: `GenLayerContractClient` and `GenLayerRpcFinality` from Task 2.
- Preserves: `composeRuntime(config, client, dashboardRoot, report?, socket?)` and all startup/shutdown semantics.

- [ ] **Step 1: Update the composition test client and assert startup remains network-idle**

```js
const originalFetch=globalThis.fetch;
let genlayerFetches=0;
globalThis.fetch=async()=>{genlayerFetches++;throw new Error("unexpected network call")};
try{
  const value=composeRuntime(config,client,resolve("apps/dashboard"),console.error,socket);
  await value.runtime.start();
  await value.runtime.stop();
  assert.equal(genlayerFetches,0);
}finally{globalThis.fetch=originalFetch}
```

The existing structural client remains `{writeContract, getTransaction, readContract}`; `readContract` receives the finalized-state variant only when a durable pending job reaches `FINALIZED/7`.

- [ ] **Step 2: Run the composition test and verify the old import fails**

Run: `npm run build && node --test services/coordinator/test/compose-runtime.test.js`  
Expected: FAIL because `compose-runtime.ts` still imports `GenLayerSdkFinality` and `GenLayerClientFacade`.

- [ ] **Step 3: Wire the manifest endpoint into composition**

Replace the old import and construction with:

```ts
import{GenLayerRpcFinality,type GenLayerContractClient}from"./genlayer-finality.js";
import{JsonRpcGenLayerStatusReader}from"./genlayer-status-reader.js";

export function composeRuntime(config:RuntimeConfig,client:GenLayerContractClient,dashboardRoot:string,report:(error:unknown)=>void=console.error,socket:SocketLifecycle=sockets):ComposedRuntime{
  const jobStore=new SqliteJobStore(config.storage.sqlitePath),listenerStore=new SqliteListenerStore(config.storage.sqlitePath),recoveryStore=new SqliteRecoveryStore(config.storage.sqlitePath);
  const statusReader=new JsonRpcGenLayerStatusReader(config.genlayer.endpoint),finality=new GenLayerRpcFinality(client,statusReader,config.genlayer.policyContract);
  const verifier=new IndependentRpcPacketVerifier(config.pathway.rpcUrls,config.pathway.endpoint,config.pathway.confirmations),coordinator=new Coordinator(verifier,finality,[],3,config.pathway.confirmations,jobStore);
  const listener=new PacketFeeListener(new JsonRpcLogSource(config.pathway.rpcUrls[0]!),config.pathway.endpoint,config.pathway.sendLibrary,config.pathway.confirmations,config.pathway.startBlock,64n,listenerStore,config.pathway.name);
  const factory=new PolicyRequestFactory({srcEid:config.pathway.srcEid,dstEid:config.pathway.dstEid,sender:config.pathway.sourceOApp,receiver:config.pathway.destinationOApp,sendLibrary:config.pathway.sendLibrary,sentinelDvn:config.pathway.sentinelDvn,evidenceUri:config.evidence.uri,policy:config.evidence.policy,evidenceTtlSeconds:config.evidence.ttlSeconds,maximumEvidenceBytes:config.evidence.maximumBytes},new HttpsEvidenceSource([config.evidence.allowedHost]));
  const recovery=new RecoveryService(config.pathway.name,recoveryStore,listener),ingestion=new IngestionRunner(listener,coordinatorPacketHandler(factory,coordinator),recoveryFailurePolicy(config.pathway.name,recoveryStore,config.runtime.maxIngestionAttempts)),server=createDashboardServer(coordinator,dashboardRoot,recovery);
  const runtime=new SentinelRuntime({restore:()=>coordinator.restore(),ingest:async()=>{await ingestion.pollOnce()},pollFinality:async()=>{await coordinator.pollPending()},listen:()=>socket.listen(server,config.status.port,config.status.host),closeServer:()=>socket.close(server),closeStores:()=>{recoveryStore.close();listenerStore.close();jobStore.close()},report,intervalMs:config.runtime.pollIntervalMs});
  return{runtime,coordinator,recovery};
}
```

Append this paragraph to the runtime-lifecycle section of `docs/OPERATIONS.md`:

```markdown
The coordinator constructs a read-only status client from the manifest's GenLayer HTTPS endpoint and polls `gen_getTransactionStatus` directly. It requires the exact `FINALIZED`/`7` pair before separately checking `FINISHED_WITH_RETURN` and reading the GUID-keyed policy record with the `latest-final` state variant. All other documented statuses remain pending; malformed or contradictory RPC responses fail closed. Submission, execution lookup and finalized contract reads still use the injected account-aware adapter, which has not been approved or exercised against a live GenLayer network.
```

- [ ] **Step 4: Run runtime-focused tests**

Run: `npm run build && node --test services/coordinator/test/compose-runtime.test.js services/coordinator/test/runtime-config.test.js services/coordinator/test/genlayer-status-reader.test.js services/coordinator/test/genlayer-finality.test.js`  
Expected: all focused tests PASS with no real network calls.

- [ ] **Step 5: Commit composition**

```bash
git add services/coordinator/src/compose-runtime.ts services/coordinator/test/compose-runtime.test.js docs/OPERATIONS.md
git commit -m "feat: compose official GenLayer finality polling"
```

### Task 4: Remove SDK runtime baggage and publish honest local status

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `README.md`
- Modify: `docs/MILESTONES.md`
- Modify: `docs/SECURITY_STATUS.md`
- Modify: `docs/research/2026-07-22-dependency-audit.md`

**Interfaces:**
- Produces: package version `0.20.0` with runtime dependencies limited to the packages actually imported by production source.
- Produces: documentation that distinguishes local RPC conformance tests from live GenLayer compatibility.

- [ ] **Step 1: Remove the unused dependency and regenerate the lock**

Use `apply_patch` to change the root version to `0.20.0` and remove `genlayer-js` from `dependencies`, then run:

```bash
npm install --package-lock-only --ignore-scripts --offline
npm install --ignore-scripts --offline
```

Expected: the lock and installed production tree no longer contain `node_modules/genlayer-js` or its lint-only dependencies.

- [ ] **Step 2: Verify the dependency boundary**

Run:

```bash
rg -n "genlayer-js" package.json package-lock.json services packages apps contracts
npm ls --omit=dev --depth=2
npm audit --omit=dev --json
```

Expected: `rg` returns no matches; `npm ls` exits zero; the production audit reports zero vulnerabilities.

- [ ] **Step 3: Update status documentation**

Document these exact outcomes:

- the local coordinator validates the official JSON-RPC status name/code pair;
- only `FINALIZED/7` advances to an execution-success check and `latest-final` bound record read;
- GenLayerJS is no longer a Sentinel runtime dependency, closing the unmet ESLint peer finding;
- no live GenLayer RPC, account provider or deployed Intelligent Contract was used;
- the archived/advisory-bearing Ganache development test path remains unresolved;
- the full test count is read from the completed suite and recorded consistently in README/security status.

- [ ] **Step 4: Run complete verification**

Run:

```bash
npm run check
git diff --check
git status --short --branch
```

Expected: strict TypeScript, five Solidity sources, IC/dashboard guardrails and all tests PASS; only intended milestone files are modified.

- [ ] **Step 5: Commit the milestone**

```bash
git add package.json package-lock.json README.md docs/MILESTONES.md docs/SECURITY_STATUS.md docs/research/2026-07-22-dependency-audit.md
git commit -m "chore: release GenLayer finality RPC milestone"
```
