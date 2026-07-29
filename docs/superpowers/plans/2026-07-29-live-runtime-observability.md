# Live Runtime Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add truthful, read-only live coordinator lifecycle and lease observation to the status API and dashboard without creating recovery authority, database inference, or a mutation surface.

**Architecture:** A focused `RuntimeObservation` tracker owns one validated in-memory snapshot. The production `SentinelRuntime` and local demo harness update the tracker at explicit lifecycle and work-phase boundaries; the status API receives only the read interface and returns an exact allowlisted model. The dashboard polls this route only after the existing operations bootstrap gate and renders unavailable state without simulation.

**Tech Stack:** TypeScript 5, Node.js 22, Node test runner, browser-native JavaScript/DOM, existing same-origin HTTP status server, existing local Hardhat EDR integration harness.

## Global Constraints

- Observe only the process serving the endpoint; do not read lease state through a second SQLite connection.
- Do not add takeover, restart, stop, recovery, requeue, resend, replacement, wallet, RPC, signer, or destination controls.
- Do not expose raw errors, stack traces, database paths, runtime-owner identifiers, recovery action identifiers, process IDs, environment data, RPC URLs, keys, credentials, or signer details.
- A heartbeat failure or stale-looking timestamp must never authorize recovery.
- Local fixture mode must report `NOT_APPLICABLE_LOCAL_FIXTURE`, never `CLAIMED`.
- The status route is GET-only, same-origin, no-store, and side-effect free.
- A restored-unavailable wallet action must continue to perform only `GET /api/demo/config`; it must not start operations or runtime-status polling.
- Preserve the current restore → listen → claim → schedule startup order and close server → release lease → close stores shutdown order.
- Preserve non-overlapping ticks, fail-closed phase ordering, idempotent stop, durable recovery fencing, and no-rebroadcast behavior.
- No deployment, funding, cloud resource, public publishing, or GitHub push is part of this plan.

---

### Task 1: Runtime Observation Model and Validator

**Files:**
- Create: `services/coordinator/src/runtime-observation.ts`
- Create: `services/coordinator/test/runtime-observation.test.js`

**Interfaces:**
- Produces:
  - `RuntimeObservationMode = "LEASED" | "LOCAL_FIXTURE"`
  - `RuntimeLifecycle = "STARTING" | "RUNNING" | "STOPPING" | "OWNERSHIP_LOST"`
  - `RuntimeLeaseRelationship = "NOT_CLAIMED" | "CLAIMED" | "LOST" | "NOT_APPLICABLE_LOCAL_FIXTURE"`
  - `RuntimePhase = "IDLE" | "HEARTBEAT_BEFORE" | "INGESTION" | "POLICY_FINALITY" | "DELIVERY_PLANNING" | "DESTINATION_DELIVERY" | "HEARTBEAT_AFTER"`
  - `RuntimeOutcome = "NEVER" | "SUCCEEDED" | "DEGRADED"`
  - `RuntimeFailureCode = "LEASE_HEARTBEAT_FAILED" | "INGESTION_FAILED" | "POLICY_FINALITY_FAILED" | "DELIVERY_PLANNING_FAILED" | "DESTINATION_DELIVERY_FAILED"`
  - `LiveRuntimeStatus`
  - `RuntimeStatusReader { runtimeStatus(): LiveRuntimeStatus }`
  - `RuntimeObservation`
  - `publicRuntimeStatus(value: unknown): LiveRuntimeStatus`
- Consumes: an injected `now(): number` returning Unix seconds.

- [ ] **Step 1: Write failing constructor and lifecycle tests**

Add tests that create deterministic leased and fixture observations:

```js
test("starts leased and local observations without inventing ownership",()=>{
  const leased=new RuntimeObservation("LEASED",()=>100);
  assert.deepEqual(leased.runtimeStatus(),{
    version:1,observedAt:100,lifecycle:"STARTING",lease:"NOT_CLAIMED",
    recoveryPosture:"REQUIRES_OFFLINE_VERIFICATION",
    tick:{active:false,phase:"IDLE",lastOutcome:"NEVER"}
  });
  const fixture=new RuntimeObservation("LOCAL_FIXTURE",()=>100);
  assert.equal(fixture.runtimeStatus().lease,"NOT_APPLICABLE_LOCAL_FIXTURE");
  fixture.markRunning();
  assert.equal(fixture.runtimeStatus().lease,"NOT_APPLICABLE_LOCAL_FIXTURE");
});
```

