# Demo and submission plan

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

### Denied path

Restart the isolated demo or use a fresh run, enter `not-authorized`, and submit. The transaction uses the same authorization ID, target, zero value, selector, and options; only the `record(bytes32)` argument changes. The real packet is mined, but the semantic fixture finalizes `DENY`. The job reaches `REJECTED`, with no signer calls, outbox record, adapter submission, or destination execution.

### Recovery proof

The automated E2E restarts the coordinator, dashboard server, four coordinator stores, and the local executor's attempt-store connection after source mining—but before any executor attempt—while leaving the EDR chain running. The listener ingests the original packet after restart, and the test-only provider observes exactly one wallet `eth_sendTransaction`.

A separate recovery test records an ambiguous executor incident, closes and reopens the real SQLite store, proves that the GUID cannot be reserved for a second broadcast, and then proves incident resolution is durable. A confirmer-level test uses that reservation contract across two confirmer instances and observes one destination send. The app exposes the execution incident through `/api/deliveries`; it clears only after Sentinel observes the exact executed GUID and target mutation. These tests are deliberately described separately rather than pretending the post-mining E2E restarts after an ambiguous destination broadcast.

## Exact trust labels

Real local behavior:

- wallet account/chain/owner checks, fee quote, confirmation, source signature, transaction, receipt, and `ActionSent` GUID;
- rejection of a source owner controlled by any unlocked harness account, so the harness cannot originate the claimed wallet-owned source action;
- compiled `TreasuryPolicyOApp`, `SentinelDVNAdapter`, `ActionTarget`, and mock Endpoint transactions;
- canonical PacketV1 decoding and hash binding;
- five ECDSA signatures and on-chain 3-of-5 recovery;
- adapter `Verified` event and `used(digest)` state;
- destination OApp receipt, `ActionExecuted`, replay state, and target mutation;
- durable listener, coordinator, recovery, and verification-outbox state;
- durable local executor reservation, incident presentation, database reopen, and authoritative resolution.

Fixtures:

- Hardhat EDR chain, confirmations, funding, Endpoint behavior, governance document, semantic-finality engine, packet proof origins, required DVN label, executor account, and five signer accounts;
- `LOCAL_POLICY_FIXTURE` is deterministic test logic, not GenLayer validator consensus;
- `LOCAL_EDR_FIXTURE_PACKET` and `LOCAL_EDR_FIXTURE_RECEIPT` are two distinct checks over one local EDR, not independently operated RPC providers.

Unavailable:

- live app URL, testnet contracts, live GenLayer request, independent DVNs/providers, five isolated operators, production custody, monitoring, audit, and mainnet support.

## Public demo gate

A public demo requires explicit approval for deployment and funding, re-verification of official addresses and pathway support, approved GenLayer finality consumption, independent source/destination RPCs, independent LayerZero DVNs, account providers, isolated signer processes, monitoring, and explorer evidence. Sentinel must remain an additional/optional verifier rather than the sole production verifier.

The future public walkthrough should publish one authoritative governance authorization; send matching and mismatching treasury actions; show both source transactions in explorers; follow the exact GUID through deterministic checks and live GenLayer finality; show three independently operated signer identities; show LayerZero verification and OApp execution only for the match; and demonstrate replay rejection. Until those facts exist, the README live URL remains `none`.

## Video and submission

Video plan (4 minutes):

- 0:00 — the trust problem: transport proves a message was emitted, not that governance authorized its meaning;
- 0:35 — architecture and deterministic-versus-semantic boundary;
- 1:05 — wallet-originated approved local action and exact GUID;
- 2:10 — changed argument finalized as denial before signing;
- 2:55 — real 3-of-5 adapter verification and destination OApp execution;
- 3:25 — fixture labels, optional-DVN posture, limitations, and design-partner ask.

Every screen must distinguish live, local-test, fixture, and unavailable data.

Submission line: “LayerZero can prove that a message was sent; Sentinel adds a decentralized answer to whether this high-value action was actually authorized—without pretending semantic consensus replaces cryptographic packet verification.”

The partner ask is narrow: one treasury/governance OApp willing to supply an authoritative authorization source and test Sentinel as an additional optional verifier beside independent LayerZero DVNs.
