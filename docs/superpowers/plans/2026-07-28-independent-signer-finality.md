# Independent Signer Finality Witness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade Sentinel's signer protocol so each isolated signer receives and independently validates the exact GenLayer transaction, policy call and finalized request-bound record before signing.

**Architecture:** `sentinel-signer/v2` carries one bounded GenLayer authorization witness beside the destination envelope and finalized result. The coordinator constructs that witness only from durable state; a signer-side attestor checks `FINALIZED/7`, the pinned policy-contract `evaluate` call and the strict finalized record; the replay store permanently binds both authorization and execution digests.

**Tech Stack:** Node.js 22.13+, TypeScript 5.8.3, Node test runner, Node SQLite, ethers 6.17.0, SHA-256, Keccak-256, existing GenLayer status reader and direct-mode suite.

## Global Constraints

- Preserve the clean-room GenLayer Sentinel boundary and do not access Merit or `genlayer-escrow`.
- Work only on branch `codex/isolated-signer-daemon` in the existing linked worktree.
- Use test-driven development: add one failing behavior test, observe the expected failure, then implement.
- `sentinel-signer/v2` is the only accepted wire version; v1 has no deployed compatibility requirement.
- Do not alter `SentinelDVNAdapter.executionDigest`.
- Do not add private keys, mnemonics, account secrets, certificates, cloud credentials or secret-bearing environment variables.
- Do not deploy, fund, contact Studio/Bradbury, create cloud resources, publish or push.
- Preserve contract `DECIDED` versus off-chain `FINALIZED/7`.
- Keep Sentinel additional/optional beside independent LayerZero DVNs.
- Direct, EDR, signer, chain, policy, key and network tests remain clearly labeled local fixtures.
- Leave the root repository's unrelated `.DS_Store` untouched.

---

## File Structure

### New files

- `services/coordinator/src/genlayer-signer-finality.ts` — independent signer-side status, transaction and finalized-record verifier.
- `services/coordinator/test/genlayer-signer-finality.test.js` — adversarial attestor tests.

### Modified files

- `services/coordinator/src/genlayer-record.ts` — input-oriented binding and decoder helpers.
- `services/coordinator/test/genlayer-record.test.js` — preserve the exact cross-language vector through both APIs.
- `services/coordinator/src/signing.ts` — authorization witness types and signer interface.
- `services/coordinator/test/signing.test.js` — signer authorization and attestor invocation.
- `services/coordinator/src/signer-protocol.ts` — v2 canonical witness and authorization hash.
- `services/coordinator/test/signer-protocol.test.js` — exact v2 bytes and strict witness bounds.
- `services/coordinator/src/signer-replay-store.ts` — authorization-digest schema and conflict binding.
- `services/coordinator/test/signer-replay-store.test.js` — v2 persistence and fail-closed migration.
- `services/coordinator/src/signer-protocol-handler.ts` — reserve and sign the exact authorization.
- `services/coordinator/test/signer-protocol-handler.test.js` — handler propagation and refusal.
- `services/coordinator/src/remote-signer.ts` — send v2 authorizations.
- `services/coordinator/test/remote-signer.test.js` — client binding and v1-response rejection.
- `services/coordinator/src/coordinator.ts` — construct authorization only from durable request ID/request/result.
- `services/coordinator/test/coordinator.test.js` — missing and exact durable context behavior.
- `services/coordinator/src/local-demo-harness.ts` — fixture attestor consumes v2 context.
- Relevant local EDR/E2E signer fixtures — migrate to the new signer interface.
- `README.md`, `docs/SIGNER_ARCHITECTURE.md`, `docs/MILESTONES.md`, `docs/UNKNOWNS.md`, `docs/THREAT_MODEL.md`, `docs/SECURITY_STATUS.md` — status and limits.
- `package.json`, `package-lock.json` — release `0.27.0`.

---

### Task 1: Input-Oriented GenLayer Record Binding

