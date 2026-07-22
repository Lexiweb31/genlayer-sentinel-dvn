# Crash-Safe ULN302 Delivery Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire finalized GenLayer `ALLOW` decisions through a canonical ULN302 verification intent, independently checked destination configuration, durable 3-of-5 signer quorum, destination submission, independent confirmation, and the real read-only dashboard.

**Architecture:** A pinned destination manifest is checked through two independent RPC origins before an intent factory can produce the exact `IReceiveUlnE2.verify` call. The outbox persists that envelope in `SIGNING` before signer contact, attaches a durable quorum in `READY`, and then hands it to the existing conservative destination worker. The composition root owns the complete sequence while all account, signer, and read-only RPC capabilities remain injected.

**Tech Stack:** Node.js 22.13+, npm 10.9.2, TypeScript 5.8.3 strict mode, ethers 6.17.0, Node test runner, Node SQLite, Solidity 0.8.30 targeting Shanghai, Hardhat 3.10.0 EDR for test-only deployed-contract coverage, pinned LayerZero V2 packages 3.0.168.

## Global Constraints

- Preserve the clean-room GenLayer Sentinel boundary; do not read, import, copy, reference, or share anything with Merit or `genlayer-escrow`.
- Process exactly one directional pathway per runtime; the intended first direction remains Ethereum Sepolia to Arbitrum Sepolia.
- Require an explicitly selected receive library, a complete pinned ULN configuration, Sentinel only in `optionalDVNs`, and at least one independent required DVN.
- Require exactly five distinct configured signer identities and quorum exactly `3`; signer keys remain behind injected services.
- Persist the exact signing envelope before contacting signers; retries reuse the same digest and expiry.
- Keep signature TTL between 30 and 900 seconds inclusive; this is a prototype policy bound, not an official LayerZero recommendation.
- Treat every confirmation count as an explicitly labeled Sentinel test value, not an official recommendation.
- Expose no signatures, call data, RPC paths, storage paths, account details, raw errors, credentials, or private keys through the API or app.
- Keep the browser read-only and backed only by real coordinator/outbox state; add no simulated fallback.
- Use local deterministic fixtures and Hardhat EDR in automated tests; make no live testnet call from the suite.
- Do not deploy, spend funds, create cloud resources, publish to GitHub, or claim DVN onboarding, audit completion, mainnet readiness, or five independent operators.
- Follow red-green-refactor for every behavior change and commit each task only after its focused tests pass.

## File Structure

- `services/coordinator/src/runtime-config.ts`: parse and publicly summarize the exact destination security manifest.
- `services/coordinator/src/destination-path-verifier.ts`: independently resolve and compare destination EndpointV2, receive ULN302, ULN config, and adapter settings.
- `services/coordinator/src/uln302-intent.ts`: reconstruct PacketV1 and create the only allowed destination signing envelope.
- `services/coordinator/src/verification-outbox.ts`: own durable `SIGNING -> READY -> delivery` state and share invariants.
- `services/coordinator/src/delivery-planner.ts`: reconcile finalized jobs, durable intents, signer quorum, and coordinator quorum state.
- `services/coordinator/src/coordinator.ts`: separate pure share collection from durable quorum advancement.
- `services/coordinator/src/destination-worker.ts`: revalidate the pinned destination immediately before broadcast.
- `services/coordinator/src/runtime.ts`: serialize ingestion, finality, signing planning, and delivery.
- `services/coordinator/src/compose-runtime.ts`: construct the complete pipeline from injected capabilities.
- `services/coordinator/src/status-api.ts`: expose sanitized delivery/configuration presentation data.
- `services/coordinator/test/*.test.js`: focused unit, persistence, crash, composition, and vertical-slice tests.
- `contracts/test/MockVerificationTarget.sol` and `contracts/test/adapter.test.js`: prove the exact ULN302 ABI call crosses the real adapter.
- `apps/dashboard/index.html`, `apps/dashboard/src/app.js`, `scripts/check-dashboard.mjs`: show honest signing/delivery state and local-test mode.
- `config/sentinel-runtime.example.json`, `README.md`, `docs/OPERATIONS.md`, `docs/MILESTONES.md`, `docs/SECURITY_STATUS.md`: non-deployable example and truthful milestone evidence.

---

### Task 1: Destination security manifest

**Files:**
- Modify: `services/coordinator/src/runtime-config.ts`
- Modify: `services/coordinator/test/runtime-config.test.js`
- Modify: `config/sentinel-runtime.example.json`

**Interfaces:**
- Produces: `DestinationPathConfig` with `rpcUrls`, `chainId`, `srcEid`, `endpoint`, `receiveLibrary`, `oapp`, `adapter`, `useDefaultReceiveLibrary`, `confirmations`, `requiredDvns`, `optionalDvns`, `optionalDvnThreshold`, `authorizedSigners`, `quorum`, and `signatureTtlSeconds`.
- Preserves: `RuntimeConfig.pathway.destinationOApp` as canonical LayerZero bytes32 and requires it to equal the left-zero-padded destination address.

- [ ] **Step 1: Write failing manifest tests**

Change the pathway fixture's destination peer to a left-zero-padded address:

```js
const b=n=>`0x${"0".repeat(24)}${n.repeat(40)}`;
// inside valid.pathway
destinationOApp:b("4")
```

Add this destination fixture to `valid` and assert bigint/redaction behavior:

