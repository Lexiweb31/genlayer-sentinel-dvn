# Incremental Runtime Code Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bind each committed LayerZero runtime-code pin to closed, repository-held primary-source evidence while requiring all five reviewed pins for a complete code-identity result.

**Architecture:** Add a canonical `official-runtime-code-audit.json` registry whose entries name the five expected LayerZero contracts and bind their addresses, source provenance, primary-source evidence digests, runtime digest, and review conclusion. Extend the pathway policy binding so a non-null hash is accepted only when exactly one canonical registry entry matches it; the observer retains the existing per-contract comparison and a new completeness rule keeps the pathway blocked for any partial registry.

**Tech Stack:** TypeScript, Node.js native tests, canonical JSON parsing, ethers Keccak-256, repository JSON configuration.

## Global Constraints

- The work is strictly read-only: no wallet access, deployment, signing, funding, or remote mutation.
- Only the five contracts named in `config/pathway-auditor.json` are representable.
- Runtime pins are lower-case `0x`-prefixed Keccak-256 hashes and never derive automatically from live RPC output or local compilation.
- Every registry entry binds expected address, chain ID, EID, LayerZero source revision, HTTPS primary-source URLs, immutable evidence digests, a canonical block reference, and observed runtime digest.
- A partial reviewed set may yield per-contract `CODE_IDENTITY_REVIEWED` but must preserve `AUDIT_CODE_IDENTITY_UNPROVEN` and `BLOCKED_CODE_IDENTITY` until all five pins are reviewed and matching.
- No registry, log, manifest, or artifact may contain credentials, packet data, private keys, raw transaction submission material, or secret URLs.

---

### Task 1: Define and bind the closed runtime-code evidence registry

**Files:**
- Create: `config/official-runtime-code-audit.json`
- Modify: `config/pathway-auditor.json`
- Modify: `services/coordinator/src/pathway-audit-policy.ts`
- Modify: `services/coordinator/test/pathway-audit-policy.test.js`

**Interfaces:**
- Consumes: `PathwayAuditorPolicy.officialRuntimeCodeKeccak256` and reviewed `config/networks.json` contract metadata.
- Produces: `PathwayAuditPolicyBinding.officialRuntimeCodeReview` keyed by `sourceEndpointV2`, `sourceSendUln302`, `sourceExecutor`, `destinationEndpointV2`, and `destinationReceiveUln302`.

- [ ] **Step 1: Write failing policy-binding tests**

Add a fixture registry with one reviewed `sourceEndpointV2` entry and four `null` pins. Assert the binding exposes the one reviewed entry, keeps the four remaining entries unreviewed, and binds the raw registry SHA-256 into `repositoryBindingSha256`.

```js
assert.equal(binding.officialRuntimeCodeReview.sourceEndpointV2.state,"REVIEWED");
assert.equal(binding.officialRuntimeCodeReview.sourceSendUln302.state,"UNREVIEWED");
assert.notEqual(binding.repositoryBindingSha256,previous.repositoryBindingSha256);
```

Add table-driven failure cases for an unknown contract name, duplicate name, wrong chain ID/EID/address, non-HTTPS provenance URL, malformed digest/hash, source digest mismatch, noncanonical JSON, a reviewed registry entry for a null policy pin, and a non-null policy pin with no matching reviewed registry entry.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `node --test services/coordinator/test/pathway-audit-policy.test.js`

Expected: FAIL because `officialRuntimeCodeReview` and the registry input/path are not implemented.

- [ ] **Step 3: Add the canonical empty registry and policy path**

Create `config/official-runtime-code-audit.json` with `schemaVersion: 1`, status `NO_RUNTIME_CODE_IDENTITIES_REVIEWED`, empty `entries`, empty `sources`, and an explicit warning that bytecode presence is not official identity. Add an exact `officialRuntimeCodeAudit` policy path with value `config/official-runtime-code-audit.json`.

- [ ] **Step 4: Implement strict parsing and binding**

Extend `PathwayAuditorPolicy`, `PathwayAuditPolicyInput`, and `PathwayAuditPolicyBinding` in `pathway-audit-policy.ts`. Require a canonical registry with exact keys, sorted unique sources and entries, the five-name allowlist, checksummed network-matching address/chain/EID values, immutable lower-case SHA-256 evidence digests, lower-case Keccak runtime digest, HTTPS URL grammar with no query/fragment/userinfo, and a nonzero canonical block reference. Reject every mismatch before returning a binding. Include the raw registry SHA-256 in `repositoryBindingSha256`.

- [ ] **Step 5: Run focused policy tests to verify they pass**

Run: `node --test services/coordinator/test/pathway-audit-policy.test.js`

Expected: PASS, including the new happy-path and malformed-registry cases.

- [ ] **Step 6: Commit the registry binding**

```bash
git add config/official-runtime-code-audit.json config/pathway-auditor.json services/coordinator/src/pathway-audit-policy.ts services/coordinator/test/pathway-audit-policy.test.js
git commit -m "feat: bind official runtime code evidence"
```

### Task 2: Preserve all-or-nothing pathway code-identity blocking

**Files:**
- Modify: `services/coordinator/src/pathway-audit-observer.ts`
- Modify: `services/coordinator/test/pathway-audit-observer.test.js`
- Modify: `services/coordinator/test/pathway-audit-bundle.test.js`

**Interfaces:**
- Consumes: `PathwayAuditPolicyBinding.officialRuntimeCodeReview` from Task 1 and per-contract `RuntimeCodeObservation` from `observeCode`.
- Produces: stable `AUDIT_CODE_IDENTITY_UNPROVEN` blocker whenever any of the five required official identities is absent, mismatched, missing, or disagreed.

