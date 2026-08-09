# Sentinel Operations-First Hero Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the approved Wandor-inspired full-viewport visual shell to GenLayer Sentinel while preserving its real local evidence viewer, live coordinator dashboard, strict no-simulation behavior, and deployable self-origin asset boundary.

**Architecture:** Keep the existing static dashboard and coordinator asset allowlist. Add audited self-hosted fonts/media, a closed browser-only pathway artifact controller, and a responsive hero that leads into the existing operational sections. Produce a Cloudflare Worker-compatible static site package for Sites hosting; publication and GitHub creation remain final controller gates after the complete repository verification.

**Tech Stack:** Existing semantic HTML/CSS/ES modules, Node.js 22.13+, TypeScript 5.8.3 coordinator server, node:test, esbuild 0.28.1, Sites hosting, locally bundled WOFF2/JPEG/MP4 assets.

## Global Constraints

- This is GenLayer Sentinel, not Wandor; no travel branding, copy, imagery, or navigation remains.
- Preserve the existing dashboard architecture; do not add React, Vite, Tailwind, lucide-react, or another client runtime.
- Every operational state comes from a locally selected validated artifact or the live coordinator API; no mock, fallback, sample, or simulated pathway state.
- The local artifact is read in memory only, never uploaded, fetched from a URL, or written to local/session storage.
- Artifact values render through `textContent`; never use `innerHTML` for evidence.
- Keep local pathway evidence separate from coordinator packet/GenLayer/signer/execution data.
- Initial pathway state is `NOT OBSERVED` with `Select a locally generated read-only pathway audit artifact. Nothing is uploaded.`
- Permanent artifact label: `READ_ONLY_UNSIGNED_NOT_DEPLOYED_NOT_ONBOARDED`.
- Self-host fonts, poster, video, JavaScript, and CSS; browser source must contain no external runtime asset URL.
- Pexels clip 3129540 is the sole motion source; preserve its source/license attribution in repository documentation.
- Pause background video under `prefers-reduced-motion: reduce` and retain the static poster.
- At widths at or below 760 pixels, hide center navigation, use 24-pixel horizontal page padding, and constrain the glass card to `calc(100vw - 48px)`.
- No blockchain deployment, funding, wallet secret, signer secret, cloud signer, or transaction submission capability is added by this plan.
- Do not stage or modify the unrelated `.DS_Store` or the worktree-only `node_modules` symlink.
- Use strict TDD and one independently reviewed commit per implementation task.

## File Map

| File | Responsibility |
| --- | --- |
| `apps/dashboard/assets/sentinel-network-loop.mp4` | Self-hosted 1280×720 ambient abstract network loop. |
| `apps/dashboard/assets/sentinel-network-poster.jpg` | Reduced-motion and pre-video poster. |
| `apps/dashboard/assets/geist-latin.woff2` | Self-hosted Geist Latin variable font for UI weights 400–700. |
| `apps/dashboard/assets/special-elite-latin.woff2` | Self-hosted Special Elite Latin wordmark font. |
| `apps/dashboard/assets/ASSET_PROVENANCE.md` | Source URLs, licenses, hashes, sizes, and permitted use. |
| `services/coordinator/src/status-api.ts` | Explicitly serve the four audited assets and browser module with safe MIME/CSP headers. |
| `services/coordinator/test/status-api.test.js` | Prove the allowlist, binary bodies, MIME types, CSP, and refusal boundary. |
| `scripts/test/dashboard-assets.test.js` | Pin asset integrity hashes and size limits. |
| `apps/dashboard/src/pathway-audit.js` | Closed browser model, rendering, and in-memory file controller. |
| `apps/dashboard/test/pathway-audit.test.js` | Artifact parsing, honest rendering, and no-upload/no-storage tests. |
| `apps/dashboard/index.html` | Hero/nav/evidence card, semantic operational anchors, metadata. |
| `apps/dashboard/src/style.css` | Self-hosted fonts, hero/glass styling, responsive/reduced-motion behavior. |
| `apps/dashboard/src/app.js` | Initialize the local evidence controller without merging coordinator state. |
| `apps/dashboard/test/hero-shell.test.js` | Structural, accessibility, copy, self-origin, and responsive CSS contract. |
| `scripts/check-dashboard.mjs` | Enforce hero/evidence IDs, truth copy, self-origin assets, and no-simulation guards. |
| `apps/dashboard/src/hosted-worker.js` | Read-only Sites worker wrapper that serves static assets with security headers. |
| `scripts/build-hosted-dashboard.mjs` | Produce deterministic `dist/public` and `dist/server/index.js` hosting output. |
| `scripts/test/hosted-dashboard.test.js` | Verify host packaging, origin-derived social metadata, methods, and headers. |
| `apps/dashboard/assets/og.png` | One validated Sentinel-specific social preview image generated after UI copy freezes. |
| `package.json` | Add deterministic hosted-site build/test scripts without dependency changes. |

