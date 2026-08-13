# Proxy Runtime Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose a verified proxy wrapper and separately unresolved implementation evidence without weakening Sentinel's runtime-identity or deployment gates.

**Architecture:** Extend the closed runtime observation schema with an optional proxy summary. The observer obtains the EIP-1967 implementation slot through its existing two-provider, block-pinned read path. The canonical pathway bundle and dashboard parser carry only sanitized proxy facts. The top-level identity remains unreviewed until both layers are reviewed.

**Tech Stack:** TypeScript, Node.js native tests, canonical JSON, existing read-only JSON-RPC client, vanilla dashboard JavaScript.

## Global Constraints

- Read-only evidence only: no wallet access, deployment, signing, funding, cloud writes, or chain mutations.
- Proxy wrapper review must never yield top-level `CODE_IDENTITY_REVIEWED` while the implementation is unresolved.
- Existing blocker ordering and `BLOCKED_CODE_IDENTITY` behavior remain unchanged.
- New public values must be closed-schema, bounded, sanitized, and free of URLs, raw RPC responses, transactions, secrets, and signer material.

---

### Task 1: Model and observe EIP-1967 proxy evidence

**Files:**
- Modify: `services/coordinator/src/pathway-audit-observer.ts`
- Modify: `services/coordinator/test/pathway-audit-observer.test.js`

**Interfaces:**
- Produces optional `proxyEvidence` on `RuntimeCodeObservation`:
  `{wrapper:"REVIEWED"|"UNREVIEWED"|"DISAGREED",implementationAddress:string|null,implementation:"REVIEWED"|"UNREVIEWED"|"DISAGREED"|"MISSING"}`.
- Consumes the two existing provider clients and the already pinned observation block.

- [ ] **Step 1: Write failing observer tests**

Add an executor fixture where both providers return matching wrapper runtime and matching EIP-1967 implementation address. Assert an unresolved implementation produces `wrapper:"REVIEWED"`, `implementation:"UNREVIEWED"`, and the existing top-level `CODE_PRESENT_IDENTITY_UNPROVEN`. Add a mismatch fixture that returns different slot words and asserts `implementation:"DISAGREED"` plus the existing canonical provider-result blocker.

- [ ] **Step 2: Run the observer test to verify it fails**

Run: `node --test services/coordinator/test/pathway-audit-observer.test.js`

Expected: FAIL because `proxyEvidence` is absent.

- [ ] **Step 3: Implement the minimum closed proxy observation**

Read `eth_getStorageAt` at the EIP-1967 implementation slot for configured proxy targets using the existing client method and pinned block tag. Decode only a 32-byte word with a nonzero last-20-byte address. Populate the optional summary without exposing slot words or transport data. Preserve the old code identity unless wrapper and implementation are each reviewed.

- [ ] **Step 4: Run focused tests to verify they pass**

Run: `node --test services/coordinator/test/pathway-audit-observer.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/coordinator/src/pathway-audit-observer.ts services/coordinator/test/pathway-audit-observer.test.js
git commit -m "feat: observe proxy runtime evidence"
```

### Task 2: Preserve proxy evidence in the public bundle and dashboard parser

**Files:**
- Modify: `services/coordinator/src/pathway-audit-bundle.ts`
- Modify: `services/coordinator/test/pathway-audit-bundle.test.js`
- Modify: `apps/dashboard/src/pathway-audit.js`
- Modify: `apps/dashboard/test/pathway-audit.test.js`

**Interfaces:**
- Consumes optional observer `proxyEvidence`.
- Produces the same optional closed field in public bundle and parsed dashboard model.

- [ ] **Step 1: Write failing bundle/parser tests**

Add a canonical bundle fixture containing a proxy summary. Assert it round-trips unchanged. Add rejection cases for an unknown proxy key, an invalid implementation address, a raw slot word, and a proxy summary attached to a non-present identity.

- [ ] **Step 2: Run focused tests to verify they fail**

Run: `node --test services/coordinator/test/pathway-audit-bundle.test.js apps/dashboard/test/pathway-audit.test.js`

Expected: FAIL because closed parsers reject the new field.

- [ ] **Step 3: Implement closed parsing and encoding**

Permit `proxyEvidence` only as the exact optional key on a runtime-code item. Require the fixed state enumerations, a checksummed implementation address only when implementation is not missing, and no extra data.

- [ ] **Step 4: Run focused tests to verify they pass**

Run: `node --test services/coordinator/test/pathway-audit-bundle.test.js apps/dashboard/test/pathway-audit.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/coordinator/src/pathway-audit-bundle.ts services/coordinator/test/pathway-audit-bundle.test.js apps/dashboard/src/pathway-audit.js apps/dashboard/test/pathway-audit.test.js
git commit -m "feat: publish closed proxy evidence"
```

### Task 3: Render the proxy distinction in the console

**Files:**
- Modify: `apps/dashboard/src/app.js`
- Modify: `apps/dashboard/src/console.css`
- Modify: `apps/dashboard/test/console-shell.test.js`

**Interfaces:**
- Consumes parsed `proxyEvidence` from the public audit view.
- Produces text-only console detail rows naming wrapper and implementation state.

- [ ] **Step 1: Write a failing console test**

Render a blocked audit with the executor proxy summary. Assert the detail contains “Proxy wrapper: reviewed” and “Implementation: unresolved” and does not contain “ready”, “safe”, or an action control.

- [ ] **Step 2: Run the focused console test to verify it fails**

Run: `node --test apps/dashboard/test/console-shell.test.js`

Expected: FAIL because proxy evidence has no renderer.

- [ ] **Step 3: Implement the minimum accessible renderer**

Create an existing-style read-only detail row only when `proxyEvidence` exists. Use the same semantic status colors/classes already used for audit results; no new browser network calls or wallet behavior.

- [ ] **Step 4: Run focused console tests to verify they pass**

Run: `node --test apps/dashboard/test/console-shell.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/app.js apps/dashboard/src/console.css apps/dashboard/test/console-shell.test.js
git commit -m "feat: render proxy evidence in console"
```

### Task 4: Verify the end-to-end read-only gate

**Files:** Verify only Task 1-3 files.

- [ ] **Step 1: Run full verification**

Run: `npm test && git diff --check`

Expected: zero test failures and no whitespace errors.

- [ ] **Step 2: Run the pathway audit with the approved manifest**

Run: `npm run audit:pathway -- --manifest /private/tmp/genlayer-sentinel-pathway-manifest-20260813-v6.json --output /private/tmp/genlayer-sentinel-pathway-evidence-proxy.json`

Expected: a blocked result retaining `AUDIT_CODE_IDENTITY_UNPROVEN` and `AUDIT_PATHWAY_DEPLOYMENTS_MISSING`; no deployment claim.

- [ ] **Step 3: Commit only test-proven corrections**

If any correction is necessary, add a regression test first, apply the smallest correction, repeat Steps 1-2, then commit it with an invariant-specific message.
