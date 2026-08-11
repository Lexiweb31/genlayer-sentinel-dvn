# Sentinel Public Site And Console Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a premium public Sentinel landing page at `/` and preserve the honest operational dashboard as a separately packaged `/console` route.

**Architecture:** Keep the existing static dashboard and hosted-worker model. Move the operations markup to `apps/dashboard/console/index.html`, package both HTML routes and their self-origin assets, and explicitly allow the console route in the worker. The public page has a small local-only redirect/search controller; all coordinator polling, wallet connection, local evidence parsing, and demo state remain in the console entry point.

**Tech Stack:** Static HTML, CSS, browser ES modules, Node.js test runner, esbuild, custom static-site packager, hosted worker.

## Global Constraints

- `/` is a public explanation; `/console` is the operator interface.
- The product remains a read-only, not-deployed, testnet prototype until independently verified deployment capability exists.
- No fake packets, decisions, signer counts, live traffic, mainnet claims, or coordinator fallbacks.
- Keep self-origin assets only; do not add remote scripts, stylesheets, fonts, trackers, or image URLs.
- No browser persistence for local pathway evidence; no private keys, seed phrases, or transaction-signing requests in the public route.
- Electric blue is the primary active signal; green means independently confirmed completion; amber means pending; red means rejection or unavailable evidence.
- Preserve worker CSP, allowed-method behavior, metadata-origin rewriting, and diagnostic route denial.

---

### Task 1: Make two static routes packageable and safe to serve

**Files:**
- Create: `apps/dashboard/console/index.html`
- Modify: `scripts/build-hosted-dashboard.mjs`
- Modify: `apps/dashboard/src/hosted-worker.js`
- Modify: `scripts/test/hosted-dashboard.test.js`

**Interfaces:**
- Consumes: `buildHostedDashboard({root})` and the worker `fetch(request, env)` contract.
- Produces: `dist/public/index.html`, `dist/public/console/index.html`, mirrored client files, and worker support for `GET`/`HEAD` on `/console` and `/console/`.

- [ ] **Step 1: Write failing packaging and worker tests**

  Add `/console/index.html` to `expectedPublicFiles` and add a route test that delegates only these paths:

  ```js
  test("the worker resolves the console route to the packaged console HTML", async () => {
    const page = await readFile("dist/public/console/index.html");
    const response = await worker.fetch(new Request("https://sentinel.example/console/"), {
      ASSETS: { fetch: async request =>
        new URL(request.url).pathname === "/console/index.html"
          ? new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } })
          : new Response("not found", { status: 404 })
      }
    });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Sentinel Console/);
  });
  ```

- [ ] **Step 2: Run the focused test to prove packaging currently fails**

  Run: `node --test scripts/test/hosted-dashboard.test.js`

  Expected: FAIL because `dist/public/console/index.html` is not emitted and `/console/` is not an allowed static route.

- [ ] **Step 3: Move the current operations HTML into the console source**

  Copy the current operational document to `apps/dashboard/console/index.html`. Change its title to `Sentinel Console — governed cross-chain message inspection.` and use root-absolute self-origin dependencies so the nested route resolves them:

  ```html
  <link rel="stylesheet" href="/src/console.css">
  <script type="module" src="/src/app.js"></script>
  <script type="module" src="/assets/demo.js"></script>
  ```

  Preserve every existing operational element ID and its read-only boundary copy. Add a top-level `Open public site` link to `/`; do not duplicate a marketing hero in the console.

- [ ] **Step 4: Extend the packager with nested-route output**

  In `buildHostedDashboard`, read both source documents, keep the existing social-image replacement only for public `index.html`, and write the console document at `publicRoot/console/index.html` and `clientRoot/console/index.html`. Ensure `mkdir(dirname(output), {recursive:true})` precedes each nested write.

- [ ] **Step 5: Make worker route resolution explicit**

  In `hosted-worker.js`, map `/console` and `/console/` to `/console/index.html` before static delegation. Keep `/console/index.html` permitted. Keep `/package.json`, traversal-like paths, `/__sentinel-assets`, and all mutation methods rejected. Root metadata rewriting remains root-only; console HTML must be served with the same CSP and no-store document policy.

- [ ] **Step 6: Run packaging tests**

  Run: `npm run test:site`

  Expected: PASS, including root metadata rewriting, console routing, worker security tests, and exact packaged-file assertions.

- [ ] **Step 7: Commit the routing package work**

  ```bash
  git add apps/dashboard/console/index.html apps/dashboard/src/hosted-worker.js scripts/build-hosted-dashboard.mjs scripts/test/hosted-dashboard.test.js
  git commit -m "feat: package Sentinel public and console routes"
  ```

### Task 2: Build the honest public landing page

**Files:**
- Modify: `apps/dashboard/index.html`
- Create: `apps/dashboard/src/landing.css`
- Create: `apps/dashboard/src/landing.js`
- Modify: `scripts/build-hosted-dashboard.mjs`
- Modify: `scripts/check-dashboard.mjs`
- Create: `apps/dashboard/test/landing-page.test.js`