---

### Task 1: Audit and self-host visual assets

**Files:**
- Create: `apps/dashboard/assets/sentinel-network-loop.mp4`
- Create: `apps/dashboard/assets/sentinel-network-poster.jpg`
- Create: `apps/dashboard/assets/geist-latin.woff2`
- Create: `apps/dashboard/assets/special-elite-latin.woff2`
- Create: `apps/dashboard/assets/ASSET_PROVENANCE.md`
- Create: `scripts/test/dashboard-assets.test.js`
- Modify: `services/coordinator/src/status-api.ts`
- Modify: `services/coordinator/test/status-api.test.js`

**Interfaces:**
- Produces four immutable self-origin assets with exact SHA-256 pins.
- Produces GET-only routes `/assets/sentinel-network-loop.mp4`, `/assets/sentinel-network-poster.jpg`, `/assets/geist-latin.woff2`, and `/assets/special-elite-latin.woff2`.
- Extends dashboard CSP with `media-src 'self'`; `font-src` and `img-src` remain self-only.

- [ ] **Step 1: Write failing asset and route tests**

Create `scripts/test/dashboard-assets.test.js` with exact integrity expectations:

```js
import test from "node:test";
import assert from "node:assert/strict";
import{createHash}from"node:crypto";
import{readFile,stat}from"node:fs/promises";

const assets=[
  ["apps/dashboard/assets/sentinel-network-loop.mp4","547fddfb71d644a47c9e268868ff557eae8ad8934a2b0b7b445f2c765e4709a4",5_000_000],
  ["apps/dashboard/assets/sentinel-network-poster.jpg","1c7db6b9ca74d9017faad3e989539a44c5a0d6b680ad3d20ad6d62974557d3f3",100_000],
  ["apps/dashboard/assets/geist-latin.woff2","9b6f5ff45b278c744b5f379a2c4ecbaf858a842b8eaf82ac8d21b699ca16c608",100_000],
  ["apps/dashboard/assets/special-elite-latin.woff2","3cf06771841c778db94dfc003a9239338613c07a9e8c8125d0641a1ba6e7977a",100_000]
];

test("dashboard visual assets match reviewed bytes and web size limits",async()=>{
  for(const[path,digest,maxBytes]of assets){
    const bytes=await readFile(path),metadata=await stat(path);
    assert.equal(createHash("sha256").update(bytes).digest("hex"),digest);
    assert.ok(metadata.size>0&&metadata.size<=maxBytes,`${path} exceeds ${maxBytes}`);
  }
});
```