Also assert:

- leased `markRunning()` yields `RUNNING`, `CLAIMED`, and `BLOCKED_BY_ACTIVE_RUNTIME`;
- fixture `markRunning()` yields `RUNNING`, `NOT_APPLICABLE_LOCAL_FIXTURE`, and `REQUIRES_OFFLINE_VERIFICATION`;
- `markStarting()` restores the mode-specific non-running lease relationship;
- `markStopping()` never reports recovery permission;
- `markOwnershipLost()` is accepted only in leased mode and yields `OWNERSHIP_LOST`, `LOST`, and `REQUIRES_OFFLINE_VERIFICATION`;
- a regressing, negative, fractional, or unsafe clock throws a stable public-model validation error.

- [ ] **Step 2: Run the new test file and confirm RED**

Run:

```bash
npm run build && node --test services/coordinator/test/runtime-observation.test.js
```

Expected: build fails because `runtime-observation.ts` does not exist.

- [ ] **Step 3: Implement the exact model and lifecycle transitions**

Create `RuntimeObservation` with:

```ts
constructor(mode:RuntimeObservationMode,now:()=>number=unixNow)
runtimeStatus():LiveRuntimeStatus
markStarting():void
markRunning():void
markStopping():void
markOwnershipLost():void
beginTick(initialPhase:Exclude<RuntimePhase,"IDLE">):void
enterPhase(phase:Exclude<RuntimePhase,"IDLE">):void
recordHeartbeat():void
finishTick(failureCode?:RuntimeFailureCode,leaseLost?:boolean):void
```

Keep the mutable snapshot private. `runtimeStatus()` must return a new deep snapshot with `observedAt` from the validated monotonic clock. Do not return references to the internal tick object.

`beginTick` rejects overlap, sets `active: true`, records `lastStartedAt`, and preserves the previous completed outcome until the current tick finishes. `enterPhase` requires an active tick. `recordHeartbeat` is valid only in leased mode and records `lastLeaseHeartbeatAt`. `finishTick` records `lastCompletedAt`, returns to `IDLE`, sets `SUCCEEDED` and clears `failureCode` when no failure is supplied, or sets `DEGRADED` and the supplied closed code. `leaseLost: true` must also apply the ownership-lost transition.

- [ ] **Step 4: Add failing tick and validator tests**

Cover:

```js
test("records one successful tick without leaking mutable state",()=>{
  let now=101;
  const value=new RuntimeObservation("LEASED",()=>now++);
  value.markRunning();
  value.beginTick("HEARTBEAT_BEFORE");
  value.recordHeartbeat();
  value.enterPhase("INGESTION");
  value.enterPhase("POLICY_FINALITY");
  value.enterPhase("DELIVERY_PLANNING");
  value.enterPhase("DESTINATION_DELIVERY");
  value.enterPhase("HEARTBEAT_AFTER");
  value.recordHeartbeat();
  value.finishTick();
  const status=value.runtimeStatus();
  assert.equal(status.tick.lastOutcome,"SUCCEEDED");
  assert.equal(status.tick.phase,"IDLE");
  assert.equal(status.tick.active,false);
  status.tick.phase="INGESTION";
  assert.equal(value.runtimeStatus().tick.phase,"IDLE");
});
```

Add cases for:

- overlapping `beginTick`;
- phase changes without an active tick;
- all five failure codes;
- post-work lease loss retaining an earlier work failure code;
- successful later tick clearing an earlier failure code;
- exact-key public validation;
- every enum and timestamp rejection;
- contradictory combinations such as `CLAIMED` plus `REQUIRES_OFFLINE_VERIFICATION`, fixture lease plus `OWNERSHIP_LOST`, `active: false` plus a non-idle phase, or `DEGRADED` without `failureCode`;
- unexpected owner, error, path, or arbitrary extra keys.

- [ ] **Step 5: Implement `publicRuntimeStatus` and make tests GREEN**

Use record checks and exact-key comparison for the root and tick objects. Return a newly constructed object containing only the declared public keys. Optional timestamps and `failureCode` are omitted rather than serialized as `undefined`.

