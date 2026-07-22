# Authenticated Remote Signer Protocol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a strict, replay-resistant protocol boundary between the Sentinel coordinator and independently operated signer services without introducing raw key handling or false decentralization claims.

**Architecture:** Stable protocol codecs separate wire data from internal bigint-rich signing types. A SQLite reservation ledger protects each signer from request replay and conflicting GUID digests, while an injected authenticated transport pins peer identity and lets the coordinator consume remote signers through the existing quorum interface.

**Tech Stack:** TypeScript, ethers 6.17.0, Node.js `node:sqlite`, Node test runner.

## Global Constraints

- The only supported wire version is `sentinel-signer/v1`.
- Mutual TLS is required in production; this repository implements an injected authenticated transport and strict SPKI SHA-256 fingerprint comparison, not homemade TLS.
- No certificates, private keys, signer URLs, cloud resources, or HSM/KMS accounts are created.
- Runtime composition continues to instantiate zero signers until private deployment configuration and custody are approved.
- Local processes are never described as five independent operators or decentralized infrastructure.
- Raw provider errors, evidence, key details, and private endpoints are not returned in protocol errors.

---

### Task 1: Canonical Protocol Codec

**Files:**
- Create: `services/coordinator/src/signer-protocol.ts`
- Create: `services/coordinator/test/signer-protocol.test.js`

**Interfaces:**
- Consumes: `SigningEnvelope`, `PolicyResult`, `SignatureShare`.
- Produces: `SignerRequest`, `SignerResponse`, `encodeSignerRequest`, `decodeSignerRequest`, `encodeSignerResponse`, `decodeSignerResponse`, `signerRequestHash`.

- [ ] Write tests constructing a request with version, lowercase 32-byte request ID, coordinator ID, issued/expiry seconds, envelope, and result; assert an exact fixed-order JSON string and lossless bigint round trip.
- [ ] Add rejection cases for extra/missing fields, uppercase or malformed hex, invalid enum/version, unsafe numbers, inconsistent GUID/digests, and invalid response signature fields.
- [ ] Run `npm run build && node --test services/coordinator/test/signer-protocol.test.js`; expect module-not-found failure.
- [ ] Implement explicit object-key validation, lowercase hex/address validators, decimal bigint conversion, fixed object construction, JSON serialization, and Keccak-256 request hashing. Do not serialize objects by spreading caller input.
- [ ] Run the focused test; expect all codec cases to pass.
- [ ] Commit `feat: add canonical signer protocol codec`.

### Task 2: Durable Replay and Conflict Reservations

**Files:**
- Create: `services/coordinator/src/signer-replay-store.ts`
- Create: `services/coordinator/test/signer-replay-store.test.js`

**Interfaces:**
- Produces: `SignerReplayStore.reserve(coordinatorId, requestId, guid, digest, requestExpiresAt, now): Promise<"RESERVED"|"DUPLICATE"|"CONFLICT">`, `SqliteSignerReplayStore`, and `close()`.

- [ ] Write tests proving first reservation succeeds, duplicate request IDs are rejected, a new request ID for the same GUID/digest succeeds, a different digest for the GUID conflicts, and all outcomes survive store restart.
- [ ] Add validation tests for malformed identifiers, expired requests, and unsafe timestamps.
- [ ] Run the focused test after build; expect module-not-found failure.
- [ ] Implement WAL/full-synchronous SQLite tables for request IDs and durable GUID bindings. Use `BEGIN IMMEDIATE`, insert the GUID binding before request reservation, and roll back both on database errors.
- [ ] Run focused tests; expect pass.
- [ ] Commit `feat: persist signer replay reservations`.

### Task 3: Signer-Side Protocol Handler

**Files:**
- Create: `services/coordinator/src/signer-protocol-handler.ts`
- Create: `services/coordinator/test/signer-protocol-handler.test.js`

