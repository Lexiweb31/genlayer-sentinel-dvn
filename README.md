# GenLayer Sentinel

GenLayer Sentinel is a clean-room, production-quality **testnet prototype** of an application-specific LayerZero DVN policy firewall. It withholds its optional DVN verification for high-value treasury/governance messages until (1) independent deterministic checks prove the packet and (2) a GenLayer Intelligent Contract reaches a finalized semantic consensus that the decoded action matches authoritative governance authorization.

**Status (2026-07-25): M1 wallet-originated local prototype; not deployed, not live, not audited, and not mainnet-ready. Live app URL: none.** The local app now lets an injected wallet quote and submit one tightly bounded action to real locally deployed OApp bytecode, extracts the mined `ActionSent` GUID, and follows that exact GUID through durable ingestion, labeled local packet proofs, an explicitly labeled `LOCAL_POLICY_FIXTURE`, five ephemeral signer services with real 3-of-5 signatures, adapter verification, and real destination OApp execution. The harness rejects an owner it can control through an unlocked EDR account and locks each run to one source action. An altered record value uses the same authorization ID and target but reaches finalized denial before any signer or destination activity. Coordinator/store restart after source mining recovers the packet without resending the wallet transaction; ambiguous local OApp execution is durably exposed for reconciliation instead of being silently retried or displayed as success.

That runnable path is a local engineering demonstration, not live GenLayer consensus or independent infrastructure. EDR, governance evidence, semantic finality, proof origins, signer identities, executor, and funding are fixtures. Production mode still requires independent public RPC operators, approved GenLayer direct-mode integration, five isolated signer operators, account providers, live ULN302 validation, monitoring, and external audit. The existing production validators remain strict; the local proof adapters are separate harness-only classes and do not relax public-HTTPS or multi-provider requirements.

## Trust problem

Normal transport verification answers “was this packet emitted?” It cannot answer “did governance authorize this exact transfer?” Sentinel keeps those questions separate. RPC quorum verifies inclusion, hashes, confirmations, pathway and replay. GenLayer validators interpret authoritative authorization and policy. Only a finalized `ALLOW` bound to the same GUID, packet digest and evidence digest can reach a threshold signer set.

## Repository

- `contracts/`: LayerZero-facing OApp core and prototype DVN adapter.
- `intelligent-contract/`: GUID-keyed GenLayer semantic policy record.
- `services/coordinator/`: fail-closed lifecycle, durable ingestion, strict request assembly, RPC verification and signer abstractions.
- `packages/core/`: protocol types and tested state machine.
- `apps/dashboard/`: self-contained same-origin app with a capability-gated local wallet action workspace and read-only coordinator operations workspace; no external assets or simulated job fallback.
- `docs/`: ADR, PRD, threat model, dated deployment/dependency audits, unknowns, demo and milestones.
- `config/networks.json`: dated, audited testnet metadata; never blindly deploy from it.

## Local wallet demo

The demo accepts only a public wallet address. Sentinel never accepts or loads that wallet’s signing secret.

```bash
npm install --legacy-peer-deps
npm run build
npm run demo:local -- --owner 0xYOUR_INJECTED_WALLET_ADDRESS
```

Add the printed loopback RPC to the injected wallet with chain ID `31337`, open the printed app URL, and connect the same address. The harness explicitly funds that address with local test currency and transfers source OApp ownership to it.

- Leave the record value as `approved` to exercise local fixture `ALLOW`, 3-of-5 signing, adapter verification, and destination execution.
- Change the record value to something else to emit a real packet that the semantic fixture finalizes as `DENY`; no signer or destination transaction should occur.
- Treat “Packet emitted; Sentinel decision pending” literally. A mined source transaction is not Sentinel approval.

All printed URLs are loopback-only. The command creates no cloud resource, testnet transaction, deployment, publication, or reusable credential. See [`docs/DEMO.md`](docs/DEMO.md) for the walkthrough and exact trust labels.

## Local checks

Requires Node.js 22.13+, Python 3 and the pinned npm 10.9.2 lockfile toolchain. Run `npm install --legacy-peer-deps`, then `npm run check`. Node's built-in SQLite provides transactional coordinator persistence without a native add-on. Coverage includes strict TypeScript, Solidity `0.8.30` compilation targeting Shanghai, Intelligent Contract guardrails, dashboard no-simulation/no-secret rules, wallet quote/send/receipt behavior, state-machine and recovery invariants, GenLayer status/finality, destination path pinning, canonical ULN302 intent, cryptographically validated threshold signing, crash/expiry invariants, and real local-EVM allow/deny/restart lifecycles. Contract fixtures start isolated loopback-only Hardhat `3.10.0` EDR servers on operating-system-selected ports and use unlocked ephemeral test identities; they do not load repository keys. Evidence digests supplied to policy consensus are SHA-256 over the exact UTF-8 rendered evidence text. Production signers should run in five isolated processes/operators backed by KMS/HSM-style providers; the target quorum is 3-of-5.

Runtime values belong in a private Sentinel-only JSON manifest shaped like `config/sentinel-runtime.example.json`; the checked-in example is deliberately non-deployable. Run `npm run preflight -- /absolute/path/to/sentinel-runtime.json` to validate it and print a redacted summary. Preflight validates structure and fail-closed constraints only—it does not prove addresses, RPC reachability, funding or protocol compatibility.