Extend the status API test to assert exact MIME types, binary equality with disk, GET-only behavior, and 404 for adjacent unlisted files.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
npm run build
node --test scripts/test/dashboard-assets.test.js services/coordinator/test/status-api.test.js
```

Expected: FAIL because the files/routes do not exist.

- [ ] **Step 3: Download and verify the exact reviewed assets**

Use these exact sources:

```bash
curl --fail --location --max-time 120 --output apps/dashboard/assets/sentinel-network-loop.mp4 https://videos.pexels.com/video-files/3129540/3129540-hd_1280_720_30fps.mp4
curl --fail --location --max-time 60 --output apps/dashboard/assets/sentinel-network-poster.jpg 'https://images.pexels.com/videos/3129540/free-video-3129540.jpg?auto=compress&cs=tinysrgb&w=1600'
curl --fail --location --max-time 60 --output apps/dashboard/assets/geist-latin.woff2 https://fonts.gstatic.com/s/geist/v5/gyByhwUxId8gMEwcGFWNOITd.woff2
curl --fail --location --max-time 60 --output apps/dashboard/assets/special-elite-latin.woff2 https://fonts.gstatic.com/s/specialelite/v20/XLYgIZbkc4JPUL5CVArUVL0ntnAOSFNuQsI.woff2
```

`ASSET_PROVENANCE.md` must record:

- Pexels page: `https://www.pexels.com/video/digital-projection-of-neon-abstract-geometrical-line-of-a-communication-network-3129540/`
- Pexels license: `https://www.pexels.com/license/`
- Creator: Pressmaster
- Google Fonts CSS request supplied by the user
- Geist and Special Elite Google Fonts source URLs
- All four exact hashes from Step 1
- Statement that browser runtime uses local copies only

- [ ] **Step 4: Add the explicit server allowlist**

Extend `assets` in `status-api.ts` with the four routes and MIME values:

```ts
["/assets/sentinel-network-loop.mp4",["assets/sentinel-network-loop.mp4","video/mp4"]],
["/assets/sentinel-network-poster.jpg",["assets/sentinel-network-poster.jpg","image/jpeg"]],
["/assets/geist-latin.woff2",["assets/geist-latin.woff2","font/woff2"]],
["/assets/special-elite-latin.woff2",["assets/special-elite-latin.woff2","font/woff2"]]
```

Add `media-src 'self'` to the dashboard CSP. Preserve `default-src 'none'`, `script-src 'self'`, `style-src 'self'`, `connect-src 'self'`, `img-src 'self'`, and `font-src 'self'`.

- [ ] **Step 5: Verify GREEN and commit**

Run:

```bash
npm run build
node --test scripts/test/dashboard-assets.test.js services/coordinator/test/status-api.test.js
git diff --check
```

Expected: asset and status API tests pass.

```bash
git add apps/dashboard/assets/sentinel-network-loop.mp4 apps/dashboard/assets/sentinel-network-poster.jpg apps/dashboard/assets/geist-latin.woff2 apps/dashboard/assets/special-elite-latin.woff2 apps/dashboard/assets/ASSET_PROVENANCE.md scripts/test/dashboard-assets.test.js services/coordinator/src/status-api.ts services/coordinator/test/status-api.test.js
git commit -m "feat: self-host Sentinel dashboard media"
```

### Task 2: Build the strict local pathway evidence controller

**Files:**
- Create: `apps/dashboard/src/pathway-audit.js`
- Create: `apps/dashboard/test/pathway-audit.test.js`
- Modify: `services/coordinator/src/status-api.ts`
- Modify: `services/coordinator/test/status-api.test.js`

**Interfaces:**
- Produces `validatePathwayAuditView(value): PathwayAuditView`.
- Produces `parsePathwayAuditViewText(text): PathwayAuditView`.
- Produces `renderPathwayAudit(elements, value, formatTime): void`.
- Produces `renderPathwayAuditUnavailable(elements, reason): void`.
- Produces `createPathwayAuditFileController({fileInput,inspectButton,status,elements,formatTime}): {dispose():void}`.
- The controller retains only one `File` object in closure memory until inspection or disposal.

- [ ] **Step 1: Write the failing closed-model tests**

Build a minimal valid `sentinel-pathway-auditor/v1` artifact fixture and assert:

```js
const view=validatePathwayAuditView(validBundle());
assert.equal(view.truthLabel,"READ_ONLY_UNSIGNED_NOT_DEPLOYED_NOT_ONBOARDED");
assert.equal(view.status,"BLOCKED_PATHWAY_CONFIGURATION");
assert.deepEqual(view.blockers.map(item=>item.code),["AUDIT_PATHWAY_DEPLOYMENTS_MISSING"]);
```