```js
destination:{
  rpcUrls:["https://dst-a.example/v1/key","https://dst-b.example/v1/key"],
  chainId:421614,
  srcEid:40161,
  endpoint:a("7"),
  receiveLibrary:a("8"),
  oapp:a("4"),
  adapter:a("9"),
  useDefaultReceiveLibrary:false,
  confirmations:"64",
  requiredDvns:[a("a")],
  optionalDvns:[a("9"),a("b")].sort(),
  optionalDvnThreshold:1,
  authorizedSigners:[a("1"),a("2"),a("3"),a("4"),a("5")],
  quorum:3,
  signatureTtlSeconds:300
}
```

Add assertions:

```js
assert.equal(config.destination.confirmations,64n);
assert.equal(config.destination.quorum,3);
assert.deepEqual(summary.destination.rpcUrls,["https://dst-a.example","https://dst-b.example"]);
assert.equal(summary.destination.signatureTtlSeconds,300);
```

Add one table-driven rejection test covering: an unknown destination key, duplicate destination RPC origins, `useDefaultReceiveLibrary: true`, destination/pathway OApp mismatch, zero address, Sentinel in `requiredDvns`, Sentinel missing from `optionalDvns`, empty `requiredDvns`, duplicate or unsorted DVNs, optional threshold `0` or greater than optional count, four or six signers, duplicate or unsorted signers, quorum `2` or `4`, confirmations `0`, TTL `29`, and TTL `901`.

- [ ] **Step 2: Run the focused test and verify the red phase**

Run: `npm run build && node --test services/coordinator/test/runtime-config.test.js`  
Expected: FAIL because `config.destination` is undefined or the unsafe destination cases are accepted.

- [ ] **Step 3: Add the exact destination types and validation**

Add:

```ts
export interface DestinationPathConfig {
  rpcUrls:string[];
  chainId:number;
  srcEid:number;
  endpoint:Hex;
  receiveLibrary:Hex;
  oapp:Hex;
  adapter:Hex;
  useDefaultReceiveLibrary:false;
  confirmations:bigint;
  requiredDvns:Hex[];
  optionalDvns:Hex[];
  optionalDvnThreshold:number;
  authorizedSigners:Hex[];
  quorum:3;
  signatureTtlSeconds:number;
}
```

Parse `root.destination` with the existing secure URL/address/integer helpers. First call `exactKeys(destination,["rpcUrls","chainId","srcEid","endpoint","receiveLibrary","oapp","adapter","useDefaultReceiveLibrary","confirmations","requiredDvns","optionalDvns","optionalDvnThreshold","authorizedSigners","quorum","signatureTtlSeconds"],"destination")`; `exactKeys` rejects every missing or extra key. Add `sortedAddresses(value,name)` that requires a nonempty array of nonzero addresses, lowercase-normalizes for comparison, rejects duplicates and requires strictly ascending input. Require exactly five authorized signers, quorum `3`, TTL `30..900`, `useDefaultReceiveLibrary === false`, Sentinel absent from required and present in optional, at least one required DVN, and `optionalDvnThreshold <= optionalDvns.length`. Compare:

```ts
const paddedOapp=`0x${"0".repeat(24)}${destinationOapp.slice(2)}`.toLowerCase();
if(paddedOapp!==pathwayDestinationOApp.toLowerCase())throw new Error("destination OApp binding mismatch");
```

Return `destination` from `parseRuntimeConfig` and redact each RPC URL to its origin in `publicConfigSummary`.

- [ ] **Step 4: Replace the non-deployable example with the complete shape**

Change the example pathway's `destinationOApp` to the left-zero-padded bytes32 form of the example destination OApp address. Add a `destination` object using only `.invalid` URLs and obvious placeholder addresses. Add `_testValueWarning: "confirmations and signature TTL are Sentinel prototype values, not official recommendations"`. Keep `_warning` and every existing no-deployment warning.

- [ ] **Step 5: Run the focused tests and commit**

Run: `npm run build && node --test services/coordinator/test/runtime-config.test.js`  
Expected: all runtime-config tests pass.

```bash
git add services/coordinator/src/runtime-config.ts services/coordinator/test/runtime-config.test.js config/sentinel-runtime.example.json
git commit -m "feat: validate destination security manifest"
```

### Task 2: Independent destination pathway verification

**Files:**
- Create: `services/coordinator/src/destination-path-verifier.ts`
- Create: `services/coordinator/test/destination-path-verifier.test.js`

**Interfaces:**
- Consumes: `DestinationPathConfig` from Task 1.
- Produces: `DestinationPathRpc = (url:string, method:string, params:unknown[]) => Promise<unknown>`.
- Produces: `VerifiedDestinationPath` and `DestinationPathVerifier.verify(): Promise<VerifiedDestinationPath>`.

- [ ] **Step 1: Write the failing two-provider agreement test**

Create a fixture RPC that switches on ethers function selectors for `getReceiveLibrary`, `isSupportedEid`, `getUlnConfig`, `verificationTarget`, `quorum`, and `signer`, returning ABI-encoded values. Assert:

```js
const verified=await new IndependentDestinationPathVerifier(config,rpc()).verify();
assert.equal(verified.chainId,421614n);
assert.equal(verified.receiveLibrary.toLowerCase(),config.receiveLibrary.toLowerCase());
assert.equal(verified.confirmations,64n);
assert.match(verified.configurationDigest,/^0x[0-9a-f]{64}$/);
assert.equal(verified.optionalDvns.includes(config.adapter.toLowerCase()),true);
```

