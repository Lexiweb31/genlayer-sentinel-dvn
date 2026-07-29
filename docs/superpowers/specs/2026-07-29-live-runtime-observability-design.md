# Live Runtime Observability Design

Date: 2026-07-29

Status: Approved design

## Purpose

Give a local or testnet operator a truthful, read-only view of the coordinator process that is serving the dashboard. The view must distinguish lifecycle progress, lease ownership loss, tick activity, and degraded work without implying high availability, automatic failover, or permission to run recovery.

This feature observes only the live process. It does not inspect the database from a second connection, infer the health of a stopped process, or decide that recovery is safe.

## Scope

The milestone adds:

- an in-memory, versioned runtime observation tracker shared by the production runtime and local harness;
- an allowlisted GET-only `/api/runtime-status` response;
- dependency injection of that reader into production and local-demo composition;
- a read-only dashboard panel for lifecycle, lease relationship, work phase, heartbeat, and last completed tick;
- explicit unavailable and unknown states;
- deterministic tests for runtime transitions, API redaction, dashboard behavior, and integration wiring.

It does not add:

- takeover, restart, stop, recovery, requeue, resend, or replacement controls;
- a database observer, stale-lease takeover, or multi-process arbitration;
- health claims for an offline or unreachable process;
- high availability, distributed exactly-once processing, or recovery authorization;
- raw errors, stack traces, database paths, runtime-owner identifiers, recovery action identifiers, secrets, keys, RPC URLs, or signer details;
- deployment, funding, cloud resources, monitoring infrastructure, or public publishing.

## Truth Boundary

The same process that runs `SentinelRuntime` produces the observation. If the process is unreachable, the browser can report only `UNAVAILABLE`. A reachable process may report its own lifecycle and whether its most recent lease operation succeeded.

The API must never derive an offline conclusion from a timestamp. A stale-looking heartbeat is operational evidence only; it is not proof that another process is absent and not permission to acquire the recovery lease.

Recovery posture has only these public values:

- `BLOCKED_BY_ACTIVE_RUNTIME`: this process has successfully claimed the runtime lease and has not observed ownership loss or completed release;
- `REQUIRES_OFFLINE_VERIFICATION`: the process has not established an active lease relationship, observed lease ownership loss, is starting or stopping, or is the local fixture harness where the production lease is not used.

The dashboard must state that recovery remains an offline, separately authorized procedure.

## Approaches Considered

### 1. Live in-memory observation

A small observation tracker owns an immutable snapshot and updates it at explicit lifecycle boundaries. `SentinelRuntime` uses it for the production path, and the local harness uses the same transition API around its supervised pipeline. The status API receives only the tracker's read-only interface.

Advantages:

- observation and the work being described share one process;
- no extra SQLite reads or contention;
- deterministic tests can control time and scheduled work;
- errors can be converted to closed public codes at the source;
- no new authority or recovery surface is introduced.

Limitation: an offline process cannot serve its final state. The dashboard truthfully reports the endpoint as unavailable.

This is the selected approach.

### 2. Direct SQLite observation from the status route

The API could read lease tables and infer active, stale, or released state.

Rejected because the same-origin server disappears with the process, a second database view does not prove process liveness, and timestamps cannot safely authorize recovery. It also introduces read contention and another interpretation of lease invariants.

### 3. Composite memory and database status

The API could merge runtime memory, lease rows, queue counts, and recovery state.

Rejected for this milestone because the sources are non-atomic and can disagree. A composite response would appear canonical while silently combining observations from different instants.

## Runtime Observation Model

The public model is versioned and contains only bounded primitives:

```text
version: 1
observedAt: non-negative integer Unix seconds
lifecycle:
  STARTING | RUNNING | STOPPING | OWNERSHIP_LOST
lease:
  NOT_CLAIMED | CLAIMED | LOST | NOT_APPLICABLE_LOCAL_FIXTURE
recoveryPosture:
  BLOCKED_BY_ACTIVE_RUNTIME | REQUIRES_OFFLINE_VERIFICATION
tick:
  active: boolean
  phase:
    IDLE | HEARTBEAT_BEFORE | INGESTION | POLICY_FINALITY |
    DELIVERY_PLANNING | DESTINATION_DELIVERY | HEARTBEAT_AFTER
  lastStartedAt?: non-negative integer Unix seconds
  lastCompletedAt?: non-negative integer Unix seconds
  lastOutcome:
    NEVER | SUCCEEDED | DEGRADED
  failureCode?:
    LEASE_HEARTBEAT_FAILED | INGESTION_FAILED |
    POLICY_FINALITY_FAILED | DELIVERY_PLANNING_FAILED |
    DESTINATION_DELIVERY_FAILED
lastLeaseHeartbeatAt?: non-negative integer Unix seconds
```

