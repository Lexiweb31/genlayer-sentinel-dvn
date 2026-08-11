# GenLayer Receipt Transport Primary-Source Audit

Audit date: 2026-08-11

Conclusion: `OFFICIAL_RPC_TRANSPORT_ADAPTER_NOT_LIVE_FINALITY_APPROVAL`

## Scope

This audit covers the read-only TypeScript transport adapter in `services/coordinator/src/genlayer-receipt-reader.ts`. It authorizes no network call, account creation, contract deployment, transaction submission, funding, signer action, or production claim.

## Primary-source interface used

- [GenLayer `gen_getTransactionStatus`](https://docs.genlayer.com/api-references/genlayer-node/gen/gen_getTransactionStatus) documents a status-only JSON-RPC call with a `txId` parameter. It identifies `FINALIZED` as numeric status code `7`.
- [GenLayer `gen_getTransactionReceipt`](https://docs.genlayer.com/api-references/genlayer-node/gen/gen_getTransactionReceipt) documents a detailed receipt call with a `txId` parameter. Its documented transaction fields include `id`, `recipient`, `status`, `txCallData`, and `result`.

The adapter sends one status request and, only after an internally consistent `FINALIZED`/7 result, one receipt request. Both requests use JSON-RPC 2.0, matching request/response IDs, credential-free HTTPS, no redirects and a bounded timeout. The transport rejects an unexpected transaction ID, recipient, receipt status, call-data shape, execution result, RPC error, HTTP failure or malformed response with a fixed public error.

## Trust boundary

The receipt's `txCallData` is raw GenVM data. The reviewed documentation does not provide this repository a stable public codec that proves it decodes to Sentinel's exact `evaluate(guid, payloadHash, evidenceUri, evidenceDigest, decodedAction, policy)` call. The adapter consequently does not implement `GenLayerSignerWitnessReader` and cannot count toward a signer quorum.

An eventual signer adapter must additionally use a reviewed decoder and a reviewed latest-final policy-record read path, then preserve the existing independent authorization checks. Each production signer operator must retain its own reviewed endpoint and custody boundary. The deployment-readiness configuration therefore continues to declare `liveGenLayerFinalityReader: false`.

Final conclusion: `OFFICIAL_RPC_TRANSPORT_ADAPTER_NOT_LIVE_FINALITY_APPROVAL`.