**Files:**
- Modify: `services/coordinator/src/genlayer-record.ts`
- Modify: `services/coordinator/test/genlayer-record.test.js`

**Interfaces:**
- Produces: `GenLayerPolicyInput`
- Produces: `genLayerPolicyInput(request: PolicyRequest): GenLayerPolicyInput`
- Produces: `genLayerRequestBindingFromInput(input: GenLayerPolicyInput, policyVersion: string): Hex`
- Produces: `decodeGenLayerRecordForInput(raw: unknown, input: GenLayerPolicyInput): GenLayerPolicyRecord`
- Preserves: `genLayerRequestBinding(request, policyVersion)` and `decodeGenLayerRecord(raw, request)`

- [ ] **Step 1: Add failing input-helper tests**

Add tests that construct:

```js
const input={
  guid:request.packet.guid,
  packetDigest:request.packet.payloadHash,
  evidenceUri:request.evidence.uri,
  evidenceDigest:request.evidence.digest,
  decodedAction:request.decodedAction,
  policy:request.policy,
};
```

Assert:

```js
assert.deepEqual(genLayerPolicyInput(request),input);
assert.equal(
  genLayerRequestBindingFromInput(input,"treasury-v1"),
  "0xe8539dc6d81fbd8491d86ca707cccc0d0e3a91629565eda34e7e1b5a85693b42"
);
assert.deepEqual(
  decodeGenLayerRecordForInput(boundRecord,input),
  decodeGenLayerRecord(boundRecord,request)
);
```

- [ ] **Step 2: Run the focused test and observe missing exports**

Run:

```bash
npm run build
node --test services/coordinator/test/genlayer-record.test.js
```

Expected: the Node test fails because the input-oriented exports do not exist.

- [ ] **Step 3: Implement thin input adapters**

Define:

```ts
export interface GenLayerPolicyInput{
  guid:Hex;
  packetDigest:Hex;
  evidenceUri:string;
  evidenceDigest:Hex;
  decodedAction:string;
  policy:string;
}
```

Move the current field-array construction into `genLayerRequestBindingFromInput`. Make the `PolicyRequest` functions convert through `genLayerPolicyInput`. Keep record limits, mismatch errors and the exact digest algorithm unchanged.

- [ ] **Step 4: Run record and finality tests**

Run:

```bash
npm run build
node --test services/coordinator/test/genlayer-record.test.js services/coordinator/test/genlayer-finality.test.js
```

Expected: all pass and the exact vector remains unchanged.

- [ ] **Step 5: Commit**

```bash
git add services/coordinator/src/genlayer-record.ts services/coordinator/test/genlayer-record.test.js
git commit -m "refactor: expose GenLayer policy binding input"
```

---

### Task 2: Signing Authorization and Independent Finality Attestor

**Files:**
- Modify: `services/coordinator/src/signing.ts`
- Modify: `services/coordinator/test/signing.test.js`
- Create: `services/coordinator/src/genlayer-signer-finality.ts`
- Create: `services/coordinator/test/genlayer-signer-finality.test.js`

**Interfaces:**
- Produces: `GenLayerAuthorizationWitness`
- Produces: `SigningAuthorization`
- Changes: `FinalityAttestor.assertFinalized(envelope, authorization)`
- Changes: `SignerService.sign(envelope, authorization)`
- Produces: `GenLayerTransactionWitness`
- Produces: `GenLayerSignerWitnessReader`
- Produces: `GenLayerSignerFinalityAttestor`

- [ ] **Step 1: Add failing attestor tests**

Use:

```js
const authorization={
  witness:{
    transactionId:h("9"),
    evidenceUri:request.evidence.uri,
    decodedAction:request.decodedAction,
    policy:request.policy,
  },
  result,
};
```

Create a status reader returning `FINALIZED/7`, a witness reader returning:

```js
{
  recipient:policyContract,
  functionName:"evaluate",
  args:[
    envelope.guid,
    envelope.packetDigest,
    authorization.witness.evidenceUri,
    envelope.evidenceDigest,
    authorization.witness.decodedAction,
    authorization.witness.policy,
  ],
  executionResultName:"FINISHED_WITH_RETURN",
}
```

