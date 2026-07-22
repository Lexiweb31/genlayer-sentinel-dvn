# Authenticated Remote Signer Protocol Design

**Status:** Approved for local implementation  
**Date:** 2026-07-22

## Objective

Replace the in-process-only signer boundary with a transport-neutral protocol that can connect a coordinator to independently operated signer processes without moving raw signing keys into the coordinator. The production target is five separately operated signer services and a 3-of-5 quorum. This milestone implements and adversarially tests the protocol; it does not deploy five operators or claim decentralization from local processes.

## Trust Boundary

The coordinator is untrusted for authorization. It may propose a signing request, but every signer independently checks the finalized GenLayer result, packet/evidence binding, destination domain, expiry, and request replay state before its isolated `DigestSigner` is invoked.

Mutual TLS is the required production transport. Certificate validation and encryption belong to the deployment transport/terminator, while the application protocol pins and records the authenticated peer SPKI SHA-256 fingerprint. The repository will provide an injected authenticated transport interface and strict fingerprint comparison, not homemade TLS or checked-in certificates.

## Protocol

The only supported request version is `sentinel-signer/v1`. A request contains:

- a 32-byte random request ID;
- an allowlisted coordinator identity;
- issued-at time and a short request expiry;
- the complete `SigningEnvelope` with decimal strings for bigint fields;
- the complete expected finalized `PolicyResult` binding.

Canonical request bytes are stable UTF-8 JSON with a fixed field order and lowercase hex. The request hash is Keccak-256 over those bytes. The execution digest remains exactly the digest accepted by `SentinelDVNAdapter`; transport metadata never changes the on-chain digest.

Responses contain the protocol version, request ID, signer address, execution digest, and signature. The coordinator rejects wrong versions, IDs, signer identities, digests, fingerprints, malformed JSON, non-success status, and signatures that do not recover the configured signer address.

## Signer Processing Order

1. Require the authenticated coordinator SPKI fingerprint to equal the configured fingerprint.
2. Strictly parse and canonicalize the request.
3. Enforce the coordinator identity, request freshness, and a maximum transport TTL.
4. Durably reserve the `(coordinator, requestId)` and `(coordinator, GUID, executionDigest)` bindings.
5. Reject duplicate request IDs and conflicting digests for an already-bound GUID.
6. Delegate to `IsolatedSignerService`, which independently checks finalized `ALLOW`, exact bindings, destination domain, signature TTL, and returned key signature.
7. Return the strictly encoded response.

Reservation occurs before signing. A crash can consume a request ID without returning a share, so the coordinator retries with a new random request ID. This favors never signing a replay over guaranteed response delivery. Repeating the same GUID/digest with a new request ID is permitted and remains safe because the destination adapter is digest-idempotent; a different digest for that GUID is rejected.

## Durable Replay State

SQLite stores coordinator identity, request ID, GUID, digest, request expiry, and creation time using WAL and full synchronous writes. Reservation is an immediate transaction. Expired request IDs may be pruned only after their request expiry, but GUID/digest conflict bindings are retained for the signer deployment lifetime unless an audited operator migration occurs.

## Coordinator Quorum

`RemoteSignerClient` implements the same minimal `address` and `sign()` capability consumed by quorum collection. Quorum collection contacts all configured services concurrently, counts only authorized valid unique addresses, sorts shares, and requires the configured threshold. One failed, refusing, or unreachable signer does not count. Multiple URLs or processes controlled by the same authorized address still count once.

Runtime composition will not instantiate remote signers in this milestone. Enabling them requires a private deployment manifest format, approved TLS/account custody, and five real operator endpoints. The existing runtime therefore remains honestly unable to cross signer quorum.

## Error and Information Handling

Protocol errors use allowlisted codes and generic public messages. Raw finality-provider errors, certificate material, private URLs, policy evidence, and key-provider details are not returned. Logs should correlate request ID, GUID, signer address, and code only.

## Testing

Tests cover canonical round trips, bigint safety, malformed/extra fields, wrong version, stale/future/overlong requests, wrong coordinator and peer fingerprints, duplicate request IDs, conflicting GUID digests, restart persistence, altered responses, wrong signer identity, invalid signatures, partial signer outage, duplicate operators, and insufficient quorum. Existing signer and adapter digest tests remain authoritative for on-chain compatibility.

## Explicit Limitations

- The injected transport tests protocol behavior, not a production TLS stack or certificate rotation.
- No certificates, private keys, signer URLs, cloud resources, or HSM/KMS accounts are created.
- Local tests do not establish five independent failure domains.
- Rate limiting, external audit logging, operator authentication workflows, and certificate issuance/rotation remain deployment work.
- Signer-set rotation still requires the future audited adapter administration described in `docs/SIGNER_ARCHITECTURE.md`.