**Interfaces:**
- Consumes: protocol codec, `SignerReplayStore`, `IsolatedSignerService`.
- Produces: `SignerProtocolHandler.handle(authenticatedPeerSpki, body): Promise<{status:number; body:string}>`.

- [ ] Write tests for an accepted canonical request and assert the returned share verifies against the signer and execution digest.
- [ ] Write rejection tests for wrong peer fingerprint/coordinator, stale/future/overlong request lifetime, duplicate ID, conflict disposition, malformed input, non-final result, wrong domain, and denied policy. Assert generic allowlisted error codes and absence of injected raw error text.
- [ ] Run focused tests; expect missing-module failure.
- [ ] Implement constant-shape lowercase fingerprint comparison, freshness checks with injected clock and maximum transport TTL, reserve-before-sign ordering, and strict response encoding. Map failures to `AUTHENTICATION_FAILED`, `INVALID_REQUEST`, `REQUEST_EXPIRED`, `REPLAYED_REQUEST`, `CONFLICTING_REQUEST`, or `SIGNING_REFUSED`.
- [ ] Run focused tests; expect pass.
- [ ] Commit `feat: add fail-closed signer protocol handler`.

### Task 4: Authenticated Remote Signer Client

**Files:**
- Create: `services/coordinator/src/remote-signer.ts`
- Create: `services/coordinator/test/remote-signer.test.js`
- Modify: `services/coordinator/src/signing.ts`
- Modify: `services/coordinator/test/signing.test.js`

**Interfaces:**
- Produces: `AuthenticatedSignerTransport.post(url, body, expectedPeerSpkiSha256)`, `RemoteSignerClient.address`, and `RemoteSignerClient.sign(envelope, result)`.
- Changes: `collectQuorum` consumes `SignerService[]` where each service has `address` and `sign`.

- [ ] Write client tests with an injected transport proving canonical requests, expected peer pin propagation, unique injected request IDs, strict response ID/address/digest/signature verification, and generic handling of transport failure.
- [ ] Add adversarial tests for altered body, peer fingerprint, signer address, request ID, digest, and invalid signature.
- [ ] Extend quorum tests to use structural remote services and prove partial outage, duplicate signer addresses, unauthorized shares, and insufficient threshold behavior.
- [ ] Run focused tests; expect missing-module/type failures.
- [ ] Implement the minimal transport interface and remote client. Require a public HTTPS URL with no credentials, custom port, localhost, or literal IP; do not implement default fetch because Node fetch cannot prove mTLS peer SPKI identity.
- [ ] Generalize quorum input to the minimal signer-service interface and retain concurrent all-settled collection, signer authorization, deduplication, sorting, and threshold enforcement.
- [ ] Run all signer-focused tests; expect pass.
- [ ] Commit `feat: add authenticated remote signer client`.

### Task 5: Documentation and Release Verification

**Files:**
- Modify: `docs/SIGNER_ARCHITECTURE.md`
- Modify: `docs/THREAT_MODEL.md`
- Modify: `docs/SECURITY_STATUS.md`
- Modify: `docs/MILESTONES.md`
- Modify: `README.md`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: version `0.18.0` and an operationally honest milestone record.

- [ ] Document the exact authenticated request flow, reserve-before-sign crash behavior, certificate/SPKI rotation requirement, 3-of-5 operator separation, protocol error handling, and why runtime still composes zero remote signers.
- [ ] Update the threat model with compromised coordinator, replay, duplicate-operator, certificate, and signer availability cases; keep actual TLS deployment and five failure domains in limitations.
- [ ] Set both package versions to `0.18.0` and update the verified test count only after observing the complete suite.
- [ ] Run `npm run check`; expect typecheck, five Solidity compilations, Intelligent Contract/dashboard checks, and every test to pass.
- [ ] Run `git diff --check`; expect no output, then inspect `git status --short` for milestone-only changes.
- [ ] Commit `feat: release authenticated signer protocol`.