and a bound compatibility record. Assert `assertFinalized(envelope,authorization)` passes.

Add one table-driven test changing each status, execution result, recipient, function, argument, record decision, policy version and request binding. Each case must reject with a sanitized error that excludes a fixture provider token.

- [ ] **Step 2: Run the new test and observe the missing module**

Run:

```bash
npm run build
node --test services/coordinator/test/genlayer-signer-finality.test.js
```

Expected: fail because `genlayer-signer-finality` does not exist.

- [ ] **Step 3: Define the authorization types and interface**

Add to `signing.ts`:

```ts
export interface GenLayerAuthorizationWitness{
  transactionId:Hex;
  evidenceUri:string;
  decodedAction:string;
  policy:string;
}
export interface SigningAuthorization{
  witness:GenLayerAuthorizationWitness;
  result:PolicyResult;
}
export interface FinalityAttestor{
  assertFinalized(
    envelope:SigningEnvelope,
    authorization:SigningAuthorization
  ):Promise<void>;
}
```

Change `SignerService.sign`, `IsolatedSignerService.sign` and `collectQuorum` to use `SigningAuthorization`. `IsolatedSignerService` checks `authorization.result.decision`, all envelope/result bindings and the signing domain before calling:

```ts
await this.finality.assertFinalized(e,authorization);
```

- [ ] **Step 4: Implement the signer attestor**

In `genlayer-signer-finality.ts`, construct `GenLayerPolicyInput` from the envelope and witness. Require exact `FINALIZED/7`, `FINISHED_WITH_RETURN`, pinned recipient, `evaluate`, six exact arguments and a strict finalized record. Require:

```ts
record.decision===authorization.result.decision
record.policyVersion===authorization.result.policyVersion
authorization.result.reasonCode===
  `GENLAYER_FINALIZED_${authorization.result.decision}`
```

Catch dependency errors only at their call boundary and throw allowlisted messages:

- `GenLayer signer status unavailable`
- `GenLayer signer transaction unavailable`
- `GenLayer signer record unavailable`
- `GenLayer signer finality mismatch`

- [ ] **Step 5: Update signing tests**

Change fixture calls from:

```js
service.sign(envelope,result)
```

to:

```js
service.sign(envelope,authorization)
```

Assert the attestor receives the exact same envelope and authorization object and that a changed result binding prevents both attestor and key invocation.

- [ ] **Step 6: Run focused tests**

Run:

```bash
npm run build
node --test services/coordinator/test/signing.test.js services/coordinator/test/genlayer-signer-finality.test.js
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add services/coordinator/src/signing.ts services/coordinator/test/signing.test.js services/coordinator/src/genlayer-signer-finality.ts services/coordinator/test/genlayer-signer-finality.test.js
git commit -m "feat: verify signer GenLayer finality witness"
```

---

### Task 3: Canonical `sentinel-signer/v2` Protocol

**Files:**
- Modify: `services/coordinator/src/signer-protocol.ts`
- Modify: `services/coordinator/test/signer-protocol.test.js`

**Interfaces:**
- Changes: `SIGNER_PROTOCOL_VERSION = "sentinel-signer/v2"`
- Changes: `SignerRequest.result` becomes `SignerRequest.authorization`
- Produces: `signerAuthorizationHash(authorization: SigningAuthorization): Hex`
- Enforces: 32,768-byte request maximum and Intelligent Contract semantic bounds

- [ ] **Step 1: Replace the canonical-byte expectation with v2**

The exact top-level request must be:

```js
{
  version:"sentinel-signer/v2",
  requestId,
  coordinatorId,
  issuedAt,
  expiresAt,
  envelope,
  authorization:{
    witness:{
      transactionId,
      evidenceUri,
      decodedAction,
      policy,
    },
    result,
  },
}
```

