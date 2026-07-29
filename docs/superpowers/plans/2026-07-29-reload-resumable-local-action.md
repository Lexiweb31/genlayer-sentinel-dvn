# Reload-Resumable Local Action Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve one mined local OApp action across a same-tab reload and resume authoritative coordinator observation without reconnecting the wallet or resending a transaction.

**Architecture:** Add a strict `sessionStorage` locator codec and a pure bootstrap resolver whose only dependencies are browser storage and a read-only public-capability loader. Extend the existing reducer with explicit restored states, then wire the result into the browser entrypoint while reusing the existing coordinator polling path.

**Tech Stack:** Node.js 22.13+, TypeScript 5.8.3, ethers 6.17.0, esbuild 0.28.1, Node test runner.

## Global Constraints

- Same-tab local demonstration only; no testnet deployment, funding, cloud resources, credentials, backend session, or publication.
- Persist only version, chain ID, source OApp, source endpoint, destination EID, transaction hash, and GUID.
- Persist only after one matching mined `ActionSent` GUID has been decoded.
- Browser storage is a locator, never deterministic, policy, signer, destination, or execution evidence.
- Restoration must not request wallet accounts, quote, sign, submit, or resend a transaction.
- Coordinator browser traffic remains same-origin read-only `GET`.
- A matched job `404` means delayed ingestion and must not be presented as rejection, expiry, or execution.
- Capability failure retains a valid locator without polling; definitive capability mismatch removes it.
- The one-action-per-harness lock remains in force across reload and terminal states.
- Use `sessionStorage`; do not use `localStorage`, cookies, or server-side state.
- Implementation follows strict red-green-refactor TDD and ends with the full repository check.

---

## File Structure

### New files

- `apps/dashboard/src/demo-session.ts` — exact locator schema, safe storage operations, canonicalization, and capability binding.
- `apps/dashboard/src/demo-bootstrap.ts` — pure startup resolution from storage and validated capability loading.
- `apps/dashboard/test/demo-session.test.js` — storage validation and binding behavior.
- `apps/dashboard/test/demo-bootstrap.test.js` — startup result behavior without wallet dependencies.

### Modified files

- `apps/dashboard/src/demo-state.ts` — explicit matched and unavailable restoration transitions.
- `apps/dashboard/test/demo-state.test.js` — restored-state safety and coordinator-evidence tests.
- `apps/dashboard/src/demo-entry.ts` — bootstrap rendering, post-GUID persistence, and read-only polling resume.
- `scripts/check-dashboard.mjs` — bundle guard for same-tab storage and restored-state behavior.
- `README.md` — operator-facing reload behavior and trust limitation.
- `docs/DEMO.md` if present, otherwise `docs/demo.md` if present — local walkthrough details.

---

### Task 1: Add the strict session locator

**Files:**
- Create: `apps/dashboard/src/demo-session.ts`
- Create: `apps/dashboard/test/demo-session.test.js`

**Interfaces:**
- Consumes: `PublicDemoConfig` from `apps/dashboard/src/wallet-action.ts`.
- Produces: `StorageLike`, `DemoSessionLocator`, `readDemoSession`, `writeDemoSession`, `clearDemoSession`, and `matchesDemoCapability`.

- [ ] **Step 1: Write the failing round-trip and canonicalization tests**

Create a small in-memory `StorageLike` in the test and exercise the wished-for API:

```js
const storage=memoryStorage();
assert.equal(writeDemoSession(storage,config,{transactionHash,guid}),true);
assert.deepEqual(readDemoSession(storage),{
  version:1,
  chainId:"31337",
  sourceOApp:config.sourceOApp.toLowerCase(),
  sourceEndpoint:config.sourceEndpoint.toLowerCase(),
  destinationEid:config.destinationEid,
  transactionHash:transactionHash.toLowerCase(),
  guid:guid.toLowerCase()
});
```