Run:

```bash
npm run build && node --test services/coordinator/test/runtime-observation.test.js
```

Expected: all runtime-observation tests pass.

- [ ] **Step 6: Commit the model**

```bash
git add services/coordinator/src/runtime-observation.ts services/coordinator/test/runtime-observation.test.js
git commit -m "feat: add live runtime observation model"
```

---

### Task 2: Production Runtime Lifecycle and Phase Tracking

**Files:**
- Modify: `services/coordinator/src/runtime.ts`
- Modify: `services/coordinator/test/runtime.test.js`

**Interfaces:**
- Consumes: `RuntimeObservation` and all phase/failure types from Task 1.
- Produces: `SentinelRuntime` with an optional injected `RuntimeObservation`; `runtimeStatus()` delegates to that observation.

- [ ] **Step 1: Write failing startup and stop observation tests**

Extend the setup helper to create a deterministic leased observation and pass it to `SentinelRuntime`. Assert:

```js
assert.equal(value.runtime.runtimeStatus().lifecycle,"STARTING");
await value.runtime.start();
assert.deepEqual(
  [value.runtime.runtimeStatus().lifecycle,value.runtime.runtimeStatus().lease],
  ["RUNNING","CLAIMED"]
);
```

During a blocked active tick, call `stop()` and assert the reachable observation is `STOPPING` before releasing the gate. Preserve the exact existing close/release/store call order.

- [ ] **Step 2: Run focused runtime tests and confirm RED**

Run:

```bash
npm run build && node --test services/coordinator/test/runtime.test.js
```

Expected: assertions fail because `SentinelRuntime` does not update or expose the observation.

- [ ] **Step 3: Integrate lifecycle transitions minimally**

Change the constructor to:

```ts
constructor(
  private dependencies:RuntimeDependencies,
  private observation=new RuntimeObservation("LEASED")
)
```

Add:

```ts
runtimeStatus():LiveRuntimeStatus {
  return this.observation.runtimeStatus();
}
```

Call `markStarting()` before the startup sequence, `markRunning()` only after `claimLease()` succeeds, and `markStopping()` before cancelling the schedule.

Do not change the current listen, claim, close, release, or store ordering.

- [ ] **Step 4: Write failing successful and degraded tick tests**

Assert the exact phase before each gated dependency resolves. Add one case per failure source:

| Dependency | Expected code | Later work in same tick |
| --- | --- | --- |
| pre-heartbeat | `LEASE_HEARTBEAT_FAILED` | skipped |
| ingestion | `INGESTION_FAILED` | skipped |
| policy finality | `POLICY_FINALITY_FAILED` | skipped |
| delivery planning | `DELIVERY_PLANNING_FAILED` | skipped |
| destination delivery | `DESTINATION_DELIVERY_FAILED` | none |
| final heartbeat | `LEASE_HEARTBEAT_FAILED` unless an earlier code exists | none |

For pre- and post-heartbeat failure, assert `OWNERSHIP_LOST`, `LOST`, and `REQUIRES_OFFLINE_VERIFICATION`. For non-lease failure, assert `RUNNING`, `CLAIMED`, and a later scheduled tick can succeed and clear the failure.

- [ ] **Step 5: Implement explicit phase tracking**

Refactor only `runTick()`:

```ts
private runTick():Promise<void> {
  if(this.tick||!this.started||this.stopping)return this.tick??Promise.resolve();
  const work=this.executeObservedTick();
  this.tick=work.finally(()=>{this.tick=undefined});
  return this.tick;
}
```

In `executeObservedTick`, retain a local `failureCode` and `leaseLost` flag. Enter each phase immediately before its awaited dependency. Map only the current phase to the closed failure code. Continue to report the original internal error through `dependencies.report`.

Always attempt the final heartbeat. A failed first heartbeat skips business work. A failed final heartbeat marks lease loss. Call `finishTick` exactly once in `finally`.

- [ ] **Step 6: Run runtime and lease regression tests**

Run:

```bash
npm run build && node --test services/coordinator/test/runtime-observation.test.js services/coordinator/test/runtime.test.js services/coordinator/test/runtime-lease.test.js
```

Expected: all focused tests pass.

- [ ] **Step 7: Commit runtime integration**