Add table-driven refusal tests for unknown fields, noncanonical JSON text, bad evidence digest, wrong status/blocker precedence, wrong truth label, malformed hashes/addresses/decimals, RPC URLs, raw transaction input, secret keys, filesystem paths, packet fields, GenLayer fields, signer shares, execution state, accessors, prototypes, and cycles.

Use fake elements whose `textContent` setter records values and whose `innerHTML` setter throws. Assert unavailable rendering clears prior content and shows `NOT OBSERVED`.

Use fake files and spies to prove:

```js
assert.equal(fileTextCalls,1);
assert.equal(fetchCalls,0);
assert.equal(localStorageWrites,0);
assert.equal(sessionStorageWrites,0);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test apps/dashboard/test/pathway-audit.test.js
```

Expected: FAIL because `pathway-audit.js` does not exist.

- [ ] **Step 3: Implement the smallest closed browser boundary**

Use exact-key parsing and fixed enums. Recompute the outer evidence SHA-256 with `crypto.subtle.digest("SHA-256", bytes)` over the canonical body and recompute the inner configuration/provider evidence digests using the same normalized formulas as `pathway-audit-bundle.ts`.

The controller behavior is:

```js
fileInput.addEventListener("change",()=>{
  selected=fileInput.files?.length===1?fileInput.files[0]:null;
  inspectButton.disabled=selected===null;
  status.textContent=selected?"READY TO INSPECT":"NOT OBSERVED";
});

inspectButton.addEventListener("click",async()=>{
  if(!selected)return;
  try{renderPathwayAudit(elements,await parsePathwayAuditViewText(await selected.text()),formatTime)}
  catch{renderPathwayAuditUnavailable(elements,"ARTIFACT REJECTED")}
});
```

Do not expose the selected file, raw JSON, RPC URLs, transaction input, or full secret-adjacent fields in the returned public view.

- [ ] **Step 4: Add the module route and verify GREEN**

Add only `/src/pathway-audit.js` to the status API's static allowlist.

Run:

```bash
npm run build
node --test apps/dashboard/test/pathway-audit.test.js services/coordinator/test/status-api.test.js
git diff --check
```

Expected: all focused tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/pathway-audit.js apps/dashboard/test/pathway-audit.test.js services/coordinator/src/status-api.ts services/coordinator/test/status-api.test.js
git commit -m "feat: validate local pathway audit evidence"
```

### Task 3: Implement the Sentinel hero and operational integration

**Files:**
- Create: `apps/dashboard/test/hero-shell.test.js`
- Modify: `apps/dashboard/index.html`
- Modify: `apps/dashboard/src/app.js`
- Modify: `apps/dashboard/src/style.css`
- Modify: `scripts/check-dashboard.mjs`

**Interfaces:**
- Adds navigation anchors `#pathway`, `#evidence`, and `#trust-model`.
- Adds evidence IDs `pathway-audit-file`, `pathway-audit-inspect`, `pathway-audit-status`, `pathway-audit-source-block`, `pathway-audit-destination-block`, `pathway-audit-rpc`, `pathway-audit-code`, `pathway-audit-configuration`, and `pathway-audit-blockers`.
- Existing coordinator and demo IDs remain unchanged.
- `app.js` initializes the local evidence controller independently of coordinator refreshes.

- [ ] **Step 1: Write the failing structural contract**

`hero-shell.test.js` must read the source HTML/CSS/JS and assert:

```js
for(const text of[
  "sentinel",
  "Verify policy before messages cross chains.",
  "Select a locally generated read-only pathway audit artifact. Nothing is uploaded.",
  "Inspect Evidence",
  "NOT OBSERVED"
])assert.ok(html.includes(text));
```

Also assert:

