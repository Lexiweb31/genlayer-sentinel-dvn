# Operator Attestation Package Design

**Status:** Approved by the deployment owner's standing approval to continue safe implementation
**Date:** 2026-08-11

## Goal

Provide a small, offline package that future Sentinel signer operators can use to submit a public identity and transport-key attestation without ever submitting key material to this repository, dashboard, or coordinator.

## Boundaries

The package validates a deliberately small JSON record: an operator identifier, a public Ethereum signer address, a public SPKI SHA-256 fingerprint, an HTTPS contact URL, a submission timestamp, and a fixed unverified-attestation marker. It rejects unknown keys and fields whose names suggest private keys, mnemonics, seeds, tokens, passwords, or secrets.

Passing validation means only that the record is structurally safe to review. It does not prove that an operator is independent, controls the address, owns the endpoint, runs an HSM, has a distinct failure domain, or counts toward Sentinel's intended 3-of-5 quorum. It cannot clear a readiness gate or authorize deployment.

## Alternatives

1. Collect operator credentials in a coordinator-owned registry. Rejected: it centralizes sensitive material and contradicts isolated operators.
2. Accept free-form documents. Rejected: difficult to validate, easy to accidentally commit secrets, and hard to review consistently.
3. Use a closed JSON attestation with an offline validator. Selected: public-reviewable, deterministic, and narrow enough to keep credential boundaries clear.

## Components and data flow

`docs/operators/operator-attestation.template.json` is a safe template with non-routable example values. `scripts/validate-operator-attestation.mjs` reads one local JSON file and emits a compact result. `services/coordinator/test/operator-attestation.test.js` proves accepted and rejected behavior.

An operator creates a separate local copy, validates it before sharing, and supplies only the record plus out-of-band evidence to the security review. Reviewers must independently verify address control, infrastructure ownership, CA issuance/revocation process, recovery operator separation, and quorum membership before touching `config/deployment-readiness.json`.

## Error handling and tests

The validator must fail closed for malformed JSON, any unknown field, bad address/fingerprint/date/URL, an incorrect marker, and secret-like property names at any depth. Tests use a valid public-only attestation and adversarial variations. The validator makes no network request and never writes a file.

## Non-goals

This work does not generate keys or certificates; authenticate an operator; contact a signer; establish mTLS; deploy contracts; configure LayerZero; query GenLayer; or modify readiness state.
