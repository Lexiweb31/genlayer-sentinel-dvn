# Crash-Safe Destination Verification Outbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist and independently confirm destination adapter delivery after signer quorum without unsafe automatic rebroadcast after an ambiguous crash.

**Architecture:** A dedicated SQLite outbox owns immutable delivery payloads and monotonic delivery state. A worker persists intent before adapter submission, independently verifies receipts and adapter state, and advances the existing coordinator only after confirmed atomic destination execution.

**Tech Stack:** TypeScript, ethers 6.17.0, Node.js `node:sqlite`, Node test runner, browser DOM JavaScript.

## Global Constraints

- No funded account, private key, deployment, cloud resource, or live submission is created.
- Ambiguous attempts never automatically rebroadcast.
- Two independent destination RPC origins and explicit positive confirmation depth are required by the concrete verifier.
- HTTP output never includes signatures, call data, RPC paths, account details, or raw errors.
- The composed runtime continues to disable destination submission until an approved account provider exists.

---

### Task 1: Durable Outbox Store

**Files:**
- Create: `services/coordinator/src/verification-outbox.ts`
- Create: `services/coordinator/test/verification-outbox.test.js`

**Interfaces:**
- Produces: `VerificationOutboxStore`, `SqliteVerificationOutbox`, `OutboxRecord`, `OutboxState`, `prepare`, `transition`, `get`, and `list`.

- [ ] Write failing tests for bigint-safe preparation, restart persistence, equivalent idempotency, conflicting binding rejection, unique/sorted shares, and legal/illegal monotonic transitions.
- [ ] Run the focused test after build and observe the missing-module failure.
- [ ] Implement strict validation, exact JSON encoding, execution-digest recomputation, WAL/full-synchronous SQLite storage, and transactional compare-and-transition updates.
- [ ] Run the focused test and expect every case to pass.
- [ ] Commit `feat: add durable verification outbox`.

### Task 2: Independent Destination Receipt Verifier

**Files:**
- Create: `services/coordinator/src/destination-verifier.ts`
- Create: `services/coordinator/test/destination-verifier.test.js`

**Interfaces:**
- Produces: `DestinationConfirmationVerifier.confirm(record): Promise<{status:"PENDING"}|{status:"CONFIRMED";confirmations:bigint}|{status:"FAILED";code:string}>` and `IndependentDestinationVerifier`.

- [ ] Write failing tests for two-provider successful agreement, pending receipts, failed status, block/event disagreement, wrong adapter/event bindings, insufficient confirmations, duplicate/unsafe origins, and required adapter-used state.
- [ ] Implement strict JSON-RPC receipt/block calls through an injected transport, official adapter `Verified` event decoding, URL redaction, agreement checks, and allowlisted failure codes.
- [ ] Run the focused test and expect pass.
- [ ] Commit `feat: verify destination receipts independently`.

### Task 3: Crash-Safe Delivery Worker

**Files:**
- Create: `services/coordinator/src/destination-worker.ts`
- Create: `services/coordinator/test/destination-worker.test.js`
- Modify: `services/coordinator/src/coordinator.ts`
- Modify: `services/coordinator/test/coordinator.test.js`

**Interfaces:**
- Consumes: outbox store, destination verifier, injected adapter submission client, coordinator lifecycle.
- Produces: `DestinationWorker.pollOnce()` and idempotent `Coordinator.confirmExecution(guid)`.

- [ ] Write failing tests for READY intent-before-submit, tx-hash persistence, pending receipt, confirmed advancement, failed receipt, ATTEMPTING restart recovery, used-but-unproven pending state, and no rebroadcast from ambiguous state.
- [ ] Implement the minimal worker with monotonic transitions and generic failure codes; persist `ATTEMPTING` before invoking submission.
- [ ] Add coordinator tests proving `QUORUM_REACHED → EXECUTED` and restart from `VERIFIED → EXECUTED` with one final persisted snapshot.
- [ ] Run focused worker/coordinator tests and expect pass.
- [ ] Commit `feat: add crash-safe destination delivery worker`.

### Task 4: Read-Only Operational Visibility

**Files:**
- Modify: `services/coordinator/src/status-api.ts`
- Modify: `services/coordinator/test/status-api.test.js`
- Modify: `apps/dashboard/index.html`
- Modify: `apps/dashboard/src/app.js`
- Create: `apps/dashboard/src/delivery.css`
- Modify: `scripts/check-dashboard.mjs`

**Interfaces:**
- Produces: sanitized `GET /api/deliveries` and dashboard delivery incident rendering.

- [ ] Write a failing API test with a malicious record containing signatures/call data and assert the response exposes only sanitized metadata while POST remains rejected.
- [ ] Add an optional delivery reader to status/dashboard handlers and explicit field projection.
- [ ] Render delivery state with safe DOM APIs and flag `RECOVERY_REQUIRED` without adding a mutation request.
- [ ] Run focused API and dashboard checks and expect pass.
- [ ] Commit `feat: expose destination delivery status`.

### Task 5: Documentation and Release Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/OPERATIONS.md`
- Modify: `docs/THREAT_MODEL.md`
- Modify: `docs/SECURITY_STATUS.md`
- Modify: `docs/MILESTONES.md`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: version `0.19.0` and verified operational documentation.

- [ ] Document intent-before-broadcast ordering, ambiguous recovery, independent receipt requirements, atomic adapter execution, monitoring, and intentionally disabled live composition.
- [ ] Set package versions to `0.19.0`; update the test count only from observed full-suite output.
- [ ] Run `npm run check` and require all type, contract, Intelligent Contract, dashboard, and test checks to pass.
- [ ] Run `git diff --check`, inspect milestone-only status, and commit `feat: release destination outbox milestone`.

