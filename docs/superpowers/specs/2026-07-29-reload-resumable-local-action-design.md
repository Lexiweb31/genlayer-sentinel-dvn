# Reload-Resumable Local Action Design

**Status:** Approved working design

**Date:** 2026-07-29

**Scope:** Same-tab restoration of the existing local wallet demonstration; no testnet deployment, funding, cloud resources, credentials, backend session, or publication

## Context

GenLayer Sentinel's local application can originate one real OApp action from an injected wallet and follow the resulting LayerZero GUID through deterministic verification, fixture policy finality, isolated signer quorum, destination verification, and execution or rejection. The browser currently keeps the transaction hash and GUID only in memory. Reloading the page loses that correlation even though the coordinator continues processing the same durable job.

This milestone restores the public locator for that already-submitted action after a same-tab reload. Restoration must not resend the source transaction, reconnect the wallet, infer a policy or execution stage from browser data, or make an obsolete locator appear to belong to a newly started local harness.

## Goals

1. Preserve a mined source transaction hash and canonical packet GUID across a reload in the same browser tab.
2. Bind the saved locator to the exact public local-harness capability that produced it.
3. Resume read-only coordinator polling only after the current capability matches that binding.
4. Keep the action workspace locked after restoration so the source action cannot be resent.
5. Distinguish delayed coordinator ingestion, temporarily unavailable capability, and a definitively different harness.
6. Preserve terminal execution, rejection, and incident presentation for the tab lifetime.
7. Prove through automated tests that bootstrap restoration has no wallet or transaction-submission dependency.

## Non-goals

- Cross-tab or cross-browser restoration.
- Persistent account identity, authentication, cookies, backend sessions, or server-side browser state.
- Restoring a transaction that has no successfully decoded `ActionSent` GUID.
- Recovering wallet confirmation, pre-receipt polling, a quote, input text, native fee, or account state.
- Automatically resending `eth_sendTransaction`.
- Treating browser storage as deterministic, policy, signer, destination, or execution evidence.
- Deciding that a harness was destroyed or a job expired without an authoritative server response.
- Adding a client-side reset that bypasses the existing one-action-per-harness terminal lock.

## Considered Approaches

### 1. Versioned same-tab locator with a pure bootstrap resolver

Persist a small exact-schema locator in `sessionStorage` only after the mined receipt yields one matching `ActionSent` GUID. A pure bootstrap resolver reads the locator, loads the current public capability, and returns a closed result union: fresh capability, matched resume, unavailable resume, or disabled. The browser entrypoint renders that result and starts the existing read-only polling path only for a match.

This is the selected approach. It matches the lifetime of the local demo, requires no identity system, makes the trust boundary testable, and cannot invoke the wallet because the resolver receives only storage and a read-only capability loader.

### 2. Inline restoration inside `demo-entry.ts`

Read and compare browser storage directly inside the existing DOM entrypoint. This has fewer files but leaves storage parsing, capability binding, wallet orchestration, and presentation tightly coupled. It is rejected because the most important invariant—bootstrap cannot submit or request an account—would be difficult to prove with focused tests.

### 3. Expiring `localStorage` or server-side sessions

Longer-lived browser persistence would survive tab closure, while a server session could correlate jobs centrally. Both are rejected for this milestone. They outlive the intentionally ephemeral harness, create stale-state and privacy questions, and add deletion, expiry, authentication, and recovery semantics that are not needed to solve reload loss.

## Architecture

Three boundaries implement the feature:

- `demo-session.ts` owns the exact storage schema, canonical parsing, capability comparison, and fail-safe storage operations.
- `demo-bootstrap.ts` owns startup resolution. Its dependency surface contains only a `StorageLike` value and a function that loads validated public demo configuration.
- `demo-state.ts` remains the authority for presentation transitions. It gains explicit matched-restoration and unavailable-restoration events.

`demo-entry.ts` remains responsible for DOM wiring. It invokes the bootstrap resolver at startup, constructs `WalletActionClient` only inside the existing connect-wallet click path, writes a locator after `GUID_OBSERVED`, and reuses the existing coordinator polling functions after a matched restoration.

No coordinator or status API changes are required.