Assert `decodeSignerRequest(encodeSignerRequest(request))` deep-equals the source and `signerAuthorizationHash` changes when any witness or result field changes.

- [ ] **Step 2: Add strict failing cases**

Add rejection cases for:

- version `sentinel-signer/v1`;
- uppercase transaction ID;
- HTTP, credential-bearing or missing-host evidence URI;
- empty action/policy;
- action/policy above 8,192 UTF-8 bytes;
- evidence URI above 2,048 UTF-8 bytes;
- request above 32,768 UTF-8 bytes;
- reordered, missing and extra authorization fields; and
- witness/result/envelope binding mismatch.

- [ ] **Step 3: Run and observe v1/current-shape failures**

Run:

```bash
npm run build
node --test services/coordinator/test/signer-protocol.test.js
```

Expected: fail because production still encodes v1 without the witness.

- [ ] **Step 4: Implement v2 canonical encoding**

Use `Buffer.byteLength(body,"utf8")` for bounds. Validate URLs with `new URL`, require protocol `https:`, a hostname and no username/password. Validate byte lengths, not JavaScript character counts.

Implement `signerAuthorizationHash` as Keccak-256 over the exact fixed-order JSON bytes of:

```js
{witness:{transactionId,evidenceUri,decodedAction,policy},result:{...}}
```

- [ ] **Step 5: Run protocol tests**

Run:

```bash
npm run build
node --test services/coordinator/test/signer-protocol.test.js
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add services/coordinator/src/signer-protocol.ts services/coordinator/test/signer-protocol.test.js
git commit -m "feat: bind signer protocol v2 authorization"
```

---

### Task 4: Durable Authorization Replay Binding

**Files:**
- Modify: `services/coordinator/src/signer-replay-store.ts`
- Modify: `services/coordinator/test/signer-replay-store.test.js`

**Interfaces:**
- Changes: `SignerReplayStore.reserve(coordinatorId, requestId, guid, executionDigest, authorizationDigest, requestExpiresAt, now)`
- Persists: `authorization_digest`
- Refuses: nonempty v1 replay databases

- [ ] **Step 1: Add failing v2 replay tests**

Reserve:

```js
await store.reserve(
  coordinator,
  requestId,
  guid,
  executionDigest,
  authorizationDigest,
  130,
  100
);
```

Assert a new request ID with the same two digests is `RESERVED`; changed authorization or execution digest is `CONFLICT`; duplicate request ID is `DUPLICATE`; behavior survives reopen.

Create a legacy database with the old two tables. Assert an empty database migrates and a nonempty one throws `legacy signer replay state requires operator migration`.

- [ ] **Step 2: Run and observe the old reserve signature**

Run:

```bash
npm run build
node --test services/coordinator/test/signer-replay-store.test.js
```

Expected: fail because the store does not accept or persist authorization digests.

- [ ] **Step 3: Implement schema detection and v2 binding**

For a new database, create:

```sql
CREATE TABLE signer_guid_bindings(
  coordinator_id TEXT NOT NULL,
  guid TEXT NOT NULL,
  digest TEXT NOT NULL,
  authorization_digest TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(coordinator_id,guid)
)
```

When `authorization_digest` is absent:

1. count both legacy tables;
2. refuse if either count is nonzero;
3. add the column inside `BEGIN IMMEDIATE`;
4. commit or roll back atomically.

Validate both digests as lowercase 32-byte hex.

- [ ] **Step 4: Run replay tests**

Run:

```bash
npm run build
node --test services/coordinator/test/signer-replay-store.test.js
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add services/coordinator/src/signer-replay-store.ts services/coordinator/test/signer-replay-store.test.js
git commit -m "feat: bind signer replay state to authorization"
```

---

### Task 5: Handler and Remote Client v2 Propagation

**Files:**
- Modify: `services/coordinator/src/signer-protocol-handler.ts`
- Modify: `services/coordinator/test/signer-protocol-handler.test.js`
- Modify: `services/coordinator/src/remote-signer.ts`
- Modify: `services/coordinator/test/remote-signer.test.js`

