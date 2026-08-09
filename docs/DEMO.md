# Demo and submission plan

## Deployed web dashboard

```text
Web dashboard: DEPLOYED — https://genlayer-sentinel-dvn.damilexi2005.chatgpt.site (owner-private; sign-in required)
Pathway contracts: NOT DEPLOYED BY THIS MILESTONE
LayerZero DVN onboarding: NOT COMPLETED
GenLayer live finality: NOT CLAIMED
Production readiness: NO
```

The deployed page is a static, self-origin presentation and local pathway-evidence inspector. It does not host the coordinator API, signer services, GenLayer account integration, or testnet contracts. Before a local artifact is selected it remains `NOT OBSERVED`; hosted coordinator-backed sections fail closed as unavailable and never substitute fixture data.

## Runnable local wallet demo

The repository now ships a complete local app demonstration. It is not a public deployment and does not contact Ethereum Sepolia, Arbitrum Sepolia, GenLayer, cloud infrastructure, or a faucet.

```bash
npm install --legacy-peer-deps
npm run build
npm run demo:local -- --owner 0xYOUR_INJECTED_WALLET_ADDRESS
```

The command prints a loopback app URL and RPC URL, chain ID `31337`, the source OApp, action target, and approved argument. Add that RPC to the injected wallet, select chain `31337`, open the app, and connect the same public address supplied on the command line. Sentinel does not accept a wallet signing secret; the injected provider owns account access and confirmation.

### Approved path

1. Leave the record value as `approved`.
2. Quote the LayerZero fee through `TreasuryPolicyOApp.quoteAction`.
3. Confirm the one source transaction in the wallet.
4. Check that the app says `Packet emitted; Sentinel decision pending`, not approved.
5. Follow the mined `ActionSent` GUID through packet/receipt confirmation, `LOCAL_POLICY_FIXTURE` finality, 3-of-5 signer quorum, adapter verification, and destination OApp execution.
6. Confirm the target recorded the approved `bytes32` argument.

### Same-tab reload

Once the mined receipt contains exactly one bound `ActionSent` event, the browser saves a versioned public locator containing only chain ID, source OApp, source Endpoint, destination EID, transaction hash, and GUID. Reloading the same tab compares that locator with the strictly parsed current demo capability:

- an exact match restores `COORDINATOR PENDING`, reselects the GUID, and resumes read-only job observation without touching the wallet;
- a job `404` means the matching coordinator has not ingested the GUID yet and remains retryable;
- a capability outage retains and displays the public locator as `RESTORED UNAVAILABLE` but does not poll;
- a validated different harness clears the obsolete locator and exposes a fresh action workspace.

The locator is browser convenience state, not packet inclusion, policy finality, signer quorum, destination verification, rejection, or execution evidence. It contains no account, fee, calldata, authorization evidence, signer data, RPC credential, or secret. Restoration never requests accounts, reconnects the wallet, quotes, signs, submits, or resends the source action. Closing the tab ends the intended persistence lifetime.

### Denied path

Restart the isolated demo or use a fresh run, enter `not-authorized`, and submit. The transaction uses the same authorization ID, target, zero value, selector, and options; only the `record(bytes32)` argument changes. The real packet is mined, but the semantic fixture finalizes `DENY`. The job reaches `REJECTED`, with no signer calls, outbox record, adapter submission, or destination execution.

### Recovery proof

The source-restart E2E still restarts the coordinator, dashboard server, four coordinator stores, and the local executor's attempt-store connection after source mining—but before any executor attempt—while leaving the EDR chain running. The listener ingests the original packet after restart, and the test-only provider observes exactly one wallet `eth_sendTransaction`.

The new operator-recovery E2E exercises a different, explicitly adversarial destination path. It deploys the real local OApps, adapter, verification target and action target; obtains one real 3-of-5 DVN authorization; broadcasts the valid adapter transaction once; mines it; then forces the submitter to throw so the outbox durably records `RECOVERY_REQUIRED / SUBMISSION_AMBIGUOUS` without a trusted returned hash. A separately generated five-wallet recovery council prepares a deployment-bound EIP-712 proposal for the discovered hash, supplies exactly three signatures, advances the injected clock by the 900-second minimum delay, and applies while the runtime lease is released. Apply repeats the real local adapter path, receipt, event, block, used-state and confirmation checks, writes one hash-chained receipt, and moves directly to `CONFIRMED` without calling the submitter. The ordinary destination worker then completes the real OApp action. Submission count remains one; replay returns the same receipt; audit count remains one.

A separate local-executor recovery test still records an ambiguous OApp-delivery incident, closes and reopens the real SQLite store, proves that the GUID cannot be reserved for a second broadcast, and then proves incident resolution is durable. The app exposes destination incidents through `/api/deliveries` and sanitized operator receipts through read-only `/api/recovery-actions`. These paths are described separately because adapter reconciliation and OApp-executor reconciliation have different proofs and controls.

## Read-only pathway-auditor demonstration

The separate M2 auditor is an operator tool, not part of the wallet demo and not a simulated live pathway. Start from [`examples/public-pathway-observation-manifest.template.json`](examples/public-pathway-observation-manifest.template.json). The `.invalid` hosts, `REPLACE_...` values, and `deployment:null` make that file visibly nonoperational. With no operator-supplied public inputs, the recorded live smoke is **NOT RUN — PUBLIC RPC INPUTS NOT SUPPLIED**.