Add focused cases for provider disagreement, default receive library, wrong chain, empty code, unsupported EID, wrong receive library, changed confirmations, changed DVN arrays/threshold, wrong adapter target/quorum, unauthorized configured signer, unsafe URLs, and RPC failure. Each must reject with a sanitized error that contains no URL path or raw provider message.

- [ ] **Step 2: Run the focused test and verify the missing-module failure**

Run: `npm run build && node --test services/coordinator/test/destination-path-verifier.test.js`  
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `destination-path-verifier.js`.

- [ ] **Step 3: Implement the verifier's public contract**

Use these exact public types:

```ts
export type DestinationPathRpc=(url:string,method:string,params:unknown[])=>Promise<unknown>;
export interface VerifiedDestinationPath {
  observedBlockNumber:bigint;
  observedBlockHash:Hex;
  chainId:bigint;
  srcEid:number;
  endpoint:Hex;
  receiveLibrary:Hex;
  oapp:Hex;
  adapter:Hex;
  confirmations:bigint;
  requiredDvns:Hex[];
  optionalDvns:Hex[];
  optionalDvnThreshold:number;
  authorizedSigners:Hex[];
  quorum:3;
  configurationDigest:Hex;
}
export interface DestinationPathVerifier {verify():Promise<VerifiedDestinationPath>}
```

Define ethers interfaces with the exact ABIs:

```ts
const endpointAbi=["function getReceiveLibrary(address receiver,uint32 srcEid) view returns(address lib,bool isDefault)"];
const receiveAbi=[
  "function isSupportedEid(uint32 eid) view returns(bool)",
  "function getUlnConfig(address oapp,uint32 remoteEid) view returns(tuple(uint64 confirmations,uint8 requiredDVNCount,uint8 optionalDVNCount,uint8 optionalDVNThreshold,address[] requiredDVNs,address[] optionalDVNs))"
];
const adapterAbi=[
  "function verificationTarget() view returns(address)",
  "function quorum() view returns(uint256)",
  "function signer(address) view returns(bool)"
];
```

First query `eth_chainId` and `eth_blockNumber` from every URL. Select the minimum reported head as `observedBlockNumber`, fetch `eth_getBlockByNumber` for that exact height from every provider, and require the same nonzero block hash. For every URL at that shared block tag: require nonempty `eth_getCode` for endpoint, receive library, and adapter; perform each `eth_call`; decode and normalize all addresses; verify ULN count fields equal array lengths; verify all configured signers return true. Compare canonical JSON encodings of the complete observations across providers, then compare every field with the manifest. Compute `configurationDigest` with `keccak256(AbiCoder.encode(...))` over observed block number/hash, chain ID, source EID, endpoint, receive library, OApp, adapter, confirmations, required/optional array hashes, threshold, signer-array hash, and quorum. Catch only transport/decode errors around their individual calls and throw `destination pathway RPC unavailable`; manifest drift and provider disagreement use their own sanitized errors.

- [ ] **Step 4: Run the focused tests and commit**

Run: `npm run build && node --test services/coordinator/test/destination-path-verifier.test.js`  
Expected: all destination-path-verifier tests pass.

```bash
git add services/coordinator/src/destination-path-verifier.ts services/coordinator/test/destination-path-verifier.test.js
git commit -m "feat: verify pinned destination pathway"
```

### Task 3: Canonical ULN302 intent construction

**Files:**
- Create: `services/coordinator/src/uln302-intent.ts`
- Create: `services/coordinator/test/uln302-intent.test.js`
- Modify: `contracts/test/MockVerificationTarget.sol`
- Modify: `contracts/test/adapter.test.js`

**Interfaces:**
- Consumes: `PolicyRequest`, finalized `PolicyResult`, and `VerifiedDestinationPath`.
- Produces: `Uln302IntentFactory.create(request,result,path,now): SigningEnvelope`.

- [ ] **Step 1: Write failing canonical intent tests**

Build a packet with `encodePacketV1`, set `encodedPayloadHash=keccak256(encoded)`, and assert:

```js
const envelope=new Uln302IntentFactory(300).create(request,result,path,100);
assert.equal(envelope.expiry,400n);
assert.equal(envelope.guid,request.packet.guid);
assert.equal(envelope.packetDigest,request.packet.payloadHash);
assert.equal(envelope.evidenceDigest,request.evidence.digest);
assert.equal(envelope.verificationTarget,path.receiveLibrary);
const decoded=receiveInterface.decodeFunctionData("verify",envelope.callData);
assert.equal(getBytes(decoded[0]).length,81);
assert.equal(decoded[1],request.packet.payloadHash);
assert.equal(decoded[2],path.confirmations);
assert.equal(decoded[0],dataSlice(encoded,0,81));
```

Add rejections for `DENY`, nonmatching result GUID/packet/evidence digest, expired evidence, bad `encodedPayloadHash`, changed message/payload hash, path/OApp mismatch, wrong target, and an invalid current time.

- [ ] **Step 2: Run the focused test and verify the missing-module failure**

Run: `npm run build && node --test services/coordinator/test/uln302-intent.test.js`  
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `uln302-intent.js`.

- [ ] **Step 3: Implement the only allowed call factory**

Use:

```ts
const receiveInterface=new Interface(["function verify(bytes packetHeader,bytes32 payloadHash,uint64 confirmations)"]);
export class Uln302IntentFactory {
  constructor(private ttlSeconds:number){if(!Number.isSafeInteger(ttlSeconds)||ttlSeconds<30||ttlSeconds>900)throw new Error("invalid signature TTL")}
  create(request:PolicyRequest,result:PolicyResult,path:VerifiedDestinationPath,now:number):SigningEnvelope {
    if(result.decision!=="ALLOW")throw new Error("policy decision does not authorize signing");
    if(result.guid.toLowerCase()!==request.packet.guid.toLowerCase()||result.packetDigest.toLowerCase()!==request.packet.payloadHash.toLowerCase()||result.evidenceDigest.toLowerCase()!==request.evidence.digest.toLowerCase())throw new Error("policy result binding mismatch");
    if(!Number.isSafeInteger(now)||now<0||result.finalizedAt>now)throw new Error("invalid signing time");
    const expiry=now+this.ttlSeconds;
    if(!Number.isSafeInteger(expiry)||request.evidence.validUntil<expiry)throw new Error("evidence expires before signature");
    const encoded=encodePacketV1({nonce:request.packet.nonce,srcEid:request.packet.srcEid,sender:request.packet.sender,dstEid:request.packet.dstEid,receiver:request.packet.receiver,guid:request.packet.guid,message:request.packet.message});
    assertCanonicalPacket(encoded,request.packet);
    const expectedReceiver=`0x${"0".repeat(24)}${path.oapp.slice(2)}`.toLowerCase();
    if(request.packet.receiver.toLowerCase()!==expectedReceiver||request.packet.srcEid!==path.srcEid)throw new Error("destination pathway binding mismatch");
    const packetHeader=dataSlice(encoded,0,81) as Hex;
    const callData=receiveInterface.encodeFunctionData("verify",[packetHeader,request.packet.payloadHash,path.confirmations]) as Hex;
    return{chainId:path.chainId,adapter:path.adapter,verificationTarget:path.receiveLibrary,guid:request.packet.guid,packetDigest:request.packet.payloadHash,evidenceDigest:request.evidence.digest,callData,expiry:BigInt(expiry)};
  }
}
```

- [ ] **Step 4: Prove the real adapter calls the exact ULN302 ABI**

Extend `MockVerificationTarget` with:

```solidity
bytes public lastHeader;
bytes32 public lastPayloadHash;
uint64 public lastConfirmations;
function verify(bytes calldata header, bytes32 payloadHash, uint64 confirmations) external {
    lastHeader = header;
    lastPayloadHash = payloadHash;
    lastConfirmations = confirmations;
}
```

Update the successful adapter test to submit the factory-compatible `verify(bytes,bytes32,uint64)` call, then assert the mock stored an 81-byte header, the exact payload hash, and exact confirmations. Preserve replay, quorum, digest agreement, and atomic failure tests.

- [ ] **Step 5: Run focused TypeScript and deployed-contract tests, then commit**

Run: `npm run build && node --test services/coordinator/test/uln302-intent.test.js contracts/test/adapter.test.js`  
Expected: all intent and adapter tests pass on Hardhat EDR.

```bash
git add services/coordinator/src/uln302-intent.ts services/coordinator/test/uln302-intent.test.js contracts/test/MockVerificationTarget.sol contracts/test/adapter.test.js
git commit -m "feat: build canonical ULN302 verification intent"
```

### Task 4: Durable pre-signing outbox

**Files:**
- Modify: `services/coordinator/src/verification-outbox.ts`
- Modify: `services/coordinator/test/verification-outbox.test.js`
- Modify: `services/coordinator/test/destination-worker.test.js`

**Interfaces:**
- Produces: `plan(guid,envelope,now)`, `recordQuorum(guid,shares,now)`, and `SIGNING` state.
- Removes: production use of `prepare(guid,envelope,shares,now)`; fixtures must follow the real two-write ordering.

- [ ] **Step 1: Replace preparation tests with failing crash-safe tests**

Construct the store with `new SqliteVerificationOutbox(path,authorized,3)`. Assert:

```js
const signing=await store.plan(envelope.guid,envelope,100);
assert.equal(signing.state,"SIGNING");
assert.deepEqual(signing.shares,[]);
assert.deepEqual(await store.plan(envelope.guid,envelope,101),signing);
store.close();
store=new SqliteVerificationOutbox(path,authorized,3);
assert.equal((await store.get(envelope.guid)).state,"SIGNING");
const ready=await store.recordQuorum(envelope.guid,shares,110);
assert.equal(ready.state,"READY");
assert.equal(ready.shares.length,3);
```

Add failures for conflicting plan, shares before plan, fewer/more than three shares, duplicate/unsorted/unapproved signer, wrong digest, malformed signature, second different quorum, expired-state transition, and corrupt persisted state. Update destination-worker fixtures to call `plan` then `recordQuorum`.

- [ ] **Step 2: Run focused tests and verify the red phase**

Run: `npm run build && node --test services/coordinator/test/verification-outbox.test.js services/coordinator/test/destination-worker.test.js`  
Expected: FAIL because `SIGNING`, `plan`, and `recordQuorum` do not exist.

- [ ] **Step 3: Implement the two-phase persistence API**

Change the public state and interface to:

