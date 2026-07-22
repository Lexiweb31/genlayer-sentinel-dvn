# Runnable coordinator design

## Goal

Assemble the existing tested GenLayer Sentinel components into one runnable, fail-closed testnet-prototype process. This milestone does not deploy contracts, load raw signer keys, submit destination verification, or claim live-network compatibility.

## Architecture

`SentinelRuntime` is a lifecycle supervisor, not a second implementation of protocol logic. A composition function receives a validated `RuntimeConfig`, a GenLayer client facade and optional clock/timer dependencies. It creates the SQLite job and listener stores, restores coordinator jobs, constructs the independent RPC verifier, GenLayer finality adapter, packet listener, strict policy request factory, acknowledged ingestion runner and same-origin dashboard server.

The runtime uses one explicit composition root. Components retain their existing interfaces and unit tests. GenLayer account custody remains outside this process: callers must inject a client facade backed by an approved account provider. No signer services are instantiated in this milestone, so the runtime can ingest, verify and reach finalized policy state but cannot falsely advance to quorum.

## Lifecycle and data flow

Startup order is: validate manifest before composition; open stores; restore jobs/request IDs; bind the dashboard to the manifest's loopback host and port; then start polling. Each ingestion tick redelivers pending packets first, assembles canonical requests, performs independent RPC verification, submits the GenLayer request, persists the request ID and only then acknowledges the listener transaction.

Each finality tick polls every durable `POLICY_PENDING` job with a known GenLayer request ID. Pending/accepted states remain pending. Only the existing strict finalized-result adapter can advance a job. Ticks are serialized so slow work cannot overlap itself.

Shutdown order is: stop scheduling; wait for an in-flight tick; close the HTTP server; close both SQLite stores. Shutdown is idempotent. Startup failure closes anything already opened and never leaves polling active.

## Error handling and observability

A tick failure is reported through an injected error reporter and does not acknowledge failed ingestion. The next interval retries durable pending work. The supervisor applies a fixed configured polling interval and no hidden exponential retry policy. Fatal startup/configuration errors reject startup. The dashboard health response remains process-level only and does not imply chain liveness.

The runtime exposes a small status snapshot for tests and operators: started/stopping flags and whether a tick is active. It never returns RPC paths, database paths, evidence bodies or key material.

## Testing

Tests use real lifecycle objects with injected fake timer/work functions only at the external boundaries. Required cases: startup restores before polling; overlapping ticks are prevented; ingestion and finality are both invoked; tick errors are reported without killing the loop; shutdown waits for in-flight work and closes resources once; startup failure cleans up. Existing 38 protocol/security tests must remain green.

## Explicit limits

- No real GenLayer client/account construction until the official direct-mode path is verified.
- No isolated signer transport or destination submission in the runnable process yet.
- No testnet RPC calls in automated tests.
- No public bind, TLS termination, deployment, funding or cloud resources.
- A passing local runtime test is not evidence of LayerZero DVN onboarding or mainnet readiness.
