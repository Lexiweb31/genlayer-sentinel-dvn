# Hardened Operator Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a state-bound, timelocked, 3-of-5 operator recovery workflow that can only requeue a verified quarantined source packet or confirm an independently proven ambiguous destination transaction.

**Architecture:** Extend the private runtime manifest with a recovery council, encode each recovery as one deployment-bound EIP-712 proposal, and require exactly three detached approvals. A SQLite runtime fence excludes live coordinator mutation; dedicated store methods combine protected state transitions with a hash-chained audit receipt; an offline CLI prepares or applies actions without accepting keys; the status API and dashboard remain read-only.

**Tech Stack:** TypeScript 5.8 strict mode, Node.js 22 built-ins, Node SQLite, ethers 6.17 EIP-712/ABI utilities, existing LayerZero packet/path verifiers, Node test runner, local Hardhat 3.10 EDR.

## Global Constraints

- No deployment, transaction broadcast, funding, cloud resource, public endpoint, signer key, environment-variable secret, or GitHub publication.
- Recovery operators are exactly five sorted nonzero addresses; quorum is exactly three; none may overlap the five DVN signer addresses.
- `minimumDelaySeconds` is at least `900`; `maximumLifetimeSeconds` is at most `86400` and at least `minimumDelaySeconds + 300`.
- Recovery accepts detached signatures only and never constructs a signing provider.
- Apply requires a cleanly released runtime lease; a stale heartbeat alone never authorizes recovery.
- Ingestion recovery repeats two-provider receipt and historical source-path checks and then returns to ordinary policy processing.
- Destination recovery repeats path, receipt, event, used-state, block-hash, and confirmation checks and never calls a submitter.
- Browser and HTTP surfaces remain read-only and expose no signature bytes, packet payloads, RPC paths, evidence content, database path, or raw error.
- Every behavior change follows RED → GREEN with the focused command shown below; every task ends with a local commit.

---

### Task 1: Recovery policy and deployment binding

**Files:**
- Modify: `services/coordinator/src/runtime-config.ts`
- Modify: `config/sentinel-runtime.example.json`
- Modify: `services/coordinator/test/runtime-config.test.js`
- Create: `services/coordinator/src/recovery-domain.ts`
- Create: `services/coordinator/test/recovery-domain.test.js`

**Interfaces:**
- Produces: `RecoveryPolicyConfig`
- Produces: `recoveryDeploymentDigest(config:RuntimeConfig):Hex`
- Consumes later: all proposal and recovery composition tasks use the exact policy and digest.

- [ ] **Step 1: Write failing recovery-policy tests**

Add recovery policy to the existing valid manifest fixture and assert:

```js
assert.deepEqual(parsed.recovery,{
  operators:[a("6"),a("7"),a("8"),a("9"),a("a")],
  quorum:3,
  minimumDelaySeconds:900,
  maximumLifetimeSeconds:3600
});
for(const mutate of[
  value=>value.recovery.operators.pop(),
  value=>value.recovery.quorum=2,
  value=>value.recovery.minimumDelaySeconds=899,
  value=>value.recovery.maximumLifetimeSeconds=1200,
  value=>value.recovery.operators[0]=value.destination.authorizedSigners[0]
])assert.throws(()=>parseRuntimeConfig(mutate(validConfig())),/recovery/);
```

