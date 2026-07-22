# Demo and submission plan

## What can be demonstrated now

The repository has a complete local backend demo, not a public or live-chain demo. `npm run test:e2e` deploys the real Sentinel adapter bytecode to an isolated Hardhat EDR chain, builds one canonical LayerZero PacketV1 intent, obtains a 3-of-5 quorum from five ephemeral ECDSA signer services, submits the exact adapter call, and confirms the receipt, event and replay flag through independent RPC observations. Its denial case proves that a finalized `DENY` produces no signatures, outbox row or destination transaction. These identities are test fixtures, not five independent operators.

The operations app is real and read-only. When served by the composed runtime it calls the same-origin health/jobs/dead-letter/delivery APIs and labels itself `LOCAL TEST` or `EXTERNAL INJECTED`; it never creates successful-looking fallback packets. A controlled local walkthrough should show `DETECTED → CONFIRMING → POLICY_PENDING → POLICY_FINAL → SIGNING → READY → SUBMITTED → EXECUTED`, then show the denial path stopping before signing. Path drift, RPC disagreement and ambiguous submission should be shown as explicit blocked/recovery states.

## Public demo gate

The public demo must use a user-approved testnet deployment and approved account/signing providers. Walkthrough: publish a governance authorization; send one matching and one mismatching treasury action; show both source transactions in explorers; follow the matching GUID through independent confirmations, GenLayer pending/finalized states, three distinct signer identities, LayerZero verification and OApp execution; show the mismatch ending in finalized rejection; replay the accepted digest and show it fail. Until that deployment exists, the README live URL must remain `none` and every local screen must stay labeled as local test evidence.

## Video and submission

Video plan (4 minutes): 0:00 the trust problem in plain language; 0:35 architecture and deterministic/semantic boundary; 1:05 approved message; 2:15 rejected message; 3:00 signer isolation and optional-DVN configuration; 3:30 limitations and partner ask. Every screen must distinguish live, local-test, fixture and unavailable data.

Submission line: “LayerZero can prove that a message was sent; Sentinel adds a decentralized answer to whether this high-value action was actually authorized—without pretending semantic consensus replaces cryptographic packet verification.”

The partner ask is narrow: one treasury/governance OApp willing to supply an authoritative authorization source and test Sentinel as an additional optional verifier beside independent LayerZero DVNs.