```bash
git add services/coordinator/src/runtime.ts services/coordinator/test/runtime.test.js
git commit -m "feat: observe production runtime lifecycle"
```

---

### Task 3: Sanitized GET-Only Runtime Status API

**Files:**
- Modify: `services/coordinator/src/status-api.ts`
- Modify: `services/coordinator/test/status-api.test.js`

**Interfaces:**
- Consumes: `RuntimeStatusReader` and `publicRuntimeStatus` from Task 1.
- Produces: optional final `runtimeStatus?: RuntimeStatusReader` parameters on `statusResponse`, `createStatusServer`, `dashboardResponse`, and `createDashboardServer`.

- [ ] **Step 1: Write failing API response tests**

Add:

```js
const liveRuntime={
  runtimeStatus:()=>({
    version:1,observedAt:100,lifecycle:"RUNNING",lease:"CLAIMED",
    recoveryPosture:"BLOCKED_BY_ACTIVE_RUNTIME",
    tick:{active:false,phase:"IDLE",lastStartedAt:90,lastCompletedAt:95,lastOutcome:"SUCCEEDED"},
    lastLeaseHeartbeatAt:95
  })
};

test("exposes only the validated live runtime observation through GET",async()=>{
  const response=await statusResponse(
    coordinator(),"GET","/api/runtime-status",
    undefined,undefined,presentation,undefined,undefined,liveRuntime
  );
  assert.equal(response.status,200);
  assert.deepEqual(Object.keys(JSON.parse(response.body)),[
    "version","observedAt","lifecycle","lease","recoveryPosture","tick","lastLeaseHeartbeatAt"
  ]);
});
```

Add cases where:

- no reader returns `503` and exactly `{error:"runtime status unavailable"}`;
- a throwing reader returns the same sanitized `503`;
- invalid, contradictory, or extra-key output returns the same `503`;
- a reader with raw `owner`, `error`, `stack`, or `databasePath` is rejected rather than filtered silently;
- `POST /api/runtime-status` returns `405` without calling the reader.

- [ ] **Step 2: Run status tests and confirm RED**

Run:

```bash
npm run build && node --test services/coordinator/test/status-api.test.js
```

Expected: `/api/runtime-status` returns `404`.

- [ ] **Step 3: Implement the route and thread the reader through constructors**

Append the optional reader parameter consistently. Handle the route before jobs:

```ts
if(url.pathname==="/api/runtime-status"){
  if(!runtimeStatus)return{status:503,body:json({error:"runtime status unavailable"})};
  try{return{status:200,body:json(publicRuntimeStatus(runtimeStatus.runtimeStatus()))}}
  catch{return{status:503,body:json({error:"runtime status unavailable"})}}
}
```

Keep the existing top-level non-GET rejection before this branch so the reader is never invoked on mutation methods.

- [ ] **Step 4: Run API and asset tests**

Run:

```bash
npm run build && node --test services/coordinator/test/status-api.test.js
```

Expected: all status and dashboard-asset tests pass.

- [ ] **Step 5: Commit the API**

```bash
git add services/coordinator/src/status-api.ts services/coordinator/test/status-api.test.js
git commit -m "feat: expose sanitized runtime status"
```

---

### Task 4: Production and Local Harness Composition

**Files:**
- Modify: `services/coordinator/src/compose-runtime.ts`
- Modify: `services/coordinator/test/compose-runtime.test.js`
- Modify: `services/coordinator/src/local-demo-harness.ts`
- Modify: `services/coordinator/test/local-demo-harness.test.js`

**Interfaces:**
- Consumes: `RuntimeObservation`, `RuntimePhase`, and the status-server reader parameter.
- Produces:
  - one leased observation shared by production `SentinelRuntime` and its dashboard server;
  - one local-fixture observation shared by the local harness tick/restart/stop loop and its dashboard server.

- [ ] **Step 1: Write a failing production composition identity test**

Use the existing injected socket lifecycle to capture the server and start the composed runtime. Request `/api/runtime-status` from the actual server or capture the reader passed to the status-server factory if the test seam already supports it. Assert:

- before start: `STARTING` and `NOT_CLAIMED`;
- after `runtime.start()`: `RUNNING` and `CLAIMED`;
- the existing `restore`, `listen`, `claim`, schedule order is unchanged;
- stop still closes HTTP before releasing the lease and closing stores.