```ts
export type OutboxState="SIGNING"|"READY"|"ATTEMPTING"|"SUBMITTED"|"CONFIRMED"|"FAILED"|"RECOVERY_REQUIRED";
export interface VerificationOutboxStore {
  plan(guid:Hex,envelope:SigningEnvelope,now:number):Promise<OutboxRecord>;
  recordQuorum(guid:Hex,shares:SignatureShare[],now:number):Promise<OutboxRecord>;
  transition(guid:Hex,expected:OutboxState,update:OutboxUpdate):Promise<OutboxRecord>;
  get(guid:Hex):Promise<OutboxRecord|undefined>;
  list():Promise<OutboxRecord[]>;
  close():void;
}
```

The constructor receives the sorted authorized signer list and quorum. `plan` runs `BEGIN IMMEDIATE`, stores `{shares:[],state:"SIGNING"}`, and permits only an identical existing envelope/digest. `recordQuorum` requires current `SIGNING`, validates exactly three sorted unique authorized shares against `executionDigest(envelope)`, and atomically stores `READY`. Permit `SIGNING -> FAILED` only with `SIGNING_EXPIRED`. Validate every decoded row in `get` and `list`; `FAILED` accepts either zero or quorum shares while all delivery states require quorum shares.

- [ ] **Step 4: Run focused tests and commit**

Run: `npm run build && node --test services/coordinator/test/verification-outbox.test.js services/coordinator/test/destination-worker.test.js`  
Expected: all outbox and destination-worker tests pass.

```bash
git add services/coordinator/src/verification-outbox.ts services/coordinator/test/verification-outbox.test.js services/coordinator/test/destination-worker.test.js
git commit -m "feat: persist signing intent before quorum"
```

### Task 5: Delivery planner and crash reconciliation

**Files:**
- Modify: `services/coordinator/src/coordinator.ts`
- Modify: `services/coordinator/test/coordinator.test.js`
- Create: `services/coordinator/src/delivery-planner.ts`
- Create: `services/coordinator/test/delivery-planner.test.js`

**Interfaces:**
- Produces: `Coordinator.collectAuthorization(...)` without job mutation.
- Produces: idempotent `Coordinator.recordQuorum(guid,addresses)` after durable outbox readiness.
- Produces: `DeliveryPlanner.reconcile()` and `DeliveryPlanner.pollOnce()`.

- [ ] **Step 1: Write failing coordinator ordering tests**

Finalize an `ALLOW` job, call `collectAuthorization`, and assert its snapshot remains `POLICY_FINALIZED` with zero signers. Then call `recordQuorum` with the persisted share addresses and assert `QUORUM_REACHED`. Call it again with the same addresses and assert it is idempotent; call it with a changed set and assert rejection.

- [ ] **Step 2: Write failing planner crash/retry tests**

Use an in-memory coordinator fixture plus a real temporary SQLite outbox. Cover:

```js
await planner.pollOnce();
assert.equal((await outbox.get(guid)).state,"READY");
assert.equal(coordinator.jobs.get(guid).snapshot.stage,"QUORUM_REACHED");
```

Add cases proving: the outbox is already `SIGNING` when the first signer is called; signer outage leaves the identical digest in `SIGNING`; restart from `SIGNING` retries the same envelope; restart from `READY` advances coordinator quorum without signing again; expired `SIGNING` becomes `FAILED/SIGNING_EXPIRED`; `DENY` creates no record; one job's signer/path error is reported while another job progresses; and reconciliation rejects `QUORUM_REACHED` without `READY` shares or an outbox attached to `REJECTED`.

- [ ] **Step 3: Run focused tests and verify the red phase**

Run: `npm run build && node --test services/coordinator/test/coordinator.test.js services/coordinator/test/delivery-planner.test.js`  
Expected: FAIL because authorization mutates too early and `delivery-planner.js` is missing.

- [ ] **Step 4: Split collection from durable quorum recording**

Change the constructor field from `private signers:IsolatedSignerService[]` to `readonly signers:SignerService[]`, then replace `authorize` with:

```ts
async collectAuthorization(guid:string,envelope:SigningEnvelope,authorized:Hex[]):Promise<SignatureShare[]> {
  const job=this.jobs.get(guid);
  if(!job||job.snapshot.stage!=="POLICY_FINALIZED"||!job.snapshot.result)throw new Error("job is not ready for signing");
  return collectQuorum(envelope,job.snapshot.result,this.signers,authorized,this.quorum);
}
async recordQuorum(guid:string,addresses:Hex[]):Promise<void> {
  const job=this.jobs.get(guid);
  if(!job)throw new Error("unknown GUID");
  const normalized=addresses.map(value=>value.toLowerCase());
  if(normalized.length!==this.quorum||new Set(normalized).size!==normalized.length||normalized.some((value,index)=>index>0&&value<=normalized[index-1]!))throw new Error("invalid durable quorum");
  if(job.snapshot.stage==="QUORUM_REACHED"){
    if(JSON.stringify(job.snapshot.signers)!==JSON.stringify(normalized))throw new Error("durable quorum mismatch");
    return;
  }
  if(job.snapshot.stage!=="POLICY_FINALIZED")throw new Error("job is not ready for quorum");
  const priorStage=job.snapshot.stage,priorSigners=[...job.snapshot.signers];
  try{
    for(const address of normalized)job.addSigner(address,this.quorum);
    if(job.snapshot.stage!=="QUORUM_REACHED")throw new Error("durable quorum incomplete");
    await this.persist(guid,this.requestIds.get(guid));
  }catch(error){job.snapshot.stage=priorStage;job.snapshot.signers=priorSigners;throw error}
}
```