**Interfaces:**
- Consumes: `signerAuthorizationHash`
- Changes: remote `sign(envelope, authorization)`
- Preserves: authenticated SPKI checks and response signature recovery

- [ ] **Step 1: Add failing handler propagation tests**

Capture `reserve` arguments and signer arguments. Assert:

```js
reserveArgs.authorizationDigest===
  signerAuthorizationHash(request.authorization)
signArgs.authorization===request.authorization
```

Assert finality refusal returns generic `SIGNING_REFUSED` without leaking an upstream token.

- [ ] **Step 2: Add failing remote v2 tests**

Require the transport body to contain `sentinel-signer/v2`, transaction ID, evidence URI, action and policy. Mutate the response version to v1 and assert refusal.

- [ ] **Step 3: Run focused tests**

Run:

```bash
npm run build
node --test services/coordinator/test/signer-protocol-handler.test.js services/coordinator/test/remote-signer.test.js
```

Expected: fail on old reserve/sign signatures and v1 bodies.

- [ ] **Step 4: Update handler and remote client**

The handler computes authorization digest only after strict decoding, reserves before signer contact, then calls:

```ts
this.signer.sign(request.envelope,request.authorization)
```

The remote client accepts the authorization from the coordinator and includes it unchanged in the canonical v2 request.

- [ ] **Step 5: Run focused tests**

Run the same command. Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add services/coordinator/src/signer-protocol-handler.ts services/coordinator/test/signer-protocol-handler.test.js services/coordinator/src/remote-signer.ts services/coordinator/test/remote-signer.test.js
git commit -m "feat: propagate signer finality authorization"
```

---

### Task 6: Durable Coordinator Authorization Construction

**Files:**
- Modify: `services/coordinator/src/coordinator.ts`
- Modify: `services/coordinator/test/coordinator.test.js`
- Modify: `services/coordinator/src/delivery-planner.ts` only if the typed interface requires it

**Interfaces:**
- Produces: one `SigningAuthorization` from `requestIds`, `requests` and finalized job result
- Refuses: signing when any durable policy component is missing

- [ ] **Step 1: Add failing exact-context test**

Create a finalized job with durable request ID and request. Capture the authorization passed to every signer and assert:

```js
authorization.witness.transactionId===requestId
authorization.witness.evidenceUri===request.evidence.uri
authorization.witness.decodedAction===request.decodedAction
authorization.witness.policy===request.policy
authorization.result===job.snapshot.result
```

- [ ] **Step 2: Add missing-context failures**

For separate fixtures, remove `requestIds`, `requests` or `snapshot.result`. Assert `collectAuthorization` rejects before any signer call with `durable signer authorization is unavailable`.

- [ ] **Step 3: Run coordinator tests and observe old behavior**

Run:

```bash
npm run build
node --test services/coordinator/test/coordinator.test.js
```

Expected: fail because the coordinator currently forwards only the result.

- [ ] **Step 4: Construct and forward the authorization**

Validate the transaction ID is lowercase 32-byte hex. Construct the witness from durable maps and call:

```ts
collectQuorum(
  envelope,
  {witness,result:job.snapshot.result},
  this.signers,
  authorized,
  this.quorum
)
```

- [ ] **Step 5: Run coordinator and planner tests**

Run:

```bash
npm run build
node --test services/coordinator/test/coordinator.test.js services/coordinator/test/delivery-planner.test.js
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add services/coordinator/src/coordinator.ts services/coordinator/test/coordinator.test.js services/coordinator/src/delivery-planner.ts
git commit -m "feat: construct durable signer authorization"
```

---

### Task 7: Migrate Local Fixtures and Adversarial E2E

**Files:**
- Modify: `services/coordinator/src/local-demo-harness.ts`
- Modify: all tests returned by:

```bash
rg -l '\.sign\(.*result|collectQuorum\(|assertFinalized:' services/coordinator/test
```

**Interfaces:**
- Preserves: local fixture behavior and exact adapter execution digest
- Proves: authorization mismatch removes a signer from quorum

- [ ] **Step 1: Run the complete Node suite to enumerate compile/runtime failures**

Run:

```bash
npm test
```

Expected: fail only at signer call sites that still use v1 signatures.

- [ ] **Step 2: Migrate each fixture without weakening assertions**

Every fixture authorization must include the same canonical witness helper:

```js
const authorization={
  witness:{
    transactionId:requestId,
    evidenceUri:request.evidence.uri,
    decodedAction:request.decodedAction,
    policy:request.policy,
  },
  result,
};
```

Local attestors must verify the supplied transaction ID through the existing fixture finality object rather than accepting `result.decision` alone.

- [ ] **Step 3: Add adversarial E2E cases**

In the ULN302/local-wallet E2E layer:

- make three fixture attestors agree and two refuse; assert 3-of-5 succeeds;
- make only two agree; assert no adapter submission;
- alter one transaction ID or policy; assert that signer does not count;
- retry a changed authorization after replay-store reopen; assert `CONFLICT`;
- preserve DENY with zero signer/key/destination calls.

- [ ] **Step 4: Run all Node tests**

Run:

```bash
npm test
```

Expected: all Node tests pass with zero skips.

- [ ] **Step 5: Run GenLayer checks**

Run:

```bash
npm run lint:ic
npm run test:ic:direct
```

Expected: linter passes and all 24 direct tests pass.

- [ ] **Step 6: Commit**

```bash
git add services/coordinator/src/local-demo-harness.ts services/coordinator/test
git commit -m "test: prove independent signer finality context"
```

---

### Task 8: Documentation, Release and Full Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/SIGNER_ARCHITECTURE.md`
- Modify: `docs/MILESTONES.md`
- Modify: `docs/UNKNOWNS.md`
- Modify: `docs/THREAT_MODEL.md`
- Modify: `docs/SECURITY_STATUS.md`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: release `0.27.0`
- Preserves: no deployed/live/audited/mainnet-ready claim

