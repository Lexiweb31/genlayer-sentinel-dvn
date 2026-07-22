# Runnable Coordinator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Assemble the validated Sentinel components into a supervised, restart-safe runtime without adding deployment, signer custody or live-network claims.

**Architecture:** First make GenLayer request bindings durable and restore them into the strict finality adapter. Then add a small lifecycle supervisor whose dependencies are injected, followed by one composition root that constructs existing components from `RuntimeConfig`. The runtime remains programmatically started with an injected GenLayer client facade because approved account custody is intentionally outside this repository.

**Tech Stack:** Node.js 22.13+, TypeScript 5.8, Node `sqlite`, Node HTTP, ethers 6.17, GenLayerJS 1.1.8, Node test runner.

## Global Constraints

- No deployment, funding, cloud resource, GitHub publication or external message.
- No raw signer or GenLayer account key in source, frontend, example manifest or test fixture.
- Sentinel remains an additional/optional DVN and cannot advance to signer quorum in this runtime milestone.
- All behavior changes use red-green-refactor TDD and preserve the existing security suite.
- Startup and shutdown must be fail-closed and idempotent.

---

### Task 1: Durable GenLayer request bindings

**Files:**
- Modify: `services/coordinator/src/job-store.ts`
- Modify: `services/coordinator/src/coordinator.ts`
- Modify: `services/coordinator/src/genlayer-finality.ts`
- Modify: `services/coordinator/test/job-store.test.js`
- Modify: `services/coordinator/test/genlayer-finality.test.js`

**Interfaces:**
- `StoredJob` gains `request?: PolicyRequest`.
- `GenLayerFinality` gains optional `register(requestId: string, request: PolicyRequest): void`.
- `SqliteJobStore` persists `request_json` with a backward-compatible schema migration.

- [ ] **Step 1: Write failing restart tests** proving the full request is restored and `register` is called with the original request ID/binding.
- [ ] **Step 2: Run `npm run build && node --test services/coordinator/test/job-store.test.js services/coordinator/test/genlayer-finality.test.js`** and confirm failure because `StoredJob.request` and `register` restoration do not exist.
- [ ] **Step 3: Add `request_json`, codec reuse and `GenLayerSdkFinality.register`**; persist requests before/after submission and re-register them during `Coordinator.restore()`.
- [ ] **Step 4: Re-run the focused tests** and confirm they pass, including old-database rows whose request is null.
- [ ] **Step 5: Commit** with `feat: persist GenLayer request bindings`.

### Task 2: Serialized runtime supervisor

**Files:**
- Create: `services/coordinator/src/runtime.ts`
- Create: `services/coordinator/test/runtime.test.js`

**Interfaces:**
- `RuntimeDependencies { restore(): Promise<void>; ingest(): Promise<void>; pollFinality(): Promise<void>; listen(): Promise<void>; closeServer(): Promise<void>; closeStores(): void; report(error: unknown): void; intervalMs: number; }`
- `SentinelRuntime.start(): Promise<void>` and `SentinelRuntime.stop(): Promise<void>`.
- `SentinelRuntime.status` returns `{started:boolean;stopping:boolean;tickActive:boolean}`.

- [ ] **Step 1: Write failing lifecycle tests** for restore-before-listen/tick, serialized ticks, error reporting without loop death, idempotent stop, and stop waiting for an in-flight tick.
- [ ] **Step 2: Run `npm run build && node --test services/coordinator/test/runtime.test.js`** and confirm module-not-found failure for the absent supervisor.
- [ ] **Step 3: Implement the minimal supervisor** using an injected interval scheduler or a timer loop with one retained in-flight promise; never overlap ticks.
- [ ] **Step 4: Run the focused runtime tests** and confirm all lifecycle cases pass.
- [ ] **Step 5: Commit** with `feat: add coordinator runtime supervisor`.

### Task 3: Composition root and finality polling

**Files:**
- Create: `services/coordinator/src/compose-runtime.ts`
- Create: `services/coordinator/test/compose-runtime.test.js`
- Modify: `services/coordinator/src/coordinator.ts`
- Modify: `services/coordinator/src/status-api.ts`

**Interfaces:**
- `Coordinator.pollPending(now?: number): Promise<number>` polls every durable `POLICY_PENDING` job using its restored request ID.
- `composeRuntime(config: RuntimeConfig, client: GenLayerClientFacade, dashboardRoot: string, report?: (error:unknown)=>void): {runtime: SentinelRuntime; coordinator: Coordinator}`.
- Composition constructs `SqliteJobStore`, `SqliteListenerStore`, `IndependentRpcPacketVerifier`, `GenLayerSdkFinality`, `PacketFeeListener`, `PolicyRequestFactory`, `IngestionRunner` and `createDashboardServer` from explicit manifest values.

- [ ] **Step 1: Write failing composition tests** asserting config values reach component boundaries, pending jobs are polled, no signers are created, dashboard listen uses manifest host/port, and partial startup failure closes stores.
- [ ] **Step 2: Run `npm run build && node --test services/coordinator/test/compose-runtime.test.js`** and confirm failure because the composition module and `pollPending` are absent.
- [ ] **Step 3: Implement `pollPending` and the composition root** with injectable boundary factories where real sockets or network clients would otherwise be required by tests.
- [ ] **Step 4: Run composition tests and the complete `npm run check` suite**; expect all tests to pass with no testnet calls.
- [ ] **Step 5: Commit** with `feat: compose runnable Sentinel coordinator`.

### Task 4: Honest operations handoff

**Files:**
- Modify: `README.md`
- Modify: `docs/OPERATIONS.md`
- Modify: `docs/MILESTONES.md`
- Modify: `docs/SECURITY_STATUS.md`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:** Documentation must distinguish programmatic runtime assembly from a deployable daemon and state why GenLayer account-provider construction remains blocked.

- [ ] **Step 1: Update status, startup/shutdown order, runtime limitations, test count and version** without adding a live URL or deployment claim.
- [ ] **Step 2: Run `npm run check`, `git diff --check`, and `git status --short --branch`**; expect a green suite and only intended files.
- [ ] **Step 3: Commit** with `docs: document runnable coordinator boundary`.