- [ ] **Step 5: Implement the serial planner**

Define:

```ts
export class DeliveryPlanner {
  constructor(
    private coordinator:Coordinator,
    private outbox:VerificationOutboxStore,
    private path:DestinationPathVerifier,
    private intents:Uln302IntentFactory,
    private authorized:Hex[],
    private report:(error:unknown)=>void,
    private clock=()=>Math.floor(Date.now()/1000)
  ){}
  async reconcile():Promise<void>;
  async pollOnce():Promise<number>;
}
```

`reconcile` validates every job/outbox pair without external calls. `pollOnce` iterates jobs in GUID order and catches/report errors per GUID. For `POLICY_FINALIZED`: load the durable request/result; if absent, verify the destination path, create the envelope, and `plan`; if `SIGNING` and expired, transition to `FAILED/SIGNING_EXPIRED`; otherwise collect shares and `recordQuorum`; when `READY`, call coordinator `recordQuorum` from stored addresses. Never create work for `REJECTED`. Never regenerate an existing envelope.

- [ ] **Step 6: Run focused tests and commit**

Run: `npm run build && node --test services/coordinator/test/coordinator.test.js services/coordinator/test/delivery-planner.test.js`  
Expected: all coordinator and delivery-planner tests pass.

```bash
git add services/coordinator/src/coordinator.ts services/coordinator/test/coordinator.test.js services/coordinator/src/delivery-planner.ts services/coordinator/test/delivery-planner.test.js
git commit -m "feat: reconcile durable signer quorum"
```

### Task 6: Pre-submit pathway revalidation

**Files:**
- Modify: `services/coordinator/src/destination-worker.ts`
- Modify: `services/coordinator/test/destination-worker.test.js`

**Interfaces:**
- Consumes: `DestinationPathVerifier` from Task 2.
- Preserves: intent-before-broadcast, ambiguous no-rebroadcast, receipt confirmation, and coordinator execution semantics.

- [ ] **Step 1: Write failing drift-isolation tests**

Inject a path verifier and reporter. Assert a throwing verifier leaves `READY`, does not call `used` or `submitVerification`, reports only `destination pathway configuration unavailable`, and still allows a second valid record to progress in the same poll. Assert the path verifier is called immediately before every new submission but not for `SUBMITTED` receipt polling.

- [ ] **Step 2: Run the focused test and verify the red phase**

Run: `npm run build && node --test services/coordinator/test/destination-worker.test.js`  
Expected: FAIL because `DestinationWorker` does not accept or call a path verifier.

- [ ] **Step 3: Add fail-closed pre-submit verification**

Use this constructor boundary:

```ts
constructor(
  private outbox:VerificationOutboxStore,
  private adapter:DestinationAdapterSubmitter,
  private verifier:DestinationConfirmationVerifier,
  private path:DestinationPathVerifier,
  private coordinator:ExecutionConfirmer,
  private report:(error:unknown)=>void,
  private clock=()=>Math.floor(Date.now()/1000)
){}
```

In `pollOnce`, isolate each record in `try/catch`. In `submit`, call `await this.path.verify()` before `adapter.used`; if it throws, report `new Error("destination pathway configuration unavailable")` and return with no transition. Keep every existing transaction and confirmation transition unchanged.

- [ ] **Step 4: Run focused tests and commit**

Run: `npm run build && node --test services/coordinator/test/destination-worker.test.js`  
Expected: all destination-worker tests pass.

```bash
git add services/coordinator/src/destination-worker.ts services/coordinator/test/destination-worker.test.js
git commit -m "feat: revalidate pathway before destination submit"
```

### Task 7: Complete runtime composition

**Files:**
- Modify: `services/coordinator/src/runtime.ts`
- Modify: `services/coordinator/test/runtime.test.js`
- Modify: `services/coordinator/src/compose-runtime.ts`
- Modify: `services/coordinator/test/compose-runtime.test.js`
- Modify: `services/coordinator/src/status-api.ts`
- Modify: `services/coordinator/test/status-api.test.js`

**Interfaces:**
- Produces: `RuntimeCapabilities` containing GenLayer client, five signers, destination submitter, destination RPC transport, and presentation mode.
- Produces: composed `outbox`, `planner`, and `destinationWorker` for programmatic operation/testing.

- [ ] **Step 1: Write the failing runtime-order test**

Extend the runtime fixture with `planDeliveries` and `deliver`. Assert one scheduled tick calls:

```js
assert.deepEqual(calls,["restore","listen","ingest","finality","plan-deliveries","deliver"]);
```

Assert an error in `planDeliveries` is reported, prevents only the later delivery phase for that tick, leaves the runtime started, and the next tick retries normally. Preserve no-overlap and shutdown tests.

- [ ] **Step 2: Write the failing composition test**

Create a valid destination config, five distinct fake signer services, a fake destination submitter, and a selector-aware destination RPC fake. Compose without starting a tick and assert:

```js
assert.equal(value.coordinator.signers.length,5);
assert.deepEqual(await value.outbox.list(),[]);
assert.ok(value.planner);
assert.ok(value.destinationWorker);
```

Start/stop with fake sockets and assert no eager GenLayer, signer, or destination call occurs when there are no jobs, and every store including outbox closes once. Add rejections for capability signer identities that do not exactly match the manifest.

- [ ] **Step 3: Run focused tests and verify the red phase**