- [ ] **Step 2: Implement production tracker sharing**

In `composeRuntime`:

```ts
const observation=new RuntimeObservation("LEASED",now);
const runtimeDependencies:RuntimeDependencies={
  restore:async()=>{await coordinator.restore();await planner.reconcile()},
  ingest:async()=>{await ingestion.pollOnce()},
  pollFinality:async()=>{await coordinator.pollPending()},
  planDeliveries:async()=>{await planner.pollOnce()},
  deliver:async()=>{await destinationWorker.pollOnce()},
  listen:()=>socket.listen(server,config.status.port,config.status.host),
  claimLease:()=>lease.claimRuntime(leaseOwner,now(),false),
  heartbeatLease:()=>lease.heartbeatRuntime(leaseOwner,now()),
  releaseLease:()=>lease.releaseRuntime(leaseOwner,now()),
  closeServer:()=>socket.close(server),
  closeStores:()=>closeOwned(owned),
  report,
  intervalMs:config.runtime.pollIntervalMs
};
const server=createDashboardServer(
  coordinator,dashboardRoot,recovery,outbox,
  {presentationMode:capabilities.presentationMode},
  undefined,outbox,observation
);
const runtime=new SentinelRuntime(runtimeDependencies,observation);
```

Declare the `now` function before the observation. Do not add a second lease reader or database connection.

- [ ] **Step 3: Run the production composition test**

Run:

```bash
npm run build && node --test services/coordinator/test/compose-runtime.test.js
```

Expected: all composition and lease-ordering tests pass.

- [ ] **Step 4: Write failing local-harness observation tests**

Start the real isolated local harness and fetch `/api/runtime-status`. Assert:

```js
assert.equal(body.lifecycle,"RUNNING");
assert.equal(body.lease,"NOT_APPLICABLE_LOCAL_FIXTURE");
assert.equal(body.recoveryPosture,"REQUIRES_OFFLINE_VERIFICATION");
```

Then:

- call `tickOnce()` and verify a completed `SUCCEEDED` tick;
- call `restartCoordinator()` and verify the same reader survives the pipeline replacement and returns to `RUNNING`;
- verify local mode never reports `CLAIMED`, `LOST`, `OWNERSHIP_LOST`, or `BLOCKED_BY_ACTIVE_RUNTIME`;
- preserve idempotent cleanup.

Assert the final restart transition and exact mode invariants without adding a new production hook solely for an intermediate test state.

- [ ] **Step 5: Implement local observation around the existing supervisor**

Create one `RuntimeObservation("LOCAL_FIXTURE")` outside `createPipeline`, pass it to every replacement dashboard server, and call:

- `markRunning()` after the initial pipeline is ready;
- `beginTick("INGESTION")` before local mining/ingestion;
- `enterPhase("POLICY_FINALITY")`, `enterPhase("DELIVERY_PLANNING")`, and `enterPhase("DESTINATION_DELIVERY")` before each existing phase;
- `finishTick()` on success;
- `finishTick(mappedCode)` on failure, then rethrow the original error;
- `markStarting()` before restart drains the prior pipeline;
- `markRunning()` after replacement succeeds;
- `markStopping()` before timer cancellation and cleanup.

Map local mining or ingestion failure to `INGESTION_FAILED`. Do not call `recordHeartbeat()` in fixture mode.

- [ ] **Step 6: Run local composition and wallet E2E regression**

Run with loopback permission:

```bash
npm run build && node --test services/coordinator/test/local-demo-harness.test.js services/coordinator/test/local-demo-wallet-e2e.test.js
```

Expected: all local harness, restart, no-resend, and wallet-to-destination tests pass.

- [ ] **Step 7: Commit composition**

```bash
git add services/coordinator/src/compose-runtime.ts services/coordinator/test/compose-runtime.test.js services/coordinator/src/local-demo-harness.ts services/coordinator/test/local-demo-harness.test.js
git commit -m "feat: wire runtime observation into coordinators"
```

---

### Task 5: Read-Only Coordinator Process Dashboard

**Files:**
- Modify: `apps/dashboard/index.html`
- Create: `apps/dashboard/src/runtime-status.js`
- Create: `apps/dashboard/test/runtime-status.test.js`
- Modify: `apps/dashboard/src/app.js`
- Modify: `apps/dashboard/src/recovery.css`
- Modify: `apps/dashboard/test/demo-entry-integration.test.js`
- Modify: `scripts/check-dashboard.mjs`