After an operator supplies four credential-free public RPC URLs, completes the provider-independence review, and explicitly authorizes the public reads, run:

```bash
npm run audit:pathway -- --manifest /absolute/path/to/public-pathway-observation.json --output /absolute/path/to/new-pathway-evidence.json
```

Before deployments, the truthful expected outcome is exit `2`: the command may establish provider-agreed blocks and public protocol code, but its artifact records `AUDIT_PATHWAY_DEPLOYMENTS_MISSING` and leaves pathway configuration absent. It never substitutes local EDR data. A later complete record must contain both OApps, both adapters, four creation transaction hashes, two OApp delegates, five sorted authorized signers, and quorum three.

Open the local operations dashboard or the owner-private deployed dashboard and use **Inspect Evidence** to select the generated artifact. Selection is local and in-memory; the browser uploads and persists nothing. The panel remains `NOT OBSERVED` until a strict canonical artifact passes its integrity and semantic-consistency checks. It never combines audit evidence with coordinator packet, GenLayer, signer, destination, or execution state. The hosted dashboard URL above is a web deployment only, not pathway deployment evidence.

For a credible recorded demo, show the command, exit code, immutable file hash, artifact truth label, two transport-agreement fields, separate operator-independence fields, pinned blocks, code identities, configuration digest or blockers, and dashboard rejection of one tampered copy. Do not call a blocked artifact validated, call transport diversity decentralization, or present `LOCAL_POLICY_FIXTURE` as GenLayer consensus.

## Exact trust labels

Real local behavior:

- wallet account/chain/owner checks, fee quote, confirmation, source signature, transaction, receipt, and `ActionSent` GUID;
- rejection of a source owner controlled by any unlocked harness account, so the harness cannot originate the claimed wallet-owned source action;
- compiled `TreasuryPolicyOApp`, `SentinelDVNAdapter`, `ActionTarget`, and mock Endpoint transactions;
- canonical PacketV1 decoding and hash binding;
- five ECDSA DVN identities and on-chain 3-of-5 adapter authorization;
- five separate recovery identities, three real EIP-712 approvals, an enforced test clock timelock, runtime fencing and one hash-chained receipt;
- adapter `Verified` event and `used(digest)` state;
- destination OApp receipt, `ActionExecuted`, replay state, and target mutation;
- durable listener, coordinator, recovery, and verification-outbox state;
- durable local executor reservation, incident presentation, database reopen, and authoritative resolution.

Fixtures:

- Hardhat EDR chain, confirmations, funding, Endpoint behavior, governance document, semantic-finality engine, packet proof origins, required DVN label, executor account, and five signer accounts;
- `LOCAL_POLICY_FIXTURE` is deterministic test logic, not GenLayer validator consensus;
- `LOCAL_EDR_FIXTURE_PACKET` and `LOCAL_EDR_FIXTURE_RECEIPT` are two distinct checks over one local EDR, not independently operated RPC providers.

Unavailable:

- public unauthenticated app access, testnet contracts, live GenLayer request, independent DVNs/providers, five isolated DVN signer operators, five isolated recovery operators, on-chain recovery governance, HSM custody, external audit anchoring, monitoring, audit, and mainnet support. The owner-private static dashboard exists, but it supplies none of these operational capabilities.

## Public demo gate

A public end-to-end pathway demo requires explicit approval for contract deployment and funding, re-verification of official addresses and pathway support, approved GenLayer finality consumption, independent source/destination RPCs, independent LayerZero DVNs, account providers, isolated signer processes, monitoring, and explorer evidence. Sentinel must remain an additional/optional verifier rather than the sole production verifier. The owner-private static dashboard URL does not satisfy this gate.

The future public walkthrough should publish one authoritative governance authorization; send matching and mismatching treasury actions; show both source transactions in explorers; follow the exact GUID through deterministic checks and live GenLayer finality; show three independently operated signer identities; show LayerZero verification and OApp execution only for the match; and demonstrate replay rejection. Until those facts exist, the deployed URL must be described only as the owner-private static dashboard—not as a live Sentinel pathway.

## Video and submission

Video plan (4 minutes):

- 0:00 — the trust problem: transport proves a message was emitted, not that governance authorized its meaning;
- 0:35 — architecture and deterministic-versus-semantic boundary;
- 1:05 — wallet-originated approved local action and exact GUID;
- 2:10 — changed argument finalized as denial before signing;
- 2:55 — real 3-of-5 adapter verification and destination OApp execution;
- 3:20 — one mined ambiguous adapter transaction recovered without rebroadcast through timelocked 3-of-5 evidence;
- 3:45 — fixture labels, optional-DVN posture, limitations, and design-partner ask.

Every screen must distinguish live, local-test, fixture, and unavailable data.

Submission line: “LayerZero can prove that a message was sent; Sentinel adds a decentralized answer to whether this high-value action was actually authorized—without pretending semantic consensus replaces cryptographic packet verification.”

The partner ask is narrow: one treasury/governance OApp willing to supply an authoritative authorization source and test Sentinel as an additional optional verifier beside independent LayerZero DVNs.