Run: `npm run build && node --test services/coordinator/test/runtime.test.js services/coordinator/test/compose-runtime.test.js services/coordinator/test/status-api.test.js`  
Expected: FAIL because delivery phases and capability-based composition are absent.

- [ ] **Step 4: Extend the serialized runtime**

Change `RuntimeDependencies` to include:

```ts
planDeliveries():Promise<void>;
deliver():Promise<void>;
```

Call them after `pollFinality()` in `runTick`. Preserve one active tick, injected reporting, idempotent stop, and close ordering.

- [ ] **Step 5: Build the complete composition root**

Define:

```ts
export interface RuntimeCapabilities {
  genlayer:GenLayerContractClient;
  signers:SignerService[];
  destinationSubmitter:DestinationAdapterSubmitter;
  destinationRpc:DestinationPathRpc;
  presentationMode:"LOCAL_TEST"|"EXTERNAL_INJECTED";
}
export interface ComposedRuntime {
  runtime:SentinelRuntime;
  coordinator:Coordinator;
  recovery:RecoveryService;
  outbox:SqliteVerificationOutbox;
  planner:DeliveryPlanner;
  destinationWorker:DestinationWorker;
}
```

Change the signature to `composeRuntime(config,capabilities,dashboardRoot,report?,socket?)`. Validate five capability signer addresses exactly equal the manifest. Construct the path verifier, intent factory, outbox, planner, receipt verifier, and destination worker. Restore coordinator then `planner.reconcile`; tick ingestion, finality, planner, worker; pass outbox to `createDashboardServer`; close outbox with the other stores.

- [ ] **Step 6: Add sanitized runtime presentation**

Add `RuntimePresentation {presentationMode:"LOCAL_TEST"|"EXTERNAL_INJECTED"}` as the final explicit argument to `statusResponse`, `dashboardResponse`, and `createDashboardServer`. Extend `/health` with only:

```json
{"status":"ok","mode":"testnet-prototype","presentationMode":"LOCAL_TEST"}
```

or `EXTERNAL_INJECTED`, supplied by composition. Do not expose capability objects. Keep all methods read-only and delivery records stripped of envelopes/shares.

- [ ] **Step 7: Run focused tests and commit**

Run: `npm run build && node --test services/coordinator/test/runtime.test.js services/coordinator/test/compose-runtime.test.js services/coordinator/test/status-api.test.js`  
Expected: all runtime, composition, and status tests pass.

```bash
git add services/coordinator/src/runtime.ts services/coordinator/test/runtime.test.js services/coordinator/src/compose-runtime.ts services/coordinator/test/compose-runtime.test.js services/coordinator/src/status-api.ts services/coordinator/test/status-api.test.js
git commit -m "feat: compose complete Sentinel delivery runtime"
```

### Task 8: Full programmatic vertical slice

**Files:**
- Create: `services/coordinator/test/uln302-runtime-e2e.test.js`

**Interfaces:**
- Consumes: coordinator, intent factory, path verifier interface, outbox, planner, destination worker, independent receipt verifier, signer services, and deployed adapter.
- Proves: finalized `ALLOW -> SIGNING -> READY/QUORUM_REACHED -> SUBMITTED -> CONFIRMED/EXECUTED`.

- [ ] **Step 1: Write the failing end-to-end test**

Start Hardhat EDR with enough ephemeral identities. Read the latest block timestamp as `now`, set evidence validity to `now + 600`, and use a 300-second signature TTL so the adapter sees an unexpired envelope. Deploy `MockVerificationTarget` and `SentinelDVNAdapter` with five sorted signer addresses and quorum three. Create five `IsolatedSignerService` instances whose digest signer calls the EDR signer's `signMessage(getBytes(digest))`. Seed a coordinator with a canonical finalized `ALLOW` request/result. Use a fixed successful `DestinationPathVerifier` with one local-test confirmation, a real temporary SQLite outbox, `DeliveryPlanner`, and this submitter:

```js
const submitter={
  used:digest=>adapter.used(digest),
  async submitVerification(envelope,signatures){
    const tx=await adapter.submitVerification(envelope.guid,envelope.packetDigest,envelope.evidenceDigest,envelope.callData,envelope.expiry,signatures);
    return tx.hash;
  }
};
```

Back two distinct HTTPS fixture origins with one deterministic adapter around the local provider's `send(method,params)` only for the independent verifier test boundary. Run planner once and worker twice, then assert:

```js
assert.equal((await outbox.get(guid)).state,"CONFIRMED");
assert.equal(coordinator.jobs.get(guid).snapshot.stage,"EXECUTED");
assert.equal(await target.lastPayloadHash(),request.packet.payloadHash);
assert.equal(await target.lastConfirmations(),path.confirmations);
assert.equal(getBytes(await target.lastHeader()).length,81);
```

Add a `DENY` companion case proving zero signer calls, zero adapter transactions, and no outbox row.

- [ ] **Step 2: Run the E2E test and verify the red phase**

Run: `npm run build && node --test services/coordinator/test/uln302-runtime-e2e.test.js`  
Expected: PASS if Tasks 1-7 implemented every published interface correctly. If it fails, the failure must identify a real cross-component binding defect; do not weaken the assertion.

- [ ] **Step 3: Make only binding corrections revealed by the E2E test**

