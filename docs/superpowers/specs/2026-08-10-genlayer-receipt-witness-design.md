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

The receipt reader implements the existing `GenLayerSignerWitnessReader` shape. It will expose:

1. `getTransactionWitness(transactionId)` — performs a status read followed by a receipt read, then returns a canonical witness containing the final transaction ID, recipient, transaction call-data, execution result, and receipt status.
2. `readPolicyRecord(contractAddress, guid)` — remains an explicitly injected, account/provider-specific `latest-final` contract-state capability. The official receipt API does not document a generic ABI call/return codec sufficient to replace this capability safely.

The existing `GenLayerSignerFinalityAttestor` will receive the reader through its existing interface. It will continue to independently compare the transaction witness and decoded `get_record(guid)` result with the authorization envelope before an isolated signer can count toward quorum.

## Data Flow

1. A signer receives a bounded authorization envelope containing a GenLayer transaction ID.
2. The signer-side attestor asks the receipt reader for that transaction's witness.
3. The reader calls the official status endpoint. Any state other than `FINALIZED` / `7` is a refusal.
4. The reader calls the official receipt endpoint and verifies that its `id`, `recipient`, `status`, `txCallData`, and execution-result fields are valid.
5. The attestor checks that the recipient equals the configured policy contract, the witness call matches the expected policy invocation, and the final `get_record(guid)` data binds the GUID, packet digest, evidence digest, policy, and decision.
6. Only the existing 3-of-5 signer quorum code may use a successful attestation. The reader itself never signs.

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
- a signer-attestor integration that accepts the real receipt reader only when receipt and policy-record bindings agree.

## Acceptance Criteria

- The new reader is compiled and covered by unit tests.
- The signer attestor has a test using the reader's real public interface, not a hand-built receipt object.
- Existing fixture paths remain labeled local; the readiness configuration still marks the live GenLayer finality gate unresolved until a reviewed endpoint, contract deployment, and independent operator setup exist.
- Repository documentation names this as an official-RPC transport adapter, not live finality evidence or a production deployment.