**Interfaces:**
- Consumes: `GET /api/runtime-status` and the existing `sentinel:demo-bootstrap` event.
- Produces:
  - `validateRuntimeStatus(value)` and `renderRuntimeStatus(elements,value,formatTime)` in `runtime-status.js`;
  - one operations-gated `refreshRuntimeStatus()` call and five-second interval;
  - a read-only “Coordinator process” panel.

- [ ] **Step 1: Write failing pure validation and rendering tests**

Create fake elements and assert:

- exact running/claimed status renders `RUNNING`, `CLAIMED`, `IDLE`, last heartbeat, `SUCCEEDED`, and `BLOCKED BY ACTIVE RUNTIME`;
- degraded outcome and ownership loss use incident classes;
- local fixture renders `NOT APPLICABLE · LOCAL FIXTURE`;
- absent timestamps render `Not observed`;
- invalid keys, enums, contradictory combinations, and unsafe timestamps throw;
- no rendering contains “safe to recover,” “failover ready,” “high availability,” or a raw error.

Run:

```bash
node --test apps/dashboard/test/runtime-status.test.js
```

Expected: module-not-found failure.

- [ ] **Step 2: Implement the focused browser module**

`runtime-status.js` must not fetch or mutate anything. Export:

```js
export function validateRuntimeStatus(value){
  const root=record(value,"runtime status");
  exactOptionalKeys(
    root,
    ["version","observedAt","lifecycle","lease","recoveryPosture","tick"],
    ["lastLeaseHeartbeatAt"],
    "runtime status"
  );
  const tick=record(root.tick,"runtime tick");
  exactOptionalKeys(
    tick,
    ["active","phase","lastOutcome"],
    ["lastStartedAt","lastCompletedAt","failureCode"],
    "runtime tick"
  );
  return validateContradictions({
    version:literal(root.version,1,"runtime version"),
    observedAt:timestamp(root.observedAt,"runtime observation time"),
    lifecycle:oneOf(root.lifecycle,LIFECYCLES,"runtime lifecycle"),
    lease:oneOf(root.lease,LEASES,"runtime lease"),
    recoveryPosture:oneOf(root.recoveryPosture,RECOVERY_POSTURES,"runtime recovery posture"),
    tick:normalizeTick(tick),
    ...(root.lastLeaseHeartbeatAt===undefined?{}:{
      lastLeaseHeartbeatAt:timestamp(root.lastLeaseHeartbeatAt,"runtime heartbeat time")
    })
  });
}

export function renderRuntimeStatus(elements,value,formatTime){
  const status=validateRuntimeStatus(value);
  elements.badge.textContent=status.tick.lastOutcome==="DEGRADED"?"DEGRADED":status.lifecycle;
  elements.lifecycle.textContent=status.lifecycle.replaceAll("_"," ");
  elements.lease.textContent=status.lease.replaceAll("_"," ");
  elements.phase.textContent=status.tick.phase.replaceAll("_"," ");
  elements.heartbeat.textContent=status.lastLeaseHeartbeatAt===undefined?"Not observed":formatTime(status.lastLeaseHeartbeatAt);
  elements.lastTick.textContent=status.tick.lastCompletedAt===undefined?"Not observed":`${status.tick.lastOutcome} · ${formatTime(status.tick.lastCompletedAt)}`;
  elements.recoveryPosture.textContent=status.recoveryPosture.replaceAll("_"," ");
  elements.badge.className=`status ${status.lifecycle==="RUNNING"&&status.tick.lastOutcome!=="DEGRADED"?"live":"bad"}`;
}

export function renderRuntimeUnavailable(elements){
  elements.badge.textContent="UNAVAILABLE";
  elements.badge.className="status bad";
  for(const element of[
    elements.lifecycle,elements.lease,elements.phase,
    elements.heartbeat,elements.lastTick,elements.recoveryPosture
  ])element.textContent="Not observed";
}
```

Define `record`, `exactOptionalKeys`, `literal`, `timestamp`, `oneOf`,
`normalizeTick`, and `validateContradictions` in this module. Each helper
must throw `new Error("invalid runtime status")` for invalid input; none may
coerce strings to numbers or accept unknown keys.

