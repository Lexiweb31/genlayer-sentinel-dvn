# Operator Attestation Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an offline, public-only operator-attestation validator and review template without changing signer or deployment behavior.

**Architecture:** A standalone ESM script owns closed-schema parsing and validation. A JSON template and operator guide document the handoff. Node tests import the script's exported validator and assert safe accept/reject outcomes.

**Tech Stack:** Node.js ESM, built-in `node:test`, JSON.

## Global Constraints

- Never read, generate, accept, print, or commit private keys, mnemonics, seeds, passwords, API tokens, or certificate private material.
- Validation success is explicitly not proof of operator independence or authorization.
- No network request, signer request, readiness-state change, deployment, or dashboard change is permitted.
- The intended production architecture remains 3-of-5 isolated independent operators.

---

### Task 1: Attestation validator

**Files:**
- Create: `scripts/validate-operator-attestation.mjs`
- Test: `services/coordinator/test/operator-attestation.test.js`

**Interfaces:**
- Produces: `validateOperatorAttestation(value)` returning the validated public record.
- Produces: CLI `node scripts/validate-operator-attestation.mjs <path>` with a nonzero exit for invalid input.

- [ ] Write failing tests for a valid record and a secret-like key.
- [ ] Run `node --test services/coordinator/test/operator-attestation.test.js` and observe the missing-module failure.
- [ ] Implement the minimum closed-schema validator.
- [ ] Re-run the focused test and require PASS.

### Task 2: Safe handoff documents

**Files:**
- Create: `docs/operators/README.md`
- Create: `docs/operators/operator-attestation.template.json`
- Modify: `package.json`

**Interfaces:**
- Produces: `npm run check:operator-attestation -- <path>`.
- Consumes: the validator from Task 1.

- [ ] Add the package script.
- [ ] Add a non-secret template and review guide that says validation does not establish independence or quorum eligibility.
- [ ] Validate the committed template and require `ATTESTATION_VALID_NOT_INDEPENDENCE_PROOF`.

### Task 3: Full verification and commit

- [ ] Run `node --test services/coordinator/test/operator-attestation.test.js && npm run build && git diff --check`.
- [ ] Commit and push the specified files with message `feat: add operator attestation package`.
