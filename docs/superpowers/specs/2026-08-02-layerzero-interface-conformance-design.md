# LayerZero interface-conformant Sentinel adapter design

Status: approved for a keyless, non-deployment M2 increment on 2026-08-02.

## Outcome

Advance `SentinelDVNAdapter` from selector-compatible local code to an adapter that explicitly implements the pinned official `ILayerZeroDVN` interface, without claiming that it is a complete LayerZero-operated DVN, onboarded, deployed, configured, or safe for production use.

The milestone remains one-way: Ethereum Sepolia (EID 40161) to Arbitrum Sepolia (EID 40231). It creates no account, cloud resource, signer, RPC subscription, funding request, transaction, deployment, or publication.

## Current official evidence

The 2026-08-02 primary-source recheck establishes:

- LayerZero says every EVM DVN must implement `ILayerZeroDVN`.
- Its current interface declares `assignJob(AssignJobParam,bytes)` as `external payable` and `getFee(uint32,uint64,address,bytes)` as `external view`.
- The pinned package `@layerzerolabs/lz-evm-messagelib-v2@3.0.168` has the same interface.
- The pinned `SendUlnBase` calls `assignJob` without forwarding native value and separately accrues the returned fee, so a zero-fee adapter can expose the payable interface while explicitly refusing nonzero `msg.value`.
- Current official chain pages still list Ethereum Sepolia as chain ID 11155111/EID 40161 and Arbitrum Sepolia as chain ID 421614/EID 40231, with the same EndpointV2, ULN302, Executor, and Dead-DVN addresses already recorded by Sentinel.
- LayerZero's current implementation guide says onboarding uses an authenticated Gasolina gateway, `/signer-info`, LayerZero-deployed DVN contracts, an agreed signer threshold, and Essence as initial admin. Sentinel has none of those approvals or deployed components.
- LayerZero documentation remains inconsistent about extra-context output: the API reference shows a `{ "valid": boolean }` object while the implementation guide requires a bare JSON boolean. Neither defines an asynchronous pending result. Sentinel therefore keeps GenLayer finality in its coordinator and does not claim native Gasolina extra-context compatibility.
- GenLayer's current network page lists Bradbury RPC `https://rpc-bradbury.genlayer.com`, chain ID 4221, and real-model workloads. `gen_getTransactionStatus` still documents `FINALIZED` as numeric status 7. This is discovery evidence, not approval of a live account provider or finality witness reader.

Primary sources:

- https://docs.layerzero.network/v2/workers/off-chain/dvn-overview
- https://docs.layerzero.network/v2/workers/off-chain/dvn-technical-reference
- https://docs.layerzero.network/v2/workers/off-chain/build-dvns
- https://docs.layerzero.network/v2/workers/off-chain/gasolina-api-reference
- https://docs.layerzero.network/v2/workers/off-chain/gasolina-implementation
- https://docs.layerzero.network/v2/deployments/chains/sepolia
- https://docs.layerzero.network/v2/deployments/chains/arbitrum-sepolia
- https://docs.genlayer.com/developers/networks
- https://docs.genlayer.com/api-references/genlayer-node/gen/gen_getTransactionStatus

## Alternatives

### Full reference DVN now

Adopt the complete Worker/DVN topology, including VID, price feed, fee library, role administration, signer-governance execution, and LayerZero onboarding assumptions. This would resemble the reference topology most closely but would encode unresolved external decisions and materially expand the attack surface before operator and onboarding requirements are confirmed. Rejected for this increment.

### Exact interface-conformant policy adapter

Explicitly inherit the pinned `ILayerZeroDVN`, implement both official functions with `override`, expose payable `assignJob`, and reject nonzero native value. Preserve the existing policy-quorum execution path and all current fail-closed restrictions. Record an intermediate readiness classification that is stronger than selector resemblance but still blocked from `LAYERZERO_DVN_CANDIDATE`. Selected.

### Documentation-only recheck

Refresh official evidence but leave the known contract mismatch in place. This would improve documentation without advancing runnable conformance. Rejected because the payable/interface gap has a narrow, testable correction.

## Contract behavior

`SentinelDVNAdapter` will explicitly implement `ILayerZeroDVN`.

`getFee` will retain its zero-fee behavior and destination-EID rejection. It will be marked `override`.

`assignJob` will be `external payable override`. It will:

1. reject any caller other than the configured message library;
2. reject nonzero `msg.value` with a dedicated error so native currency cannot become trapped;
3. reject an unsupported destination EID;
4. derive and emit the existing immutable job binding; and
5. return zero.

The payable surface is interface compatibility, not permission to accept funds. No withdrawal path will be added.

The verification quorum, replay key, expiration, signature ordering, destination target, and nonreentrancy behavior remain unchanged.

## Readiness truth model

Add the repository-local binding state `ILAYERZERO_DVN_INTERFACE_ADAPTER`. It means only:

- Solidity inheritance and compilation prove the pinned interface is implemented;
- generated ABI mutability and selectors agree with the pinned interface; and
- local tests prove the zero-value job path and nonzero-value refusal.

Set `payableAssignJobResolved` to `true` because the concrete signature question is closed. Keep all of the following blocked:

- destination verification topology;
- LayerZero onboarding;
- independent DVN selection;
- live pathway validation;
- confirmation-policy approval;
- live GenLayer finality reader;
- isolated signer and recovery operators; and
- deployment security approval.

Only `LAYERZERO_DVN_CANDIDATE` may satisfy the existing candidate-conformance readiness gate. The new intermediate state must continue to produce a conformance blocker.

## Evidence and configuration

Create a dated 2026-08-02 official-source audit. Update `config/networks.json` and the readiness audit reference to that document only after confirming every recorded address still matches the current official chain pages. Preserve `AUDITED_CONTRACT_METADATA_NOT_PATHWAY_VALIDATED` and every pathway warning.

No live RPC request is part of this increment. A future read-only live-pathway command must accept explicit public RPC inputs, prove two genuinely independent origins, and remain separate from deployment capability.

## Tests

The red-green contract tests must prove:

- generated ABI marks `assignJob` payable and `getFee` view;
- official and adapter function selectors match;
- the configured message library can assign a zero-value job and receives fee zero;
- an unauthorized caller cannot assign a job;
- a nonzero-value assignment reverts with no retained balance;
- unsupported destination EIDs still fail closed; and
- existing quorum, replay, expiry, atomicity, OApp, and assurance tests remain green.

Readiness tests must prove:

- the intermediate classification parses and binds canonically;
- it still yields the conformance blocker for a candidate request;
- `payableAssignJobResolved: true` removes only the payable blocker; and
- synchronized source/artifact/build-manifest tampering still fails closed.

Run the full `npm run check` gate after implementation. Any Slither fingerprint change must be reviewed and bound exactly; High or Medium production findings remain unallowlistable.

## Failure and rollback

Compilation, ABI disagreement, source drift, artifact drift, audit staleness, or any unresolved readiness gate fails closed. Rollback is a Git revert of this local milestone. There is no on-chain rollback because this design authorizes no deployment or transaction.

## Explicit non-claims

This milestone does not prove fee economics, multi-message-library administration, VID correctness, LayerZero acceptance, Essence behavior, receive-library authorization, live ULN verification, independent RPC operation, signer isolation, GenLayer validator diversity, production key custody, testnet deployment, or mainnet readiness.
