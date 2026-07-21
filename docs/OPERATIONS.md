# Coordinator operations

## Ingestion

`PacketFeeListener` polls finalized source blocks through `JsonRpcLogSource`. It filters the configured EndpointV2 and SendUln302 addresses for the official `PacketSent(bytes,bytes,address)` and `DVNFeePaid(address[],address[],uint256[])` topics. A detection is emitted only when both events occur in the same transaction. This proves a fee event exists but does not replace the later two-provider receipt and canonical packet verification.

The listener holds a block-number/hash cursor and rewinds by the configured lookback if the cursor block is no longer canonical. Events above `latest - confirmations` are not emitted. Listener cursor and seen-state remain in memory; production requires storing them transactionally with job creation so restarts and multi-instance coordination cannot skip work.

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