The production regression caught by this test is losing a valid locator or preserving noncanonical identity values.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm run build
node --test apps/dashboard/test/demo-session.test.js
```

Expected: FAIL because `dist/apps/dashboard/src/demo-session.js` does not exist.

- [ ] **Step 3: Implement the minimal exact-schema codec**

Implement:

```ts
export const DEMO_SESSION_KEY="genlayer-sentinel.local-action.v1";
export interface StorageLike {
  getItem(key:string):string|null;
  setItem(key:string,value:string):void;
  removeItem(key:string):void;
}
export interface DemoSessionLocator {
  version:1;
  chainId:"31337";
  sourceOApp:Hex;
  sourceEndpoint:Hex;
  destinationEid:number;
  transactionHash:Hex;
  guid:Hex;
}
export function readDemoSession(storage:StorageLike|undefined):DemoSessionLocator|undefined;
export function writeDemoSession(
  storage:StorageLike|undefined,
  config:PublicDemoConfig,
  submission:{transactionHash:string;guid:string}
):boolean;
export function clearDemoSession(storage:StorageLike|undefined):void;
export function matchesDemoCapability(locator:DemoSessionLocator,config:PublicDemoConfig):boolean;
```

Use exact keys, a 1,024-character input ceiling, nonzero address/hash validation, positive safe EID validation, lowercase canonicalization, and caught storage exceptions.

- [ ] **Step 4: Write failing malformed-storage and mismatch tests**

Table-drive literal invalid records for malformed JSON, extra fields, version `2`, chain `"1"`, zero address, zero hash, malformed hash, EID `0`, unsafe EID, and a string longer than 1,024 characters. Assert each returns `undefined` and removes the key. Add one storage double whose methods throw and assert read, write, and clear do not throw.

For harness binding, mutate each of `chainId`, `sourceOApp`, `sourceEndpoint`, and `destinationEid` independently and assert `matchesDemoCapability` returns `false`.

The production regressions caught are accepting injected fields, retaining corrupt storage, crashing when storage is disabled, or resuming against a different harness.

- [ ] **Step 5: Run the focused tests and complete GREEN**

Run:

```bash
npm run build
node --test apps/dashboard/test/demo-session.test.js
```

Expected: all session tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/demo-session.ts apps/dashboard/test/demo-session.test.js
git commit -m "feat: add strict local action session locator"
```

---

### Task 2: Resolve bootstrap state without wallet dependencies

**Files:**
- Create: `apps/dashboard/src/demo-bootstrap.ts`
- Create: `apps/dashboard/test/demo-bootstrap.test.js`

**Interfaces:**
- Consumes: `StorageLike`, session-locator functions, and `PublicDemoConfig`.
- Produces: `DemoBootstrapResult` and `resolveDemoBootstrap(storage,loadCapability)`.

- [ ] **Step 1: Write the failing fresh and matched-resume tests**

Use a real in-memory storage implementation and complete public configuration fixture:

```js
assert.deepEqual(
  await resolveDemoBootstrap(storage,async()=>config),
  {kind:"FRESH",config}
);
writeDemoSession(storage,config,{transactionHash,guid});
assert.deepEqual(
  await resolveDemoBootstrap(storage,async()=>config),
  {kind:"RESUME",config,locator:readDemoSession(storage)}
);
```

The production regression caught is failing to resume a matching action or inventing restoration without a saved locator.

- [ ] **Step 2: Run the focused bootstrap test and verify RED**

Run:

```bash
npm run build
node --test apps/dashboard/test/demo-bootstrap.test.js
```

Expected: FAIL because the bootstrap module does not exist.

- [ ] **Step 3: Implement the closed bootstrap result**

Implement:

```ts
export type DemoBootstrapResult=
  |{kind:"FRESH";config:PublicDemoConfig}
  |{kind:"RESUME";config:PublicDemoConfig;locator:DemoSessionLocator}
  |{kind:"RESTORED_UNAVAILABLE";locator:DemoSessionLocator}
  |{kind:"DISABLED"};

export async function resolveDemoBootstrap(
  storage:StorageLike|undefined,
  loadCapability:()=>Promise<PublicDemoConfig>
):Promise<DemoBootstrapResult>;
```

Read the locator before awaiting the capability. On capability failure, return unavailable only when a locator exists. On match, return resume. On mismatch, clear and return fresh.

- [ ] **Step 4: Write failing unavailable and mismatch tests**

Assert:

```js
const unavailable=await resolveDemoBootstrap(storage,async()=>{throw new Error("offline")});
assert.deepEqual(unavailable,{kind:"RESTORED_UNAVAILABLE",locator});
assert.deepEqual(readDemoSession(storage),locator);

const changed={...config,sourceOApp:"0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"};
const fresh=await resolveDemoBootstrap(storage,async()=>changed);
assert.deepEqual(fresh,{kind:"FRESH",config:changed});
assert.equal(readDemoSession(storage),undefined);
```

Also assert capability failure without a locator returns `{kind:"DISABLED"}` and a throwing storage implementation still permits `{kind:"FRESH",config}`.

The production regressions caught are deleting state on a transient failure, polling an unknown harness, or keeping a locator after affirmative mismatch.

- [ ] **Step 5: Run focused session and bootstrap tests**

Run:

```bash
npm run build
node --test apps/dashboard/test/demo-session.test.js apps/dashboard/test/demo-bootstrap.test.js
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/demo-bootstrap.ts apps/dashboard/test/demo-bootstrap.test.js
git commit -m "feat: resolve local action reload state"
```