- [ ] **Step 1: Update operationally honest documentation**

Document:

- v1 is rejected and no deployed migration exists;
- v2 carries a minimal GenLayer authorization witness;
- each signer-side attestor verifies status, transaction call and finalized record;
- the transaction-witness reader is still an injected interface;
- no mTLS daemon, official live SDK adapter, five operators or HSM exists;
- fixture readers do not prove provider independence; and
- Sentinel remains optional/additional.

- [ ] **Step 2: Set version `0.27.0`**

Run:

```bash
npm version 0.27.0 --no-git-tag-version
```

Confirm only root version metadata changes in the lockfile.

- [ ] **Step 3: Run fresh full verification**

Run:

```bash
npm run check
```

Expected: TypeScript, GenVM linter, 24 direct tests, build, five Solidity sources, dashboard and the complete Node suite pass with zero failures/skips/todos.

- [ ] **Step 4: Run hygiene and secret checks**

Run:

```bash
git diff --check
git status --short
rg -n --hidden -g '!node_modules/**' -g '!.venv/**' -g '!.cache/**' -g '!.git/**' \
  '(BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|PRIVATE_KEY=|SECRET_KEY=|API_KEY=|MNEMONIC=|seed phrase)' .
git ls-files .venv .cache '*.pem' '*.key'
```

Expected: only benign documentation mentions; no secret/key/cache file tracked.

- [ ] **Step 5: Commit release**

```bash
git add README.md docs package.json package-lock.json
git commit -m "chore: release independent signer finality milestone"
```

- [ ] **Step 6: Re-run verification against committed HEAD**

Run:

```bash
npm run check
git status --short
git log -1 --oneline
```

Expected: full suite passes, worktree is clean and HEAD is the `0.27.0` release commit.

- [ ] **Step 7: Stop before external action**

Report exact commits, Node/Python counts, protocol version, what the attestor proves, the injected transaction-reader limitation, and that no deployment, funds, cloud, push, publication or secrets occurred.