Add a second test that changes every deployment-bound field one at a time and asserts `recoveryDeploymentDigest` changes, while RPC URLs, storage path, polling interval, and status port do not affect it.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
npm run build && node --test services/coordinator/test/runtime-config.test.js services/coordinator/test/recovery-domain.test.js
```

Expected: failure because `recovery` and `recoveryDeploymentDigest` do not exist.

- [ ] **Step 3: Implement strict recovery configuration**

Add:

```ts
export interface RecoveryPolicyConfig {
  operators:Hex[];
  quorum:3;
  minimumDelaySeconds:number;
  maximumLifetimeSeconds:number;
}
```

Require the exact root key `recovery`, exact nested keys, five sorted unique addresses, quorum three, delay floor, lifetime ceiling, 300-second post-delay window, and no overlap with `destination.authorizedSigners`.

In `recovery-domain.ts`, hash this ABI tuple:

```ts
[
  config.pathway.sourceChainId,
  config.destination.chainId,
  config.pathway.srcEid,
  config.pathway.dstEid,
  config.pathway.endpoint,
  config.pathway.sendLibrary,
  config.pathway.sourceOAppAddress,
  config.destination.oapp,
  config.pathway.sentinelDvn,
  config.destination.adapter,
  config.destination.receiveLibrary,
  config.genlayer.policyContract
]
```

Use explicit ABI types and return lowercase bytes32. Add the non-deployable recovery policy to the checked-in example.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command.

Expected: all focused tests pass.

- [ ] **Step 5: Commit**

```bash
git add services/coordinator/src/runtime-config.ts services/coordinator/src/recovery-domain.ts config/sentinel-runtime.example.json services/coordinator/test/runtime-config.test.js services/coordinator/test/recovery-domain.test.js
git commit -m "feat: configure recovery council"
```

---

### Task 2: Canonical EIP-712 proposals and 3-of-5 approvals

**Files:**
- Create: `services/coordinator/src/recovery-proposal.ts`
- Create: `services/coordinator/test/recovery-proposal.test.js`

**Interfaces:**
- Consumes: `RuntimeConfig`, `RecoveryPolicyConfig`, `recoveryDeploymentDigest`
- Produces:

```ts
export type RecoveryKind="INGESTION_REQUEUE"|"DESTINATION_CONFIRM";
export interface RecoveryProposalV1 {
  version:1;
  kind:RecoveryKind;
  deploymentDigest:Hex;
  subject:Hex;
  expectedState:"DEAD"|"RECOVERY_REQUIRED";
  expectedFailureCode:string;
  preconditionDigest:Hex;
  candidateTransactionHash:Hex;
  nonce:Hex;
  preparedAt:string;
  executeAfter:string;
  expiresAt:string;
}
export interface RecoveryApproval {address:Hex;signature:Hex}
export interface ValidatedRecoveryBundle {
  proposal:RecoveryProposalV1;
  approvals:RecoveryApproval[];
  actionId:Hex;
}
export function makeRecoveryProposal(config:RuntimeConfig,input:RecoveryProposalInput):RecoveryProposalV1;
export function recoveryTypedData(config:RuntimeConfig,proposal:RecoveryProposalV1):{
  domain:TypedDataDomain;types:Record<string,TypedDataField[]>;value:Record<string,unknown>
};
export function recoveryProposalDigest(config:RuntimeConfig,proposal:RecoveryProposalV1):Hex;
export function validateRecoveryBundle(config:RuntimeConfig,value:unknown,now:number):ValidatedRecoveryBundle;
```

- [ ] **Step 1: Write the failing proposal tests**

Use five real ephemeral ethers wallets, sorted by lowercase address. Create a proposal with an injected nonce and clock, sign its exported typed data with the first three wallets, and assert:

```js
const validated=validateRecoveryBundle(config,bundle,1000);
assert.equal(validated.actionId,recoveryProposalDigest(config,proposal));
assert.deepEqual(validated.approvals.map(value=>value.address),operators.slice(0,3));
```

For each mutation below, reconstruct the bundle and assert rejection:

```js
[
  bundle=>bundle.approvals.pop(),
  bundle=>bundle.approvals.push(bundle.approvals[0]),
  bundle=>bundle.approvals.reverse(),
  bundle=>bundle.proposal.subject=h("f"),
  bundle=>bundle.proposal.deploymentDigest=h("e"),
  bundle=>bundle.proposal.executeAfter="899",
  bundle=>bundle.proposal.expiresAt="1000",
  bundle=>bundle.extra=true
]
```

Also sign once with the wrong EIP-712 chain ID and once with a DVN signer; both must fail.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm run build && node --test services/coordinator/test/recovery-proposal.test.js
```

Expected: module-not-found failure for `recovery-proposal.js`.

- [ ] **Step 3: Implement proposal construction and strict parsing**

Use one EIP-712 `RecoveryProposal` type with:

```ts
[
  {name:"kind",type:"bytes32"},
  {name:"deploymentDigest",type:"bytes32"},
  {name:"subject",type:"bytes32"},
  {name:"expectedState",type:"bytes32"},
  {name:"expectedFailureCode",type:"bytes32"},
  {name:"preconditionDigest",type:"bytes32"},
  {name:"candidateTransactionHash",type:"bytes32"},
  {name:"nonce",type:"bytes32"},
  {name:"preparedAt",type:"uint64"},
  {name:"executeAfter",type:"uint64"},
  {name:"expiresAt",type:"uint64"}
]
```

Hash textual enum/code values with `keccak256(toUtf8Bytes(value))`. Build the domain with name/version, destination chain ID, adapter, and deployment salt. Parse exact keys, canonical decimal strings, bytes32 values, state/kind pairs, nonzero nonce, deployment equality, delay/lifetime bounds, and current time. Require exactly three sorted unique approvals and recover each with `verifyTypedData`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command.

Expected: all proposal tests pass with real EIP-712 signatures.

- [ ] **Step 5: Commit**

```bash
git add services/coordinator/src/recovery-proposal.ts services/coordinator/test/recovery-proposal.test.js
git commit -m "feat: authorize typed recovery proposals"
```

---

### Task 3: Durable runtime and recovery exclusion

**Files:**
- Create: `services/coordinator/src/runtime-lease.ts`
- Create: `services/coordinator/test/runtime-lease.test.js`
- Modify: `services/coordinator/src/runtime.ts`
- Modify: `services/coordinator/test/runtime.test.js`

**Interfaces:**
- Produces:

```ts
export interface RuntimeLease {
  claimRuntime(owner:string,now:number,allowStale:boolean):Promise<void>;
  heartbeatRuntime(owner:string,now:number):Promise<void>;
  releaseRuntime(owner:string,now:number):Promise<void>;
  assertReleased():Promise<void>;
  acquireRecovery(actionId:Hex,now:number):Promise<void>;
  releaseRecovery(actionId:Hex):Promise<void>;
  close():void;
}
export class SqliteRuntimeLease implements RuntimeLease {
  constructor(path:string,staleAfterSeconds:number);
}
```

- Consumes later: CLI apply uses recovery exclusion; composed runtime owns heartbeat/release.

- [ ] **Step 1: Write failing SQLite lease tests**

With two store instances on one temporary database, prove:

```js
await first.claimRuntime("owner-a",100,false);
await assert.rejects(second.assertReleased(),/runtime active/);
await assert.rejects(second.claimRuntime("owner-b",101,false),/runtime active/);
await first.heartbeatRuntime("owner-a",110);
await assert.rejects(second.claimRuntime("owner-b",200,false),/runtime active/);
await second.claimRuntime("owner-b",200,true);
await assert.rejects(first.heartbeatRuntime("owner-a",201),/lease ownership/);
await second.releaseRuntime("owner-b",202);
await second.acquireRecovery(h("1"),203);
await assert.rejects(first.acquireRecovery(h("2"),203),/recovery busy/);
await second.releaseRecovery(h("1"));
```

Assert invalid clocks, owners, action IDs, timestamp regression, and release by a non-owner all fail.

- [ ] **Step 2: Write failing runtime lifecycle tests**

Extend `RuntimeDependencies` test doubles and assert exact ordering:

```js
assert.deepEqual(calls.slice(0,3),["restore","listen","claim-lease"]);
assert.deepEqual(tickCalls,[
  "heartbeat-lease","ingest","finality","plan-deliveries","deliver","heartbeat-lease"
]);
assert.deepEqual(stopCalls.slice(-3),["close-server","release-lease","close-stores"]);
```

Startup failure after listener binding must close the server and stores without claiming success.

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```bash
npm run build && node --test services/coordinator/test/runtime-lease.test.js services/coordinator/test/runtime.test.js
```

Expected: missing lease module and runtime dependency failures.

- [ ] **Step 4: Implement the lease store**