## Stored Locator

The storage key is:

```text
genlayer-sentinel.local-action.v1
```

The only accepted JSON shape is:

```ts
export interface DemoSessionLocator {
  version: 1;
  chainId: "31337";
  sourceOApp: Hex;
  sourceEndpoint: Hex;
  destinationEid: number;
  transactionHash: Hex;
  guid: Hex;
}
```

The parser:

- accepts exactly these keys and no others;
- rejects input larger than 1,024 UTF-16 code units;
- rejects zero or malformed addresses and hashes;
- requires the exact local chain string `"31337"`;
- requires a positive safe destination EID;
- canonicalizes addresses and hashes to lowercase;
- removes malformed storage when removal is available; and
- treats storage access exceptions as an unavailable optional feature rather than crashing the app.

The locator contains public chain identifiers only. It never contains an account, private key, seed phrase, RPC credential, quote, fee, calldata, authorization evidence, signer information, or coordinator result.

## Harness Binding

A locator matches the current capability only when all four public harness fields are equal after canonicalization:

1. `chainId`
2. `sourceOApp`
3. `sourceEndpoint`
4. `destinationEid`

The source OApp and endpoint are newly deployed for each local harness, so a changed pair is affirmative evidence that the saved action belongs to a different harness. On a validated mismatch, the resolver removes the locator and returns the ordinary fresh-capability result.

If the capability is missing, unavailable, or invalid, the browser cannot prove a mismatch. It retains the valid locator and returns an unavailable-restoration result.

## Bootstrap Results

The resolver returns exactly one of:

```ts
type DemoBootstrapResult =
  | {kind: "FRESH"; config: PublicDemoConfig}
  | {kind: "RESUME"; config: PublicDemoConfig; locator: DemoSessionLocator}
  | {kind: "RESTORED_UNAVAILABLE"; locator: DemoSessionLocator}
  | {kind: "DISABLED"};
```

Startup behavior:

1. Read and strictly parse the locator.
2. Load and strictly parse the same-origin public demo capability.
3. If both exist and match, return `RESUME`.
4. If both exist and mismatch, remove the locator and return `FRESH`.
5. If the locator exists but capability loading fails, retain it and return `RESTORED_UNAVAILABLE`.
6. If no locator exists and capability loading fails, return `DISABLED`.
7. If no locator exists and capability loading succeeds, return `FRESH`.

The resolver has no provider, wallet client, DOM, timer, POST request, or transaction interface.

## Browser State Machine

Two explicit events are added:

```ts
{type: "ACTION_RESTORED"; transactionHash: string; guid: string}
{type: "ACTION_RESTORE_UNAVAILABLE"; transactionHash: string; guid: string}
```

`ACTION_RESTORED` is accepted from `WALLET_REQUIRED` after the matching capability has been rendered. It enters `COORDINATOR_PENDING`, preserves both identifiers, marks the state as restored, emits the existing `sentinel:guid-observed` selection event, and starts coordinator polling.

`ACTION_RESTORE_UNAVAILABLE` is accepted from `DISABLED`. It enters the new `RESTORED_UNAVAILABLE` phase, preserves both identifiers, marks the state as restored, and leaves polling stopped because the current harness identity is unknown.

All phases containing a transaction hash remain source-action locked. Coordinator stages are still the only route from `COORDINATOR_PENDING` to `POLICY_REJECTED`, `SENTINEL_EXECUTED`, or `SENTINEL_INCIDENT`.

## Data Flow

### New live action

1. Existing wallet flow quotes and submits the fixed OApp action.
2. Existing receipt parser accepts exactly one matching `ActionSent` event.
3. Reducer enters `COORDINATOR_PENDING`.
4. The browser attempts to persist the capability-bound locator.
5. Storage failure does not alter the live action or resend behavior.
6. Existing GUID selection and coordinator polling continue.

### Matching reload

1. Browser reads the saved locator.
2. Browser performs one same-origin `GET /api/demo/config`.
3. Strict configuration parsing succeeds and the harness binding matches.
4. Reducer enters restored `COORDINATOR_PENDING`.
5. All source controls remain locked without requesting wallet accounts.
6. Browser emits the GUID selection event and polls the existing read-only job and delivery endpoints.