Use `textContent`, not `innerHTML`. Convert underscores to spaces only after enum validation.

- [ ] **Step 3: Add the dashboard markup and styling**

Insert the section before packet lifecycle with these IDs:

```html
runtime-status-badge
runtime-lifecycle
runtime-lease
runtime-phase
runtime-heartbeat
runtime-last-tick
runtime-recovery-posture
```

The fixed note must say:

> Live observation from this coordinator process only. This is not failover, high availability, or recovery authorization.

Use the existing section, status, readout, live, and incident visual language. Do not add buttons, forms, or interactive controls.

- [ ] **Step 4: Write failing real-entry polling tests**

Extend `demo-entry-integration.test.js`:

- restored-unavailable still fetches only `["/api/demo/config"]`, creates zero intervals/timeouts, and never fetches `/api/runtime-status`;
- operations-allowed fetch order includes `/api/runtime-status` exactly once with the existing health/jobs/dead-letter/delivery/recovery calls;
- polling starts only once even if `OPERATIONS_ALLOWED` is dispatched twice;
- a `503`, malformed body, or thrown fetch renders `UNAVAILABLE` without affecting the other operations panels.

Update expected interval count from five to six only in operations-allowed cases.

- [ ] **Step 5: Wire operations-gated fetching**

Import the pure renderer in `app.js`. Add:

```js
async function refreshRuntimeStatus(){
  try{
    const response=await fetch("/api/runtime-status",{headers:{accept:"application/json"},cache:"no-store"});
    if(!response.ok)throw new Error(`status ${response.status}`);
    renderRuntimeStatus(runtimeElements,validateRuntimeStatus(await response.json()),formatRuntimeTime);
  }catch{
    renderRuntimeUnavailable(runtimeElements);
  }
}
```

Call it once and schedule one five-second interval inside the existing idempotent `startPolling()`. Add its unavailable presentation to `showUnverifiedRestore()` without performing a fetch.

- [ ] **Step 6: Strengthen dashboard claim guards**

Require the runtime route, bootstrap gating, fixed disclaimer, and local-fixture lease label in `scripts/check-dashboard.mjs`. Reject public claims containing:

- `safe to recover`;
- `automatic failover`;
- `high availability enabled`;
- `stale lease permits recovery`.

- [ ] **Step 7: Run dashboard build and tests**

Run:

```bash
npm run build:dashboard &&
npm run check:dashboard &&
node --test apps/dashboard/test/*.test.js
```

Expected: all dashboard guards and tests pass.

- [ ] **Step 8: Commit the dashboard**

```bash
git add apps/dashboard/index.html apps/dashboard/src/runtime-status.js apps/dashboard/test/runtime-status.test.js apps/dashboard/src/app.js apps/dashboard/src/recovery.css apps/dashboard/test/demo-entry-integration.test.js scripts/check-dashboard.mjs
git commit -m "feat: show live coordinator runtime status"
```

---

### Task 6: Documentation and Honest Operational Guidance

**Files:**
- Modify: `README.md`
- Modify: `docs/OPERATIONS.md`
- Modify: `docs/THREAT_MODEL.md`
- Modify: `docs/MILESTONES.md`

**Interfaces:**
- Consumes: the final public status model and dashboard behavior.
- Produces: operator interpretation, incident response, and limitation documentation matching the implemented code.

- [ ] **Step 1: Add exact README endpoint and limitation text**

Document:

- `GET /api/runtime-status`;
- the four lifecycle values and four lease relationships;
- local fixture mode never owns the production lease;
- unreachable means only “status unavailable”;
- heartbeat age and ownership loss do not authorize recovery;
- this remains a single-node testnet prototype.

- [ ] **Step 2: Add the operations interpretation table**

Add:

| Observation | Operator interpretation | Allowed browser action |
| --- | --- | --- |
| `RUNNING / CLAIMED` | This process reports a live claimed lease | Observe only |
| `RUNNING / NOT_APPLICABLE_LOCAL_FIXTURE` | Local fixture loop; no production lease | Observe only |
| `DEGRADED` tick | One phase failed; scheduler may retry | Investigate logs; no browser recovery |
| `OWNERSHIP_LOST / LOST` | Heartbeat failed after a claim | Stop normal operation and verify offline |
| `UNAVAILABLE` | Endpoint cannot provide a valid snapshot | Verify process and lease offline |