**Interfaces:**
- Consumes: `/console/` as the only operational destination and the self-origin asset bundle.
- Produces: public page elements `#landing-inspect`, `#landing-query`, `#landing-status`, and `#landing-proof-path`.

- [ ] **Step 1: Write failing landing-page tests**

  Create a test that reads `apps/dashboard/index.html` and asserts:

  ```js
  test("public site focuses on the truthful product thesis and console handoff", () => {
    assert.match(html, /Proof before value moves\./);
    assert.match(html, /id="landing-inspect"[^>]*href="\/console\/"/);
    assert.match(html, /id="landing-query"/);
    assert.match(html, /id="landing-proof-path"/);
    assert.equal(html.includes("demo-workspace"), false);
    assert.equal(html.includes("local harness"), false);
  });
  ```

- [ ] **Step 2: Run the test and confirm it fails**

  Run: `node --test apps/dashboard/test/landing-page.test.js`

  Expected: FAIL because the existing root document is the operations workspace.

- [ ] **Step 3: Replace root markup with a short public page**

  Implement a self-contained public document with:

  - wordmark and two quiet links: `Trust model` and `Open console`;
  - hero heading `Proof before value moves.`;
  - one search-style input labelled `Inspect a packet or transaction`; when it contains text, route to `/console/?q=${encodeURIComponent(value)}`; when empty, route to `/console/`;
  - `#landing-proof-path` with exactly source packet, confirmations, finalized policy, signer quorum, and destination execution;
  - concise testnet status and trust-model text; and
  - a final `Open Sentinel Console` CTA.

  Do not add a video, dashboard table, coordinator fetch, wallet connection, file upload, fake live metrics, or a transaction button to this route.

- [ ] **Step 4: Implement the public styling and handoff controller**

  `landing.css` defines the ink/blue token system, wide editorial typography, thin separators, responsive proof-path stacking, visible keyboard focus, and `prefers-reduced-motion` behavior. `landing.js` only validates that query input is nonempty before redirecting to `/console/` and preserves it as the URL `q` parameter; it must not fetch data or access `window.ethereum`.

- [ ] **Step 5: Add the landing files to hosted packaging and safety checks**

  Add `src/landing.css` and `src/landing.js` to `COPIES` and `expectedPublicFiles`. Update `scripts/check-dashboard.mjs` to read both HTML documents separately, assert root-only public IDs/copy, and assert `landing.js` contains neither `fetch(` nor `ethereum`.

- [ ] **Step 6: Run focused public-page checks**

  Run: `node --test apps/dashboard/test/landing-page.test.js && npm run build:site && npm run check:dashboard`

  Expected: PASS with a root page that is static and a console that retains operational guardrails.

- [ ] **Step 7: Commit the public-site work**

  ```bash
  git add apps/dashboard/index.html apps/dashboard/src/landing.css apps/dashboard/src/landing.js scripts/build-hosted-dashboard.mjs scripts/check-dashboard.mjs apps/dashboard/test/landing-page.test.js
  git commit -m "feat: add Sentinel public site"
  ```

### Task 3: Recompose the console around message inspection

**Files:**
- Create: `apps/dashboard/src/console.css`
- Modify: `apps/dashboard/console/index.html`
- Modify: `apps/dashboard/src/app.js`
- Modify: `apps/dashboard/test/hero-shell.test.js`
- Create: `apps/dashboard/test/console-shell.test.js`
- Modify: `scripts/build-hosted-dashboard.mjs`
- Modify: `scripts/check-dashboard.mjs`

**Interfaces:**
- Consumes: existing `/api/jobs`, `/api/deliveries`, `/api/runtime-status`, `/api/dead-letters`, `/api/recovery-actions`, the read-only wallet functions, and the optional `q` URL parameter.
- Produces: console elements `#console-search`, `#message-list`, `#console-empty`, `#console-detail`, and URL-selected packet state.

- [ ] **Step 1: Write failing console-shell tests**

  Add assertions for a message-first entry while retaining all existing behavior targets:

  ```js
  test("console starts with an inbox and an explicit empty observation state", () => {
    for (const id of ["console-search", "message-list", "console-empty", "console-detail"]) {
      assert.match(html, new RegExp(`\\bid="${id}"`, "i"));
    }
    assert.ok(html.includes("No packets are currently observed."));
    assert.ok(html.includes("Open public site"));
  });
  ```

- [ ] **Step 2: Run console tests and prove the new shell is missing**

  Run: `node --test apps/dashboard/test/hero-shell.test.js apps/dashboard/test/console-shell.test.js`

  Expected: FAIL because the old hero-first portal shell remains.

- [ ] **Step 3: Replace only the console presentation shell**

  In `console/index.html`, replace the marketing hero, fixed portal sidebar, and broad homepage proof story with:

  - a compact utility bar containing public-site link, current route label, wallet state, and testnet label;
  - an inbox header and `#console-search` field;
  - a row-based `#message-list` with origin, destination, identifier, observed time, and current stage;
  - `#console-empty` for no coordinator records and unavailable coordinator data; and
  - `#console-detail` containing the current canonical identity, ordered evidence rail, policy result, signer progress, and destination state.

  Preserve the current evidence-file view, runtime observation, delivery, recovery, and local-demo content as compact expandable inspector sections beneath the selected message. No existing backend endpoint or browser event changes in this task.

