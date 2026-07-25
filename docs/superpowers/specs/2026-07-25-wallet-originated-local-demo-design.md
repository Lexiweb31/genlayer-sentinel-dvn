# Wallet-Originated Local Demo Design

**Status:** Approved working design

**Date:** 2026-07-25

**Scope:** Local, fixture-backed demonstration only; no testnet deployment, funding, cloud resources, credentials, or publication

## Context

GenLayer Sentinel already has a crash-safe coordinator, canonical LayerZero packet verification, finalized policy gating, cryptographically validated 3-of-5 signing, destination submission and independent confirmation, and a read-only operations dashboard. The current dashboard accurately presents coordinator state but cannot originate an OApp transaction. This leaves a material product and competition-quality gap: a user cannot initiate a real governed action from the app and then follow the exact resulting GUID through Sentinel.

This milestone adds a wallet-originated local demonstration. It must exercise real local OApp and adapter bytecode and the existing coordinator state machine. It must not represent a fixture decision as live GenLayer consensus, expose a private key, create a server-relayed transaction path, or imply that a mined source transaction has passed Sentinel policy.

## Goals

1. Let a user connect an injected EIP-1193 wallet to an isolated local EVM.
2. Quote and submit `TreasuryPolicyOApp.sendAction` directly from that wallet.
3. Extract the real GUID from the mined source receipt.
4. Correlate that GUID with the existing coordinator job, policy, signing, delivery, and execution views.
5. Demonstrate both:
   - an exact authorized action that reaches execution; and
   - a fixture-authority mismatch that reaches finalized denial and never reaches signing or destination submission.
6. Keep the same app fail-closed and read-only unless the runtime explicitly exposes the local demo capability.
7. Preserve the existing trust boundary: the browser originates only the OApp transaction; Sentinel remains responsible for deterministic verification, semantic policy state, signer quorum, and destination verification.

## Non-goals

- Live Ethereum Sepolia or Arbitrum Sepolia deployment.
- Live GenLayer Studio or testnet consensus.
- A production coordinator daemon, nonce manager, replacement policy, faucet, or custody service.
- Server-side transaction relay or browser-hosted private keys.
- Arbitrary calldata, target selection, value transfer, or general-purpose OApp composition.
- Treating the local semantic fixture as decentralized consensus.
- Adding wallet-based recovery, signer, or administrative controls.

## Considered Approaches

### 1. Capability-gated wallet-originated local demo

The browser calls the real local source OApp through an injected wallet. A local harness deploys and configures the contracts, funds the user-supplied address on the isolated chain, and runs fixture-backed policy finality through the existing coordinator interfaces.

This is the selected approach because it is usable without deployment funds, proves a genuine frontend-to-contract transaction, keeps keys outside Sentinel, and can be tested end to end.

### 2. Testnet-only wallet app

The browser points directly at testnet OApps and follows live infrastructure. This is the eventual M2 direction, but it is not usable until deployment addresses, independent DVNs, GenLayer access, confirmation depths, RPCs, signers, and funding are explicitly approved.

### 3. Server-relayed demonstration

The browser asks Sentinel to send the source transaction. This is rejected because it would hide the transaction authority behind a centralized backend and would not satisfy the requirement that the frontend genuinely calls the contracts.

## Architecture

The existing dashboard becomes one Sentinel application with two bounded responsibilities:

- **Action workspace:** wallet connection, quote, wallet confirmation, source receipt, and GUID extraction.
- **Operations workspace:** the existing read-only coordinator lifecycle for the extracted or manually selected GUID.

The browser never reports deterministic verification, semantic finality, signer quorum, destination verification, or execution from local assumptions. Those states continue to come only from the coordinator APIs.

The runtime exposes a demo capability only when all local-demo dependencies were intentionally composed. Absence, malformed configuration, external injected mode, or any ambiguity disables the action workspace.

## Components

### `DemoCapability`

A public, immutable configuration value injected into the dashboard server:

```ts
export interface DemoCapability {
  mode: "LOCAL_WALLET_DEMO";
  chainId: bigint;
  chainName: string;
  rpcUrl: string;
  sourceOApp: string;
  sourceEndpoint: string;
  destinationEid: number;
  authorizedTarget: string;
  actionSelector: string;
  actionSignature: "record(bytes32)";
  approvedArgument: string;
  approvedAuthorizationId: string;
  options: string;
  payInLzToken: false;
  semanticSource: "LOCAL_POLICY_FIXTURE";
}
```

The parser validates exact addresses, hashes, selector, loopback RPC origin, local chain ID, empty or audited options, and the fixed action signature. It rejects extra fields and secret-bearing URLs. The API serializes bigint values as decimal strings.

`GET /api/demo/config` returns:

- `404` when no capability exists;
- sanitized immutable configuration when enabled; and
- no account, private key, signer endpoint, database path, deployment credential, or hidden policy material.

No browser endpoint deploys contracts, funds accounts, changes policy, submits LayerZero verification, or controls recovery.

### `WalletActionClient`