Create singleton SQLite rows for runtime and recovery ownership. Use `BEGIN IMMEDIATE` for every transition. `allowStale` may replace an `ACTIVE` runtime owner only when `now - heartbeat_at > staleAfterSeconds`; `assertReleased` never treats staleness as release. Recovery acquisition requires runtime state `RELEASED`.

- [ ] **Step 5: Integrate the runtime hooks**

Add `claimLease`, `heartbeatLease`, and `releaseLease` dependencies. Start in restore → listen → claim order. Heartbeat before and after each serialized tick. Stop scheduling, drain, close HTTP, release the lease, then close stores. Sanitize lease errors through the existing runtime report path.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run the Step 3 command.

Expected: all lease and runtime tests pass.

- [ ] **Step 7: Commit**

```bash
git add services/coordinator/src/runtime-lease.ts services/coordinator/test/runtime-lease.test.js services/coordinator/src/runtime.ts services/coordinator/test/runtime.test.js
git commit -m "feat: fence operator recovery from runtime"
```

---

### Task 4: Hash-chained audit and atomic protected transitions

**Files:**
- Create: `services/coordinator/src/recovery-audit.ts`
- Create: `services/coordinator/test/recovery-audit.test.js`
- Modify: `services/coordinator/src/recovery-store.ts`
- Modify: `services/coordinator/test/recovery-store.test.js`
- Modify: `services/coordinator/src/verification-outbox.ts`
- Modify: `services/coordinator/test/verification-outbox.test.js`

**Interfaces:**
- Produces:

```ts
export interface RecoveryAuditInput {
  actionId:Hex;
  kind:RecoveryKind;
  deploymentDigest:Hex;
  subject:Hex;
  preconditionDigest:Hex;
  candidateTransactionHash:Hex;
  operators:Hex[];
  preparedAt:number;
  executeAfter:number;
  expiresAt:number;
  resultCode:"INGESTION_REQUEUED"|"DESTINATION_CONFIRMED";
}
export interface RecoveryReceipt extends RecoveryAuditInput {
  approvalCount:3;
  appliedAt:number;
  previousReceiptHash:Hex;
  receiptHash:Hex;
}
export interface RecoveryReceiptReader {
  listRecoveryReceipts():Promise<RecoveryReceipt[]>;
  getRecoveryReceipt(actionId:Hex):Promise<RecoveryReceipt|undefined>;
}
```

- Extends:

```ts
RecoveryStore.resolveWithAudit(
  pathwayKey:string,transactionHash:string,input:RecoveryAuditInput,appliedAt:number
):Promise<RecoveryReceipt>;

VerificationOutboxStore.recoverConfirmed(
  guid:Hex,expectedDigest:Hex,expectedFailureCode:string,
  transactionHash:Hex,confirmations:bigint,input:RecoveryAuditInput,appliedAt:number
):Promise<{record:OutboxRecord;receipt:RecoveryReceipt}>;
```

- [ ] **Step 1: Write the failing audit-chain test**

Append two inputs through a test database helper and assert the second `previousReceiptHash` equals the first `receiptHash`. Close/reopen and verify the same list. Mutate the first row with direct test-only SQL and assert every read throws `recovery audit invariant violation`.

- [ ] **Step 2: Write failing atomic transition tests**

For ingestion:

```js
const receipt=await store.resolveWithAudit("path",tx,auditInput,200);
assert.equal(await store.findDead("path",tx),undefined);
assert.equal((await reader.listRecoveryReceipts()).length,1);
assert.deepEqual(await store.resolveWithAudit("path",tx,auditInput,201),receipt);
```

For destination, prepare a `RECOVERY_REQUIRED` record and assert direct recovery produces `CONFIRMED`, preserves envelope/shares/digest, attaches the exact proven hash/confirmations, and writes one receipt. Wrong state, digest, failure code, GUID, or zero confirmations must leave both record and ledger unchanged.

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```bash
npm run build && node --test services/coordinator/test/recovery-audit.test.js services/coordinator/test/recovery-store.test.js services/coordinator/test/verification-outbox.test.js
```

Expected: missing audit module and recovery methods.

- [ ] **Step 4: Implement the shared audit helper**