- [ ] **Step 4: Add focused console styling**

  `console.css` owns the console's ink/blue responsive grid, table rows, state colors, narrow technical labels, 44px minimum interactive targets, motion-reduction behavior, and console-to-detail small-screen layout. Remove portal/landing-only selectors from the console document rather than hiding them with CSS.

- [ ] **Step 5: Bind search and URL selection in `app.js`**

  Add pure helpers with exact behavior:

  ```js
  export function normalizeConsoleQuery(value) {
    return String(value ?? "").trim().toLowerCase();
  }

  export function matchesConsoleQuery(job, query) {
    const haystack = [job.packet.guid, job.packet.txHash, job.packet.srcEid, job.packet.dstEid, job.stage]
      .filter(value => value != null).join(" ").toLowerCase();
    return query === "" || haystack.includes(query);
  }
  ```

  Read `q` and `guid` with `new URLSearchParams(location.search)`. Filter rows without mutating `jobs`; selecting a row updates only `guid` via `history.replaceState`. A missing query result renders `No observed packet matches this query.` and never substitutes a fixture. Existing coordinator polling continues to populate data and updates the selected inspector only if the selected GUID remains present.

- [ ] **Step 6: Run dashboard behavior tests**

  Run: `npm run build:dashboard && node --test apps/dashboard/test/hero-shell.test.js apps/dashboard/test/console-shell.test.js apps/dashboard/test/timeline.test.js apps/dashboard/test/wallet-action.test.js apps/dashboard/test/pathway-audit.test.js && npm run check:dashboard`

  Expected: PASS. The console has a usable empty state, existing read-only mechanisms remain present, and dashboard checks find no simulated fallback or mutation request.

- [ ] **Step 7: Commit the console work**

  ```bash
  git add apps/dashboard/console/index.html apps/dashboard/src/console.css apps/dashboard/src/app.js apps/dashboard/test/hero-shell.test.js apps/dashboard/test/console-shell.test.js scripts/build-hosted-dashboard.mjs scripts/check-dashboard.mjs
  git commit -m "feat: make Sentinel console message-first"
  ```

### Task 4: Update public documentation and run route-level verification

**Files:**
- Modify: `README.md`
- Modify: `docs/DEMO.md`
- Modify: `docs/SECURITY_STATUS.md`
- Modify: `scripts/test/hosted-dashboard.test.js`

**Interfaces:**
- Consumes: final `/` and `/console/` public route behavior.
- Produces: user-facing instructions that distinguish a public explanation from a read-only testnet console.

- [ ] **Step 1: Write failing documentation assertions**

  Add a hosted package test asserting both route paths exist and that root and console have distinct titles:

  ```js
  test("the package contains distinct public and console experiences", async () => {
    const publicPage = await readFile("dist/public/index.html", "utf8");
    const consolePage = await readFile("dist/public/console/index.html", "utf8");
    assert.match(publicPage, /Proof before value moves\./);
    assert.match(consolePage, /Sentinel Console/);
    assert.equal(publicPage.includes("demo-workspace"), false);
  });
  ```

- [ ] **Step 2: Run it before the final documentation update**

  Run: `node --test scripts/test/hosted-dashboard.test.js`

  Expected: PASS after Tasks 1–3; if it fails, fix packaging before editing docs.

- [ ] **Step 3: Update documentation with exact route roles**

  In `README.md`, document `/` as the public product site and `/console/` as a read-only testnet operations inspector. In `docs/DEMO.md`, lead the walkthrough with the public site, then direct the evaluator to the console search/inbox and explicit unavailable states. In `docs/SECURITY_STATUS.md`, state that route separation changes presentation only and does not constitute deployment, DVN onboarding, GenLayer finality integration, or live signer quorum.

- [ ] **Step 4: Run the full relevant verification suite**

  Run: `npm run build && npm run test:site && node --test apps/dashboard/test/*.test.js && git diff --check`

  Expected: PASS. Do not deploy, publish, or claim that the live hosted site has switched until a separately approved deployment succeeds.

- [ ] **Step 5: Commit documentation and final verification evidence**

  ```bash
  git add README.md docs/DEMO.md docs/SECURITY_STATUS.md scripts/test/hosted-dashboard.test.js
  git commit -m "docs: describe Sentinel public site and console"
  ```

## Plan Self-Review

- **Spec coverage:** Task 1 creates and protects routes; Task 2 delivers the short public site; Task 3 delivers the message-first console and truthful state handling; Task 4 updates documentation and verifies both routes.
- **No overreach:** No task deploys contracts, sends transactions, opens cloud resources, changes LayerZero configuration, or adds a mainnet claim.
- **Type consistency:** The console search helpers consume the existing job shape used by `render(job)`: `job.packet.guid`, `job.packet.txHash`, `job.packet.srcEid`, `job.packet.dstEid`, and `job.stage`.
- **Placeholder scan:** No deferred implementation markers or unspecified test steps remain.
