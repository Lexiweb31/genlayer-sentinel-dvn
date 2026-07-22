# Crash-Safe Destination Verification Outbox Design

**Status:** Approved for local implementation  
**Date:** 2026-07-22

## Objective

Durably connect a completed signer quorum to destination-chain `SentinelDVNAdapter.submitVerification` without losing signing material, silently rebroadcasting an ambiguous transaction, or advancing the dashboard before independently confirmed chain evidence exists. This is a local testnet-prototype backend milestone; it does not provide a funded account, deploy contracts, or enable live submission in the composed runtime.

## Boundary

The policy job remains the source of semantic lifecycle state. A separate SQLite outbox owns delivery state and stores the exact signing envelope, sorted quorum shares, execution digest, transaction hash when known, timestamps, and a sanitized failure code. Separating these records avoids coupling policy-store schema and transaction delivery recovery.

## States

- `READY`: exact delivery payload durably prepared; no submission has begun.
- `ATTEMPTING`: intent persisted immediately before calling the account-backed adapter client.
- `SUBMITTED`: transaction hash durably recorded; receipt confirmation pending.
- `CONFIRMED`: independent receipt evidence and adapter `used(digest)` state verified.
- `FAILED`: a known mined transaction failed or authoritative evidence contradicted the request.
- `RECOVERY_REQUIRED`: an attempt may have been broadcast but no transaction hash was durably captured.

Transitions are monotonic except an explicit future operator recovery tool; this milestone exposes no mutation over HTTP.

## Preparation and Binding

`prepare(guid, envelope, shares)` validates:

- GUID matches the envelope;
- execution digest recomputes exactly;
- shares are nonempty, have that digest, use unique sorted signer addresses, and contain canonical signatures;
- a second preparation for the GUID is byte-for-byte equivalent.

Conflicting preparation fails closed. The outbox encodes bigint fields without lossy conversion.

## Submission Algorithm

1. Load a `READY` record and query `adapter.used(digest)`.
2. If already used, do not broadcast; require independent historical verification evidence before confirmation.
3. Persist `ATTEMPTING`.
4. Call the injected account-backed adapter client.
5. Persist the returned canonical transaction hash as `SUBMITTED`.

On restart, any `ATTEMPTING` record is ambiguous. The worker queries independent confirmation sources. If they prove the matching successful adapter event and used state, it confirms. Otherwise it moves to `RECOVERY_REQUIRED` and never rebroadcasts automatically. This intentionally accepts a false-positive manual recovery requirement when a crash occurs after persisting intent but before broadcasting.

## Confirmation

For a known transaction hash, at least two configured destination providers must independently agree on:

- a successful receipt;
- transaction block number and block hash;
- the configured adapter address;
- the canonical `Verified(guid, packetDigest, evidenceDigest, executionDigest)` event;
- minimum confirmation depth.

The verifier also requires `adapter.used(executionDigest) == true`. Provider URLs are redacted in returned evidence. A pending receipt leaves the outbox unchanged. A mined failed receipt or disagreement moves the record to `FAILED`. Test confirmation values remain explicit placeholders.

## Coordinator Advancement

After an outbox record becomes `CONFIRMED`, the worker advances the durable coordinator job from `QUORUM_REACHED` to `VERIFIED`, then to `EXECUTED`. The adapter marks `used` and calls its verification target atomically in one transaction, so a successful confirmed receipt establishes both lifecycle facts. Restart from an intermediate `VERIFIED` state completes `EXECUTED` idempotently.

## Dashboard and API

The read-only API exposes sanitized outbox metadata: GUID, digest, state, transaction hash when public, timestamps, confirmation count, and allowlisted failure code. It never returns signatures, call data, RPC paths, account information, or raw errors. The dashboard shows delivery state and flags `RECOVERY_REQUIRED` as an operator incident; no browser recovery or submit action exists.

## Runtime Integration

The composition root does not instantiate an adapter account client or destination submitter in this milestone. The outbox components are programmatically composable and fully tested, but live ticking remains disabled until an approved account provider, destination RPC manifest, adapter deployment, and funding are supplied with explicit user approval.

## Testing

Tests cover durable preparation, conflict rejection, sorted/unique shares, restart persistence, exact state transitions, already-used handling, successful broadcast, pending and confirmed receipts, provider disagreement, failed receipts, wrong events, insufficient confirmations, ambiguous restart, no automatic rebroadcast, coordinator advancement, sanitized API output, and absence of signatures/call data.

## Limitations

- No account custody, nonce manager, fee policy, gas replacement, or production TLS/RPC infrastructure is created.
- `RECOVERY_REQUIRED` needs a future authenticated reconciliation CLI and chain/account history review.
- SQLite remains single-writer prototype durability, not active-active infrastructure.
- Independent RPC origins are configuration evidence, not proof of independent operators.
- A local mocked receipt is not evidence of current LayerZero testnet compatibility or DVN onboarding.

