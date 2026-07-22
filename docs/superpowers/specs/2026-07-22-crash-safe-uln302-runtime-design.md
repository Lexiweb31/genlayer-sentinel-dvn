# Crash-Safe ULN302 Delivery Runtime Design

**Status:** Approved for implementation planning  
**Date:** 2026-07-22  
**Product:** GenLayer Sentinel  
**Safety label:** Production-shaped testnet prototype; not deployed, audited, onboarded, or mainnet-ready

## Objective

Connect the existing packet listener, deterministic source verification, finalized GenLayer policy decision, isolated signer protocol, durable verification outbox, destination verifier, and dashboard into one honest vertical slice:

`finalized ALLOW -> canonical ULN302 intent -> 3-of-5 signer quorum -> durable outbox -> destination verification -> EXECUTED`

The milestone must prove the complete backend lifecycle programmatically without creating keys, funding accounts, deploying contracts, making live testnet calls in automated tests, or implying that LayerZero or GenLayer has onboarded the service.

## Decisions

### One directional pathway per runtime

A runtime instance processes one explicitly configured direction. The first intended direction remains Ethereum Sepolia to Arbitrum Sepolia. The reverse direction requires its own audited manifest and runtime instance; it is not inferred by swapping fields.

### Pinned configuration, independently observed

The coordinator never signs against whichever destination configuration happens to be returned at runtime. The manifest pins the destination EndpointV2, receive ULN302, destination OApp, destination Sentinel adapter, source EID, confirmation count, complete required and optional DVN sets, and optional DVN threshold. At least two independent destination RPC origins must return the same chain ID, receive library, support state, and effective ULN configuration, and those observations must match the manifest exactly.

The receive library must be explicitly selected for the OApp rather than inherited from the endpoint default. Sentinel must appear in the optional DVN set, must not appear in the required set, and at least one non-Sentinel DVN must be required. This encodes the prototype's security posture: Sentinel is an additional policy verifier, never the sole verifier.

Any provider disagreement, default-library use, unsupported EID, missing contract code, unexpected receive library, DVN-set change, optional-threshold change, or confirmation change is configuration drift and blocks signing.

### Canonical LayerZero call only

The intent factory reconstructs PacketV1 from the durable packet fields using the repository's canonical codec. It requires:

- the reconstructed encoded packet hash to equal `packet.encodedPayloadHash`;
- the decoded packet fields, GUID, message, and payload hash to match the durable packet;
- the packet header to be exactly the first 81 bytes;
- the payload hash to equal `keccak256(guid || message)`; and
- the destination call data to be exactly `IReceiveUlnE2.verify(packetHeader, payloadHash, confirmations)`.

The `SigningEnvelope` binds the destination chain ID, adapter, immutable verification target, GUID, packet digest, evidence digest, exact call data, and bounded expiry. The verification target must equal the pinned receive ULN302 address. No caller-supplied arbitrary call data reaches the signing path.

### Durable intent before signatures

The existing outbox begins at `READY`, after signatures already exist. That ordering leaves a crash window: the coordinator can durably reach quorum while the returned signatures are still only in memory. This milestone adds a pre-share `SIGNING` state.

`plan(guid, envelope, now)` persists the exact envelope and execution digest before contacting signers. A repeated plan for the same GUID must be byte-for-byte equivalent. A conflicting plan fails closed.

After quorum collection, `recordQuorum(guid, shares, now)` atomically validates and stores sorted unique shares and transitions `SIGNING -> READY`. The coordinator job is advanced to `QUORUM_REACHED` only after the outbox has durably stored the shares. This makes the outbox the recovery source for signer completion.

### Injected security boundaries

The composition root receives signer services and a destination adapter submitter as injected dependencies. It does not read private keys or invent a raw-key environment-variable convention. The intended runtime requires five distinct configured signer identities and a quorum of exactly three. Local and automated tests may use in-memory cryptographic fakes behind the same interfaces, but the dashboard and documentation must label them as test infrastructure.

The standalone signer processes, authenticated account provider, mTLS certificate lifecycle, nonce manager, fee replacement policy, and live RPC transport are later security milestones. This milestone wires their interfaces without pretending those operational controls already exist.