If Step 2 exposed a defect, limit corrections to mismatched interfaces, canonical hex normalization, receipt shape normalization, or idempotent lifecycle ordering in the files introduced by Tasks 2-7. If Step 2 passed, make no production change. Do not bypass independent confirmation, reduce quorum, replace the real adapter with a fake, or add timing sleeps.

- [ ] **Step 4: Run the vertical slice and all changed backend suites**

Run: `npm run build && node --test services/coordinator/test/destination-path-verifier.test.js services/coordinator/test/uln302-intent.test.js services/coordinator/test/verification-outbox.test.js services/coordinator/test/delivery-planner.test.js services/coordinator/test/destination-worker.test.js services/coordinator/test/runtime.test.js services/coordinator/test/compose-runtime.test.js services/coordinator/test/uln302-runtime-e2e.test.js contracts/test/adapter.test.js`  
Expected: all listed tests pass with no external network calls and no leaked EDR process.

- [ ] **Step 5: Commit the proven vertical slice**

```bash
git add services/coordinator/test/uln302-runtime-e2e.test.js
git commit -m "test: prove crash-safe ULN302 delivery slice"
```

Before committing, inspect `git diff --cached --name-only` and unstage any file not required by Tasks 2-8.

### Task 9: Honest app, operations documentation, and release evidence

**Files:**
- Modify: `apps/dashboard/index.html`
- Modify: `apps/dashboard/src/app.js`
- Modify: `scripts/check-dashboard.mjs`
- Modify: `README.md`
- Modify: `docs/OPERATIONS.md`
- Modify: `docs/MILESTONES.md`
- Modify: `docs/SECURITY_STATUS.md`
- Modify: `docs/DEMO.md`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: real `/health`, `/api/jobs`, and `/api/deliveries` responses.
- Produces: prominent `LOCAL TEST`/`EXTERNAL INJECTED` label with no simulated data and truthful 0.22.0 milestone documentation.

- [ ] **Step 1: Tighten the dashboard guard before UI changes**

Add `runtime-mode` to required HTML IDs and require these JS tokens:

```js
"fetch(\"/health\""
"LOCAL TEST"
"SIGNING"
"No simulated state is shown"
```

Continue rejecting mock/sample job data and every state-changing fetch method.

- [ ] **Step 2: Run the dashboard check and verify the red phase**

Run: `npm run check:dashboard`  
Expected: FAIL with `missing dashboard target runtime-mode`.

- [ ] **Step 3: Render real runtime and delivery state**

Give the header badge `id="runtime-mode"`. Fetch `/health` from the same origin, render `LOCAL TEST` prominently for `LOCAL_TEST`, render `EXTERNAL INJECTED` for that mode, and render `MODE UNAVAILABLE` on invalid/unavailable health data. In the delivery section, describe `SIGNING` as `intent durable; collecting 3-of-5`, `READY` as `quorum durable; awaiting submission`, and preserve visibly distinct `FAILED` and `RECOVERY_REQUIRED`. Use only `textContent`.

- [ ] **Step 4: Run dashboard checks**

Run: `npm run check:dashboard`  
Expected: dashboard syntax and no-simulation guardrails pass.

- [ ] **Step 5: Update truthful operator and project documentation**

Update README/runtime signature, milestone status, operations startup/tick/recovery behavior, demo walkthrough, and security coverage to state what the passing slice proves. Keep all of these explicit: no live app URL, no deployment, no approved account provider, no live GenLayer finality, no mTLS/KMS/HSM, no five independent operators, no atomic on-chain path-config commitment, no authenticated ambiguous-attempt recovery, and no mainnet claim. Document the five configured identities/3-of-5 target and the off-chain configuration-change race.

Change `package.json` and lockfile root version from `0.21.0` to `0.22.0` without changing dependencies.

- [ ] **Step 6: Run complete verification**

Run: `npm run check`  
Expected: TypeScript, five Solidity production/test source compilation, Intelligent Contract guardrails, dashboard guardrails, and the complete automated suite pass.

Run: `npm audit --omit=dev`  
Expected: zero production vulnerabilities.

Run: `git diff --check`  
Expected: no whitespace errors.

Run: `git diff -- contracts/src`  
Expected: no production Solidity contract change in this milestone.

Run: `git status --short`  
Expected: only intentional source, test, documentation, example-config, version, and generated artifact changes are present; no manifest containing real secrets or addresses exists.

- [ ] **Step 7: Commit the milestone release**

```bash
git add apps/dashboard/index.html apps/dashboard/src/app.js scripts/check-dashboard.mjs README.md docs/OPERATIONS.md docs/MILESTONES.md docs/SECURITY_STATUS.md docs/DEMO.md package.json package-lock.json
git commit -m "chore: release crash-safe ULN302 runtime milestone"
```

- [ ] **Step 8: Verify the committed tree**

Run: `git status --short`  
Expected: no output.

Run: `git log -10 --oneline`  
Expected: the nine task commits are visible in order, ending with `chore: release crash-safe ULN302 runtime milestone`.

## Execution Checkpoints

- After Task 2: destination pathway configuration is independently verifiable but no signer or transaction path is enabled.
- After Task 4: signing intent is crash-safe, but no runtime planner uses it yet.
- After Task 7: the complete backend is composed with injected capabilities; no live provider or keys are created.
- After Task 8: a local programmatic E2E proves the exact adapter lifecycle; it is still simulation evidence, not testnet evidence.
- After Task 9: app and documentation accurately expose the working backend and remaining deployment/security gates.