---

### Task 3: Extend the presentation state machine

**Files:**
- Modify: `apps/dashboard/src/demo-state.ts`
- Modify: `apps/dashboard/test/demo-state.test.js`

**Interfaces:**
- Consumes: validated locator identifiers from `DemoBootstrapResult`.
- Produces: `RESTORED_UNAVAILABLE`, `DemoState.restored`, `ACTION_RESTORED`, and `ACTION_RESTORE_UNAVAILABLE`.

- [ ] **Step 1: Write failing matched-restoration tests**

Add:

```js
let state=reduceDemoState(initialDemoState(),{type:"CAPABILITY_AVAILABLE"});
state=reduceDemoState(state,{type:"ACTION_RESTORED",transactionHash,guid});
assert.deepEqual(state,{
  phase:"COORDINATOR_PENDING",
  transactionHash,
  guid,
  restored:true
});
assert.deepEqual(reduceDemoState(state,{type:"INVALIDATED"}),state);
assert.throws(
  ()=>reduceDemoState(state,{type:"SENTINEL_EXECUTED"}),
  /invalid demo transition/
);
```

Then advance the same state through `COORDINATOR_STAGE: EXECUTED` and assert it reaches `SENTINEL_EXECUTED` while retaining `restored:true`.

The production regression caught is restoration bypassing coordinator evidence or unlocking a submitted source action.

- [ ] **Step 2: Run the reducer test and verify RED**

Run:

```bash
npm run build
node --test apps/dashboard/test/demo-state.test.js
```

Expected: FAIL because the restoration event is not accepted.

- [ ] **Step 3: Implement matched restoration**

Add `restored?:true` to `DemoState`, accept `ACTION_RESTORED` only from `WALLET_REQUIRED` with nonzero canonical hash inputs, and enter `COORDINATOR_PENDING`.

- [ ] **Step 4: Write the failing unavailable-restoration test**

Add:

```js
const state=reduceDemoState(initialDemoState(),{
  type:"ACTION_RESTORE_UNAVAILABLE",
  transactionHash,
  guid
});
assert.deepEqual(state,{
  phase:"RESTORED_UNAVAILABLE",
  transactionHash,
  guid,
  restored:true
});
assert.deepEqual(reduceDemoState(state,{type:"INVALIDATED"}),state);
assert.throws(
  ()=>reduceDemoState(state,{type:"COORDINATOR_STAGE",stage:"EXECUTED"}),
  /invalid demo transition/
);
```

The production regression caught is an unverified current harness being allowed to poll or produce an execution state.

- [ ] **Step 5: Implement unavailable restoration and run reducer tests**

Add `RESTORED_UNAVAILABLE` to `DemoPhase`. Accept `ACTION_RESTORE_UNAVAILABLE` only from `DISABLED`. Preserve the existing invalidation lock whenever a transaction hash exists.

Run:

```bash
npm run build
node --test apps/dashboard/test/demo-state.test.js
```

Expected: all reducer tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/demo-state.ts apps/dashboard/test/demo-state.test.js
git commit -m "feat: model restored local action states"
```

---

### Task 4: Wire restoration into the operational dashboard

**Files:**
- Modify: `apps/dashboard/src/demo-entry.ts`
- Modify: `scripts/check-dashboard.mjs`
- Modify: `README.md`
- Modify: the existing local demo guide discovered under `docs/`

**Interfaces:**
- Consumes: `resolveDemoBootstrap`, `writeDemoSession`, and the new reducer events.
- Preserves: existing `sentinel:guid-observed`, `/api/jobs/:guid`, `/api/deliveries`, and wallet click handlers.

- [ ] **Step 1: Add a failing executable dashboard guard**

Extend `scripts/check-dashboard.mjs` to read the generated bundle and fail unless:

- it contains `genlayer-sentinel.local-action.v1`;
- it contains the `RESTORED_UNAVAILABLE` presentation;
- it contains `sessionStorage`;
- it does not contain `localStorage`; and
- the existing no-mutation and no-wallet-secret guards continue to pass.

Run:

```bash
npm run build:dashboard
npm run check:dashboard
```

Expected: FAIL because the entrypoint does not yet use the session bootstrap.

The production regressions caught are accidentally switching to longer-lived storage, omitting the restoration path from the shipped bundle, or weakening browser security guards.

- [ ] **Step 2: Implement bootstrap result rendering**

Replace `loadCapability` startup with:

```ts
void bootstrap();