`composeRuntime(config, capabilities, dashboardRoot)` is the programmatic runtime boundary. Capabilities must inject the account-aware GenLayer contract client, exactly five signer services, a destination submitter, destination RPC access and an explicit presentation mode. Sentinel itself constructs the read-only GenLayer status client and deterministic public-RPC transports; it never loads raw account or signer keys. Startup restores durable jobs and signing intents, reconciles already-collected quorum without calling signers again, then binds HTTP and schedules serialized ticks. Each tick ingests packets, polls semantic finality, plans/signs eligible deliveries and submits or confirms destination work. Shutdown drains active work and closes all four SQLite stores plus HTTP. `runtime.maxIngestionAttempts` is mandatory; the example value `3` is a test value, not production tuning.

## Deployment outline (not executed)

1. Resolve every item in `docs/UNKNOWNS.md` that affects the slice and re-audit official chain pages.
2. Revalidate the pinned LayerZero packages and the separately approved GenLayer account-aware adapter; compile, fuzz and audit.
3. Deploy the OApps and adapters on the two testnets with separate deployment credentials.
4. Deploy the GenLayer IC and validate the exact finalized-state read path.
5. Configure trusted peers and Sentinel as **additional/optional** beside independent DVNs; verify configuration from chain state.
6. Bring up isolated signers and coordinator monitoring; run rejection, reorg, RPC disagreement and replay drills.

No deployment, funds, cloud resource, GitHub publication or external message is authorized by this repository.

## Monitoring and recovery

Alert on stuck stage age, repeated ingestion failure, any dead-letter entry, expired `SIGNING`, `RECOVERY_REQUIRED` or `FAILED` delivery, destination-path drift, RPC disagreement, reorg, evidence staleness, GenLayer undetermined/appeal state, signer divergence, quorum latency, adapter submission failure and destination execution failure. Destination delivery persists `ATTEMPTING` before broadcasting; a crash without a durable transaction hash requires account/chain reconciliation and is never automatically rebroadcast. The browser also never retries `eth_sendTransaction`; an unavailable receipt preserves the transaction hash for reconciliation. A successful production transaction advances to executed only after two providers agree on receipt/block/event bindings, confirmation depth and adapter `used(digest)`. The browser can originate only the capability-bounded local OApp action and exposes no recovery, signer, or destination control. Pause intake/signers on integrity alerts. Remove the optional DVN via OApp governance if availability is affected. Rotate compromised signers using threshold administration. Do not overwrite decisions or pretend executed actions are reversible.

## Limitations

Gasolina documents a synchronous bare-boolean extra-context hook and that Essence owns transaction submission/retry, but it does not specify retry cadence/backoff for an unavailable policy service or any pending response. Test source/destination confirmation, signature-expiry and ingestion-attempt values are placeholders. The 2026-07-22 official-source audit verified both chains' then-current EndpointV2, ULN302 and Executor metadata; it did **not** resolve a deployed OApp pathway, choose independent DVNs, validate a deployed pathway, or approve confirmation depths. The local EDR proof labels are not independent-provider evidence, and the local semantic result is not GenLayer consensus. The direct GenLayer status reader and finalized-state adapter remain fixture-tested only; the Intelligent Contract has not passed direct-mode/validator-variance testing. The signer protocol and production destination verifier are tested abstractions, not deployed custody, mutual TLS or isolated infrastructure. SQLite state is single-node rather than HA consensus storage. Ambiguous source or destination submissions require reconciliation and are never automatically resent. No production nonce manager, replacement policy, live submitter, deployed address, or public URL is provided. `MockEndpointV2` is behavioral test code, not LayerZero protocol code. The action workspace is enabled only by the local capability and cannot control recovery, signing, policy, or destination submission.

## Primary references

[LayerZero DVN overview](https://docs.layerzero.network/v2/workers/off-chain/dvn-overview), [DVN technical reference](https://docs.layerzero.network/v2/workers/off-chain/dvn-technical-reference), [Gasolina API](https://docs.layerzero.network/v2/workers/off-chain/gasolina-api-reference), [Gasolina implementation](https://docs.layerzero.network/v2/workers/off-chain/gasolina-implementation), [production DVN configuration](https://docs.layerzero.network/v2/concepts/modular-security/production-dvn-configuration), [Ethereum Sepolia deployment](https://docs.layerzero.network/v2/deployments/chains/sepolia), [Arbitrum Sepolia deployment](https://docs.layerzero.network/v2/deployments/chains/arbitrum-sepolia), [GenLayer transaction status RPC](https://docs.genlayer.com/api-references/genlayer-node/gen/gen_getTransactionStatus), [GenLayer messages/finality](https://docs.genlayer.com/developers/intelligent-contracts/features/messages), and [GenLayer non-determinism](https://docs.genlayer.com/developers/intelligent-contracts/features/non-determinism). Dated evidence and remaining gates are in [`docs/research/2026-07-22-official-audit.md`](docs/research/2026-07-22-official-audit.md) and [`docs/research/2026-07-22-dependency-audit.md`](docs/research/2026-07-22-dependency-audit.md).
