# Sentinel Operations-First Hero UI Design

**Date:** 2026-08-09  
**Status:** Approved design direction  
**Product:** GenLayer Sentinel  
**Scope:** Dashboard visual shell and local evidence-entry experience

## Outcome

Give GenLayer Sentinel the polished full-viewport composition of the supplied Wandor reference without copying its travel product, branding, wording, or fake interactions. The new first screen uses an ambient cross-chain background, a white-to-transparent readability gradient, centered navigation, a strong policy-firewall headline, and a frosted evidence card. Every action remains connected to Sentinel's existing operational data boundaries.

The page must still communicate the prototype's actual state. It must never imply that a pathway is deployed, onboarded, live, approved for production, or validated by GenLayer merely because the interface looks complete.

## Architecture Decision

Keep the existing tested static dashboard architecture and its JavaScript modules. Do not migrate the application to React, Vite, Tailwind, or a second frontend runtime solely to reproduce the reference layout. The user selected the reference as a visual structure, and preserving the current dashboard avoids breaking its coordinator polling, packet timeline, local demo path, and no-simulation guardrails.

The implementation will use semantic HTML, modular JavaScript, and the existing dashboard build. CSS will reproduce the reference's layout, typography, frosted glass, responsive behavior, and tactile interactions. This is faster and keeps the security-relevant UI boundary small.

## Visual System

- Wordmark: `sentinel`, set in Special Elite and used only for the brand wordmark.
- UI typography: Geist, weights 400, 500, 600, and 700.
- Core palette: smoked black, mineral white, graphite text, muted gray, and a restrained safety-lime accent carried forward from Sentinel's existing brand.
- Motion background: a locally bundled, license-safe abstract cross-chain network loop with a static poster fallback. It must not use the supplied Japan travel video or external hotlinking.
- Readability overlay: a 687-pixel white-to-transparent gradient above the background.
- Glass treatment: low-opacity white fill, three-pixel white border, 20-pixel backdrop blur, soft shadow, and 44-pixel radius.
- Reduced motion: users requesting reduced motion receive the poster image with the video paused.

## Page Structure

### Full-viewport hero

The first section fills at least the small viewport height. The background media sits at z-index 0, the gradient at z-index 1, and all content at z-index 2 inside a 1,360-pixel maximum-width wrapper.

### Navigation

- Left: `sentinel` wordmark.
- Center anchors: `Pathway`, `Evidence`, and `Trust Model`.
- Right action: `Load Evidence`.
- No Login control is shown because Sentinel has no honest authentication workflow in this milestone.
- On screens at or below 760 pixels, center links hide and the wordmark/action remain.

### Hero copy

- Headline: `Verify policy before messages cross chains.`
- Supporting copy: `Independent RPC checks, GenLayer policy consensus, and threshold signer evidence—before a LayerZero pathway is treated as consistent.`
- The copy must not claim production readiness or a deployed/onboarded DVN.

### Frosted evidence card

The Wandor prompt card becomes Sentinel's real local artifact boundary.

- Initial message: `Select a locally generated read-only pathway audit artifact. Nothing is uploaded.`
- Circular upload control opens a hidden file input accepting JSON only.
- Primary action: `Inspect Evidence`.
- The file is parsed locally through the closed browser audit model.
- No network upload, local storage write, or simulated result is permitted.
- Before a valid file is selected, the status remains `NOT OBSERVED` and the inspect action is unavailable.
- Invalid files produce a sanitized local error without rendering attacker-provided HTML.

### Operational sections

Below the hero, the existing operational experience remains available on the same page:

1. Pathway evidence viewer for the operator-selected local artifact.
2. Live coordinator packet timeline and inspector.
3. Deterministic checks, GenLayer decision state, signer quorum, LayerZero verification, and execution/rejection evidence.
4. Trust-model and limitation copy.

The local pathway artifact must remain visually and semantically separate from live coordinator packet data. Loading a file cannot alter or fabricate coordinator state.

## Data Flow

1. Page loads with no observed pathway artifact.
2. Existing coordinator polling independently requests live packet data from the local status API.
3. The user selects a locally generated pathway-audit JSON file.
4. The browser reads the file in memory, validates the closed schema, canonical evidence digest, truth label, and internally derived hashes.
5. Valid evidence renders into the pathway panel using `textContent` only.
6. Invalid evidence leaves the prior valid state untouched and displays a sanitized refusal.
7. Neither path writes browser storage or sends the artifact across the network.

## Error and Honest-State Rules

- Coordinator unreachable: `COORDINATOR UNAVAILABLE`; no simulated packet state.
- No packets: `NO PACKETS DETECTED`.
- No local artifact: `NOT OBSERVED`.
- Invalid artifact: `ARTIFACT REJECTED` with a fixed safe explanation.
- Blocked artifact: show its exact sorted blockers and permanent truth label.
- Consistent artifact: show `OBSERVED PATHWAY CONSISTENT`, while retaining `READ_ONLY_UNSIGNED_NOT_DEPLOYED_NOT_ONBOARDED` and all explicit nonclaims.
- A polished background or animation never changes any operational state.

## Accessibility and Responsiveness

- All controls are native buttons or labeled inputs with visible focus rings.
- The upload control has `aria-label="Select local pathway audit evidence"`.
- Status changes use an appropriate polite live region.
- Text and controls meet readable contrast over the video/gradient treatment.
- Keyboard users can reach navigation, file selection, inspection, and operational controls in visual order.
- At or below 760 pixels, navigation spacing contracts, center links hide, the headline scales down, and the glass card uses `calc(100vw - 48px)`.
- Long hashes and addresses wrap or truncate with accessible full-value labels rather than overflowing.

## Testing and Guardrails

- Extend dashboard structural checks for the wordmark, headline, truth labels, local-file copy, required IDs, and locally bundled media.
- Test the closed browser artifact parser, success rendering, invalid digest refusal, unknown/secret field refusal, and unavailable state.
- Test that artifact data is assigned via `textContent`, never `innerHTML`.
- Reject external artifact uploads, artifact fetch URLs, storage writes, mock pathway data, and simulated pathway language.
- Preserve all existing coordinator, packet timeline, runtime status, demo, and wallet-action tests.
- Verify desktop and 760-pixel responsive layouts in the local browser.
- Verify reduced-motion behavior and keyboard focus.

## Publishing Sequence

1. Finish Tasks 8–12 and the full adversarial test gate.
2. Build and visually verify the dashboard locally.
3. Commit the complete milestone on the isolated branch.
4. Push the branch to the configured Sentinel repository.
5. Deploy the web dashboard through the repository's configured hosting path.
6. Smoke-test the public URL without wallets, secrets, or contract transactions.
7. Add the verified live URL and deployment limitations to the README.

Web publication does not authorize blockchain contract deployment, testnet funding, DVN onboarding, signer key provisioning, or cloud signer infrastructure. Those remain separate security-sensitive gates.

## Acceptance Criteria

- The first viewport clearly follows the supplied hero/navigation/glass-card composition while presenting only Sentinel content.
- The travel video and Wandor branding are absent.
- The evidence card performs a real local JSON selection and validation workflow.
- Existing live operational panels still function and remain separate from local artifact evidence.
- Mobile, keyboard, reduced-motion, and unavailable states are usable.
- No state is simulated and every deployment/onboarding/production limitation remains visible.
- The tested branch can be pushed and the web dashboard deployed without exposing secrets or initiating blockchain transactions.