async function bootstrap():Promise<void>{
  const result=await resolveDemoBootstrap(browserSessionStorage(),fetchCapability);
  if(result.kind==="DISABLED"){disable("The local wallet action capability is unavailable.");return}
  if(result.kind==="RESTORED_UNAVAILABLE"){
    showStoredIdentifiers(result.locator);
    transition({
      type:"ACTION_RESTORE_UNAVAILABLE",
      transactionHash:result.locator.transactionHash,
      guid:result.locator.guid
    });
    return;
  }
  config=result.config;
  showCapability(config);
  transition({type:"CAPABILITY_AVAILABLE"});
  if(result.kind==="RESUME"){
    transition({
      type:"ACTION_RESTORED",
      transactionHash:result.locator.transactionHash,
      guid:result.locator.guid
    });
    window.dispatchEvent(new CustomEvent("sentinel:guid-observed",{detail:{guid:result.locator.guid}}));
    scheduleCoordinatorPoll(result.locator.guid,0);
  }
}
```

`fetchCapability` performs only the existing same-origin `GET /api/demo/config` and strict parsing. `browserSessionStorage` catches access exceptions. `showStoredIdentifiers` displays only the source OApp, destination EID, transaction hash, and GUID supplied by the parsed locator.

- [ ] **Step 3: Persist only after GUID observation**

Immediately after the successful `GUID_OBSERVED` transition, call:

```ts
writeDemoSession(browserSessionStorage(),config,submission);
```

Do not persist from `SOURCE_SUBMITTED`, wallet confirmation, receipt failure, or any coordinator stage.

- [ ] **Step 4: Add honest restored-state and delayed-ingestion copy**

Render:

- `RESTORED UNAVAILABLE`: “Saved public transaction and GUID retained. The current local harness cannot be verified, so Sentinel will not poll or resend.”
- matched restored pending: “Saved public locator restored. Loading authoritative coordinator evidence; no wallet request or source resend occurred.”
- matched job `404`: “The matching harness has not ingested this GUID yet. Sentinel will keep checking without resending.”

Keep the transaction and GUID fields visible and all connect, input, quote, and send controls disabled when `state.transactionHash` exists.

- [ ] **Step 5: Run dashboard, reducer, and bootstrap tests**

Run:

```bash
npm run build
node --test apps/dashboard/test/demo-session.test.js apps/dashboard/test/demo-bootstrap.test.js apps/dashboard/test/demo-state.test.js apps/dashboard/test/dashboard.test.js apps/dashboard/test/wallet-action.test.js
npm run check:dashboard
```

Expected: all selected tests and dashboard guards pass.

- [ ] **Step 6: Document operator-visible semantics**

Add a concise reload section to README and the existing local demo guide:

```text
After a mined ActionSent event, the app stores only the current harness binding,
transaction hash, and GUID in same-tab sessionStorage. Reloading the same tab
resumes read-only coordinator observation when the harness matches. The locator
is not proof, never reconnects the wallet, and never resends the source action.
```

Document mismatch clearing and unavailable-capability retention without claiming persistence beyond the tab.

- [ ] **Step 7: Run full verification**

Run:

```bash
npm run check
```

Expected: TypeScript, intelligent-contract lint and direct tests, complete build, dashboard guards, and all repository tests pass with zero failures.

- [ ] **Step 8: Commit**

```bash
git add apps/dashboard/src/demo-entry.ts scripts/check-dashboard.mjs README.md docs
git commit -m "feat: resume local action after reload"
```

---

### Task 5: Review and milestone evidence

**Files:**
- Modify only if review finds a defect.

**Interfaces:**
- Consumes: the complete milestone diff and verification output.
- Produces: reviewed commits with no deployment or publication side effects.

- [ ] **Step 1: Review the complete diff against the design**

Run:

```bash
git diff 0d2c1a5..HEAD --check
git diff 0d2c1a5..HEAD --stat
git log --oneline 0d2c1a5..HEAD
```

Verify each design goal maps to production behavior and at least one regression test. Check mutations for wrong storage key, missing exact-key validation, inverted capability match, premature persistence, polling while unavailable, wallet calls during bootstrap, and terminal-state unlocking.

- [ ] **Step 2: Apply review findings through TDD**

For every behavioral defect, first add a focused failing regression test, run it to observe the expected failure, make the minimal correction, and rerun the focused and full checks.

- [ ] **Step 3: Run final fresh verification**

Run:

```bash
npm run check
git status --short
```

Expected: all checks pass and the worktree contains no uncommitted implementation changes.

- [ ] **Step 4: Preserve the branch**

Do not deploy, fund, create cloud resources, push, publish, merge, or remove the worktree. Report the exact branch, commits, test counts, limitations, and next approval boundary.