## Components

### Destination pathway verifier

`IndependentDestinationPathVerifier` uses two or more public HTTPS RPC origins. For each provider it performs read-only calls equivalent to:

1. `eth_chainId` and bytecode checks for EndpointV2, receive ULN302, and the Sentinel adapter;
2. `EndpointV2.getReceiveLibrary(destinationOApp, srcEid)`;
3. `ReceiveUln302.isSupportedEid(srcEid)`; and
4. `ReceiveUln302.getUlnConfig(destinationOApp, srcEid)`; and
5. adapter getters for `verificationTarget`, `quorum`, and each configured signer authorization.

It normalizes addresses and numeric values, compares the complete observations across providers, then compares the result with the pinned manifest. Its successful output is a `VerifiedDestinationPath` value containing only canonical public configuration plus a deterministic configuration digest for logs and diagnostics. RPC URLs and raw provider errors are never exposed.

The verifier runs before a new signing plan and again immediately before destination submission. This narrows, but does not eliminate, the block-level race between off-chain observation and transaction execution. The limitation is explicit in this testnet prototype; an on-chain configuration commitment or guarded adapter upgrade is required before mainnet consideration.

### ULN302 intent factory

`Uln302IntentFactory` accepts a finalized `ALLOW` job, its durable policy request, an independently verified destination path, and the current time. It rejects missing or non-finalized results, every `DENY`, expired evidence, mismatched GUID/digests, and expiry arithmetic outside the configured TTL.

It reconstructs and validates the packet, creates the exact receive-library call, and returns the `SigningEnvelope`. Expiry is calculated once and persisted with the plan; retries reuse the same envelope and never extend authorization silently.

### Delivery planner

`DeliveryPlanner.pollOnce()` reconciles policy jobs and outbox records serially:

1. A `POLICY_FINALIZED` job with no outbox record is path-verified, converted into an envelope, and persisted as `SIGNING`.
2. A `SIGNING` record requests shares for its already persisted envelope. Signers independently re-check the finalized GenLayer result and allowed signing domain.
3. A successful 3-of-5 result is atomically persisted as `READY`.
4. A `READY` record whose job is still `POLICY_FINALIZED` advances the durable job to `QUORUM_REACHED` using the stored signer addresses.
5. A `REJECTED` job never creates or advances an outbox record.

Quorum collection failures leave the record in `SIGNING`. The next tick may retry the identical digest with new transport request IDs. No retry changes the envelope, expiry, policy result, or execution digest. Once the persisted expiry is no longer usable, the record moves to a terminal `FAILED` state with `SIGNING_EXPIRED`; operators must create a separately authenticated recovery workflow in a future milestone rather than silently generating a new authorization.

### Verification outbox

The state model becomes:

- `SIGNING`: exact envelope and digest are durable; no quorum is durable yet.
- `READY`: a valid sorted 3-of-5 quorum is durable.
- `ATTEMPTING`: broadcast intent is durable and the submit call may be in flight.
- `SUBMITTED`: a canonical transaction hash is durable.
- `CONFIRMED`: independent receipt, event, confirmation depth, and adapter `used(digest)` evidence agree.
- `FAILED`: a known authoritative failure or expired signing plan is terminal.
- `RECOVERY_REQUIRED`: broadcast outcome is ambiguous and automatic rebroadcast is forbidden.

Existing records that satisfy the new invariants remain readable. The SQLite table does not require a destructive schema rewrite because the record is JSON-backed, but every restored record is validated against its state invariants. A `SIGNING` record has no shares; `READY`, `ATTEMPTING`, `SUBMITTED`, `CONFIRMED`, and `RECOVERY_REQUIRED` have exactly the configured quorum of sorted, unique, authorized, canonical shares. `FAILED` may have zero shares when signing expired or a complete quorum when delivery failed. Conflicting duplicate writes are rejected.

### Destination worker

The existing worker retains its conservative transaction algorithm. Before changing `READY -> ATTEMPTING`, it invokes the destination pathway verifier again. Drift leaves the record `READY`, reports a sanitized configuration incident, and performs no broadcast.