Create the audit table in both protected store constructors. Within the caller's existing SQLite transaction, verify the full chain, return an existing identical action idempotently, compute:

```ts
receiptHash=keccak256(AbiCoder.defaultAbiCoder().encode(
  ["bytes32","bytes32","bytes32","bytes32","bytes32","bytes32","address[]","uint64","uint64","uint64","uint64","bytes32","bytes32"],
  [actionId,kindHash,deploymentDigest,subject,preconditionDigest,candidateTransactionHash,operators,preparedAt,executeAfter,expiresAt,appliedAt,resultCodeHash,previousReceiptHash]
));
```

- [ ] **Step 5: Implement protected store methods**

`resolveWithAudit` verifies the exact dead record, deletes it, and appends the receipt in one recovery-store transaction. `recoverConfirmed` permits only `RECOVERY_REQUIRED -> CONFIRMED`, verifies exact digest/failure and positive confirmations, preserves signed material, updates the outbox row, and appends the receipt in one outbox transaction. Do not add this transition to the general transition map.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run the Step 3 command.

Expected: audit, replay, tamper, and atomic transition tests pass.

- [ ] **Step 7: Commit**

```bash
git add services/coordinator/src/recovery-audit.ts services/coordinator/test/recovery-audit.test.js services/coordinator/src/recovery-store.ts services/coordinator/test/recovery-store.test.js services/coordinator/src/verification-outbox.ts services/coordinator/test/verification-outbox.test.js
git commit -m "feat: audit atomic recovery transitions"
```

---

### Task 5: State and chain-bound recovery service

**Files:**
- Create: `services/coordinator/src/operator-recovery.ts`
- Create: `services/coordinator/test/operator-recovery.test.js`
- Modify: `services/coordinator/src/recovery-service.ts`

**Interfaces:**
- Consumes: proposal validation, runtime lease, audit reader, `PacketVerifier`, `DestinationPathVerifier`, `DestinationConfirmationVerifier`, recovery/listener/outbox stores.
- Produces:

```ts
export interface OperatorRecoveryDependencies {
  config:RuntimeConfig;
  recoveryStore:RecoveryStore&RecoveryReceiptReader;
  inbox:PacketInbox;
  outbox:VerificationOutboxStore&RecoveryReceiptReader;
  sourceVerifier:PacketVerifier;
  destinationPath:DestinationPathVerifier;
  destinationVerifier:DestinationConfirmationVerifier;
  lease:RuntimeLease;
  now:()=>number;
  nonce:()=>Hex;
}
export class OperatorRecoveryService {
  prepareIngestion(transactionHash:Hex):Promise<RecoveryProposalV1>;
  prepareDestination(guid:Hex,candidateTransactionHash:Hex):Promise<RecoveryProposalV1>;
  apply(bundle:unknown):Promise<RecoveryReceipt>;
}
```

- [ ] **Step 1: Write failing ingestion prepare/apply tests**

Build a retained `DetectedPacket` with real canonical PacketV1 bytes. Assert prepare calls the source verifier, binds its shared configuration digest, and does not mutate stores. Advance the clock beyond `executeAfter`, sign with three recovery wallets, apply, and assert inbox requeue precedes `resolveWithAudit`.

Add failures for missing/dead-state drift, wrong source proof, active runtime, two approvals, changed retained packet, and expired proposal. Assert every failure leaves the dead letter and audit unchanged.

- [ ] **Step 2: Write failing destination prepare/apply tests**

Create a `RECOVERY_REQUIRED/SUBMISSION_AMBIGUOUS` outbox record. Both prepare and apply must call destination path verification and pass a temporary candidate record to `destinationVerifier.confirm`. Assert only `CONFIRMED` is accepted:

```js
assert.equal(candidate.state,"SUBMITTED");
assert.equal(candidate.transactionHash,candidateHash);
assert.equal(submitterCalls,0);
```

Cover `PENDING`, every `FAILED` result, changed outbox digest/state/failure, active runtime, replay, and audit mismatch. None may call `recoverConfirmed`.

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```bash
npm run build && node --test services/coordinator/test/operator-recovery.test.js
```

