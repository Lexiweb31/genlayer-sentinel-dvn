# Independent Signer Finality Witness Design

**Status:** Approved by the original isolated-threshold-signer requirement and the instruction to continue code-only hardening  
**Date:** 2026-07-28  
**Target release:** `0.27.0`

## Objective

Replace `sentinel-signer/v1` with a versioned authorization witness that gives every isolated signer enough information to verify the exact GenLayer transaction and policy request independently before invoking its key provider.

The current protocol carries a coordinator-produced `PolicyResult`, signing envelope and transport metadata. `IsolatedSignerService` calls an injected `FinalityAttestor`, but that attestor receives only the result. It does not receive the GenLayer transaction ID, evidence URI, decoded action or policy. A real signer therefore cannot prove that:

1. the claimed GenLayer transaction is exactly `FINALIZED/7`;
2. the transaction successfully called `evaluate` on the configured Sentinel policy contract;
3. its arguments match the packet, evidence, action and policy being signed; or
4. the finalized record has the same cross-language request-binding digest.

Local fixture attestors can assert the decision, but that is not independent finality verification. The documentation currently describes the intended stronger behavior. This milestone makes the code boundary match that trust claim without deploying a signer daemon or GenLayer contract.

## Scope

This milestone implements:

- `sentinel-signer/v2` as the only accepted signer wire version;
- a minimal, canonical GenLayer authorization witness;
- strict request binding across the envelope, policy result and witness;
- a reusable independent signer finality attestor;
- a transaction-witness reader interface that a future official GenLayer SDK adapter must implement;
- durable replay binding to both the destination execution digest and the GenLayer authorization digest;
- coordinator propagation of the durable GenLayer transaction ID and original policy inputs to every signer;
- local fixture and adversarial end-to-end coverage; and
- truthful documentation of what remains injected, local or unproven.

This milestone does **not**:

- create the mTLS signer daemon;
- implement a production TLS client/server;
- add raw private keys, mnemonics, wallet secrets or cloud credentials;
- choose KMS/HSM or certificate vendors;
- implement the account-aware GenLayer submission adapter;
- contact Studio or Bradbury;
- deploy contracts, spend funds, create cloud resources, publish or push;
- claim five independent operators; or
- make Sentinel a sole required LayerZero DVN.

## Source Basis

The design relies on these official boundaries rechecked on 2026-07-28:

- LayerZero describes a DVN as an off-chain verification system paired with on-chain contracts and allows multisignature trust mechanisms: <https://docs.layerzero.network/v2/workers/off-chain/dvn-overview>
- LayerZero's technical reference requires valid quorum signatures, instruction expiry and replay prevention: <https://docs.layerzero.network/v2/workers/off-chain/dvn-technical-reference>
- GenLayer documents `gen_getTransactionStatus`, finalized transaction execution checks, read-only contract reads and detailed transaction data: <https://docs.genlayer.com/api-references/genlayer-js>
- GenLayer documents `gen_getTransactionReceipt` fields including recipient and transaction call data: <https://docs.genlayer.com/api-references/genlayer-node/gen/gen_getTransactionReceipt>
- A GenLayer transaction records the recipient, call data, sender, execution state and consensus data: <https://docs.genlayer.com/understand-genlayer-protocol/core-concepts/transactions>

The future transaction-witness adapter must use an official GenLayer SDK or documented RPC to decode the exact `evaluate` invocation. This milestone defines and tests the fail-closed interface but does not invent a transaction codec.

## Alternatives Considered

### 1. Keep `sentinel-signer/v1`

This would preserve compatibility and minimize changes. It is rejected because v1 gives an isolated signer no transaction ID or original semantic request inputs. The signer can only trust the coordinator's result, which contradicts the intended independent signer architecture.

No v1 deployment exists, so retaining an unsafe compatibility mode has no operational benefit.

### 2. Send the complete persisted `PolicyRequest` and job snapshot