Once the path is valid, the worker checks `adapter.used(digest)`, persists `ATTEMPTING`, calls the injected submitter, and stores the transaction hash as `SUBMITTED`. Because an interrupted call may have broadcast without returning a transaction hash, an `ATTEMPTING` record found after restart becomes `RECOVERY_REQUIRED`. It is never automatically rebroadcast; authenticated transaction-history reconciliation is a later operator-tooling milestone.

For `SUBMITTED`, independent providers must agree on a successful receipt, block number and hash, the exact adapter event, sufficient depth, and `adapter.used(digest) == true`. Only `CONFIRMED` advances the coordinator through `VERIFIED` to `EXECUTED`.

### Runtime composition

`composeRuntime` creates and owns the job store, listener store, recovery store, verification outbox, source verifier, destination pathway verifier, GenLayer finality adapter, coordinator, listener, ingestion runner, delivery planner, destination worker, and same-origin dashboard server.

The runtime receives these external capabilities:

- `GenLayerContractClient` backed by an approved account provider;
- five `SignerService` instances whose public identities match the manifest;
- `DestinationAdapterSubmitter` backed by an approved destination account provider; and
- a destination read-only RPC transport used by the path and receipt verifiers.

Startup restores stores and reconciles durable job/outbox relationships before polling. Each non-overlapping tick runs:

1. source ingestion and deterministic verification;
2. GenLayer finality polling;
3. delivery planning and signer quorum collection; and
4. destination submission and confirmation.

Shutdown stops scheduling, waits for the in-flight tick, closes the HTTP server, then closes every SQLite owner exactly once. Startup failure closes already-created resources.

## Runtime manifest additions

The validated manifest adds a `destination` section containing:

- two or more independent public HTTPS RPC URLs;
- destination EndpointV2, receive ULN302, destination OApp, and Sentinel adapter addresses; the OApp address must equal the low 20 bytes of the pathway's left-zero-padded `destinationOApp` bytes32 value;
- destination chain ID and source EID;
- an explicit `useDefaultReceiveLibrary: false` assertion;
- exact required and optional DVN address arrays;
- the exact optional DVN threshold;
- the exact testnet confirmation value, labeled as a project test value rather than an official recommendation;
- five distinct authorized signer addresses in ascending canonical order;
- quorum fixed to `3`; and
- a bounded signature TTL.

Parsing rejects unknown unsafe shapes, zero or duplicate addresses, unsorted signer/DVN arrays, Sentinel in the required set, Sentinel absent from the optional set, no independent required DVN, thresholds inconsistent with the optional set, quorum other than 3, signer count other than 5, insecure or duplicate RPC origins, nonpositive confirmations, and unbounded TTLs.

Public status output may show addresses, EIDs, testnet confirmation counts, quorum progress, configuration digest, transaction hash, and sanitized failure codes. It redacts RPC paths, storage paths, signatures, call data, account-provider details, transport authentication material, evidence bodies, and raw errors.

## Crash consistency

| Crash point | Durable state | Restart behavior |
| --- | --- | --- |
| Before `plan` commits | policy is finalized only | Rebuild and persist the canonical plan |
| After `SIGNING`, before any shares | exact envelope/digest | Retry the same digest while unexpired |
| After shares return, before `recordQuorum` | `SIGNING` only | Re-request the same digest; no state is overstated |
| After `READY`, before coordinator quorum | durable envelope and shares | Advance the coordinator from stored signer identities |
| After coordinator quorum, before broadcast | `READY` and `QUORUM_REACHED` | Destination worker proceeds once |
| After `ATTEMPTING`, before tx hash | ambiguous broadcast | Require reconciliation; never auto-rebroadcast |
| After `SUBMITTED`, before confirmation | known transaction hash | Resume independent receipt polling |
| After `CONFIRMED`, before job execution state | confirmed chain evidence | Idempotently advance to `EXECUTED` |

Cross-store reconciliation fails closed on impossible combinations, including `QUORUM_REACHED` without durable shares, mismatched GUID/digest bindings, or a delivery record attached to a rejected job. It reports a sanitized operator incident rather than mutating history speculatively.

## Failure handling