Expected: module-not-found failure.

- [ ] **Step 4: Implement deterministic observations**

Decode retained packet bytes with `decodePacketV1`, construct the complete core `Packet` with transaction/block fields and encoded-payload hash, and call the combined source verifier. Compute ingestion preconditions from every dead-letter field, retained packet bytes/options/DVN fees, decoded packet digest, and shared source configuration digest.

Compute destination preconditions from GUID, execution digest, complete envelope, exact sorted shares/signatures, state, failure code, and record timestamps. Use ABI encoding, not object stringification.

- [ ] **Step 5: Implement prepare and apply**

Prepare observes state/chain, creates a random-nonce proposal, and writes nothing. Apply validates the bundle and checks for an existing receipt before acquiring the recovery lease. It reacquires the exact observation, compares `preconditionDigest`, executes only the matching protected store method, and releases the recovery lease in `finally`.

Map internal failures to the allowlisted recovery codes through a `RecoveryError` carrying only its code. Never include raw provider or SQLite messages.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run the Step 3 command.

Expected: all recovery service tests pass.

- [ ] **Step 7: Commit**

```bash
git add services/coordinator/src/operator-recovery.ts services/coordinator/test/operator-recovery.test.js services/coordinator/src/recovery-service.ts
git commit -m "feat: apply evidence-bound operator recovery"
```

---

### Task 6: Offline prepare/apply CLI

**Files:**
- Create: `services/coordinator/src/json-rpc.ts`
- Modify: `services/coordinator/src/rpc-verifier.ts`
- Modify: `services/coordinator/src/source-path-verifier.ts`
- Create: `services/coordinator/src/recovery-command.ts`
- Create: `services/coordinator/src/recovery-cli.ts`
- Create: `services/coordinator/test/recovery-command.test.js`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: `safeJsonRpc(url:string,method:string,params:unknown[]):Promise<unknown>`
- Produces:

```ts
export async function runRecoveryCommand(
  args:string[],
  io:{stdout(value:string):void;stderr(value:string):void},
  dependencies?:RecoveryCommandDependencies
):Promise<number>;
```

- [ ] **Step 1: Write failing CLI surface tests**

Use temporary absolute manifest/bundle paths and injected service factories. Assert exact commands call the matching service method and emit one canonical JSON line. Assert relative paths, environment-only config, unknown commands, malformed hashes, extra arguments, invalid JSON, and service failures emit one allowlisted code and no raw exception text.

