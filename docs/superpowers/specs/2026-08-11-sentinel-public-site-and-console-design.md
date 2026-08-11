# Sentinel Public Site And Console Design

## Decision

Split the current mixed dashboard into two routes:

- `/` is the public Sentinel landing page.
- `/console` is the operational Sentinel console.

The split is a product boundary, not a cosmetic route change. The public site earns trust and explains the product. The console helps an operator inspect a particular cross-chain message or governed action.

## Audience And Outcome

The public site serves prospective treasury, governance, and OApp teams. Within seconds, it must explain that Sentinel is a policy firewall: a cross-chain action cannot proceed until independent packet evidence, policy finality, a signer quorum, and the destination gate agree.

The console serves an operator who needs to answer one question: what is the state of this message, and what evidence is still missing? Its primary job is read-only inspection until a deployed pathway enables transaction proposals.

## Route `/`: Public Site

### Hero

The hero uses the line `Proof before value moves.` and a restrained electric-blue-on-ink visual system. It has one primary action: `Open Console`. A secondary search-style affordance may accept a packet GUID, transaction hash, or address only when the console's real lookup capability is available; otherwise it links to the console without pretending to execute a lookup.

### Proof Path

Below the hero is one horizontal proof path:

1. Source packet
2. Independent confirmations
3. Finalized policy
4. Signer quorum
5. Destination execution

Each stage uses a truthful state. The public site may describe the intended workflow but may not show invented live traffic, signer counts, approvals, deployments, or mainnet support.

### Supporting Content

Keep the page short: the product thesis, the proof path, a concise trust-model section, testnet status, and a final console CTA. Do not put the current dashboard's inspector, recovery logs, operator controls, broad metric cards, or local-demo tooling on this route.

## Route `/console`: Operator Console

### Entry

The console opens as an interoperability inbox, inspired by the direct search-and-message-list pattern used by message explorers. It offers a search field for transaction hash, packet GUID, address, and known local evidence artifact. Wallet connection and network state sit quietly in the utility bar.

### Message List

The main index presents rows rather than decorative cards. Each row includes origin, destination, message identifier, observed time, current stage, and a clear state color. Filtering is secondary to the primary message search.

### Detail Inspector

Selecting a message opens a detail view with the canonical packet identity as the main object and an ordered evidence rail:

1. Packet detection and independent RPC confirmation
2. Governance authorization match
3. GenLayer finalized decision, if independently observed
4. Isolated signer quorum
5. LayerZero destination verification and execution/rejection

The evidence rail never marks an unobserved state as passed. If coordinator data, a finality source, a deployment, or a signer is unavailable, the console must say so plainly.

### Governed Actions

`Propose action` remains unavailable until the Sepolia/Arbitrum pathway is deployed and its runtime checks are real. Before then, the console is deliberately an elegant read-only inspector. This avoids a visually polished but misleading approval flow.

## Visual System

- Base: ink black, deep blue atmospheric surfaces, graphite separators.
- Primary signal: electric blue for focus, live observation, and active traversal.
- Positive state: restrained green only for independently confirmed completion.
- Waiting state: muted amber.
- Rejection state: deep red.
- Typography: a confident grotesk for decisions and headings; monospaced type only for hashes, identifiers, timestamps, and technical state.
- Layout: broad canvas, thin grouped surfaces, generous whitespace, and rows for operational data. Avoid a persistent visual-card grid, generic crypto gradients, provider-brand imitation, fake globes, or ornamental video.

## Behavior And Error Handling

- A search without a supported source returns an explicit empty state rather than a demo packet.
- Wallet refusal, wrong network, unreachable coordinator, invalid JSON evidence, and unavailable finality data each receive an actionable, plain-language state.
- The console preserves the selected message and filter in the URL when feasible, so an operator can share an inspection state without sharing secrets.
- All client-side states distinguish local/demo fixtures from independently observed production-style evidence.

## Verification

- Route tests confirm that `/` and `/console` render their different responsibilities.
- Dashboard tests cover search empty states, state labeling, evidence ordering, and no-simulation guardrails.
- Responsive checks cover compact public hero and console table-to-detail transitions.
- Visual checks compare both routes against the agreed token system, not an external product's brand.

## Scope

This work is a UI and routing redesign. It does not deploy contracts, spend funds, create cloud resources, change LayerZero configuration, or represent the testnet prototype as production-ready.