- the video uses only `/assets/sentinel-network-loop.mp4`, with `autoplay`, `muted`, `loop`, and `playsinline`;
- the poster uses only `/assets/sentinel-network-poster.jpg`;
- file input uses `accept="application/json,.json"`;
- the upload and inspect buttons have native button semantics and accessible labels;
- nav links target exact on-page anchors;
- all existing operational IDs remain;
- CSS includes `@font-face` for both local WOFF2 files, `min-height:100svh`, 687-pixel gradient, 20-pixel card blur, 44-pixel radius, `@media (max-width:760px)`, and `prefers-reduced-motion:reduce`;
- JS imports `createPathwayAuditFileController` and never merges the artifact with `jobs`, `deliveryByGuid`, or demo state.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
node --test apps/dashboard/test/hero-shell.test.js apps/dashboard/test/pathway-audit.test.js
```

Expected: hero-shell test fails against the old dashboard markup.

- [ ] **Step 3: Replace only the visual shell**

Set the document title to:

```html
<title>GenLayer Sentinel — Verify policy before messages cross chains.</title>
```

Create the full-viewport hero with:

- self-origin video/poster;
- 687-pixel white gradient;
- `sentinel` Special Elite wordmark;
- Pathway, Evidence, and Trust Model center links;
- `Load Evidence` button that invokes the hidden file input;
- headline and supporting copy from the approved design;
- frosted card with initial local-only copy, circular upload button, hidden JSON input, and disabled `Inspect Evidence` button;
- a live-region status initialized to `NOT OBSERVED`.

Move—not duplicate—the existing coordinator notice into the start of the operational content. Add the local evidence detail panel immediately below the hero and before live coordinator sections. Keep the demo/runtime/timeline/recovery/delivery/inspector/trust sections and all their existing IDs.

- [ ] **Step 4: Implement the approved visual CSS**

Use self-hosted font faces:

```css
@font-face{font-family:Geist;src:url('/assets/geist-latin.woff2') format('woff2');font-weight:400 700;font-style:normal;font-display:swap}
@font-face{font-family:'Special Elite';src:url('/assets/special-elite-latin.woff2') format('woff2');font-weight:400;font-style:normal;font-display:swap}
```

Implement the exact composition tokens:

```css
.hero-shell{position:relative;min-height:100svh;width:100%;overflow:hidden}
.hero-media{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0}
.hero-gradient{position:absolute;z-index:1;inset:0 0 auto;height:687px;pointer-events:none;background:linear-gradient(180deg,#fff 0%,rgba(255,255,255,0) 100%)}
.hero-content{position:relative;z-index:2;max-width:1360px;margin:0 auto}
.evidence-glass{width:701px;min-height:208px;background:rgba(255,255,255,.06);border:3px solid #fff;border-radius:44px;box-shadow:0 0 4px rgba(0,0,0,.15);backdrop-filter:blur(20px)}
```

At 760 pixels, hide center navigation, reduce wordmark to 32 pixels, use 24-pixel page padding, set card width to `calc(100vw - 48px)`, and reduce prompt text to 17 pixels. Under reduced motion, hide/pause the video through CSS and show the poster-backed hero.

- [ ] **Step 5: Integrate the controller and harden guardrails**

Initialize `createPathwayAuditFileController` once. Both `Load Evidence` and the circular upload button call `fileInput.click()`. The inspect button parses the selected file. Do not call coordinator mutation routes.

Extend `check-dashboard.mjs` to require all hero/evidence IDs and approved phrases, include `/src/pathway-audit.js` in the allowed source set, and reject:

```text
Wandor
Japan
mockPathway
samplePathway
simulated pathway
artifact upload
localStorage
external artifact URL
innerHTML
```

The storage check must target the pathway module so existing same-tab wallet-action `sessionStorage` remains separately governed.

- [ ] **Step 6: Verify GREEN and commit**

Run:

```bash
npm run build:dashboard
npm run check:dashboard
node --test apps/dashboard/test/hero-shell.test.js apps/dashboard/test/pathway-audit.test.js apps/dashboard/test/runtime-status.test.js apps/dashboard/test/timeline.test.js services/coordinator/test/status-api.test.js
git diff --check
```

Expected: dashboard and focused integration tests pass.

```bash
git add apps/dashboard/index.html apps/dashboard/src/app.js apps/dashboard/src/style.css apps/dashboard/test/hero-shell.test.js scripts/check-dashboard.mjs
git commit -m "feat: add Sentinel operations-first hero"
```

### Task 4: Produce and validate the hosted dashboard package

**Files:**
- Create: `apps/dashboard/src/hosted-worker.js`
- Create: `scripts/build-hosted-dashboard.mjs`
- Create: `scripts/test/hosted-dashboard.test.js`
- Create: `apps/dashboard/assets/og.png`
- Modify: `apps/dashboard/index.html`
- Modify: `package.json`

**Interfaces:**
- Produces `npm run build:site`.
- Produces `dist/public/**` with the validated dashboard, source modules, demo bundle, fonts, video, poster, and social image.
- Produces `dist/server/index.js`, a Cloudflare Worker-compatible ESM handler.
- The hosted worker serves GET/HEAD only, delegates static bytes to `env.ASSETS.fetch`, injects the request origin into hosted social metadata, and adds the same security headers as the local dashboard server.

- [ ] **Step 1: Write the failing hosted-package tests**

Test that `npm run build:site` produces all exact paths. Import `dist/server/index.js` with a fake `env.ASSETS.fetch` and assert:

```js
const response=await worker.fetch(new Request("https://sentinel.example/"),fakeEnv);
assert.equal(response.status,200);
assert.match(await response.text(),/https:\/\/sentinel\.example\/assets\/og\.png/);
assert.match(response.headers.get("content-security-policy"),/default-src 'none'/);
```

Assert POST returns 405 without calling `env.ASSETS`, traversal-like paths do not bypass the static binding, video receives `public, max-age=31536000, immutable`, and HTML receives `no-store`.

- [ ] **Step 2: Run the hosted test and verify RED**

Run:

```bash
node --test scripts/test/hosted-dashboard.test.js
```

Expected: FAIL because `build:site` and the worker do not exist.

- [ ] **Step 3: Generate one Sentinel-specific social preview**

Use the `imagegen` skill exactly once with this prompt:

```text
Create a complete 1200×630 landscape social preview for GenLayer Sentinel, a cross-chain policy firewall. Mineral-white field fading into a subtle abstract mesh of connected chain nodes, smoked-black typography reading exactly “GenLayer Sentinel” and “Verify policy before messages cross chains.”, restrained safety-lime verification accents, polished editorial technology aesthetic, no travel imagery, no coin logos, no extra text, high legibility at small size.
```

Inspect the result. If the required text is wrong or invented, retry once; otherwise save it as `apps/dashboard/assets/og.png`. Do not ship a generic fallback.

- [ ] **Step 4: Implement deterministic hosting output**

`build-hosted-dashboard.mjs` must:

1. remove and recreate only `dist/public` and `dist/server`;
2. run after the normal dashboard build;
3. copy the allowlisted dashboard HTML/CSS/JS, demo bundle, audited assets, and `og.png`;
4. transform only the hosted copy of `index.html` so its Open Graph and X image values contain `__SITE_ORIGIN__/assets/og.png`;
5. copy `apps/dashboard/src/hosted-worker.js` to `dist/server/index.js`;
6. reject missing or unexpected source assets.

The worker replaces `__SITE_ORIGIN__` using `new URL(request.url).origin` only in the HTML response, not arbitrary request data.

Add scripts:

```json
"build:site":"npm run build:dashboard && node scripts/build-hosted-dashboard.mjs",
"test:site":"npm run build:site && node --test scripts/test/hosted-dashboard.test.js"
```

- [ ] **Step 5: Run hosted and repository dashboard gates**

Run:

```bash
npm run test:site
npm run check:dashboard
node --test scripts/test/dashboard-assets.test.js apps/dashboard/test/hero-shell.test.js apps/dashboard/test/pathway-audit.test.js services/coordinator/test/status-api.test.js
git diff --check
```

Expected: all hosted and dashboard tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/hosted-worker.js apps/dashboard/assets/og.png apps/dashboard/index.html scripts/build-hosted-dashboard.mjs scripts/test/hosted-dashboard.test.js package.json
git commit -m "feat: package Sentinel dashboard for hosting"
```

### Task 5: Publication and verified live handoff

**Files:**
- Create through Sites tooling: `.openai/hosting.json`
- Modify after successful deployment: `README.md`
- Modify after successful deployment: `docs/DEMO.md`

**Interfaces:**
- Consumes the successful full repository gate from the original M2 Task 12.
- Produces one deployed Sites URL and one GitHub public repository when authentication permits.
- Writes no blockchain deployment record and performs no wallet/testnet transaction.

- [ ] **Step 1: Confirm publication prerequisites**

Run the original M2 focused/full gates first. Confirm:

```text
git status --short        clean except known worktree node_modules
npm run check             zero failures
npm run test:site         zero failures
dist/server/index.js      present
dist/public/index.html    present
```

Do not publish a failing or unreviewed build.

- [ ] **Step 2: Publish through Sites**

Use `sites:sites-building` capability path, then `sites:sites-hosting` fast publish sequence:

1. create the site once;
2. persist only the returned `project_id` in `.openai/hosting.json`;
3. commit the exact validated source;
4. push with the short-lived source credential via per-command authorization header;
5. package with the Sites `scripts/package-site.sh` helper;
6. save one version at the pushed commit SHA;
7. deploy privately by default, or request explicit access-level approval if only public/shared deployment is available;
8. poll to success and open the exact deployed URL in Codex.

- [ ] **Step 3: Smoke-test only the public web surface**

At the deployed URL verify:

- hero HTML, poster, video, fonts, modules, and social image return 200;
- `NOT OBSERVED` is visible before artifact selection;
- coordinator sections honestly show unavailable on the static public host;
- no external asset request, wallet prompt, transaction, or artifact upload occurs;
- reduced-motion and mobile CSS are present.

Do not run the live pathway RPC CLI unless a separate explicit safe public manifest is supplied.

- [ ] **Step 4: Restore GitHub authentication and publish the repository**

Current discovered state is `gh` account `Lexiweb31` with an invalid token and no Git remote. If still invalid, stop only this GitHub sub-step and ask the user to complete `gh auth login -h github.com`; do not copy tokens into chat or repository files.

After authentication:

```bash
gh auth status
gh repo view Lexiweb31/genlayer-sentinel-dvn
```

If the repository does not exist, create exactly `Lexiweb31/genlayer-sentinel-dvn` as public from the clean integrated repository. If it exists, verify ownership before adding it as `origin`. Push the integrated default branch and no secret-bearing refs.

- [ ] **Step 5: Bind the verified live URL and re-publish docs**

Only after deployment status is `succeeded`, add the exact URL to the README and demo guide with these adjacent limitations:

```text
Web dashboard: DEPLOYED
Pathway contracts: NOT DEPLOYED BY THIS MILESTONE
LayerZero DVN onboarding: NOT COMPLETED
GenLayer live finality: NOT CLAIMED
Production readiness: NO
```

Run documentation/dashboard checks, commit `docs: publish Sentinel dashboard URL`, and push the integrated branch again.

## Completion Criteria

- The first viewport matches the approved navigation/headline/glass-card composition with only Sentinel content.
- The travel video and Wandor brand are absent.
- Fonts and motion assets are self-origin, hash-pinned, licensed, and size-bounded.
- The upload control performs real in-memory JSON selection; nothing is uploaded or persisted.
- No valid or invalid artifact can fabricate coordinator packet state.
- Existing operational/demo/runtime/recovery/delivery behavior and tests remain intact.
- Mobile, keyboard, focus, and reduced-motion contracts pass.
- Hosted output is deterministic and Cloudflare Worker-compatible.
- The full repository gate passes before publication.
- A successful Sites deployment returns a verified URL; README claims it only after verification.
- GitHub publication proceeds only after authenticated ownership is confirmed.
- No blockchain deployment, signer provisioning, funding, onboarding, or production-readiness claim occurs.
