# GenLayer Sentinel

GenLayer Sentinel is a clean-room, production-quality **testnet prototype** of an application-specific LayerZero DVN policy firewall. It withholds its optional DVN verification for high-value treasury/governance messages until (1) independent deterministic checks prove the packet and (2) a GenLayer Intelligent Contract reaches a finalized semantic consensus that the decoded action matches authoritative governance authorization.

**Status (2026-07-22): M1 local vertical slice; not deployed, not live, not audited, not mainnet-ready. Live app URL: none.** The dashboard refuses to invent packet activity. Solidity compiles against pinned official LayerZero packages; the adapter and an EndpointV2-compatible OApp lifecycle are exercised on a local EVM. A supervised composition root assembles durable ingestion, bounded poison-packet quarantine, operator-safe requeue, independent verification, strict request construction, GenLayer finality polling and the same-origin dashboard. The backend now includes a canonical authenticated remote-signer protocol and a crash-safe destination verification outbox that persists intent before broadcast, independently confirms the exact adapter event, and never automatically rebroadcasts an ambiguous attempt. The runtime intentionally instantiates zero remote signers and no account-backed destination submitter. GenLayer direct-mode, approved account providers, production mutual TLS, five independent signer operators and real ULN302 integration remain required before a standalone daemon or deployment.

## Trust problem

Normal transport verification answers “was this packet emitted?” It cannot answer “did governance authorize this exact transfer?” Sentinel keeps those questions separate. RPC quorum verifies inclusion, hashes, confirmations, pathway and replay. GenLayer validators interpret authoritative authorization and policy. Only a finalized `ALLOW` bound to the same GUID, packet digest and evidence digest can reach a threshold signer set.

## Repository

- `contracts/`: LayerZero-facing OApp core and prototype DVN adapter.
- `intelligent-contract/`: GUID-keyed GenLayer semantic policy record.
- `services/coordinator/`: fail-closed lifecycle, durable ingestion, strict request assembly, RPC verification and signer abstractions.
- `packages/core/`: protocol types and tested state machine.
- `apps/dashboard/`: self-contained read-only operational packet inspector served beside coordinator state, exposing deterministic and semantic proofs separately with no external assets or simulated fallback.
- `docs/`: ADR, PRD, threat model, audit, unknowns, demo and milestones.
- `config/networks.json`: dated, audited testnet metadata; never blindly deploy from it.

## Local checks

Requires Node.js 22.13+, Python 3 and npm. `npm install`, then `npm run check`. Node's built-in SQLite provides transactional coordinator persistence without a native add-on. Checks include strict TypeScript, Solidity `0.8.30` compilation targeting Shanghai, Intelligent Contract guardrails, dashboard no-simulation rules, state-machine, recovery, GenLayer finality, RPC and local-EVM tests. Evidence digests supplied to policy consensus are SHA-256 over the exact UTF-8 rendered evidence text. No private key belongs in this repository or frontend. Production signers should run in five isolated processes/operators backed by KMS/HSM-style providers; the target quorum is 3-of-5.

Runtime values belong in a private Sentinel-only JSON manifest shaped like `config/sentinel-runtime.example.json`; the checked-in example is deliberately non-deployable. Run `npm run preflight -- /absolute/path/to/sentinel-runtime.json` to validate it and print a redacted summary. Preflight validates structure and fail-closed constraints only—it does not prove addresses, RPC reachability, funding or protocol compatibility.

`composeRuntime(config, genlayerClient, dashboardRoot)` is the programmatic runtime boundary. It requires an injected GenLayer client facade because this repository does not load raw account keys or pretend a local key is production custody. Startup restores durable state before binding HTTP and scheduling serialized ticks. Shutdown stops scheduling, waits for active work, closes HTTP and then closes the job, listener, and recovery SQLite stores. `runtime.maxIngestionAttempts` is mandatory; the example value `3` is a test value, not production tuning.

## Deployment outline (not executed)

1. Resolve every item in `docs/UNKNOWNS.md` that affects the slice and re-audit official chain pages.
2. Pin compatible official LayerZero OApp/protocol packages and GenLayer SDK; compile, fuzz and audit.
3. Deploy the OApps and adapters on the two testnets with separate deployment credentials.
4. Deploy the GenLayer IC and validate the exact finalized-state read path.
5. Configure trusted peers and Sentinel as **additional/optional** beside independent DVNs; verify configuration from chain state.
6. Bring up isolated signers and coordinator monitoring; run rejection, reorg, RPC disagreement and replay drills.

No deployment, funds, cloud resource, GitHub publication or external message is authorized by this repository.

## Monitoring and recovery

Alert on stuck stage age, repeated ingestion failure, any dead-letter entry, `RECOVERY_REQUIRED` or `FAILED` delivery, RPC disagreement, reorg, evidence staleness, GenLayer undetermined/appeal state, signer divergence, quorum latency, adapter submission failure and destination execution failure. Destination delivery persists `ATTEMPTING` before broadcasting; a crash without a durable transaction hash requires account/chain reconciliation and is never automatically rebroadcast. A successful transaction advances to executed only after two providers agree on receipt/block/event bindings, confirmation depth and adapter `used(digest)`. The browser exposes read-only sanitized incident metadata and cannot submit or recover. Pause intake/signers on integrity alerts. Remove the optional DVN via OApp governance if availability is affected. Rotate compromised signers using threshold administration. Do not overwrite decisions or pretend executed actions are reversible.

## Limitations

Gasolina does not document asynchronous pending/retry behavior for extra context. Test source/destination confirmation and ingestion-attempt values are placeholders. DVN onboarding/VID and receive-library/DVN addresses require confirmation; the 2026-07-22 web re-audit was blocked by the local network permission boundary, so `config/networks.json` remains dated 2026-07-21. The pinned GenLayer SDK adapter is fixture-tested but has not contacted Studio or a testnet. The runtime is programmatically composable but is not a standalone daemon until approved GenLayer and destination account providers are integrated. The signer protocol, destination verifier and injected transports are tested abstractions, not deployed custody, mutual TLS or isolated infrastructure. SQLite listener/job/recovery, signer replay and delivery-outbox state are single-node rather than HA consensus storage. Ambiguous destination attempts require a future authenticated reconciliation CLI; no nonce manager, fee replacement policy or live submitter is provided. The local Endpoint harness is behavioral test code, not LayerZero protocol code. The dashboard is deliberately read-only and cannot initiate OApp wallet transactions, recovery, signing, or destination submission.

## Primary references

[LayerZero DVN overview](https://docs.layerzero.network/v2/workers/off-chain/dvn-overview), [DVN technical reference](https://docs.layerzero.network/v2/workers/off-chain/dvn-technical-reference), [Gasolina API](https://docs.layerzero.network/v2/workers/off-chain/gasolina-api-reference), [production DVN configuration](https://docs.layerzero.network/v2/concepts/modular-security/production-dvn-configuration), [Ethereum Sepolia deployment](https://docs.layerzero.network/v2/deployments/chains/sepolia), [Arbitrum Sepolia deployment](https://docs.layerzero.network/v2/deployments/chains/arbitrum-sepolia), [GenLayer messages/finality](https://docs.genlayer.com/developers/intelligent-contracts/features/messages), and [GenLayer non-determinism](https://docs.genlayer.com/developers/intelligent-contracts/features/non-determinism).