Assert the apply command never requests a key, mnemonic, provider signer, or wallet callback from dependencies.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
npm run build && node --test services/coordinator/test/recovery-command.test.js
```

Expected: missing command module.

- [ ] **Step 3: Extract one hardened JSON-RPC transport**

Move the existing ten-second POST, redirect refusal, strict JSON-RPC correlation, and sanitized failure behavior into `json-rpc.ts`. Inject it into source receipt/path and destination path/confirmation verifiers used by the CLI. Keep all existing verifier tests green.

- [ ] **Step 4: Implement command composition**

Read explicit absolute files with `readFile`; parse the runtime manifest; open listener, recovery, outbox, audit, and lease stores; construct the existing source/destination verifiers; create the operator service; execute one command; and close every acquired resource in reverse order on success or failure.

Use `randomBytes(32)` for proposal nonces. Serialize bigint values as decimal strings. Print only proposal or receipt JSON. The thin `recovery-cli.ts` sets `process.exitCode` from `runRecoveryCommand`.

Add:

```json
"recovery:prepare": "npm run build && node dist/services/coordinator/src/recovery-cli.js prepare",
"recovery:apply": "npm run build && node dist/services/coordinator/src/recovery-cli.js apply"
```

- [ ] **Step 5: Run focused and verifier regression tests**

Run:

```bash
npm run build && node --test services/coordinator/test/recovery-command.test.js services/coordinator/test/rpc-verifier.test.js services/coordinator/test/source-path-verifier.test.js services/coordinator/test/destination-path-verifier.test.js services/coordinator/test/destination-verifier.test.js
```

Expected: all tests pass and CLI output contains no secret-bearing path or raw error.

- [ ] **Step 6: Commit**

```bash
git add services/coordinator/src/json-rpc.ts services/coordinator/src/rpc-verifier.ts services/coordinator/src/source-path-verifier.ts services/coordinator/src/recovery-command.ts services/coordinator/src/recovery-cli.ts services/coordinator/test/recovery-command.test.js package.json package-lock.json
git commit -m "feat: add detached recovery CLI"
```

---

### Task 7: Runtime composition and read-only recovery evidence

**Files:**
- Modify: `services/coordinator/src/compose-runtime.ts`
- Modify: `services/coordinator/test/compose-runtime.test.js`
- Modify: `services/coordinator/src/status-api.ts`
- Modify: `services/coordinator/test/status-api.test.js`
- Modify: `apps/dashboard/index.html`
- Modify: `apps/dashboard/src/app.js`
- Modify: `apps/dashboard/src/recovery.css`
- Modify: `scripts/check-dashboard.mjs`

**Interfaces:**
- Composed runtime owns `SqliteRuntimeLease` and `RecoveryReceiptReader`.
- Status API adds sanitized `GET /api/recovery-actions`.
- Dashboard adds an `OPERATOR RECOVERY` read-only audit section.

- [ ] **Step 1: Write failing composition tests**

Assert construction performs no lease or network work. Start the runtime and assert listener bind occurs before runtime lease claim. Stop and assert HTTP close precedes clean lease release and store close. A live lease owned by another runtime must make startup fail and close all acquired resources.

- [ ] **Step 2: Write failing API/dashboard tests**

Return one receipt containing test-only `signature`, `databasePath`, and `rawPacket` fields from a malicious reader double. Assert `/api/recovery-actions` includes only:

```js
{
  actionId,kind,subject,candidateTransactionHash,operators,
  approvalCount:3,preparedAt,executeAfter,expiresAt,appliedAt,
  resultCode,previousReceiptHash,receiptHash
}
```

Assert POST remains 405. Extend the static dashboard check to require the recovery endpoint/label and reject recovery buttons, forms, POST/fetch mutation, signature rendering, or simulated receipts.

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```bash
npm run build && node --test services/coordinator/test/compose-runtime.test.js services/coordinator/test/status-api.test.js apps/dashboard/test/*.test.js
```

Expected: missing lease composition, endpoint, and dashboard section.

- [ ] **Step 4: Wire lease and audit readers**

Acquire the lease store in `composeRuntime`, generate one process owner with `randomUUID`, pass claim/heartbeat/release callbacks into `SentinelRuntime`, and pass a sanitized audit reader into `createDashboardServer`. Ensure reverse-order construction cleanup remains exact.

- [ ] **Step 5: Add the read-only dashboard section**

Fetch `/api/recovery-actions` every five seconds. Render action kind, shortened subject/candidate, `3 of 5 approvals`, stable result, applied time, and receipt hash. Empty/unavailable states must be explicit. Do not expose an action or recovery control.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run the Step 3 command.

Expected: all runtime, API, dashboard, and no-mutation checks pass.

- [ ] **Step 7: Commit**

```bash
git add services/coordinator/src/compose-runtime.ts services/coordinator/test/compose-runtime.test.js services/coordinator/src/status-api.ts services/coordinator/test/status-api.test.js apps/dashboard/index.html apps/dashboard/src/app.js apps/dashboard/src/recovery.css scripts/check-dashboard.mjs
git commit -m "feat: expose recovery audit evidence"
```

---

### Task 8: Adversarial E2E, documentation, and release gate

**Files:**
- Create: `services/coordinator/test/operator-recovery-e2e.test.js`
- Modify: `README.md`
- Modify: `docs/OPERATIONS.md`
- Modify: `docs/THREAT_MODEL.md`
- Modify: `docs/SECURITY_STATUS.md`
- Modify: `docs/MILESTONES.md`
- Modify: `docs/DEMO.md`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Proves one real local adapter transaction whose submitter returns ambiguously can be recovered only by timelocked 3-of-5 approval and repeated independent proof.
- Publishes honest version and test evidence without live-network claims.

- [ ] **Step 1: Write the failing destination-recovery E2E**

Use local EDR contracts and five ephemeral recovery wallets distinct from the five DVN wallets. Make the destination submitter broadcast the valid adapter transaction, retain its hash, then throw so the outbox becomes `RECOVERY_REQUIRED/SUBMISSION_AMBIGUOUS`.

Assert:

```js
assert.equal(outboxRecord.state,"RECOVERY_REQUIRED");
assert.equal(submissionCount,1);
```

Prepare while the runtime is stopped, sign with three recovery wallets, advance the injected clock past 900 seconds, apply, and assert:

```js
assert.equal((await outbox.get(guid)).state,"CONFIRMED");
assert.equal(submissionCount,1);
assert.equal((await audit.listRecoveryReceipts()).length,1);
```

Restart/poll the ordinary runtime and assert coordinator/OApp execution reaches the existing terminal state without another adapter submission. Repeat apply and prove the same receipt is returned.

- [ ] **Step 2: Run E2E and verify RED**

Run:

```bash
npm run build && node --test services/coordinator/test/operator-recovery-e2e.test.js
```

Expected: failure until all recovery composition is present.

- [ ] **Step 3: Complete only the integration needed for GREEN**

Reuse existing local EDR, adapter, outbox, coordinator, destination verifier, and OApp execution helpers. Do not introduce a special recovery fixture verifier that bypasses real receipt/event/used-state checks.

- [ ] **Step 4: Run E2E and verify GREEN**

Run the Step 2 command.

Expected: the ambiguous path recovers once, emits one audit receipt, never resubmits, and completes ordinary execution.

- [ ] **Step 5: Update truthful operational documentation**

Document:

- detached 3-of-5 recovery proposal/signing ceremony;
- 15-minute minimum delay and one-day maximum lifetime;
- explicit runtime stop/release procedure;
- source and destination repeated verification;
- crash ordering and replay behavior;
- audit receipt external archival;
- read-only dashboard evidence;
- no on-chain governor, HSM custody, independent operator proof, public RPC proof, live recovery, deployment, or mainnet claim.

Update the package/lock root version to `0.25.0`. Do not alter dependency versions.

- [ ] **Step 6: Run the complete verification gate**

Run:

```bash
npm run check
```

Expected: strict typecheck, five Solidity sources, Intelligent Contract guardrails, dashboard checks, and every unit/integration/contract/security/E2E test pass with zero failures, skips, or todos.

Run:

```bash
git diff --check
git status --short
rg -n --hidden -g '!node_modules/**' -g '!dist/**' -g '!artifacts/**' -g '!cache/**' '(PRIVATE_KEY|MNEMONIC|SECRET_KEY|API_KEY|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY)' .
```

Expected: no whitespace errors, no secret marker in production/config/docs, and only intended milestone files changed.

- [ ] **Step 7: Record exact evidence and commit**

Update `docs/SECURITY_STATUS.md` with the observed version, exact test count, and limitations from Step 6.

```bash
git add README.md docs/OPERATIONS.md docs/THREAT_MODEL.md docs/SECURITY_STATUS.md docs/MILESTONES.md docs/DEMO.md package.json package-lock.json services/coordinator/test/operator-recovery-e2e.test.js
git commit -m "chore: release hardened recovery milestone"
```

---

## Plan self-review result

- Spec coverage: configuration, EIP-712 approvals, timelock, runtime exclusion, source and destination evidence, atomic audit, replay, CLI, dashboard, adversarial E2E, and limitations each map to a task.
- Scope: one recovery subsystem with eight reviewable units; no signer daemon, on-chain governor, account provider, deployment, or monitoring expansion is included.
- Type consistency: `RecoveryProposalV1`, `ValidatedRecoveryBundle`, `RecoveryAuditInput`, `RecoveryReceipt`, `RuntimeLease`, and `OperatorRecoveryService` have one definition and stable consumers.
- Security ordering: no protected mutation occurs before current-state comparison, repeated chain proof, quorum validation, timelock validation, released-runtime assertion, and exclusive recovery acquisition.