- Source RPC disagreement, insufficient source confirmations, or PacketV1 mismatch blocks GenLayer submission as before.
- Pending GenLayer status remains pending. Only the strict finalized-result adapter can produce `ALLOW` or `DENY`.
- Destination path disagreement or manifest drift prevents signing and submission.
- Signer outage or refusal remains retryable only while the persisted envelope is unexpired.
- Signer identity, digest, signature, order, or authorization mismatch is discarded and cannot count toward quorum.
- A mined failed receipt, event mismatch, adapter-unused result, or independent provider disagreement becomes a sanitized terminal delivery failure.
- An ambiguous submission becomes `RECOVERY_REQUIRED`; no web endpoint can retry or override it.
- A single job failure is reported without terminating unrelated polling, while startup/configuration failures remain fatal.

## Dashboard behavior

The existing app remains read-only and displays real backend state. The packet timeline adds configuration verification, signing-plan persistence, signer quorum, delivery submission, destination confirmations, and execution or rejection. `SIGNING`, `FAILED`, and `RECOVERY_REQUIRED` are visibly distinct. The dashboard does not synthesize progress, expose a submit button, sign in the browser, accept private keys, or present local fixture data as a live deployment.

When run with test doubles, the page must display a prominent local-test label. A live app URL remains absent until the user separately approves deployment and evidence of that deployment is recorded.

## Test strategy

Implementation follows test-driven development. Required automated coverage includes:

- exact PacketV1 reconstruction, 81-byte header extraction, encoded packet hash binding, and payload hash binding;
- byte-exact ABI encoding of `verify(bytes,bytes32,uint64)` against the pinned LayerZero package interface;
- refusal of arbitrary targets, call data, GUIDs, digests, evidence, decisions, expiries, or configuration;
- two-provider agreement and every destination drift/failure case;
- explicit receive-library selection, EID support, complete ULN config comparison, and Sentinel's optional-only placement;
- durable `SIGNING`, idempotent planning, conflicting plan rejection, valid quorum attachment, restart compatibility, and expiry;
- crash/restart behavior at every row in the crash-consistency table;
- exactly five configured signer identities, 3-of-5 success, partial outage, duplicate/unapproved share rejection, and identical-digest retry;
- full runtime lifecycle, serialized ticks, startup reconciliation, error isolation, and resource shutdown;
- `DENY` producing no signing intent and no destination work;
- programmatic end-to-end execution from finalized `ALLOW` through a confirmed exact adapter event and `EXECUTED`;
- sanitized API/dashboard output with no signatures, call data, RPC paths, raw errors, account information, or secrets; and
- all existing contract, coordinator, security, recovery, dashboard, and artifact-reproducibility tests remaining green.

Automated tests use local deterministic fixtures and the Hardhat EDR contract runner. They do not treat mocked RPC responses or local receipts as evidence of current public-testnet compatibility.

## Explicit non-goals and remaining limits

- No contract deployment, funded transaction, faucet use, cloud resource, DNS, public hosting, GitHub publication, or external message is authorized.
- No raw-key signer or private-key environment variable is added.
- No standalone signer daemon, mTLS deployment, KMS/HSM integration, certificate rotation, nonce manager, or fee replacement policy is claimed complete.
- No live GenLayer account provider or direct finality consumer is selected beyond the existing injected interface.
- No reverse-direction pathway is assumed.
- No DVN onboarding, production SLA, audit, decentralization claim based solely on five local processes, or mainnet-readiness claim is made.
- Independent RPC URLs reduce common-provider risk but do not prove independent infrastructure ownership.
- The current adapter can prove that the five manifest signers are authorized and that quorum is three, but it cannot enumerate constructor-time signer entries; a live deployment must additionally provide verified constructor evidence or a reviewed enumerable signer-set revision.
- Off-chain path revalidation cannot atomically prevent a same-block configuration change; mainnet consideration requires an on-chain configuration commitment or equivalent guarded adapter design.

## Completion evidence

This milestone is complete only when the new tests fail before their implementations, the full repository check passes afterward, Solidity artifacts remain reproducible, the dashboard reads the real composed outbox, documentation labels all simulated and blocked boundaries, and the Git worktree contains no unintended changes. Completion does not authorize deployment or publication.
