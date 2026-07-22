# Durable Ingestion Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent poison packets from blocking the pathway while preserving durable, idempotent, operator-controlled recovery.

**Architecture:** A focused SQLite recovery ledger records failures before the listener is acknowledged. A local recovery service requeues the retained packet before resolving its dead-letter record, while the HTTP dashboard remains read-only.

**Tech Stack:** TypeScript, Node.js `node:sqlite`, Node test runner, browser DOM JavaScript.

## Global Constraints

- Keep the product labeled `TESTNET_PROTOTYPE`; do not claim mainnet readiness.
- Do not deploy, spend funds, create cloud resources, or publish.
- Never persist raw exception messages or return full quarantined packet payloads through HTTP.
- `runtime.maxIngestionAttempts` must be an explicit positive integer; the example value is a test value.
- Requeue must remain a local programmatic operator action, not an HTTP mutation.

---

### Task 1: Durable Recovery Ledger

**Files:**
- Create: `services/coordinator/src/recovery-store.ts`
- Create: `services/coordinator/test/recovery-store.test.js`

**Interfaces:**
- Produces: `SqliteRecoveryStore`, `RecoveryStore`, `DeadLetter`, and `FailureDisposition`.

- [ ] Write tests proving attempt increments, threshold quarantine, restart durability, idempotent dead recording, sanitized list output, and resolution.
- [ ] Run `npm run build && node --test services/coordinator/test/recovery-store.test.js`; expect failure because the module is absent.
- [ ] Implement a SQLite table keyed by pathway and normalized transaction hash, with bigint-safe packet JSON and transactional upsert.
- [ ] Run the focused test; expect all recovery-store tests to pass.
- [ ] Commit `feat: add durable ingestion quarantine`.

### Task 2: Failure-Aware Ingestion and Requeue

**Files:**
- Modify: `services/coordinator/src/ingestion.ts`
- Modify: `services/coordinator/src/listener.ts`
- Create: `services/coordinator/src/recovery-service.ts`
- Modify: `services/coordinator/test/ingestion.test.js`
- Modify: `services/coordinator/test/listener.test.js`
- Create: `services/coordinator/test/recovery-service.test.js`

**Interfaces:**
- Consumes: `RecoveryStore.recordFailure`, `findDead`, and `resolve`.
- Produces: `PacketInbox.requeue`, `RecoveryService.requeue`, and `recoveryFailurePolicy`.

- [ ] Write failing tests showing retries stay pending, threshold failures are acknowledged only after quarantine, listener requeue is idempotent, and recovery restores before resolve.
- [ ] Run the three focused test files; expect interface/behavior failures.
- [ ] Implement the minimal failure policy, idempotent listener requeue, and ordered recovery service.
- [ ] Run the focused tests; expect them all to pass.
- [ ] Commit `feat: add safe packet requeue workflow`.

### Task 3: Runtime Configuration and Composition

**Files:**
- Modify: `services/coordinator/src/runtime-config.ts`
- Modify: `services/coordinator/src/compose-runtime.ts`
- Modify: `services/coordinator/test/runtime-config.test.js`
- Modify: `services/coordinator/test/compose-runtime.test.js`
- Modify: checked-in runtime manifest/example located by repository search.

**Interfaces:**
- Produces: required `runtime.maxIngestionAttempts` and `ComposedRuntime.recovery`.

- [ ] Write failing config and composition tests for the positive attempt limit, exposed recovery service, and store shutdown.
- [ ] Run focused tests; expect failures on the missing field/service.
- [ ] Wire the recovery store, failure policy, recovery service, dashboard reader, and close lifecycle into composition.
- [ ] Run focused tests; expect pass.
- [ ] Commit `feat: compose durable ingestion recovery`.

### Task 4: Honest Read-Only Dashboard and Operations Docs

**Files:**
- Modify: `services/coordinator/src/status-api.ts`
- Modify: `services/coordinator/test/status-api.test.js`
- Modify: `apps/dashboard/index.html`
- Modify: `apps/dashboard/src/app.js`
- Modify: `apps/dashboard/src/style.css`
- Modify: `README.md`
- Modify: relevant operations/threat-model documentation located by repository search.

**Interfaces:**
- Consumes: sanitized `DeadLetterReader.listDead()`.
- Produces: read-only `GET /api/dead-letters` and quarantine dashboard rendering.

- [ ] Write failing API tests proving sanitized metadata is returned and mutation methods remain rejected.
- [ ] Implement the optional reader and endpoint without returning packet payloads.
- [ ] Add dashboard rendering with safe DOM APIs and an explicit local-operator recovery notice.
- [ ] Update limitations, monitoring, recovery ordering, and test-value documentation.
- [ ] Run `npm run check:dashboard` and focused API tests; expect pass.
- [ ] Commit `docs: expose ingestion quarantine status`.

### Task 5: Milestone Verification

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: version `0.17.0` and verified milestone.

- [ ] Set both package versions to `0.17.0`.
- [ ] Run `npm run typecheck`; expect exit 0.
- [ ] Run `npm test`; expect every test to pass.
- [ ] Run `git diff --check`; expect no output.
- [ ] Review `git status --short` and ensure only milestone files changed.
- [ ] Commit `chore: release recovery milestone`.