State that offline recovery still requires the existing stopped-runtime proof, deterministic re-verification, timelock, and 3-of-5 recovery approvals.

- [ ] **Step 3: Update threat model and milestone language**

Add threats for:

- treating a live self-report as independent monitoring;
- treating heartbeat age as liveness proof;
- exposing lease-owner or error data;
- local fixture status being mistaken for production leasing.

Record the mitigation: closed model, no identifiers, no database inference, GET only, fixed dashboard disclaimer, and offline recovery verification.

Update M1 without claiming high availability or production monitoring.

- [ ] **Step 4: Run documentation and claim checks**

Run:

```bash
rg -n "runtime-status|NOT_APPLICABLE_LOCAL_FIXTURE|offline verification|single-node" README.md docs/OPERATIONS.md docs/THREAT_MODEL.md docs/MILESTONES.md
npm run check:dashboard
git diff --check
```

Expected: every document contains the matching limitation language; all checks pass.

- [ ] **Step 5: Commit documentation**

```bash
git add README.md docs/OPERATIONS.md docs/THREAT_MODEL.md docs/MILESTONES.md
git commit -m "docs: explain live runtime status boundary"
```

---

### Task 7: Full Verification and Independent Review

**Files:**
- Modify only if verification or review identifies a defect.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: a clean, reviewed feature branch with evidence for every completion claim.

- [ ] **Step 1: Run formatting and diff guards**

Run:

```bash
git diff --check e28fce8..HEAD
git status --short --branch
```

Expected: no whitespace errors and no untracked implementation files.

- [ ] **Step 2: Run focused observability tests**

Run with loopback permission where required:

```bash
npm run build &&
node --test \
  services/coordinator/test/runtime-observation.test.js \
  services/coordinator/test/runtime.test.js \
  services/coordinator/test/runtime-lease.test.js \
  services/coordinator/test/status-api.test.js \
  services/coordinator/test/compose-runtime.test.js \
  services/coordinator/test/local-demo-harness.test.js \
  services/coordinator/test/local-demo-wallet-e2e.test.js \
  apps/dashboard/test/runtime-status.test.js \
  apps/dashboard/test/demo-entry-integration.test.js
```

Expected: all focused unit, API, composition, dashboard-entry, restart, and wallet E2E tests pass.

- [ ] **Step 3: Run the complete repository suite**

Run with loopback permission:

```bash
npm run check
```

Expected:

- TypeScript typecheck passes;
- official GenLayer lint and direct tests pass;
- Solidity compilation passes;
- dashboard guards pass;
- all Node contract, coordinator, security, integration, and E2E tests pass.

- [ ] **Step 4: Perform a local read-only smoke check**

Start:

```bash
npm run demo:local -- --owner 0xE6e40CFe775fd15BED4c21a0Fae1cD6F042743dc
```

Verify:

- dashboard loads from the printed loopback URL;
- coordinator panel shows local fixture lease as not applicable;
- no panel offers a mutation control;
- sending the fixed action still uses one wallet transaction;
- reload restoration still resumes by GUID without reconnect or resend.

Stop with Ctrl-C and confirm local EVM, coordinator, and temporary state clean up.

- [ ] **Step 5: Request independent code review**

Review the complete diff from `e28fce8` to `HEAD` for:

- status-model contradictions or information leakage;
- lease loss incorrectly implying recovery safety;
- startup/shutdown ordering regressions;
- local fixture overstating durable lease behavior;
- restored-unavailable polling regressions;
- missing executable browser-entry coverage;
- documentation claims that exceed code evidence.

- [ ] **Step 6: Fix findings through TDD**

For each Critical or Important finding:

1. reproduce it with a focused failing test;
2. run the test and capture RED;
3. implement the minimum correction;
4. run focused tests and capture GREEN;
5. rerun `npm run check`;
6. commit the correction with a specific message.

- [ ] **Step 7: Preserve the isolated branch**

Do not merge, push, deploy, publish, spend funds, create cloud resources, or remove the worktree. Report the branch name, worktree path, commit range, exact test counts, review outcome, and remaining live-integration limitations.
