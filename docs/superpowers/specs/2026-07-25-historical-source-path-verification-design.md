# Historical Source Path Verification Design

Status: approved continuation of the accepted M2 testnet-readiness boundary. This milestone is read-only and creates no deployments, transactions, cloud resources, credentials, or public artifacts.

## Goal

Before a packet can be submitted to GenLayer, prove from two independent source RPC origins that the packet was emitted while the configured Ethereum Sepolia → Arbitrum Sepolia LayerZero pathway was explicitly pinned to the intended OApp peer, SendUln302 library, executor, confirmation depth, and DVN sets. Preserve the existing separation: this is deterministic chain verification, not semantic consensus.

## Considered approaches

1. Manifest-only validation. Extend `parseRuntimeConfig` and trust the operator-supplied values. This is simple but does not prove those values existed on-chain when the packet was sent.
2. Latest-head startup validation. Read the source pathway once when the coordinator starts. This catches obvious configuration mistakes, but a later change or historical packet can be evaluated against the wrong configuration.
3. Historical packet-block validation (selected). Query both providers at the packet's exact block number and require the exact block hash plus explicit application configuration. This is more RPC work, but it binds the deterministic policy gate to the packet being evaluated and fails closed on reorgs, provider disagreement, default inheritance, or drift.

## Configuration

The source `pathway` manifest gains:

- `sourceOAppAddress`, which must exactly pad to the existing packet-header `sourceOApp` bytes32 value;
- `executor`, `maxMessageSize`, and the freshly audited source `deadDvn`;
- complete sorted `requiredDvns` and `optionalDvns` arrays;
- `optionalDvnThreshold`.

The parser requires at least one independent required DVN, requires Sentinel only in the optional array, rejects the Dead DVN, rejects duplicate/unsorted arrays, requires an explicit non-default SendUln302 library, and keeps every prototype confirmation value visibly operator-supplied. The current metadata registry remains audited metadata, not proof of a deployed OApp pathway.

## Historical verifier

`IndependentSourcePathVerifier.verify(packet)` uses both configured source RPC origins and the packet's exact `blockNumber` and `blockHash`.

Each provider must return:

- the configured source chain ID and exact packet block hash;
- non-empty bytecode for EndpointV2, SendUln302, source OApp, executor, Sentinel DVN, and every configured DVN;
- `EndpointV2.getSendLibrary(sourceOAppAddress, dstEid)` equal to the pinned SendUln302 address;
- `EndpointV2.isDefaultSendLibrary(...) == false`;
- `SendUln302.isSupportedEid(dstEid) == true`;
- `SendUln302.getAppUlnConfig(sourceOAppAddress, dstEid)` exactly equal to the explicit manifest confirmations and DVN arrays, without merged-default fallback;
- `SendUln302.executorConfigs(sourceOAppAddress, dstEid)` exactly equal to the explicit maximum message size and executor;
- `TreasuryPolicyOApp.peers(dstEid)` exactly equal to the destination OApp bytes32 value.

Both providers must agree byte-for-byte on the complete observation. The verifier returns a deterministic configuration digest for diagnostics. Transport failures expose only a sanitized error and never an RPC URL or credential-bearing path.

## Runtime integration and persistence boundary

A `SourceBoundPacketVerifier` composes the existing receipt/canonical-packet verifier with the historical pathway verifier. The coordinator receives packet confirmations only after both checks pass, so it cannot persist `POLICY_PENDING` or submit to GenLayer when the source path is unproven.

The returned source configuration digest is attached to both provider verification records. `SentinelJob` requires the two records to contain the same nonzero digest before advancing to `CONFIRMED`. The digest is therefore persisted with the job snapshot and visible as deterministic evidence after restart; it is not mislabeled as GenLayer evidence or added to the semantic policy result.

The local harness computes a clearly fixture-scoped source configuration digest and continues to label both local observations `LOCAL_EDR_FIXTURE_*`.

## Destination hardening

The destination verifier additionally reads `getAppUlnConfig` and requires the raw application configuration to equal the pinned manifest. A merged configuration that merely inherits LayerZero defaults is rejected even when its current effective values happen to match. This closes the same default-migration risk on the receive side.

## Failure behavior

Provider disagreement, wrong block hash, unsupported EID, missing bytecode, default library use, inherited ULN values, peer mismatch, executor drift, DVN drift, or malformed RPC output aborts deterministic verification before any GenLayer submission or signer call. Existing durable retry/dead-letter policy handles repeated failures; no automatic configuration write or deployment action is introduced.

## Tests

- Runtime schema tests cover source OApp binding, sorted arrays, Sentinel optional-only, Dead DVN rejection, thresholds, executor, and message-size validation.
- Source verifier tests cover the complete happy path at the exact packet block, independent-provider disagreement, every pinned-field drift, default inheritance, missing bytecode, and sanitized RPC failure.
- Composite verifier tests prove no confirmation is returned when either receipt or pathway verification fails and prove the shared configuration digest is attached to both confirmations.
- State-machine tests require matching nonzero configuration digests.
- Destination tests prove raw application configuration is explicit rather than inherited.
- Full local wallet E2E remains green and retains fixture labels.

## Out of scope

No contract deployment, OApp wiring, DVN onboarding, provider procurement, confirmation-policy approval, signer credential construction, GenLayer deployment, faucet use, funding, dashboard hosting, GitHub publication, or testnet transaction is authorized by this milestone.
