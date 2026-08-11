# Finality-source auditor

`npm run audit:finality-source -- --manifest /absolute/path/to/finality-source.json` validates one canonical GenLayer finality-source review record and prints a sanitized JSON summary.

It does not perform DNS, HTTP, JSON-RPC, wallet, signer, account, deployment, transaction, funding, or cloud activity. The command returns exit code `2` for a valid review record because its permanent truth label is `REVIEW_RECORD_NOT_SIGNER_AUTHORIZATION`; it returns `1` for invalid arguments or input.

The record may contain only a non-secret source label, source-origin SHA-256 fingerprint, Bradbury chain ID `4221`, policy-contract address, `latest-final` read mode, `UNAPPROVED` call-data codec state, review date, and acknowledgement. It cannot contain an endpoint URL, credentials, signer key, policy result, or any authorization state.

A valid result does not change `liveGenLayerFinalityReader: false`. It is a review artifact for a future signer integration, which still requires a reviewed official raw-call-data codec, a latest-final policy-record adapter, deployed policy identity, independently reviewed endpoint operators, and isolated signer custody.