A browser-safe module owns EIP-1193 interaction. Its dependencies are injected so the behavior can be tested without a browser extension:

```ts
export interface Eip1193Provider {
  request(args: {method: string; params?: unknown[]}): Promise<unknown>;
}

export interface PreparedDemoAction {
  authorizationId: string;
  target: string;
  value: 0n;
  data: string;
}

export interface SourceSubmission {
  transactionHash: string;
  guid: string;
  blockNumber: bigint;
}
```

The client:

1. requests accounts;
2. verifies the selected account is the configured OApp owner through `owner()`;
3. verifies the active chain ID;
4. encodes only `record(bytes32)`;
5. calls `quoteAction`;
6. submits `sendAction` with the exact quoted native fee;
7. waits for a successful receipt;
8. accepts exactly one matching `ActionSent` log from the configured OApp;
9. returns the transaction hash, GUID, and source block.

The browser bundle is built from the repository-pinned `ethers` runtime dependency. No CDN, remote script, dynamic import, or inline script is allowed. The existing self-only content security policy remains in force.

### Action workspace

The workspace shows:

- explicit `LOCAL TEST · FIXTURE POLICY` labeling;
- wallet availability, account, chain, and owner checks;
- the immutable source OApp, destination EID, target, selector, zero native action value, and LayerZero fee;
- a single record-value input;
- whether that value exactly matches the fixture authorization;
- distinct quote, wallet confirmation, submitted, mined, GUID observed, policy denied, and executed states.

The workspace does not display “approved” before coordinator finality. A mined source transaction is labeled “Packet emitted; Sentinel decision pending.”

The record-value input is hashed to the `bytes32` argument. Every attempt uses the same `approvedAuthorizationId`. The approved example uses `approvedArgument`; any other value still emits a valid OApp packet to the same authorized target and authorization ID, then is denied by the semantic fixture because its calldata does not match the authoritative record. This proves the semantic gate checks meaning rather than merely recognizing an authorization identifier.

### `LocalDemoHarness`

The harness is an explicitly local executable, not the production daemon. It:

1. requires `--owner 0x...`;
2. binds the EVM, coordinator, and app to loopback interfaces;
3. starts an isolated Hardhat EDR chain with chain ID `31337`;
4. funds the supplied owner address using local test RPC controls;
5. deploys two mock endpoints, two real `TreasuryPolicyOApp` contracts, the real `SentinelDVNAdapter`, and the focused action target;
6. configures peers, authorized target, optional Sentinel DVN role, five ephemeral signer identities, and 3-of-5 quorum;
7. transfers source OApp ownership to the supplied wallet only after configuration;
8. composes the existing listener, coordinator, planner, destination worker, status API, and dashboard;
9. uses a local authoritative governance fixture and an explicitly labeled semantic-finality fixture;
10. prints only public addresses, loopback URLs, presentation mode, and shutdown instructions.

Ephemeral signer keys live only in harness process memory. They are never serialized, returned by an API, logged, or bundled into the app. The harness does not accept a wallet private key.

### Local policy fixture

The fixture implements the existing policy/finality interfaces. It binds decisions to the canonical GUID, packet digest, evidence digest, authorization ID, target, zero value, selector, argument, validity window, and policy version.

- Exact authoritative action: `FINALIZED ALLOW`.
- Any semantic mismatch: `FINALIZED DENY`.
- Malformed, stale, or inconsistently bound evidence: fail closed without a signable result.

The fixture creates real durable coordinator state but is presented everywhere as `LOCAL_POLICY_FIXTURE`, never as GenLayer validator consensus.

## Data Flow

1. Operator starts the local harness with a wallet address.
2. Harness configures the local chain and starts the same-origin app.
3. Browser fetches health and demo capability.
4. User connects the injected wallet.
5. Client verifies chain and on-chain OApp ownership.
6. User enters the governed record value.
7. Client quotes the action with `eth_call`.
8. Wallet submits the source OApp transaction.
9. Client waits for a successful receipt and extracts the unique `ActionSent` GUID.
10. The action workspace selects that GUID and polls the existing coordinator APIs.
11. Listener pairs the real local `PacketSent` and `DVNFeePaid` evidence.
12. Deterministic verification binds packet identity and confirmations.
13. Local semantic fixture finalizes allow or deny against authoritative fixture evidence.
14. Allow follows existing durable signing, 3-of-5 quorum, path recheck, adapter submission, independent destination confirmation, and OApp execution.
15. Deny reaches `REJECTED`; no signing intent, signature request, outbox record, or destination transaction is created.

## Browser State Machine

```text
DISABLED
  -> WALLET_REQUIRED
  -> WRONG_CHAIN | WRONG_OWNER | READY
READY
  -> QUOTING
  -> QUOTE_FAILED | QUOTED
QUOTED
  -> WALLET_CONFIRMATION
  -> USER_REJECTED | SUBMITTED
SUBMITTED
  -> SOURCE_REVERTED | MINED
MINED
  -> GUID_INVALID | GUID_OBSERVED
GUID_OBSERVED
  -> COORDINATOR_PENDING
  -> POLICY_REJECTED | SENTINEL_EXECUTED | SENTINEL_INCIDENT
```

