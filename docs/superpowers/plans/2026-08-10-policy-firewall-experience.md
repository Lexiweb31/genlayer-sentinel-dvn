# GenLayer Sentinel Policy Firewall Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a product-led Sentinel landing experience that flows into the existing honest evidence and operations workspace, and ensure the hosted root serves the resulting dashboard.

**Architecture:** Keep the current semantic HTML and ES-module controller boundary. The hero and workspace use existing DOM IDs so `app.js`, `pathway-audit.js`, demo modules, and coordinator read-only panels retain behavior. The hosted builder emits the exact dashboard tree in the static layout recognized by the Sites runtime, while the worker continues to fail closed for unallowlisted paths.

**Tech Stack:** semantic HTML, CSS, browser ES modules, Node test runner, Sites Cloudflare Worker package.

## Global Constraints

- Retain `READ_ONLY_UNSIGNED_NOT_DEPLOYED_NOT_ONBOARDED` and every current nonclaim.
- Do not manufacture jobs, signer counts, policy decisions, confirmations, wallet state, or live GenLayer finality.
- Preserve existing DOM IDs consumed by `apps/dashboard/src/app.js`, `demo-entry.ts`, and `pathway-audit.js`.
- Retain keyboard focus behavior, mobile layouts, and `prefers-reduced-motion` behavior.
- The evidence chooser reads local JSON only; it must not upload or persist files.
- The final worker must remove `__sentinel-assets`; it is diagnostic-only and not product UI.
- The final hosted root and static assets must be verified in the authenticated deployment before claiming success.

---

### Task 1: Establish a hosted-static compatibility contract

**Files:**
- Modify: `scripts/build-hosted-dashboard.mjs`
- Modify: `apps/dashboard/src/hosted-worker.js`
- Modify: `scripts/test/hosted-dashboard.test.js`

**Interfaces:**
- Consumes: `buildHostedDashboard({ root?: string }): Promise<{ publicRoot: string; clientRoot: string; serverRoot: string }>`.
- Produces: an archive containing `dist/client/index.html` plus the full allowlisted dashboard asset tree; `fetch(request, env)` serves `/` by delegating to an asset that returns HTML.

- [ ] **Step 1: Write a failing builder contract test**

```js
test("build:site emits a Sites client tree with the exact public files",async()=>{
  assert.deepEqual(await filesBelow(resolve("dist/client")),expectedPublicFiles);
  assert.equal((await readFile("dist/client/index.html","utf8")).includes("__SITE_ORIGIN__"),true);
});
```

- [ ] **Step 2: Run the focused test and verify the missing layout failure**

Run: `node --test scripts/test/hosted-dashboard.test.js`

Expected: the new contract fails if `dist/client` is absent or incomplete.

- [ ] **Step 3: Implement the minimum package layout**

```js
const publicRoot=join(projectRoot,"dist/public");
const clientRoot=join(projectRoot,"dist/client");
await rm(clientRoot,{recursive:true,force:true});
await cp(publicRoot,clientRoot,{recursive:true});
```

Remove `__sentinel-assets` and `DIAGNOSTIC_CANDIDATES` from the final worker. Keep the root-to-index request mapping, GET/HEAD-only behavior, allowlist, security headers, metadata origin injection, and no-store error behavior.

- [ ] **Step 4: Verify package and worker tests**

Run: `npm run test:site`

Expected: every hosted-dashboard test passes, including root, HEAD, traversal rejection, metadata injection, and static asset tests.

- [ ] **Step 5: Commit the compatibility cleanup**

```bash
git add scripts/build-hosted-dashboard.mjs apps/dashboard/src/hosted-worker.js scripts/test/hosted-dashboard.test.js
git commit -m "fix: finalize Sentinel hosted static layout"
```

### Task 2: Build the policy-firewall hero

**Files:**
- Modify: `apps/dashboard/index.html`
- Modify: `apps/dashboard/src/style.css`
- Test: `apps/dashboard/test/hero-shell.test.js`

**Interfaces:**
- Consumes: existing IDs `pathway-audit-load`, `pathway-audit-upload`, `pathway-audit-file`, `pathway-audit-status`, `pathway-audit-inspect`, and `runtime-mode`.
- Produces: a hero with product narrative, evidence intake, a four-item explanatory trust rail, and links to the existing evidence and trust-model sections.

- [ ] **Step 1: Write a failing hero structure test**

```js
for(const token of[
  "A policy firewall for messages that move value.",
  "Packet proof",
  "Policy decision",
  "Signer quorum",
  "Destination check",
  "Nothing is uploaded."
])assert.match(html,new RegExp(token));
assert.match(html,/id="pathway-audit-file"/);
assert.match(html,/id="pathway-audit-inspect"/);
```

- [ ] **Step 2: Run the focused hero test and verify it fails for missing copy or rail markup**

Run: `node --test apps/dashboard/test/hero-shell.test.js`

Expected: failure names the missing hero copy or required operational ID.

- [ ] **Step 3: Implement the semantic hero update**

```html
<p class="hero-kicker">GENLAYER × LAYERZERO · POLICY FIREWALL</p>
<h1 id="hero-title">A policy firewall for messages that move value.</h1>
<ol class="trust-rail" aria-label="Sentinel decision gates">
  <li><strong>01</strong><span>Packet proof</span><p>Canonical inclusion and payload binding.</p></li>
  <li><strong>02</strong><span>Policy decision</span><p>Finalized semantic policy evidence.</p></li>
  <li><strong>03</strong><span>Signer quorum</span><p>Intended 3-of-5 isolated approval.</p></li>
  <li><strong>04</strong><span>Destination check</span><p>Verification before execution.</p></li>
</ol>
```

