# GenLayer Finality RPC Boundary Design

**Status:** Approved for local implementation  
**Date:** 2026-07-22

## Objective

Make Sentinel's signing gate depend on GenLayer's documented consensus-status RPC rather than SDK enum behavior. A packet may advance only after `gen_getTransactionStatus` returns the internally consistent pair `FINALIZED` and `7`, the finalized transaction execution succeeded, and an immutable policy record read from finalized GenLayer state matches the original GUID-bound request.

This milestone also removes `genlayer-js` from Sentinel's runtime dependency tree. It does not implement account custody, wallet transport, contract deployment, or a custom raw-transaction signer.

## Selected Boundary

The coordinator uses two deliberately separate clients:

1. `JsonRpcGenLayerStatusReader` is constructed by Sentinel from the manifest's public HTTPS GenLayer endpoint. It performs the security-critical, read-only finality poll through `gen_getTransactionStatus`.
2. `GenLayerContractClient` remains injected. It submits `evaluate`, obtains finalized execution metadata, and calls `get_record` against the explicit `latest-final` state variant. This is the account-aware boundary and may be implemented by a separately approved adapter around an official SDK or wallet provider.

The split lets Sentinel independently validate consensus finality without taking ownership of account keys or reimplementing GenLayer transaction encoding.

## Alternatives Considered

### Keep the existing SDK-only finality adapter

This is the smallest code change, but it leaves the configured GenLayer endpoint unused by the composition root and couples the signing gate to SDK enums plus an unnecessary runtime dependency tree. It does not address the current `genlayer-js` packaging-integrity finding.

### Implement all GenLayer JSON-RPC, calldata and account signing locally

This could remove every external adapter, but it would create a new transaction codec, nonce manager and custody implementation inside Sentinel. That is materially larger, harder to audit, and conflicts with the approved rule that account/provider construction remains outside this repository.

### Selected hybrid

Direct status polling gives the security gate a small auditable protocol surface. Injection preserves the safe custody boundary and avoids claiming a deployable account service before one is approved.

## Status Protocol

The reader sends one JSON-RPC 2.0 request:

- method: `gen_getTransactionStatus`;
- params: `[{ "txId": requestId }]`;
- a locally generated numeric request ID;
- content type: `application/json`.

It rejects non-HTTPS endpoints before network work and applies a bounded request timeout. A response is accepted only when:

- HTTP status is successful;
- the body is a JSON object with JSON-RPC version `2.0`;
- the response ID equals the request ID;
- no JSON-RPC error is present;
- `result.status` is a known uppercase status;
- `result.statusCode` is a known integer code; and
- the name/code pair exactly matches Sentinel's audited table.

The complete documented code map from `UNINITIALIZED/0` through `LEADER_TIMEOUT/13` is represented locally. Unknown or contradictory values fail closed. Only `FINALIZED/7` opens the next gate. `ACCEPTED/5`, `READY_TO_FINALIZE/11`, appeals, timeouts and every other valid status remain non-final and return no decision.

## Finalization Flow

1. Load the durable policy request binding by request ID.
2. Query the independent status reader.
3. Return pending unless the response is exactly `FINALIZED/7`.
4. Ask the injected contract client for transaction execution metadata and require `FINISHED_WITH_RETURN`.
5. Read `get_record(guid)` with `transactionHashVariant: "latest-final"`.
6. Require `ALLOW` or `DENY`, the original packet payload hash, the original evidence digest, and a nonempty policy version.
7. Emit a `PolicyResult`; signer collection remains a later, separate coordinator stage.

The Intelligent Contract already prevents a second record for the same GUID. The off-chain binding check remains necessary because a compromised endpoint, wrong contract, wrong network or adapter bug must not be able to substitute another record.

## Failure Semantics

- Network failures, timeouts, malformed responses, JSON-RPC errors, status contradictions, missing execution metadata and record mismatches throw sanitized errors and never return a policy decision.
- Valid non-final statuses return `undefined` and are polled again by the existing serialized runtime.
- A finalized execution error throws and leaves the durable job in `POLICY_PENDING`; no signer is called. A future recovery-state milestone may classify this as a terminal policy incident, but this change does not silently alter the durable state machine.
- Response bodies and endpoint URLs are not included in error text, preventing accidental token or upstream-detail leakage.

## Dependency and Configuration Effects

`composeRuntime` constructs the status reader from `config.genlayer.endpoint`, making the validated manifest value operational. `genlayer-js` is removed from `dependencies` because production source no longer imports it. The injected interface uses Sentinel-owned structural types, so a future executable adapter may choose an official GenLayer SDK without coupling the coordinator core to it.

Removing the SDK closes the current unmet ESLint peer/integrity finding. It does not certify live GenLayer compatibility: a real account-aware adapter, live RPC fixture, deployed policy contract, funded account and approved custody design remain explicit blockers.

## Test Strategy

Tests use injected fetch and contract-client fakes and perform no network calls. They cover:

- exact JSON-RPC request shape and request-ID correlation;
- every documented status mapping, with only `FINALIZED/7` advancing;
- contradictory/unknown status pairs, malformed JSON, JSON-RPC errors, HTTP errors and timeout/transport failure;
- execution failure and missing execution result after finality;
- mandatory `latest-final` policy record reads;
- packet/evidence/policy binding checks and durable request re-registration;
- composition using the configured endpoint without network work at startup;
- absence of production imports and a clean production dependency tree.

## Non-Goals

- No deployment, funds, cloud resources or GitHub publication.
- No private key, wallet, account provider or browser signer.
- No replacement for the archived Ganache contract-test runner; that remains a separate development-infrastructure milestone.
- No claim that a LayerZero pathway, GenLayer endpoint or policy contract is currently live.