Only the coordinator can cause the last three terminal presentation states.

## Error Handling

Errors are stable, allowlisted presentation codes with sanitized messages:

- `DEMO_DISABLED`
- `WALLET_UNAVAILABLE`
- `ACCOUNT_UNAVAILABLE`
- `WRONG_CHAIN`
- `WRONG_OWNER`
- `CONFIG_INVALID`
- `QUOTE_REVERTED`
- `INSUFFICIENT_LOCAL_FUNDS`
- `USER_REJECTED`
- `SOURCE_REVERTED`
- `SOURCE_RECEIPT_UNAVAILABLE`
- `ACTION_EVENT_MISSING`
- `ACTION_EVENT_AMBIGUOUS`
- `COORDINATOR_UNAVAILABLE`
- `COORDINATOR_PENDING`
- `POLICY_REJECTED`
- `SENTINEL_INCIDENT`

Provider, RPC, revert, and coordinator response bodies are not copied into user-visible messages. The browser preserves the transaction hash when available and never retries `eth_sendTransaction` automatically.

Account or chain changes invalidate any quote and require a fresh ownership check. Page reload may restore a transaction hash or GUID only from non-secret session storage after validating its canonical shape and matching configured chain/OApp. No stage is inferred from restored browser data.

## Security Boundaries

- Wallet keys and signing remain entirely inside the injected provider.
- The browser cannot request signer shares or destination submission.
- Demo configuration is public and immutable for the process lifetime.
- Only the configured OApp, target, function signature, destination EID, zero action value, options, and fee shape are encoded.
- Frontend restrictions are usability guardrails, not policy authority; the OApp, deterministic verifier, semantic fixture, signer services, and adapter independently validate their own inputs.
- The local RPC URL must resolve to a loopback host and chain ID `31337`.
- The app never asks users to enter a private key or seed phrase.
- Existing CSP, no-store, MIME, frame, referrer, and permissions headers remain enforced.
- External injected and future testnet modes default to no demo capability until a separate design explicitly enables them.

## Testing Strategy

### Unit tests

- Parse and sanitize valid demo capability.
- Reject non-loopback RPC, unexpected chain, malformed addresses/hashes, changed selector/signature, nonzero value, secret-bearing URL, and extra fields.
- Encode the exact action and quote call.
- Reject wrong chain, account, and on-chain owner.
- Preserve distinct user rejection, quote revert, source revert, missing event, and ambiguous event states.
- Extract one canonical GUID only from the configured OApp receipt.
- Invalidate quotes on account or chain change.
- Map delivery and policy states without invented success.

### API and app tests

- `/api/demo/config` is absent when disabled and sanitized when enabled.
- Non-GET methods remain rejected.
- Static assets remain allowlisted.
- CSP allows only same-origin assets and connections.
- The send workspace stays disabled without capability or wallet.
- App copy labels fixture semantic decisions and local-chain funding honestly.
- No simulated jobs, private keys, seed phrases, test signer secrets, remote scripts, or CDN references appear.

### Local-EVM integration tests

- Deploy source OApp owned by an ephemeral wallet signer.
- Quote and send through the wallet-client abstraction.
- Verify the real source receipt, `ActionSent`, `PacketSent`, fee event, GUID, payload, and sender.
- Prove changed account, wrong chain, unauthorized target, and reverted source transaction fail closed.

### End-to-end tests

- Approved record value produces a real source transaction and exact GUID, then reaches finalized fixture allow, durable 3-of-5 quorum, confirmed adapter delivery, and OApp execution.
- Altered record value produces a real source transaction and exact GUID, then reaches finalized fixture deny with zero signer calls and no outbox/destination transaction.
- App/API state follows the exact GUID throughout both paths.
- Restart after source mining restores coordinator state without resending the wallet transaction.

## Acceptance Criteria

1. A user-supplied injected wallet is the on-chain sender and source OApp owner.
2. No wallet private key is accepted, persisted, logged, or served.
3. Quote and send target real local OApp bytecode.
4. The displayed GUID comes from the configured OApp’s mined `ActionSent` event.
5. The same GUID appears in real coordinator state.
6. Exact authorized action executes through the existing 3-of-5 and destination pipeline.
7. Semantically altered action is rejected before signing.
8. The app clearly labels the EVM, evidence authority, and semantic engine as local fixtures.
9. Disabled/external mode remains read-only.
10. The full existing suite plus new unit, integration, security, and end-to-end tests passes.

## Documentation Changes

The implementation updates the README, demo walkthrough, operations guide, security status, and milestones to state:

- how to start the harness with a wallet address;
- how to add/switch the isolated local chain;
- what is real bytecode and real transaction state;
- what remains fixture-backed;
- how to demonstrate allow and deny;
- why source mining does not equal Sentinel approval;
- why the demo is not a testnet deployment or mainnet-readiness claim; and
- that live GenLayer, real independent signers, production transport security, and user-approved LayerZero deployment remain future gates.