No public field carries a raw exception message. `observedAt` is assigned when the snapshot is read. Lifecycle timestamps come from an injected clock and must be monotonic within one process observation.

On the production path, `STARTING` covers construction, restoration, HTTP binding, and lease claim. `RUNNING` begins only after the lease claim succeeds. `STOPPING` begins before scheduling is cancelled. `OWNERSHIP_LOST` begins when a runtime heartbeat reports failure after a successful claim.

On the local fixture path, `STARTING` covers pipeline construction and coordinator restart. `RUNNING` begins after the local dashboard and pipeline are ready. Its lease relationship is always `NOT_APPLICABLE_LOCAL_FIXTURE`, its recovery posture is always `REQUIRES_OFFLINE_VERIFICATION`, and it can never report `OWNERSHIP_LOST`.

Startup failure before a successful claim never becomes a remotely observable stopped state because the server is closed during failure cleanup.

## Tick Semantics

Only one tick may be active, preserving the existing overlap guard.

Before each dependency call, the runtime records the corresponding phase. A successful pre-work heartbeat records `lastLeaseHeartbeatAt`. A failure in:

- the pre-work heartbeat records `LEASE_HEARTBEAT_FAILED`, changes lifecycle and lease to `OWNERSHIP_LOST` and `LOST`, skips all work, and attempts only the existing final heartbeat;
- ingestion records `INGESTION_FAILED`;
- policy polling records `POLICY_FINALITY_FAILED`;
- delivery planning records `DELIVERY_PLANNING_FAILED`;
- destination delivery records `DESTINATION_DELIVERY_FAILED`.

Non-lease work failures preserve `RUNNING` and `CLAIMED`, report through the existing error reporter, skip later phases in that tick, and leave the scheduler able to retry on the next tick.

The final heartbeat always runs. If it fails after other work, lease state becomes `LOST` and lifecycle becomes `OWNERSHIP_LOST`; the work failure code remains the tick outcome unless there was no earlier failure, in which case the public failure code is `LEASE_HEARTBEAT_FAILED`.

A fully successful tick sets `lastOutcome` to `SUCCEEDED`, clears `failureCode`, records `lastCompletedAt`, and returns to `IDLE`.

A failed tick sets `lastOutcome` to `DEGRADED`, records `lastCompletedAt`, and returns its phase to `IDLE`. The dashboard may label the process degraded, but it must not call it stopped or recovery-ready.

## Stop Semantics

Production `stop()` changes lifecycle to `STOPPING` before cancelling scheduling and draining an active tick. The local harness marks the same state before draining and closing its supervised pipeline. While the live HTTP server remains reachable, the status endpoint can report this transition.

The server closes before lease release, preserving the current shutdown order. Because the endpoint is no longer reachable after server close, the dashboard cannot observe a clean `RELEASED` state from this process. This is intentional. Offline recovery tooling must continue to verify the durable lease separately.

An observed ownership loss does not itself stop or mutate the coordinator in this milestone. Existing work execution already skips when the pre-work heartbeat fails. Changing process supervision or shutdown policy is a separate design decision.

## Status API

`statusResponse`, `dashboardResponse`, and their server constructors receive an optional `RuntimeStatusReader`:

```text
interface RuntimeStatusReader {
  runtimeStatus(): LiveRuntimeStatus
}
```

`GET /api/runtime-status`:

- returns `200` and the validated allowlisted snapshot when a reader is injected;
- returns `503` with `{ "error": "runtime status unavailable" }` when no reader is injected or the reader fails;
- accepts no query parameters that affect the response;
- retains the existing JSON security and no-store headers.

Every non-GET request remains `405`. The route invokes no lease mutation, database write, runtime action, recovery action, wallet request, RPC request, or signer operation.

The response serializer validates the public shape before returning it. Invalid enum values, unsafe timestamps, contradictory lease/recovery combinations, or unexpected fields fail closed to the same sanitized `503` response.

## Composition

Production composition and the local demo harness each create one observation tracker before creating the dashboard server. They pass the read-only tracker interface to the server and the mutation interface only to their own runtime orchestration.

Production construction order must avoid publishing a false running state:

1. create the observation tracker in `STARTING`;
2. bind the dashboard server;
3. claim the runtime lease;
4. transition to `RUNNING`;
5. start scheduled ticks.

