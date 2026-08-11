# GenLayer Receipt Witness Design

## Goal

Close the local-fixture gap in Sentinel's signer-side GenLayer finality evidence with a keyless, read-only adapter for the documented GenLayer JSON-RPC receipt and status methods.

## Scope

The milestone adds one transport-facing reader used by isolated signer operators. It obtains the consensus status and transaction receipt for one configured GenLayer transaction ID, then returns a minimal, typed witness only when both responses are internally consistent.

The reader must:

- accept only credential-free HTTPS endpoints and bounded positive timeouts;
- call only `gen_getTransactionStatus` and `gen_getTransactionReceipt`;
- require JSON-RPC 2.0 response IDs to match the request IDs;
- require `FINALIZED` / status code `7` before returning a receipt witness;
- bind the returned transaction ID and recipient to the expected values;
- retain the exact call-data bytes and execution result data needed by the existing signer finality attestor;
- fail closed, with sanitized errors, on transport, HTTP, JSON-RPC, schema, finality, recipient, or identifier failures.

It does not submit a transaction, deploy an Intelligent Contract, add a wallet, add an RPC endpoint to checked-in configuration, infer semantic approval from receipt fields, or convert the testnet prototype into a production-ready system.

## Architecture

`JsonRpcGenLayerReceiptReader` will sit beside the existing `JsonRpcGenLayerStatusReader`. Both use the same credential-free HTTPS and no-redirect transport constraints, but remain separate readers so status polling stays lightweight.

The receipt reader exposes `getFinalizedReceipt(transactionId, expectedRecipient)`. It performs a status read followed by a receipt read and returns a canonical transport witness containing the final transaction ID, recipient, raw GenVM call data, execution result, and receipt status.

It deliberately does **not** implement `GenLayerSignerWitnessReader`. The documented receipt contains raw GenVM `txCallData`, while Sentinel's signer attestor requires decoded `evaluate(...)` function arguments. The official material reviewed for this milestone does not define a stable public codec that Sentinel can safely reproduce. The existing signer witness reader and its `readPolicyRecord(contractAddress, guid)` capability remain injected, account/provider-specific boundaries until a reviewed official codec and latest-final read path are available.

The eventual signer witness adapter must compose this receipt transport with that approved codec; only then can `GenLayerSignerFinalityAttestor` compare the decoded transaction and `get_record(guid)` result with the authorization envelope before an isolated signer can count toward quorum.

## Data Flow

1. A future signer-side adapter receives a bounded authorization envelope containing a GenLayer transaction ID.
2. That adapter asks the receipt reader for the transport witness and supplies the configured policy-contract recipient.
3. The reader calls the official status endpoint. Any state other than `FINALIZED` / `7` is a refusal.
4. The reader calls the official receipt endpoint and verifies that its `id`, `recipient`, `status`, `txCallData`, and execution-result fields are valid.
5. A future reviewed decoder may use the returned raw call data to construct the existing signer witness; until then, the signer attestor cannot accept this reader directly.
6. Only the existing 3-of-5 signer quorum code may use a successful full attestation. The receipt reader itself never signs.

## Error Handling and Security

All errors returned by the reader are fixed public strings. Raw provider response bodies, endpoint URLs, tokens, and call data are never included in thrown errors. The reader sends no credentials, rejects endpoint credentials, rejects redirects, caps its timeout, and does not retry. A caller can choose a retry schedule outside the signer authorization path.

`FINALIZED` proves only the GenLayer transaction's consensus status. It does not by itself prove that Sentinel's policy contract was called with the expected inputs; that binding remains mandatory in `GenLayerSignerFinalityAttestor` and the injected latest-final record capability.

## Testing

Tests will use a controlled fetch implementation and verify:

- the two exact JSON-RPC method names and parameter shape;
- valid finalized receipt decoding;
- non-final status refusal without fetching a receipt;
- mismatched JSON-RPC IDs, transaction IDs, recipient values, result shapes, and status contradictions;
- HTTP, malformed JSON, RPC error, and transport failures without provider-data leakage;
- endpoint and timeout validation;
- rejection of attempts to use the low-level receipt reader as a decoded signer witness without an approved codec.

## Acceptance Criteria

- The new reader is compiled and covered by unit tests.
- The low-level reader remains separate from the decoded signer witness boundary; no test or production path may treat raw receipt data as an approved signer authorization.
- Existing fixture paths remain labeled local; the readiness configuration still marks the live GenLayer finality gate unresolved until a reviewed endpoint, contract deployment, and independent operator setup exist.
- Repository documentation names this as an official-RPC transport adapter, not live finality evidence or a production deployment.