This would give the signer every coordinator field. It is rejected because source receipt details, full encoded packet data, state-machine fields and unrelated timestamps are not required to validate the GenLayer record. A broader protocol increases parser and disclosure surface without strengthening the authorization proof.

### 3. Minimal GenLayer authorization witness — selected

The request carries only:

- GenLayer transaction ID;
- evidence URI;
- decoded action;
- policy text;
- existing finalized `PolicyResult`; and
- existing destination `SigningEnvelope`.

The envelope supplies GUID, packet digest and evidence digest. The result supplies the policy version and claimed decision. The witness supplies the remaining inputs required to reconstruct the exact Intelligent Contract request and its request-binding digest.

The signer configuration, not the coordinator request, pins the GenLayer endpoint, policy contract and destination signing domain.

## Canonical Authorization Model

Add:

```ts
export interface GenLayerAuthorizationWitness {
  transactionId: Hex;
  evidenceUri: string;
  decodedAction: string;
  policy: string;
}

export interface SigningAuthorization {
  witness: GenLayerAuthorizationWitness;
  result: PolicyResult;
}
```

The signer interface becomes:

```ts
export interface SignerService {
  address: Hex;
  sign(
    envelope: SigningEnvelope,
    authorization: SigningAuthorization
  ): Promise<SignatureShare>;
}
```

The witness is bounded exactly like the Intelligent Contract:

- transaction ID: lowercase 32-byte hex;
- evidence URI: credential-free HTTPS, at most 2,048 UTF-8 bytes;
- decoded action: 1–8,192 UTF-8 bytes;
- policy: 1–8,192 UTF-8 bytes.

The envelope GUID, packet digest and evidence digest must equal the policy result. The resulting GenLayer policy input is:

```ts
{
  guid: envelope.guid,
  packetDigest: envelope.packetDigest,
  evidenceUri: witness.evidenceUri,
  evidenceDigest: envelope.evidenceDigest,
  decodedAction: witness.decodedAction,
  policy: witness.policy
}
```

The policy version comes from `authorization.result.policyVersion`.

## `sentinel-signer/v2` Wire Protocol

The fixed-order request fields are:

1. `version`;
2. `requestId`;
3. `coordinatorId`;
4. `issuedAt`;
5. `expiresAt`;
6. `envelope`;
7. `authorization`.

`authorization` contains:

1. `witness`;
2. `result`.

`witness` contains:

1. `transactionId`;
2. `evidenceUri`;
3. `decodedAction`;
4. `policy`.

The response shape remains request ID, signer, execution digest and signature, but its version is `sentinel-signer/v2`.

The parser rejects:

- v1 and every unknown version;
- missing, extra or reordered fields;
- uppercase or malformed hex;
- invalid or credential-bearing evidence URLs;
- empty or oversized UTF-8 values;
- inconsistent envelope/result bindings;
- future, expired or overlong transport lifetimes; and
- bodies above 32,768 UTF-8 bytes.

The body limit is enforced both by the future HTTP server and by `decodeSignerRequest` so alternate transports cannot bypass it.

## Independent Finality Attestor

Add a signer-specific transaction reader:

```ts
export interface GenLayerTransactionWitness {
  recipient: Hex;
  functionName: "evaluate";
  args: [
    Hex,
    Hex,
    string,
    Hex,
    string,
    string
  ];
  executionResultName: string;
}

export interface GenLayerSignerWitnessReader {
  getTransactionWitness(transactionId: Hex): Promise<GenLayerTransactionWitness>;
  readPolicyRecord(contract: Hex, guid: Hex): Promise<unknown>;
}
```

The reader interface deliberately returns decoded, structured transaction data. A later adapter around the official GenLayer SDK or documented receipt RPC is responsible for decoding and proving the raw transaction recipient/call data. Sentinel does not create its own GenLayer transaction codec in this milestone.

Add:

