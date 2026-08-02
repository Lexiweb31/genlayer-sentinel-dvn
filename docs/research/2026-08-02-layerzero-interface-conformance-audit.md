# LayerZero Interface-Conformance Primary-Source Audit

Audit date: 2026-08-02

Conclusion: `AUDITED_METADATA_NOT_DEPLOYMENT_AUTHORIZATION`

## Scope and method

This audit refreshed the official public material needed to classify the current Sentinel contract and to keep the offline deployment-readiness gate current. It reviewed documentation and the dependency version locked in this repository. It did **not** call a live chain RPC, inspect deployed bytecode, validate an OApp pathway, select independent DVNs, onboard Sentinel, approve confirmation depths, deploy anything, create infrastructure, fund an account, or submit a transaction.

Primary sources accessed on 2026-08-02:

- [LayerZero: Build DVNs](https://docs.layerzero.network/v2/workers/off-chain/build-dvns)
- [LayerZero: DVN technical reference](https://docs.layerzero.network/v2/workers/off-chain/dvn-technical-reference)
- [LayerZero: Gasolina implementation guide](https://docs.layerzero.network/v2/workers/off-chain/gasolina-implementation)
- [LayerZero: Gasolina API reference](https://docs.layerzero.network/v2/workers/off-chain/gasolina-api-reference)
- [LayerZero: Ethereum Sepolia deployments](https://docs.layerzero.network/v2/deployments/chains/sepolia)
- [LayerZero: Arbitrum Sepolia deployments](https://docs.layerzero.network/v2/deployments/chains/arbitrum-sepolia)
- [GenLayer: networks and RPCs](https://docs.genlayer.com/developers/networks)
- [GenLayer: transaction-status RPC](https://docs.genlayer.com/api-references/genlayer-node/gen/gen_getTransactionStatus)
- [GenLayer: Optimistic Democracy and finality](https://docs.genlayer.com/understand-genlayer-protocol/optimistic-democracy-how-genlayer-works)

Local dependency evidence:

- `package-lock.json` pins `@layerzerolabs/lz-evm-messagelib-v2` to `3.0.168`.
- `node_modules/@layerzerolabs/lz-evm-messagelib-v2/contracts/uln/interfaces/ILayerZeroDVN.sol` is the interface compiled by Sentinel.
- `node_modules/@layerzerolabs/lz-evm-messagelib-v2/contracts/uln/SendUlnBase.sol` is the corresponding locked send-library source inspected for its job call.

## Rechecked LayerZero deployment metadata

| Network | Chain ID | EID | EndpointV2 | SendUln302 | ReceiveUln302 | Executor | Dead DVN |
|---|---:|---:|---|---|---|---|---|
| Ethereum Sepolia | 11155111 | 40161 | `0x6EDCE65403992e310A62460808c4b910D972f10f` | `0xcc1ae8Cf5D3904Cef3360A9532B477529b177cCE` | `0xdAf00F5eE2158dD58E0d3857851c432E34A3A851` | `0x718B92b5CB0a5552039B593faF724D182A881eDA` | `0x8b450b0acF56E1B0e25C581bB04FBAbeeb0644b8` |
| Arbitrum Sepolia | 421614 | 40231 | `0x6EDCE65403992e310A62460808c4b910D972f10f` | `0x4f7cd4DA19ABB31b0eC98b9066B9e857B1bf9C0E` | `0x75Db67CDab2824970131D5aa9CECfC9F69c69636` | `0x5Df3a1cEbBD9c8BA7F8dF51Fd632A9aef8308897` | `0xA85BE08A6Ce2771C730661766AACf2c8Bb24C611` |

These values match the previous audit. They remain dated metadata, not proof of live bytecode or a valid directional pathway. Dead-DVN addresses are recorded only so tooling can reject them; they must never be selected as required or optional verifiers.

## Interface and job-call finding

The official LayerZero material says every supported-chain DVN contract must implement `ILayerZeroDVN`. The current official signature is:

```solidity
function assignJob(AssignJobParam calldata _param, bytes calldata _options)
    external payable returns (uint256 fee);
```

The package locked by this repository declares the same payable function and the same tuple fields and types. Its `SendUlnBase._assignJobs` calls `ILayerZeroDVN(dvn).assignJob(_param, options)` without attaching native value, then accounts for the returned fee in Message Library storage.

`SentinelDVNAdapter` now explicitly inherits that pinned interface. Its `assignJob` is payable solely to preserve the required ABI and immediately rejects `msg.value != 0`; `getFee` returns zero for its single configured destination. Contract tests compare the generated selectors and mutability against an independently declared ABI and prove authorized zero-fee assignment, unauthorized-caller rejection, unsupported-destination rejection, nonzero-value rejection, and zero retained balance.

This resolves only the narrow payable-interface question. It does not make the contract equivalent to LayerZero's full reference DVN topology. The correct internal state is `ILAYERZERO_DVN_INTERFACE_ADAPTER`, not `LAYERZERO_DVN_CANDIDATE`, `ONBOARDED_DVN`, or `DEPLOYED_DVN`.

## Deterministic DVN obligations remain separate

LayerZero's DVN workflow still requires source `PacketSent` and `DVNFeePaid` observation, confirmation-depth enforcement, destination receive-library and ULN configuration resolution, pre- and post-submit idempotency checks, and destination `verify` execution. Sentinel's GenLayer decision cannot replace these deterministic obligations. A future live deployment must bind the policy decision to the canonical GUID, packet/payload digest, and authoritative evidence produced by those checks.

The present adapter has one immutable message library, one immutable verification target, one destination EID, and a constructor-set signer quorum. It has not been proven against either audited ReceiveUln302 address, has no LayerZero-issued deployment/onboarding record, and does not establish the complete administrative, fee, VID, topology, or chain-expansion behavior described by the technical reference.

## Gasolina/onboarding findings and unresolved async semantics

The current Gasolina implementation guide says the service endpoint shared with LayerZero must be an authenticated gateway using IAM/SigV4, mTLS, private ingress, or equivalent controls. The documented onboarding sequence is:

1. LayerZero queries `GET /signer-info` for signer addresses.
2. LayerZero deploys the DVN contracts across agreed chains with those signers and threshold.
3. The Essence wallet is initially assigned `ADMIN_ROLE`.
4. LayerZero returns the deployed addresses for OApp configuration.

The same guide recommends separate signer trust domains, managed KMS/HSM keys, multiple independent deployments, and at least three independent RPC-provider entities for production data quorum. Sentinel's intended 3-of-5 operators remain a documented design; local ephemeral keys are not evidence of five independent operators.

There is a material documentation conflict at the extra-context boundary:

- the Gasolina API reference shows an object response, `{ "valid": true | false }`;
- the Gasolina implementation guide requires a bare JSON boolean, `true` or `false`.

Neither document defines a `pending` result, a retry cadence, retry backoff, or a way to wait synchronously through GenLayer's appeal/finality lifecycle. A returned `false` can also hold a required-DVN pathway nonce until signing or an Endpoint/OApp recovery action changes the state. Therefore Sentinel must keep GenLayer finality in its coordinator and signer protocol and must not claim native Gasolina extra-context integration until LayerZero confirms the exact response and retry contract.

## GenLayer finality finding

The current official network page lists Testnet Bradbury at `https://rpc-bradbury.genlayer.com`, chain ID `4221`, with real-model, production-like testnet workloads. This repository has not used that endpoint in this audit and has not deployed its Intelligent Contract there.

The official node API exposes `gen_getTransactionStatus`; `FINALIZED` has numeric status code `7`. GenLayer's consensus documentation distinguishes `ACCEPTED` from `FINALIZED`: accepted decisions remain inside an appeal window, while finalized decisions are described as permanent and irreversible. Sentinel signers must therefore reject `ACCEPTED`, `UNDETERMINED`, appeal, timeout, canceled, or unknown states and act only after independently reading exact `FINALIZED`/`7` transaction and policy-record evidence.

The repository's current finality reader is fixture-tested. It is not an approved, independently operated live Bradbury reader, and the direct-mode Intelligent Contract tests use controlled local web/LLM results rather than live validator diversity.

## Unresolved external confirmations and deployment blockers

LayerZero confirmation or completed operational evidence is still required for:

- DVN onboarding eligibility, process, testnet coverage, and deployed contract topology;
- exact authenticated caller integration and the conflicting extra-context response shape;
- retry/unavailability behavior while a GenLayer result is not final;
- live Ethereum Sepolia to Arbitrum Sepolia send/receive configuration and bytecode;
- Sentinel's destination verification target and administrative/control topology;
- at least one independently operated required/optional DVN set beside Sentinel;
- approved confirmations based on chain security and reorg risk;
- a successful live pathway validation and rollback/unblock rehearsal.

GenLayer confirmation or completed operational evidence is still required for:

- deployment of the exact Intelligent Contract and policy version on Bradbury;
- an approved authoritative finality/state reader and failover behavior;
- live multi-validator semantic results, appeal timing, and model diversity;
- authoritative governance evidence availability and freshness rules.

Sentinel deployment operations are also still blocked on five isolated signer operators, five independent recovery operators, production PKI and HSM/KMS custody, externally checkpointed audit logs, monitoring, incident response, and an independent security review.

## Project-only values and truth boundary

The values 15 Ethereum Sepolia confirmations and 64 Arbitrum Sepolia confirmations remain unapproved security-review candidates. The values 3 and 20 remain local prototype test values. None is represented as a LayerZero recommendation.

Sentinel is intended to be an additional or optional verifier beside independent LayerZero DVNs, not the sole production verifier. This audit authorizes only an offline readiness report. It authorizes no transaction, funding, deployment, cloud resource, LayerZero onboarding claim, GenLayer live-finality claim, public application URL, production claim, or mainnet claim.

Final conclusion: `AUDITED_METADATA_NOT_DEPLOYMENT_AUTHORIZATION`.
