# Coordinator operations

## Startup preflight

Copy `config/sentinel-runtime.example.json` outside the repository, replace every `.invalid` origin and placeholder address from a fresh audited deployment manifest, and set filesystem permissions so only the coordinator identity can read it. Do not source environment variables from another product. `npm run preflight -- /absolute/path/to/private/sentinel-runtime.json` requires prototype mode, two distinct public HTTPS RPC origins, nonzero pathway addresses, decimal block settings, an exact evidence host, a public HTTPS GenLayer endpoint, an absolute SQLite path, and loopback-only status binding. Its output strips RPC paths and hides the database path.

Passing preflight does not authorize deployment or establish that addresses, libraries, DVNs, RPCs or GenLayer are current. Chain-state validation and explicit user approval remain separate gates.

## Ingestion

`PacketFeeListener` polls finalized source blocks through `JsonRpcLogSource`. It filters the configured EndpointV2 and SendUln302 addresses for the official `PacketSent(bytes,bytes,address)` and `DVNFeePaid(address[],address[],uint256[])` topics. A detection is emitted only when both events occur in the same transaction. This proves a fee event exists but does not replace the later two-provider receipt and canonical packet verification.

The listener holds a block-number/hash cursor and rewinds by the configured lookback if the cursor block is no longer canonical. Events above `latest - confirmations` are not emitted. `SqliteListenerStore` checkpoints the cursor and seen transaction/block pairs under an explicit pathway key using WAL, full synchronous writes and an immediate transaction. A restarted listener resumes at the next block and retains deduplication state; reorg removal and the resulting new cursor are saved together.

New detections and the advanced cursor are checkpointed in one transaction before `poll()` returns. Pending packets are redelivered without scanning forward until the caller explicitly acknowledges their transaction hash. `IngestionRunner` invokes the handler first and acknowledges only after it resolves, so a failed job write remains retryable after restart. The durable coordinator then deduplicates retries by packet GUID.

`PolicyRequestFactory` is the only supported listener-to-policy assembly path. It requires the configured send library, exact source/destination EIDs and OApp peers, a positive Sentinel fee in the optional DVN list, and rejects Sentinel if configured as required. It decodes only the `TreasuryPolicyOApp.Action` tuple and renders a stable action record. `HttpsEvidenceSource` requires a non-empty exact-host allowlist; rejects HTTP, credentials, custom ports, localhost, literal IPs, redirects and unexpected content types; and applies a ten-second timeout. The factory rejects empty or oversized evidence before hashing the exact UTF-8 bytes with SHA-256. The ingestion runner acknowledges only after request assembly, independent RPC verification and durable coordinator detection succeed.

Application URL validation does not prevent an allowlisted DNS name from resolving to a private address. Production deployment must pin the governance origin operationally, resolve through controlled DNS, deny private/link-local/metadata ranges at the network layer, restrict outbound destinations, and alert on certificate or address changes.

This is recoverable at-least-once delivery, not distributed exactly-once semantics. A handler must durably create or recognize the job before returning. Production also needs bounded retry/dead-letter policy, operator reconciliation tooling, multi-writer fencing, and pruning of acknowledged `seen` entries below a proven reorg horizon.

## Job recovery

`SqliteJobStore` uses WAL mode, full synchronous writes, explicit immediate transactions and schema versioning. Packet snapshots retain bigint fields without lossy number conversion. The coordinator persists `POLICY_PENDING` before the GenLayer submission, then persists its transaction hash. On restart, known GUIDs return the original request ID and are not resubmitted.

If submission may have reached GenLayer but its hash was not stored, the pre-submit intent remains without a request ID. The coordinator stops with `policy submission recovery required` instead of guessing or creating a second consensus request. An operator must reconcile GenLayer/account history and repair the record through a future audited recovery tool. Corrupt snapshots, unknown schema versions and GUID mismatches fail startup.

SQLite is appropriate for a single testnet coordinator, not active-active high availability. A production candidate needs one elected writer or a transactional shared database with fencing, backups, restore drills, encryption at rest and retention policy.

The Endpoint, SendUln302, start block, confirmation depth and RPC URL must come from an audited deployment manifest. They must never silently default. RPC credentials belong in the coordinator secret store, not the dashboard or repository.

## Read-only status API

`createStatusServer` exposes `GET /health`, `GET /api/jobs`, and `GET /api/jobs/:guid`. Other methods are rejected. Responses disable caching, safely encode bigint fields as decimal strings, and contain no key material. The server does not create jobs or sign messages.

The dashboard fetches `/api/jobs` from the same origin every five seconds. It lets an operator select an observed GUID and inspect canonical packet fields, each RPC verification, the finalized GenLayer record, and signer quorum. It intentionally exposes no state-changing browser request. A reverse proxy should serve the static dashboard and coordinator API under one TLS origin. If the API is absent, invalid, or empty, the dashboard explicitly displays unavailable/no-packets state and never substitutes fixtures. Authentication is still required before exposing operational metadata outside a controlled demo environment.

## Alerts

Alert on reorg rewinds, unpaired packet/fee events, RPC errors, cursor lag, repeated GUIDs, long-lived lifecycle stages, GenLayer undetermined/failure states, signer divergence, quorum latency, destination persistence failure and rejected OApp execution. Logs must use redacted RPC origins and GUID/transaction identifiers, never URLs containing credentials or signature/key material.
