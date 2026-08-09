# GenLayer Sentinel Policy Firewall Experience Design

## Goal

Make GenLayer Sentinel feel like a credible cross-chain policy firewall demo before it becomes an operator workspace, without changing its trust boundaries or inventing runtime data.

## Product framing

The first viewport is a partner and investor-facing product story. It answers three questions before asking for any evidence: what Sentinel protects, what proof types it uses, and what the user can do now. The primary action remains the existing local audit-artifact chooser. It never uploads input, submits a transaction, claims a live deployment, or fabricates a packet.

## Visual direction

- Keep the cinematic full-viewport hero, Special Elite `sentinel` wordmark, Geist UI typeface, video/poster surface, 687px legibility gradient, and frosted-glass action card.
- Use an ivory canvas, near-black text, terracotta for policy language, acid-lime only for verified or deterministic-positive states, and red only for explicit failures or blockers.
- Replace generic operational density above the fold with a clear product narrative: `A policy firewall for messages that move value`, followed by a concise deterministic-versus-semantic explanation.
- Use motion only for the ambient video and existing reduced-motion-safe behaviors. No fake loading, fabricated success, animated signer counts, or simulated packet progress.

## First viewport

1. Navigation contains `How it works`, `Evidence`, and `Trust model`, plus the existing mode label and a `Load evidence` action.
2. The hero headline is product-led, while the supporting line describes independent RPC verification, finalized GenLayer policy, and threshold signer evidence as distinct stages.
3. The glass card is renamed as an evidence intake surface. Its text clearly says that it reads a local JSON audit and uploads nothing. The existing file input, button wiring, validation, and disabled inspect action are retained.
4. A compact four-part trust rail below the card presents `Packet proof`, `Policy decision`, `Signer quorum`, and `Destination check`. Each item is explanatory until real evidence is loaded; it must not display a pass state by default.
5. The boundary statement remains visible and plainly says that the prototype is unsigned, not deployed, not onboarded, and cannot submit a transaction.

## Evidence workspace

The page below the fold stays operational rather than marketing-only:

- The pathway-evidence section becomes `Evidence workspace`, retaining its closed local-file parser, digest binding, allowlisted fields, and honest blocker display.
- The local wallet demo, runtime observation, packet lifecycle, quarantined packets, delivery outbox, recovery receipts, and detailed inspector keep their existing IDs and JavaScript contracts.
- Section headers receive clearer hierarchy, better spacing, restrained status pills, and responsive card layouts. Existing runtime-unavailable, coordinator-unavailable, empty, and blocked messages remain truthful and visible.

## Trust and safety constraints

- No live GenLayer finality, LayerZero onboarding, signer independence, destination submission, deployed OApps, or mainnet readiness may be implied.
- Do not add simulated packet records, preview audit results, hard-coded verification passes, wallet credentials, private keys, or network-write controls.
- Preserve all current DOM IDs, module entry points, file-input behavior, local-only storage behavior, and no-simulation checks used by dashboard tests.
- Keep keyboard focus, mobile behavior, reduced-motion behavior, and readable contrast intact.

## Deployment compatibility follow-up

The hosted artifact must expose both the verified dashboard files and an asset layout recognized by the Sites runtime. The temporary `__sentinel-assets` diagnostic route is not product UI and must be removed after a deployed diagnostic confirms that the runtime can serve the packaged index and assets.

## Acceptance criteria

1. The first viewport reads as a policy-firewall product, not a generic crypto dashboard.
2. `Load evidence` and the card upload control open the existing local JSON chooser and retain the existing no-upload behavior.
3. The trust rail contains explanation-only states before evidence is loaded and maps to real evidence only after the existing parser accepts it.
4. Existing coordinator, runtime, wallet-demo, delivery, recovery, and evidence tests remain green.
5. The hosted root loads the dashboard HTML and the diagnostic route is removed from the final deployment.