```ts
export class GenLayerSignerFinalityAttestor implements FinalityAttestor {
  constructor(
    status: GenLayerStatusReader,
    witness: GenLayerSignerWitnessReader,
    policyContract: Hex
  );

  assertFinalized(
    authorization: SigningAuthorization,
    envelope: SigningEnvelope
  ): Promise<void>;
}
```

It performs these checks in order:

1. validate the pinned policy contract and all local inputs;
2. query the witness transaction ID through `GenLayerStatusReader`;
3. require exactly `FINALIZED/7`;
4. load the structured transaction witness;
5. require successful `FINISHED_WITH_RETURN` execution;
6. require the configured policy contract as recipient;
7. require function `evaluate`;
8. require all six arguments to exactly equal the reconstructed policy input;
9. read `get_record(guid)` from `latest-final` state through the witness reader;
10. decode the record with the same strict TypeScript decoder used by the coordinator;
11. require its decision and policy version to equal the authorization result; and
12. require the result reason code to be `GENLAYER_FINALIZED_<DECISION>`.

Any unavailable, malformed, contradictory or mismatched observation fails closed. Provider bodies, endpoints, raw call data and record contents do not appear in public errors.

The attestor proves consistency of one configured reader. It does not prove that the reader is independently operated or that GenLayer validators are diverse. Each of five production signer operators must use its own reviewed read path.

## Request-Binding Refactor

Refactor `services/coordinator/src/genlayer-record.ts` around:

```ts
export interface GenLayerPolicyInput {
  guid: Hex;
  packetDigest: Hex;
  evidenceUri: string;
  evidenceDigest: Hex;
  decodedAction: string;
  policy: string;
}
```

Expose:

```ts
export function genLayerRequestBindingFromInput(
  input: GenLayerPolicyInput,
  policyVersion: string
): Hex;

export function decodeGenLayerRecordForInput(
  raw: unknown,
  input: GenLayerPolicyInput
): GenLayerPolicyRecord;
```

Keep the existing `PolicyRequest` functions as thin adapters so coordinator callers do not duplicate conversions. The exact Python/TypeScript vector from `0.26.0` must remain unchanged.

## Coordinator Flow

`Coordinator.collectAuthorization` already holds:

- the durable GenLayer transaction ID in `requestIds`;
- the durable original `PolicyRequest` in `requests`; and
- the finalized `PolicyResult` in the job snapshot.

Before quorum collection it constructs:

```ts
{
  witness: {
    transactionId: requestId,
    evidenceUri: request.evidence.uri,
    decodedAction: request.decodedAction,
    policy: request.policy
  },
  result
}
```

It refuses signing if any durable component is absent or inconsistent. `collectQuorum` forwards the same immutable authorization to every signer. Local fixture signers and remote clients implement the same interface.

The outbox and destination adapter execution digest do not change. Transport/finality witness data never enters the on-chain digest.

## Durable Replay Binding

The replay store currently permanently binds `(coordinatorId, GUID)` only to the destination execution digest. Protocol v2 also computes:

```ts
authorizationDigest =
  keccak256(utf8(canonical authorization JSON))
```

The durable GUID row stores both:

- execution digest; and
- authorization digest.

A new request ID for the same GUID is allowed only when both digests match. A changed transaction ID, evidence URI, action, policy, result or destination execution digest returns `CONFLICT`.

SQLite schema versioning must migrate the local undeployed test database safely:

1. detect the existing table shape;
2. add a non-null authorization digest only when creating a new v2 database;
3. refuse to open a nonempty v1 replay database because its historical rows lack the authorization proof;
4. allow an empty v1 database to migrate in one transaction; and
5. document that no production migration is claimed.

Because no signer service is deployed, fail-closed refusal is preferable to guessing authorization for old rows.

## Error and Information Handling

Existing allowlisted protocol error codes remain:

- `AUTHENTICATION_FAILED`;
- `INVALID_REQUEST`;
- `REQUEST_EXPIRED`;
- `REPLAYED_REQUEST`;
- `CONFLICTING_REQUEST`; and
- `SIGNING_REFUSED`.

No new upstream-specific code is exposed. The handler returns `SIGNING_REFUSED` for status, transaction, record or key-provider failures. Operator telemetry may record one internal allowlisted stage code, but never evidence content, policy text, raw transaction data, signatures, certificate material, private endpoints or provider errors.

## Test Strategy

Use test-driven development with real production parsing and policy logic.

### Protocol tests

- exact canonical v2 bytes and hash;
- v1 rejection;
- transaction ID and semantic witness round trip;
- URL and UTF-8 byte bounds;
- body-size rejection;
- changed witness/result/envelope binding rejection;
- no accidental transaction ID or semantic field omission.

### Attestor tests

- exact `FINALIZED/7`, successful `evaluate`, pinned recipient and bound record passes;
- every other valid GenLayer status remains a refusal;
- failed execution, wrong recipient, wrong function and each changed argument fail;
- malformed/missing/oversized records fail;
- changed decision, policy version or request binding fail;
- sanitized failures do not expose provider details.

### Replay tests

- identical execution and authorization with a new request ID is allowed;
- changed transaction ID, evidence URI, action, policy, result or execution digest conflicts;
- duplicate request ID remains rejected;
- rows survive restart;
- nonempty v1 databases fail closed;
- empty local v1 databases migrate atomically.

### Coordinator and remote tests

- coordinator supplies its durable transaction ID and policy inputs;
- missing request ID or policy request blocks signer contact;
- `RemoteSignerClient` sends v2 and rejects v1 responses;
- partial outage still requires unique authorized identities;
- local fixture attestors receive the exact authorization witness.

### End-to-end tests

The local EDR/fixture lifecycle will prove:

- all five fixture signer services receive the same bound transaction witness;
- three valid independent fixture shares reach the adapter;
- any signer-side finality mismatch prevents that signer from counting;
- fewer than three matching signers prevents destination submission;
- a changed authorization context conflicts durably after restart; and
- DENY remains inert.

These are local fixtures, not independent operators or live GenLayer consensus.

## Documentation Changes

Update:

- `docs/SIGNER_ARCHITECTURE.md` — v2 witness and future daemon boundary;
- `docs/THREAT_MODEL.md` — coordinator-supplied witness, independent reader and residual provider correlation;
- `docs/SECURITY_STATUS.md` — protocol/attestor/replay evidence;
- `docs/MILESTONES.md` — close the signer-finality context gap but retain mTLS daemon, official live adapter and five operators;
- `docs/UNKNOWNS.md` — state what the future SDK transaction-witness adapter must confirm;
- `README.md` — explain v2 without claiming remote services are deployed.

## Success Criteria

The milestone is complete when:

1. v1 is rejected everywhere;
2. every signer request carries the canonical minimal GenLayer witness;
3. every signer checks an independent attestor before key invocation;
4. the attestor verifies status, transaction call and finalized record;
5. replay state binds both execution and authorization digests;
6. the cross-language policy request vector remains unchanged;
7. local ALLOW, DENY, outage, restart and conflict E2E cases pass;
8. the full GenVM, Solidity, TypeScript, dashboard and Node suite passes;
9. no secret, deployment, network write or cloud resource is introduced; and
10. documentation still says not deployed, not live, not audited and not mainnet-ready.

## Follow-On Milestone

Only after this protocol is stable should Sentinel build the standalone signer daemon:

- actual Node TLS 1.3 mutual-authentication server;
- application-level coordinator SPKI pin;
- strict body, concurrency and rate limits;
- operator-local KMS/HSM/key-agent boundary;
- private manifest and certificate lifecycle;
- graceful drain and health/metrics;
- five-process local conformance harness; and
- later, five independently operated testnet services with explicit approval.