### Delayed ingestion

When `GET /api/jobs/:guid` returns `404` after a matched restoration, the UI describes the packet as waiting for coordinator ingestion and keeps the existing retry loop. A `404` does not clear the locator and does not imply rejection, expiry, or execution.

### Unavailable capability

If capability loading fails while a valid locator exists, the UI displays the public transaction hash and GUID with `RESTORED UNAVAILABLE`. It explains that the current harness cannot be verified, retains the locator, performs no wallet call, and does not poll a possibly unrelated coordinator.

### Different harness

When a validated capability has a different chain, source OApp, endpoint, or destination EID, the browser removes the obsolete locator and presents the fresh local action workspace.

## Presentation

Restored states are explicit:

- `COORDINATOR PENDING` with a message that the public locator was restored and authoritative coordinator evidence is being loaded.
- `RESTORED UNAVAILABLE` with a message that the locator is retained but the current harness cannot be verified.
- A matched job `404` says the coordinator has not ingested the GUID yet.

The transaction hash and GUID are labeled as browser-restored public identifiers, not proof. Existing lifecycle stages retain their current evidence meanings. The app never says the wallet is connected after reload unless the user explicitly connects it again, and restored actions cannot expose quote or send controls.

## Error Handling

- Malformed, oversized, extra-field, zero-value, or wrong-version storage is removed and ignored.
- A storage getter, setter, or remover exception never prevents the dashboard from loading.
- A capability parse or network failure retains a valid locator but prevents polling.
- A definitive capability mismatch removes the locator.
- A job `404` retries as delayed ingestion.
- Other job or delivery failures keep the action locked, show temporary coordinator unavailability, and retry without resending the source transaction.
- Terminal coordinator states stay in storage until the tab browsing context ends or a later validated capability proves a harness mismatch.

## Security and Trust Boundaries

- `sessionStorage` is a convenience locator, not authoritative evidence.
- Only a successful mined `ActionSent` decode creates a locator.
- No wallet account, transaction, signing, or RPC method is available to the bootstrap resolver.
- All coordinator browser requests remain same-origin `GET`.
- The source action is never retried automatically.
- Restored identifiers cannot move the reducer directly to policy, quorum, verification, rejection, incident, or execution.
- The feature does not weaken CSP, dashboard mutation guards, configuration parsing, deterministic verification, GenLayer finality, signer quorum, or destination idempotency.

## Testing

### Session codec tests

- round-trip one canonical locator;
- lowercase mixed-case public identifiers;
- reject and remove malformed JSON, oversized input, extra keys, wrong version, zero values, malformed values, and invalid EIDs;
- tolerate unavailable or throwing storage;
- match only the exact harness binding.

### Bootstrap tests

- fresh capability without storage;
- matched restoration;
- mismatch clears and returns fresh;
- unavailable capability retains and returns unavailable restoration;
- unavailable capability without storage returns disabled;
- dependency surface performs only the supplied capability read.

### Reducer tests

- matched restoration enters `COORDINATOR_PENDING`;
- unavailable restoration enters `RESTORED_UNAVAILABLE`;
- restored identifiers lock invalidation and cannot jump to a terminal result without coordinator evidence;
- coordinator evidence advances a matched restored action through the existing terminal paths.

### Browser and guard tests

- locator is written only after GUID observation;
- restoration emits the existing GUID selection event and begins read-only polling;
- unavailable restoration does not poll;
- bundle uses `sessionStorage` and not `localStorage`;
- browser code contains no coordinator mutation and no wallet secret handling.

### Regression

Run the full repository build, unit, integration, contract, intelligent-contract direct-mode, dashboard, security, and local end-to-end checks. The feature remains a production-quality local prototype and makes no testnet or mainnet-readiness claim.

## Documentation

README and local demo documentation will explain:

- reload restoration works only in the same tab and harness;
- only public transaction and GUID identifiers are stored;
- a restored locator is not proof;
- a new harness invalidates the old locator;
- capability unavailability retains but does not poll the locator; and
- no wallet transaction is initiated during restoration.