The existing startup and shutdown ordering tests remain authoritative.

Local fixture construction uses the same `STARTING` state, changes the lease relationship to `NOT_APPLICABLE_LOCAL_FIXTURE`, and reaches `RUNNING` only after its pipeline and dashboard are ready. Coordinator restart returns the observation to `STARTING`, drains the old pipeline, creates the replacement, and then returns to `RUNNING`. Failure leaves the endpoint unavailable or the visible state degraded; it never invents a production lease.

## Dashboard

A new “Coordinator process” section appears before packet lifecycle. It contains:

- lifecycle badge;
- lease relationship;
- current work phase;
- last heartbeat time;
- last completed tick and outcome;
- recovery posture;
- an always-visible statement that this is live-process observation, not failover or recovery authorization.

Rendering rules:

- `RUNNING` plus `CLAIMED` may use the normal live treatment;
- `lastOutcome: DEGRADED`, `STOPPING`, and `OWNERSHIP_LOST` use incident treatment;
- missing optional timestamps render `Not observed`;
- a `503`, invalid JSON, invalid public model, or fetch failure renders `UNAVAILABLE`;
- the panel never fabricates timestamps or substitutes fixture progress.

The endpoint joins the existing five-second operations polling only after the `OPERATIONS_ALLOWED` bootstrap event. A restored-unavailable local action therefore continues to perform only the capability request and does not poll runtime status.

## Error Handling and Security

- Map failures to the closed public failure-code set at the runtime boundary.
- Preserve detailed errors only in the existing internal reporter.
- Validate timestamps as safe, non-negative integers.
- Enforce exact public keys and enum values.
- Never expose runtime owner, database path, recovery action ID, RPC response, raw error, stack, process ID, host filesystem data, environment data, or credentials.
- Never convert heartbeat age into takeover or recovery permission.
- Keep the route GET-only and same-origin.
- Keep dashboard wording explicit that the coordinator is single-node.

## Testing

Implementation follows test-driven development.

### Runtime unit tests

- construction and startup observations;
- transition to running only after claim;
- phase progression for a successful tick;
- non-overlap preservation;
- allowlisted phase failures and retry;
- pre- and post-work heartbeat ownership loss;
- stopping during an active tick;
- idempotent stop and current close/release/store ordering;
- monotonic injected timestamps.

### API tests

- exact allowlisted response;
- absent reader and throwing reader return sanitized `503`;
- invalid and contradictory snapshots return sanitized `503`;
- non-GET requests return `405`;
- no owner, raw error, path, or unexpected field is serialized.

### Dashboard tests

- live, degraded, stopping, ownership-lost, and unavailable rendering;
- no simulated or recovery-authorizing wording;
- runtime status is not polled during restored-unavailable bootstrap;
- runtime status joins operations polling exactly once after operations are allowed.

### Composition and regression tests

- production and local harness inject the exact runtime reader;
- local mode always reports `NOT_APPLICABLE_LOCAL_FIXTURE` and never claims durable lease ownership;
- HTTP binding, lease claim, scheduling, shutdown, and recovery fencing order remain unchanged;
- full typecheck, Intelligent Contract lint/direct tests, contract compilation, dashboard guards, unit, integration, security, and end-to-end suites pass.

## Documentation

Update:

- `README.md` with the live-process truth boundary and endpoint;
- `docs/THREAT_MODEL.md` with single-node and stale-heartbeat limitations;
- `docs/OPERATIONS.md` or the existing operations guide with interpretation and incident response;
- `docs/MILESTONES.md` to record the local-only observability milestone;
- dashboard copy and guards to prevent high-availability or recovery-readiness claims.

## Acceptance Criteria

The milestone is complete when:

1. a live process exposes one validated, allowlisted runtime snapshot through GET only;
2. the snapshot distinguishes starting, running, stopping, and ownership loss without raw identifiers or errors;
3. tick phases, heartbeat success, completion, and bounded failures are observable with deterministic timestamps;
4. heartbeat loss cannot be displayed as recovery permission;
5. the dashboard renders live and unavailable states without simulated fallback;
6. restored-unavailable action bootstrap performs no runtime-status or operations polling;
7. no runtime, lease, recovery, wallet, RPC, signer, or destination mutation is reachable from the status route or panel;
8. existing runtime ordering, fencing, retry, idempotency, and no-rebroadcast invariants remain intact;
9. focused tests, the complete repository suite, dashboard guardrails, and independent review pass;
10. documentation continues to state that the prototype is single-node, local/testnet-oriented, and not production-ready.
