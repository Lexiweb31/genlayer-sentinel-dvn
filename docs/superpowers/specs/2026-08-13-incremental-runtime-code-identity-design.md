# Incremental Runtime Code Identity Design

## Goal

Improve the read-only pathway auditor's evidence quality by allowing each of
five official LayerZero runtime-code hashes to be independently reviewed and
committed, while retaining a hard all-five requirement for any complete
official-code identity result.

## Scope

The review targets exactly these deployed LayerZero contracts:

1. Ethereum Sepolia `EndpointV2`.
2. Ethereum Sepolia `SendUln302`.
3. Ethereum Sepolia Executor.
4. Arbitrum Sepolia `EndpointV2`.
5. Arbitrum Sepolia `ReceiveUln302`.

This work is read-only. It must not deploy contracts, request a wallet,
submit a transaction, create an operator account, or change LayerZero,
GenLayer, or signer configuration.

## Evidence model

Each non-null configured hash must be backed by a committed review record that
contains all of the following for that named contract:

- the expected checksummed address from the repository's reviewed network
  record;
- the applicable chain ID and EID;
- a pinned LayerZero V2 source revision or release identifier and immutable
  primary-source URL;
- the raw URL and SHA-256 digest of the official deployment-address source;
- the raw URL and SHA-256 digest of the official source/release provenance;
- the Keccak-256 digest of the runtime bytecode observed from two reviewed
  public RPC operator families at a declared canonical block; and
- a statement of the exact conclusion: source provenance plus two-provider
  agreement supports this one runtime identity, not a global security or
  availability claim.

The review record must not contain API keys, credential-bearing URLs, private
keys, packet contents, or transaction-submission material.

## Incremental configuration

`config/pathway-auditor.json` continues to contain the five named runtime
expectations. A hash may move from `null` to an exact lower-case 32-byte
Keccak-256 value only when its corresponding review record is complete and its
record digest is committed alongside the configuration.

Missing or rejected review evidence leaves that particular hash `null`. The
auditor continues to classify observed bytecode for a null expectation as
`CODE_PRESENT_IDENTITY_UNPROVEN` and emits
`AUDIT_CODE_IDENTITY_UNPROVEN`. It must never fill a value from a live RPC
result, a repository compilation, or an unauthenticated third-party explorer.

## Readiness rule

Incremental reviewed entries provide narrow per-contract drift detection.
They do not clear the code-identity category for the pathway. The auditor may
report `CODE_IDENTITY_REVIEWED` for an individual contract only if its expected
hash matches two-provider runtime bytes. Its top-level pathway status remains
`BLOCKED_CODE_IDENTITY` until all five official expectations are non-null and
match at the same audited observation.

`AUDIT_PATHWAY_DEPLOYMENTS_MISSING` remains independent. Even after all five
official identities are reviewed, no Sentinel pathway becomes deployable or
operational until the separately required OApps, adapters, creation evidence,
signer quorum, LayerZero onboarding, and GenLayer finality integration exist.

## Failure handling

Any of these conditions fails closed for the affected item: an address differs
from the reviewed network record, a source URL is not HTTPS, source digests do
not match committed raw evidence, source/release provenance is incomplete,
provider result disagreement occurs, code is empty, a hash is malformed, or a
claimed hash does not equal the runtime digest. A failed item cannot weaken a
previously retained blocker or change a `null` pin.

Review expiration follows the existing 30-day provider-audit policy only for
transport trust. Runtime hash evidence is immutable evidence tied to the
declared source revision and address source; any LayerZero deployment or source
revision change requires a new record and a new explicit commit.

## Testing and verification

Tests will prove that one or more reviewed entries can coexist with null
entries, that record/config bindings are canonical, and that any incomplete
five-contract set still produces the code-identity blocker. Tests will also
reject malformed digests, missing source records, wrong addresses, duplicate
contract names, stale or unknown source identifiers, and a configuration that
claims pathway-ready identity from partial evidence.

The full project test suite and the read-only live audit will be run after any
implementation. A live audit can improve only from `BLOCKED_CODE_IDENTITY` to
the next truthful blocker; it cannot claim deployment, DVN onboarding, signer
quorum, GenLayer finality, or LayerZero execution.