Keep the existing local file input and its button wiring unchanged. Change only presentation copy, hierarchy, and nonfunctional wrappers.

- [ ] **Step 4: Implement responsive style tokens**

```css
.trust-rail{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;background:rgba(10,10,10,.18)}
.trust-rail li{min-height:142px;padding:20px;background:rgba(255,255,255,.62);backdrop-filter:blur(14px)}
.trust-rail strong{color:var(--policy);font:600 11px/1 ui-monospace,monospace}
@media (max-width:760px){.trust-rail{grid-template-columns:repeat(2,minmax(0,1fr))}}
```

Use `--policy:#905831` and reserve lime styling for a real accepted evidence state, never default rail items.

- [ ] **Step 5: Verify hero behavior and commit**

Run: `node --test apps/dashboard/test/hero-shell.test.js apps/dashboard/test/hero-motion.test.js && npm run check:dashboard`

Expected: hero tests and dashboard no-simulation guardrails pass.

```bash
git add apps/dashboard/index.html apps/dashboard/src/style.css apps/dashboard/test/hero-shell.test.js
git commit -m "feat: add Sentinel policy firewall hero"
```

### Task 3: Recompose the evidence workspace without changing runtime contracts

**Files:**
- Modify: `apps/dashboard/index.html`
- Modify: `apps/dashboard/src/style.css`
- Modify: `apps/dashboard/src/delivery.css`
- Modify: `apps/dashboard/src/recovery.css`
- Test: `scripts/check-dashboard.mjs`

**Interfaces:**
- Consumes: all existing section IDs, status IDs, runtime IDs, and coordinator API reads in `apps/dashboard/src/app.js`.
- Produces: visual grouping named `Evidence workspace`, `Local proof path`, `Runtime posture`, and `Operational record` while preserving exact controller targets.

- [ ] **Step 1: Write a failing dashboard contract assertion**

```js
for(const token of[
  "Evidence workspace",
  "Local proof path",
  "Runtime posture",
  "Operational record",
  "No simulated state is shown"
])if(!html.includes(token)&&!js.includes(token))throw new Error(`missing policy-firewall workspace token: ${token}`);
```

- [ ] **Step 2: Run the guardrail check and verify the new structure assertion fails**

Run: `npm run check:dashboard`

Expected: failure reports the first missing workspace token.

- [ ] **Step 3: Implement section hierarchy and card styling**

```html
<p class="workspace-eyebrow">EVIDENCE WORKSPACE</p>
<h2 id="evidence-title">Read what the pathway can prove.</h2>
```

Use CSS grid wrappers and bordered panels around existing children. Do not rename or remove `#pathway-audit-configuration`, `#demo-workspace`, `#timeline`, `#dead-letters`, `#deliveries`, `#recovery-actions`, or `#inspector`.

- [ ] **Step 4: Verify existing controllers still target the page**

Run: `node --test apps/dashboard/test/pathway-audit.test.js apps/dashboard/test/runtime-status.test.js apps/dashboard/test/timeline.test.js apps/dashboard/test/demo-entry-integration.test.js && npm run check:dashboard`

Expected: all controller tests pass and the check retains existing live-data and no-simulation assertions.

- [ ] **Step 5: Commit the workspace redesign**

```bash
git add apps/dashboard/index.html apps/dashboard/src/style.css apps/dashboard/src/delivery.css apps/dashboard/src/recovery.css scripts/check-dashboard.mjs
git commit -m "feat: refine Sentinel evidence workspace"
```

### Task 4: Verify, publish, and document the polished deployment

**Files:**
- Modify: `README.md`
- Modify: `docs/DEMO.md`
- Test: `scripts/test/hosted-dashboard.test.js`

**Interfaces:**
- Consumes: the deployment URL returned by the successful owner-private Sites deployment.
- Produces: accurate public documentation and a private deployment whose root serves the dashboard; no diagnostic route is reachable.

- [ ] **Step 1: Add a failing deployed-artifact assertion**

```js
const workerSource=await readFile("dist/server/index.js","utf8");
assert.equal(workerSource.includes("__sentinel-assets"),false);
assert.equal(workerSource.includes("DIAGNOSTIC_CANDIDATES"),false);
```

- [ ] **Step 2: Run it and verify it fails while diagnostic code remains**

Run: `node --test scripts/test/hosted-dashboard.test.js`

Expected: the worker-source assertion fails until Task 1 removes diagnostic code.

- [ ] **Step 3: Run the complete local verification set**

Run: `npm run test:site && npm run check:dashboard && npm run test`

Expected: every command exits zero; report counts exactly as printed.

- [ ] **Step 4: Publish the exact committed source**

```bash
git push origin HEAD:main
/Users/user/.codex/plugins/cache/openai-bundled/sites/0.1.34/scripts/package-site.sh "$PWD" /private/tmp/genlayer-sentinel-final.tar.gz
```

Create a fresh Sites source credential, push the same `HEAD` to the Sites source branch with a per-command authorization header, save one archive version, deploy it owner-private, and poll until status is `succeeded`.

- [ ] **Step 5: Perform authenticated deployed-root verification and update docs**

Verify the root returns dashboard HTML, then update the README and demo URL only if the deployed URL changes. Keep the owner-private and not-deployed/not-onboarded labels adjacent to the link.

```bash
git add README.md docs/DEMO.md
git commit -m "docs: publish final Sentinel dashboard"
git push origin HEAD:main
```
