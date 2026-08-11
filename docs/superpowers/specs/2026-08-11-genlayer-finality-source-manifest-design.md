# GenLayer Finality-Source Manifest Design

## Goal

Add a closed-schema local manifest that identifies the only GenLayer finality source a future Sentinel signer may consider. The manifest is a review artifact, not a connection configuration or signer permission.

## Design

The manifest will bind:

- a schema and tool version;
- a non-secret source label and reviewed URL-origin SHA-256 fingerprint;
- the expected GenLayer chain ID and policy-contract address;
- a policy-record read mode fixed to `latest-final`;
- a transaction call-data codec state fixed to `UNAPPROVED` until an official reviewed decoder is available;
- a review date and bounded review age.

The parser rejects unknown keys, credentials, raw URLs, unsupported chain IDs, zero addresses, malformed fingerprints, future/stale review dates, and any codec state that would imply signer authorization. It returns a safe summary without a connection URL.

## Security Boundary

The parser never calls the source, reads environment variables, accepts credentials, submits an action, or creates a signer. A valid manifest only proves that a reviewer recorded a proposed source identity. It cannot change `liveGenLayerFinalityReader: false`, implement `GenLayerSignerWitnessReader`, or authorize a quorum.

## Testing

Unit tests will accept exactly one canonical local fixture and reject malformed shapes, credentials, URL values, unexpected decoder states, invalid chain/contract/fingerprint values, and stale/future review dates. The output summary must never reveal a raw source URL.

## Acceptance Criteria

- A strict parser and test fixture compile without external dependencies.
- All failure paths are fixed public errors.
- Documentation names the artifact a future-source review record, not live finality evidence.
- The deployment-readiness gate remains false.
