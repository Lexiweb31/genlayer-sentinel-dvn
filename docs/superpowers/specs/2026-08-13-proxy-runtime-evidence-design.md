# Proxy Runtime Evidence Design

## Purpose

Make a LayerZero contract that is an on-chain proxy legible in Sentinel's
read-only evidence model without allowing a verified proxy wrapper to stand in
for an unverified implementation.

## Chosen approach

For every configured runtime-code target, retain the current code hash and
identity state. Add a proxy-evidence object only when the policy explicitly
declares that target as an EIP-1967 proxy. It has independent wrapper and
implementation states.

- `wrapper`: records only that two RPC providers agree on the deployed wrapper
  runtime at the pinned block. `ONCHAIN_AGREED` is not a source-provenance or
  official LayerZero identity claim.
- `implementation`: records the EIP-1967 implementation address and its
  reviewed state, or a fixed unresolved state when no independently verifiable
  implementation identity exists.

The top-level runtime identity remains `CODE_PRESENT_IDENTITY_UNPROVEN` until
both the wrapper and implementation are reviewed. A proxy can never produce
`CODE_IDENTITY_REVIEWED` by wrapper evidence alone.

## Boundaries

- Evidence is read-only and contains no RPC URLs, wallet requests, transaction
  material, signer data, or secrets.
- The model is a presentation and audit refinement only. It does not modify
  readiness, blocker precedence, deployments, signing, DVN onboarding, or
  destination execution.
- Non-proxy targets have no proxy-evidence field.
- The dashboard consumes only the closed, allowlisted public field and renders
  the wrapper and implementation facts separately.

## Data flow

1. The observer reads a configured target's runtime code through its existing
   two-provider path.
2. For proxy-configured targets it reads the EIP-1967 implementation slot from
   both providers at the same pinned block.
3. Provider disagreement, zero values, malformed words, or missing code keep
   implementation state unresolved and preserve the existing canonical blocker.
4. The canonical bundle and dashboard parser carry the sanitized proxy summary.
5. The console displays it as “on-chain wrapper agreed / implementation
   unresolved” or the corresponding fully reviewed state; it never calls it
   safe, ready, or deployable.

## Testing

Unit and bundle tests cover: an on-chain-agreed wrapper with unresolved implementation;
two reviewed layers; implementation-slot provider disagreement; and parser/UI
rejection of unknown or unsafe proxy fields. Existing all-or-nothing identity
and deployment blockers must remain unchanged.