- [ ] **Step 1: Write failing observer tests for partial review**

Create a policy binding with only `sourceEndpointV2` reviewed and make both source RPC fixtures return its expected runtime bytes. Assert that this item is `CODE_IDENTITY_REVIEWED`, each unpinned item is `CODE_PRESENT_IDENTITY_UNPROVEN`, the blocker list contains exactly one canonical `AUDIT_CODE_IDENTITY_UNPROVEN`, and the status is `BLOCKED_CODE_IDENTITY`.

```js
assert.equal(result.officialCode.source[0].identity,"CODE_IDENTITY_REVIEWED");
assert.equal(result.status,"BLOCKED_CODE_IDENTITY");
assert.deepEqual(result.blockers.filter(x=>x.code==="AUDIT_CODE_IDENTITY_UNPROVEN").length,1);
```

Also write cases where all five entries are reviewed but one runtime result mismatches, and where all five match but `deployment:null` retains `BLOCKED_PATHWAY_CONFIGURATION`.

- [ ] **Step 2: Run focused observer tests to verify they fail**

Run: `node --test services/coordinator/test/pathway-audit-observer.test.js services/coordinator/test/pathway-audit-bundle.test.js`

Expected: FAIL because partial review currently has no explicit completeness invariant.

- [ ] **Step 3: Implement the completeness invariant**

Add a pure helper that evaluates all five policy review states and observations. It must add one canonical code-identity blocker whenever a required expectation is null, missing, mismatched, or provider-disagreed; it must not remove deployment/configuration blockers. Preserve existing stable blocker sorting and deduplication.

- [ ] **Step 4: Run focused observer and bundle tests to verify they pass**

Run: `node --test services/coordinator/test/pathway-audit-observer.test.js services/coordinator/test/pathway-audit-bundle.test.js`

Expected: PASS with the partial, mismatch, and full-reviewed-but-undeployed cases.

- [ ] **Step 5: Commit the all-or-nothing gate**

```bash
git add services/coordinator/src/pathway-audit-observer.ts services/coordinator/test/pathway-audit-observer.test.js services/coordinator/test/pathway-audit-bundle.test.js
git commit -m "fix: retain blocker for partial code review"
```

### Task 3: Add primary-source review workflow and evidence documentation

**Files:**
- Create: `docs/research/2026-08-13-official-runtime-code-review.md`
- Modify: `docs/PATHWAY_AUDITOR.md`
- Modify: `docs/UNKNOWNS.md`
- Modify: `README.md`
- Test: `services/coordinator/test/pathway-audit-policy.test.js`

**Interfaces:**
- Consumes: the registry schema from Task 1 and the all-or-nothing rule from Task 2.
- Produces: an operator-readable, reproducible process for collecting one reviewed hash without a deployment claim.

- [ ] **Step 1: Write a failing documentation/configuration assertion**

Add assertions that the committed registry is canonical and empty until a source-reviewed entry exists, and that each document preserves the difference between individual runtime evidence and pathway readiness.

```js
assert.equal(registry.status,"NO_RUNTIME_CODE_IDENTITIES_REVIEWED");
assert.equal(registry.entries.length,0);
assert.match(documentation,/all five/i);
assert.match(documentation,/not deployed/i);
```

- [ ] **Step 2: Run the focused policy test to verify it fails**

Run: `node --test services/coordinator/test/pathway-audit-policy.test.js`

Expected: FAIL because the registry/documentation workflow is not yet represented.

- [ ] **Step 3: Document exact collection and review procedure**

Document the required primary-source URL capture, raw-byte digest capture, exact source revision, two-provider block-pinned runtime read, chain/address cross-check, canonical registry update, and review rejection conditions. State that an entry may be added only after the source evidence is available; do not invent a hash or source revision.

- [ ] **Step 4: Run focused documentation/configuration tests to verify they pass**

Run: `node --test services/coordinator/test/pathway-audit-policy.test.js`

Expected: PASS with canonical empty registry and explicit nonclaims.

- [ ] **Step 5: Commit the workflow documentation**

```bash
git add docs/research/2026-08-13-official-runtime-code-review.md docs/PATHWAY_AUDITOR.md docs/UNKNOWNS.md README.md services/coordinator/test/pathway-audit-policy.test.js
git commit -m "docs: describe official runtime code review"
```

### Task 4: Verify the complete read-only assurance gate

**Files:**
- Verify only: all Task 1–3 files.

**Interfaces:**
- Consumes: completed registry binding, completeness gate, and documentation.
- Produces: verified local evidence only; it does not produce a deployable pathway.

- [ ] **Step 1: Run the complete suite**

Run: `npm test`

Expected: PASS with zero failures.

- [ ] **Step 2: Run the null-deployment pathway audit**

Run: `npm run audit:pathway -- --manifest /absolute/path/to/verified-manifest.json --output /absolute/path/to/verified-artifact.json`

Expected: exit code `2`; output retains `AUDIT_PATHWAY_DEPLOYMENTS_MISSING`. If all five source-reviewed runtime hashes have not been committed, output also retains `AUDIT_CODE_IDENTITY_UNPROVEN` and status `BLOCKED_CODE_IDENTITY`.

- [ ] **Step 3: Inspect safety properties**

Run: `git diff --check` and inspect the artifact for forbidden secrets, wallet requests, transaction construction, or a readiness/deployment claim.

Expected: no whitespace errors and no forbidden content.

- [ ] **Step 4: Commit verification-only corrections if required**

If a correction is required, add a regression test first, make the smallest fix, rerun Steps 1–3, then commit only the correction with a message that names the repaired invariant.
