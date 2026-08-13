# GenLayer Sentinel

GenLayer Sentinel is a clean-room, production-quality **testnet prototype** of an application-specific LayerZero DVN policy firewall. It withholds its optional DVN verification for high-value treasury/governance messages until (1) independent deterministic checks prove the packet and (2) a GenLayer Intelligent Contract reaches a finalized semantic consensus that the decoded action matches authoritative governance authorization.

**Status (2026-08-13): the M1 wallet-originated local prototype, M2 keyless read-only pathway auditor, and public read-only console are complete. The console is deployed at [genlayer-sentinel-console.damilexi2005.chatgpt.site](https://genlayer-sentinel-console.damilexi2005.chatgpt.site); it is a static, read-only interface and does not establish a deployed pathway. Sentinel's pathway contracts are not deployed, the pathway is not live-chain validated or LayerZero-onboarded, GenLayer live finality is not claimed, the system is not externally audited, and production/mainnet readiness is `NO`.** The auditor can observe one declared Ethereum Sepolia → Arbitrum Sepolia pathway through exactly two credential-free transports per chain, pin provider-agreed blocks, verify public code/deployment/configuration evidence, and emit a canonical integrity-bound artifact. Runtime-code review is incremental for drift detection, but all five official contract identities must be source-reviewed and match before code identity can clear. No live smoke was run because public RPC inputs were not supplied. The local app still lets an injected wallet quote and submit one tightly bounded zero-value action to real locally deployed OApp bytecode, extracts the mined `ActionSent` GUID, and follows that exact GUID through durable ingestion, labeled local packet proofs, an explicitly labeled `LOCAL_POLICY_FIXTURE`, five ephemeral signer services with real 3-of-5 signatures, adapter verification, and real destination OApp execution. The production composition additionally fails closed unless two source RPC transports agree on the exact packet-block hash and explicitly configured source Endpoint, send library, OApp, peer, executor, message-size limit and raw ULN DVN policy. Its historical configuration digest is persisted with both deterministic proof records and shown in the dashboard. A separate recovery council can authorize only two state-bound operations after a minimum 15-minute delay: requeue a still-canonical quarantined source packet, or confirm an already-mined ambiguous destination transaction after repeated pathway, receipt, event, used-state and confirmation checks. Recovery never signs or rebroadcasts a destination transaction.

```text
Public read-only console: DEPLOYED — https://genlayer-sentinel-console.damilexi2005.chatgpt.site
Route-separated package: DEPLOYED (static/read-only only)
Pathway contracts: NOT DEPLOYED BY THIS MILESTONE
LayerZero DVN onboarding: NOT COMPLETED
GenLayer live finality: NOT CLAIMED
Production readiness: NO
```

The reviewed static package gives each route one role:

- `/` is the public product site. It explains Sentinel's proof path and trust boundaries without exposing the console workspace or querying the coordinator.
- `/console/` is the read-only testnet operations inspector. It provides packet search, an observed-message inbox, and explicit unavailable or `NOT OBSERVED` states instead of fixture data.

The route split changes presentation only. In hosted mode the console has no coordinator binding and cannot deploy contracts, onboard a DVN, obtain GenLayer finality, operate a signer quorum, or submit a governed action. Only the explicit loopback `demo:local` capability can enable the local wallet action workspace; visiting `/console/` does not grant that capability.

That runnable path is a local engineering demonstration, not live GenLayer consensus or independent infrastructure. EDR, governance evidence, semantic finality, proof origins, signer identities, executor, and funding are fixtures. The Intelligent Contract now passes the pinned official GenVM linter and 24 official direct-runner tests with strict mocks, pickling checks, fail-closed semantic cases, controlled validator re-execution, and an exact Python/TypeScript request-binding vector. Production mode still requires Studio/Bradbury compatibility evidence, independent public RPC operators, a reviewed GenLayer account provider, five isolated signer operators, live ULN302 validation, monitoring, and external audit. The existing production validators remain strict; the local proof adapters are separate harness-only classes and do not relax public-HTTPS or multi-provider requirements.

The only signer wire version is `sentinel-signer/v2`. It carries a bounded GenLayer transaction/evidence/action/policy witness, and every isolated signer must independently require `FINALIZED`/`7`, a successful exact `evaluate` call to the pinned policy contract, and the strict request-bound record before its key is invoked. Replay state binds both the adapter execution digest and authorization digest. The repository now includes a native Node TLS 1.3 mutual-authentication daemon and coordinator transport. Real loopback tests derive both SPKI pins from live peer certificates and reach durable replay, fixture finality and an ephemeral DVN key. This is local process-boundary evidence, not a deployed endpoint, production PKI, official live GenLayer reader, HSM integration or five independent operators.

## Trust problem

Normal transport verification answers “was this packet emitted?” It cannot answer “did governance authorize this exact transfer?” Sentinel keeps those questions separate. RPC quorum verifies inclusion, hashes, confirmations, pathway and replay. GenLayer validators interpret authoritative authorization and policy. Only a finalized `ALLOW` bound to the same GUID, packet digest and evidence digest can reach a threshold signer set.

## Keyless read-only pathway audit

The pathway command has no wallet, account provider, signer, transaction submission, funding, deployment, GenLayer, cloud, or publication capability. It accepts one canonical public manifest, reads only fixed reviewed repository inputs, and can call only seven allowlisted read methods. Two explicit transports on each chain must agree on the chain, canonical block header, code, creation transaction/receipt, and every decoded pathway read. Reviewed operator independence is a separate gate: different URLs alone do not prove independent control.

```bash
npm run audit:pathway -- --manifest /absolute/path/to/public-pathway-observation.json --output /absolute/path/to/new-pathway-evidence.json
```

Exit `0` means an immutable artifact reached `OBSERVED_PATHWAY_CONSISTENT`; exit `2` means an honest artifact was produced with blockers; exit `1` means the execution could not safely produce trustworthy evidence. Every artifact says `READ_ONLY_UNSIGNED_NOT_DEPLOYED_NOT_ONBOARDED`. A null deployment is supported and expected to exit `2` with deployment/pathway fields absent rather than simulated. The checked-in [manifest template](docs/examples/public-pathway-observation-manifest.template.json) is intentionally nonoperational: it uses reserved `.invalid` hosts, `REPLACE_...` values, and `deployment:null` and must be rejected until an operator replaces every value and canonicalizes the document.

See the complete [operator guide](docs/PATHWAY_AUDITOR.md) for provider review, complete deployment evidence, deterministic checks, artifact comparison, monitoring, recovery, and approval boundaries. Live smoke: **NOT RUN — PUBLIC RPC INPUTS NOT SUPPLIED**.

## Keyless deployment readiness (local only)

`npm run readiness:bundle` is a read-only preparation command for a later, separately approved testnet deployment. It validates one canonical public manifest, binds it to the current Git commit and working-tree state, recompiles and fingerprints the two production contracts, checks the dated official-network evidence, and emits a canonical readiness bundle. It has no wallet, signer, provider, RPC, cloud, funding, transaction-building, deployment, or publication capability. Every bundle permanently says `UNSIGNED_NOT_DEPLOYED_NOT_VERIFIED`, requires separate user approval, and contains `"transactions":[]`.

```bash
npm run readiness:bundle -- --manifest /absolute/path/public-readiness.json
npm run readiness:bundle -- --manifest /absolute/path/public-readiness.json --output /absolute/path/readiness-bundle.json
```

The only accepted inputs are the exact absolute-path forms above. Output files use mode `0600`, are created atomically, and are never overwritten. Exit `0` means the local checks reached `READY_FOR_SEPARATE_DEPLOYMENT_APPROVAL`; it does not authorize or perform deployment. Exit `2` means the bundle was produced but remains blocked. Exit `1` means the input, repository evidence, Git inspection, bundle construction, or output failed; stderr contains only one stable error code. When using the npm wrapper, build logs precede command output, so use `--output` for machine consumption.

The checked-in [`public readiness manifest`](docs/examples/public-readiness-manifest.json) is a schema example, not deployment authorization. Its historical source commit intentionally cannot match the final implementation commit. Running it is expected to return exit `2`, with output shaped like:

```json
{"status":"BLOCKED_ARTIFACT_BINDING","transactions":[],"truthLabel":"UNSIGNED_NOT_DEPLOYED_NOT_VERIFIED","userApprovalRequired":true}
```

The actual canonical bundle contains additional audited public metadata and sanitized blockers. It never infers LayerZero readiness from ABI selector names. The adapter now explicitly implements the pinned official payable `ILayerZeroDVN` interface and rejects every nonzero `msg.value`, so that narrow interface question is resolved. Native value force-sent outside that entry point can be returned only to the immutable authorized message library by a permissionless, nonredirectable recovery function. Its readiness state is only `ILAYERZERO_DVN_INTERFACE_ADAPTER`: destination verification topology, LayerZero onboarding, independent DVN selection, live pathway validation, confirmation-policy approval, a live GenLayer finality reader, five isolated signer operators, five independent recovery operators, and deployment security approval all remain unresolved. Only exact future `LAYERZERO_DVN_CANDIDATE` evidence can clear the conformance gate. Sentinel must initially be an additional or optional verifier beside independently operated LayerZero DVNs, never the sole production verifier.

The keyless [finality-source auditor](docs/FINALITY_SOURCE_AUDITOR.md) validates a future signer trust-review record without contacting GenLayer. Its only valid output remains `REVIEW_RECORD_NOT_SIGNER_AUTHORIZATION`; it cannot enable the finality reader or signer quorum.

Deterministic checks and GenLayer consensus have separate jobs. Deterministic verification proves the exact PacketSent/pathway binding, payload hashes, confirmation depth, configuration, and replay state using independently operated RPC evidence. GenLayer semantic consensus decides whether that same canonical GUID/packet/evidence binding matches authoritative governance authorization and policy. A future signer may act only after both layers finalize; this readiness command performs neither layer and signs nothing.

Rollback for this command is deletion of a generated local bundle. No chain rollback exists because it submits no transaction and changes no chain or deployment record. If any binding or audit is suspect, discard the bundle, refresh official evidence, rebuild from a clean reviewed commit, and rerun. Do not “repair” a blocked bundle by editing its output.

## Repository

- `contracts/`: LayerZero-facing OApp core and prototype DVN adapter.
- `intelligent-contract/`: GUID-keyed GenLayer semantic policy record.
- `services/coordinator/`: fail-closed lifecycle, durable ingestion, strict request assembly, RPC verification and signer abstractions.
- `packages/core/`: protocol types and tested state machine.
- `apps/dashboard/`: self-contained public site at `/` and read-only testnet operations inspector at `/console/`, with an in-memory local pathway-artifact inspector and a loopback-capability-gated local wallet action workspace; no remote asset dependency or simulated job fallback.
- `docs/`: ADR, PRD, threat model, dated deployment/dependency audits, unknowns, demo and milestones.
- `config/networks.json`: dated, primary-source-checked testnet metadata; never blindly deploy from it.

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

After the receipt yields one matching `ActionSent` event, the app stores only the local chain/harness binding, transaction hash, and GUID in same-tab `sessionStorage`. Reloading that tab resumes read-only coordinator observation only when the current public capability identifies the same harness. The locator is not proof, never reconnects the wallet, never quotes or resends the action, and cannot create a policy or execution state. A validated different harness clears it; an unavailable capability retains the public locator but does not poll an unverified coordinator. The operations app also shows the serving process's lifecycle, current phase, last completed tick and lease relationship. Local mode is explicitly `NOT_APPLICABLE_LOCAL_FIXTURE`, not a production lease.

All printed URLs are loopback-only. The command creates no cloud resource, testnet transaction, deployment, publication, or reusable credential. See [`docs/DEMO.md`](docs/DEMO.md) for the walkthrough and exact trust labels.

## Local checks

Requires Node.js 22.13+, Python 3.12+ and the pinned npm 10.9.2 lockfile toolchain.

```bash
npm install --legacy-peer-deps
npm run setup:ic:direct
npm run setup:assurance
npm run check
```

The two setup commands are explicit, separate network-enabled bootstraps. `setup:ic:direct` installs a hash-locked Python graph into `.venv` and prepares pinned GenVM `v0.2.16` under `.cache/genlayer-sentinel`. `setup:assurance` creates `.venv-assurance`, installs the complete hash-locked Slither `0.11.5` graph, and downloads only the platform-listed native solc `0.8.30` after checksum verification. Assurance Python discovery uses the same allowlisted child environment as later commands; pip runs in Python isolated mode with pip isolation, keyrings disabled, every pip configuration layer disabled through the operating-system null device, and a disposable empty repository-local home/XDG/netrc boundary. Later lint, direct tests, property tests, static analysis, and `check` runs use those repository-local paths and do not bootstrap a missing cache. Both runners construct allowlisted environments and do not consume wallet, private-key, API-key, RPC, or cloud credentials.

Coverage includes strict TypeScript, Solidity `0.8.30` compilation targeting Shanghai, official GenVM linting, 24 official direct-runner cases, the ordinary Node suite, and four fixed-seed generated-input contract campaigns. The adapter properties exercise real 3-of-5 signing, independently generated authorized/outsider mixtures, quorum-length duplicate shares, malformed data appended to an otherwise valid quorum, ordering, domain binding, replay, expiry, and atomic target failure; the OApp properties exercise exact `PacketSent` decoding, peer/target/value validation, GUID and authorization replay, rollback, and outbound binding. Pinned Slither `0.11.5` analyzes both production Solidity targets with native solc and a closed exact-fingerprint review policy; ignored findings are shown, and the current production-source result is High `0`, Medium `0`, reviewed Low `1`, and reviewed Informational `6`. The runner separately reports fully validated dependency-only and mixed-result counts instead of silently suppressing them. It also covers fail-closed semantic behavior, cross-language request binding, dashboard no-simulation/no-secret rules, wallet quote/send/receipt behavior, exact-schema same-tab locator restoration, live runtime observation, lease-loss fail closure, state-machine and recovery invariants, GenLayer status/finality, exact-block two-provider pathway pinning, rejection of unsafe inherited ULN configuration, canonical ULN302 intent, cryptographically validated DVN and recovery quorums, timelocks, runtime fencing, hash-chained recovery receipts, crash/expiry invariants, and real local-EVM allow/deny/restart/ambiguous-broadcast lifecycles. Contract fixtures start isolated loopback-only Hardhat `3.10.0` EDR servers on operating-system-selected ports and use unlocked ephemeral test identities; they do not load repository keys. Evidence digests supplied to policy consensus are SHA-256 over the exact UTF-8 rendered evidence text. Production DVN signers and recovery operators are separate five-member groups; each targets 3-of-5 and should run in isolated operator-controlled custody. Current interface/readiness evidence is in [`docs/research/2026-08-02-layerzero-interface-conformance-audit.md`](docs/research/2026-08-02-layerzero-interface-conformance-audit.md); original property seeds and assurance limits remain in the dated [`docs/research/2026-07-29-contract-assurance-audit.md`](docs/research/2026-07-29-contract-assurance-audit.md).

The signer transport tests additionally use real loopback TLS 1.3 sockets and runtime-generated, untracked certificates. The server requires a trusted client certificate before strict `POST /v2/sign` framing, caps request bodies at 32,768 bytes and handler responses at 16,384 bytes, derives the coordinator pin from the live socket, and only then invokes application authorization, replay, finality and key gates. The client verifies the signer CA, logical DNS hostname, SNI and live SPKI pin, uses no redirects/retries/decompression/pooling, and applies one bounded 100–30,000 ms end-to-end timeout. Certificate/key/CA bytes are constructor capabilities; production source does not load their paths or secrets from environment variables or command-line arguments.

### GenLayer direct-mode walkthrough

After setup, run the two layers independently:

```bash
npm run lint:ic
npm run test:ic:direct
```

The Python cases in [`intelligent-contract/tests`](intelligent-contract/tests) execute `SentinelPolicy`, its structured GUID record, immutable request binding, evidence-digest gate, semantic fail closure, and captured validator path. Direct mode uses controlled web and LLM results. A test-only comparator hook works around a missing `EqComparative` host-call implementation in `genlayer-test==0.29.2`; it proves controlled re-execution behavior, not the real semantic comparator. This is not Studio, Bradbury, independent validators, live GenLayer finality, or a DVN signature. Exact versions, commands, cache behavior, evidence, and remaining gates are in [`docs/research/2026-07-28-genlayer-direct-mode-audit.md`](docs/research/2026-07-28-genlayer-direct-mode-audit.md).

Runtime values belong in a private Sentinel-only JSON manifest shaped like `config/sentinel-runtime.example.json`; the checked-in example is deliberately non-deployable. Run `npm run preflight -- /absolute/path/to/sentinel-runtime.json` to validate it and print a redacted summary. The manifest requires exactly five sorted recovery-operator addresses, quorum three, a delay of at least 900 seconds, a lifetime no longer than 86,400 seconds, and no identity overlap with the five DVN signers. Preflight validates structure and fail-closed constraints only—it does not prove addresses, RPC reachability, operator independence, funding or protocol compatibility.

`composeRuntime(config, capabilities, dashboardRoot)` is the programmatic runtime boundary. Capabilities must inject the account-aware GenLayer contract client, exactly five signer services, a destination submitter, source and destination RPC access, and an explicit presentation mode. Sentinel itself constructs the read-only GenLayer status client and never loads raw account or signer keys. Startup restores durable jobs and signing intents, reconciles already-collected quorum without calling signers again, binds HTTP, then claims a durable runtime lease before scheduling serialized ticks. Each tick heartbeats the lease, ingests packets, requires canonical receipt plus historical source-path verification before GenLayer submission, polls semantic finality, plans/signs eligible deliveries and submits or confirms destination work. Shutdown drains active work, closes HTTP, cleanly releases the lease, then closes stores. A stale heartbeat is not permission for the recovery CLI. `runtime.maxIngestionAttempts` is mandatory; the example value `3` is a test value, not production tuning.

`GET /api/runtime-status` exposes a versioned allowlisted snapshot from that same live process: `STARTING`, `RUNNING`, `STOPPING`, or `OWNERSHIP_LOST`; lease relationship; current work phase; bounded last-tick outcome; and sanitized timestamps. It is self-observation, not independent monitoring. An unreachable endpoint means only unavailable. Heartbeat age or `OWNERSHIP_LOST` never establishes recovery permission; offline recovery must still prove a released runtime lease and satisfy deterministic re-verification, timelock, and 3-of-5 recovery approval.

## Offline operator recovery

Recovery is deliberately absent from the browser and HTTP API. Stop the coordinator and confirm its clean shutdown before preparing or applying anything. Preparation repeats current state and deterministic chain observations but writes nothing:

```bash
npm run recovery:prepare -- ingestion --manifest /absolute/runtime.json --transaction 0xSOURCE_TX_HASH
npm run recovery:prepare -- destination --manifest /absolute/runtime.json --guid 0xPACKET_GUID --transaction 0xMINED_DESTINATION_TX_HASH
```

Each of three independent recovery operators reconstructs the exported EIP-712 domain and `RecoveryProposal` with `recoveryTypedData`, verifies the deployment digest, subject, failure state, precondition digest, candidate hash, delay and expiry, then signs through its own reviewed offline/HSM workflow. Sentinel intentionally ships no key-loading signing command. Combine exactly three sorted `{address, signature}` approvals with the unchanged proposal in one bundle, wait until `executeAfter`, and apply:

```bash
npm run recovery:apply -- --manifest /absolute/runtime.json --bundle /absolute/detached-bundle.json
```

Apply revalidates quorum, timelock, deployment, current state and chain evidence, then requires exclusive recovery ownership while the runtime lease is explicitly released. It writes one atomic hash-chained receipt and returns the same receipt on replay. Archive the proposal, independent operator attestations and returned receipt outside the coordinator database; the dashboard exposes only sanitized receipt metadata. See [`docs/OPERATIONS.md`](docs/OPERATIONS.md) for crash ordering and failure handling.

## Deployment outline (not executed)

1. Resolve every item in `docs/UNKNOWNS.md` that affects the slice and re-audit official chain pages.
2. Revalidate the pinned LayerZero packages and the separately approved GenLayer account-aware adapter; rerun the bounded assurance gate and obtain an independent audit.
3. Deploy the OApps and adapters on the two testnets with separate deployment credentials.
4. Deploy the GenLayer IC and validate the exact finalized-state read path.
5. Configure trusted peers and Sentinel as **additional/optional** beside independent DVNs; verify configuration from chain state.
6. Bring up isolated signers and coordinator monitoring; run rejection, reorg, RPC disagreement and replay drills.

No readiness bundle, deployment, funds, cloud resource, GitHub publication or external message is authorized by this repository.

## Monitoring and recovery

Alert on stuck stage age, repeated ingestion failure, any dead-letter entry, expired `SIGNING`, `RECOVERY_REQUIRED` or `FAILED` delivery, runtime `DEGRADED`, `STOPPING`, or `OWNERSHIP_LOST`, runtime-lease conflict, recovery preparation/application failure, audit-chain failure, destination-path drift, RPC disagreement, reorg, evidence staleness, GenLayer undetermined/appeal state, signer divergence, quorum latency, adapter submission failure and destination execution failure. Destination delivery persists `ATTEMPTING` before broadcasting; a crash without a durable transaction hash requires account/chain reconciliation and is never automatically rebroadcast. The browser also never retries `eth_sendTransaction`; an unavailable receipt preserves the transaction hash for reconciliation. A successful production transaction advances to executed only after two providers agree on receipt/block/event bindings, confirmation depth and adapter `used(digest)`. The browser exposes no recovery, signer, or destination control. Pause intake/signers on integrity alerts. Remove the optional DVN via OApp governance if availability is affected. Rotate compromised signers through an independently reviewed adapter migration. Recovery rotation requires a reviewed manifest ceremony; partial council rotation alone does not change the deployment digest, so immediate invalidation requires rotating all five identities or a new deployment domain. Do not overwrite decisions or pretend executed actions are reversible.

## Limitations

Gasolina's API reference shows an extra-context `{ "valid": boolean }` response, while its implementation guide requires a bare JSON boolean. The guide requires authenticated ingress and describes Essence/LayerZero deployment and submission roles, but neither source specifies pending semantics or retry cadence/backoff while GenLayer finality is unavailable. Sentinel therefore keeps async finality in its coordinator and claims no native Gasolina integration. Test source/destination confirmation, signature-expiry and ingestion-attempt values are placeholders. The 2026-08-02 official-source recheck verified both chains' current EndpointV2, ULN302, Executor and Dead-DVN metadata; it did **not** resolve a deployed OApp pathway, choose independent DVNs, validate a deployed pathway, prove RPC-operator independence, or approve confirmation depths. Exact-block reads are multiple calls bound to an agreed block hash, not atomic state proofs. The local EDR proof labels are not independent-provider evidence, and the local semantic result is not GenLayer consensus. The four property campaigns are bounded to 112 fixed-seed runs and their current generators; Slither is detector-based analysis with seven exact reviewed findings. Neither is formal verification or an external audit. The direct GenLayer status reader and finalized-state adapter remain fixture-tested only. The repository now has an **official-RPC receipt transport adapter** for documented status and receipt reads, but it handles only finalized status, recipient binding and raw GenVM call data. It is not a live finality-reader approval: the signer transaction-witness reader still needs a reviewed raw-call-data codec, an authoritative latest-final policy-record adapter, reviewed independent endpoints, a deployed policy contract and isolated signer operators. Direct-mode execution now passes, but it uses mocked web/LLM results and a controlled equality hook for the direct runner's missing comparative host call; Studio/Bradbury, the real semantic comparator, independent validators, live renderer stability, live finality and model diversity remain unproven. The signer protocol, replay store, independent finality attestor, native mTLS transport/daemon, recovery workflow and production destination verifier are tested local boundaries, not deployed custody, production certificate lifecycle, HSM policy or isolated infrastructure. The transaction-witness reader is injected and has no approved official live GenLayer SDK/RPC implementation yet. There is no public signer listener, production CA ownership, rotation/revocation/OCSP ceremony, rate-limited ingress, five-operator deployment or DDoS claim. The recovery council is off-chain: there is no on-chain governor, live independent operator ceremony, HSM integration or public proof service. A local hash chain detects mutation only when its head is externally checkpointed; a privileged database attacker can otherwise truncate or recompute local history. SQLite state is single-node rather than HA consensus storage. The runtime panel is a same-process self-report, not external monitoring, process-liveness proof, failover, or recovery authorization. Ambiguous source or destination submissions require reconciliation and are never automatically resent. No production nonce manager, replacement policy, live submitter, deployed address, public URL or live recovery claim is provided. `MockEndpointV2` is behavioral test code, not LayerZero protocol code. The action workspace is enabled only by the local capability and cannot control recovery, signing, policy or destination submission.

## Primary references

[LayerZero DVN overview](https://docs.layerzero.network/v2/workers/off-chain/dvn-overview), [DVN technical reference](https://docs.layerzero.network/v2/workers/off-chain/dvn-technical-reference), [Gasolina API](https://docs.layerzero.network/v2/workers/off-chain/gasolina-api-reference), [Gasolina implementation](https://docs.layerzero.network/v2/workers/off-chain/gasolina-implementation), [production DVN configuration](https://docs.layerzero.network/v2/concepts/modular-security/production-dvn-configuration), [pathway configuration](https://docs.layerzero.network/v2/get-started/create-lz-oapp/configuring-pathways), [Ethereum Sepolia deployment](https://docs.layerzero.network/v2/deployments/chains/sepolia), [Arbitrum Sepolia deployment](https://docs.layerzero.network/v2/deployments/chains/arbitrum-sepolia), [GenLayer networks](https://docs.genlayer.com/developers/networks), [GenLayer testing](https://docs.genlayer.com/api-references/genlayer-test), [GenLayer direct mode](https://docs.genlayer.com/api-references/genlayer-test/direct), [GenLayer transaction status RPC](https://docs.genlayer.com/api-references/genlayer-node/gen/gen_getTransactionStatus), [GenLayer messages/finality](https://docs.genlayer.com/developers/intelligent-contracts/features/messages), and [GenLayer non-determinism](https://docs.genlayer.com/developers/intelligent-contracts/features/non-determinism). Dated evidence and remaining gates are in [`docs/research/2026-07-28-genlayer-direct-mode-audit.md`](docs/research/2026-07-28-genlayer-direct-mode-audit.md), [`docs/research/2026-07-25-official-recheck.md`](docs/research/2026-07-25-official-recheck.md), and [`docs/research/2026-07-22-dependency-audit.md`](docs/research/2026-07-22-dependency-audit.md).

The current LayerZero interface, Gasolina, deployment-metadata, and GenLayer finality recheck is [`docs/research/2026-08-02-layerzero-interface-conformance-audit.md`](docs/research/2026-08-02-layerzero-interface-conformance-audit.md).
