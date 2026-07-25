# Wallet-Originated Local Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a capability-gated local Sentinel app in which an injected wallet quotes and sends a real OApp action, extracts the mined GUID, and follows the same GUID through an honestly labeled fixture policy, 3-of-5 signing, destination verification, and OApp execution or denial.

**Architecture:** Extend the existing same-origin dashboard with a narrowly scoped wallet action workspace. A local-only harness deploys real OApp and adapter bytecode and composes dedicated EDR fixture proof adapters around the existing coordinator; production configuration and independent-RPC validation remain unchanged.

**Tech Stack:** Node.js 22.13+, TypeScript 5.8.3, ethers 6.17.0, esbuild 0.28.1, Solidity 0.8.30 targeting Shanghai, Hardhat 3.10.0 EDR, Node test runner, Node SQLite.

## Global Constraints

- Local, fixture-backed demonstration only; no testnet deployment, funding, cloud resources, credentials, or publication.
- The browser must call `TreasuryPolicyOApp.quoteAction` and `sendAction` through an injected EIP-1193 wallet.
- Sentinel must never accept, persist, log, or serve the wallet private key or seed phrase.
- A mined source transaction must be labeled as packet emission, not Sentinel approval.
- Only the exact `record(bytes32)` action, configured OApp, target, destination EID, zero action value, and options are supported.
- Every action uses the same authoritative authorization ID; changed calldata must be denied semantically before signing.
- Local semantic results must be labeled `LOCAL_POLICY_FIXTURE`, never GenLayer consensus.
- Local packet, pathway, destination, and executor proofs must be labeled fixtures and must not weaken production independent-RPC validators.
- External injected mode remains read-only unless a future separately approved design enables wallet submission.
- The dashboard may use only self-origin assets; no CDN, remote script, inline script, or dynamic import.
- Implementation follows strict red-green-refactor TDD and ends with the full repository check.

---

## File Structure

### New files

- `services/coordinator/src/demo-capability.ts` — strict public demo capability parser and serializer.
- `services/coordinator/src/local-demo-policy.ts` — static governance evidence plus pending-then-final fixture policy.
- `services/coordinator/src/local-demo-proofs.ts` — receipt, packet, path, destination, and local executor proof adapters.
- `services/coordinator/src/local-demo-harness.ts` — deploy and compose a complete loopback-only demo session.
- `services/coordinator/src/local-demo-cli.ts` — parse CLI arguments, start the harness, and handle signals.
- `apps/dashboard/src/wallet-action.ts` — provider-agnostic EIP-1193 quote/send/receipt client.
- `apps/dashboard/src/demo-state.ts` — pure browser presentation state machine.
- `apps/dashboard/src/demo-entry.ts` — DOM integration and GUID handoff to the operations workspace.
- `apps/dashboard/src/demo.css` — action-workspace styling.
- `scripts/build-dashboard.mjs` — pinned esbuild bundle for the wallet entry.
- Focused unit and integration tests beside the existing coordinator, dashboard, and contract tests.

### Modified files

- `contracts/test/MockEndpointV2.sol` — fixture-only optional DVN fee configuration and `DVNFeePaid` emission.
- `contracts/test/oapp.test.js` — prove paired packet/fee events and real wallet-owned sends.
- `services/coordinator/src/status-api.ts` — sanitized demo config endpoint and one generated bundle asset.
- `services/coordinator/src/compose-runtime.ts` — explicitly passes no demo capability in production/external composition.
- `apps/dashboard/index.html`, `apps/dashboard/src/app.js`, and dashboard guard scripts — action workspace, GUID selection event, and honest-copy checks.
- `package.json` and `package-lock.json` — pin esbuild directly, build the wallet bundle, and expose the local demo command.
- README and operational/security/demo/milestone documents — runnable walkthrough and precise trust labels.

---

### Task 1: Emit fixture-faithful LayerZero fee evidence

**Files:**
- Modify: `contracts/test/MockEndpointV2.sol`
- Modify: `contracts/test/oapp.test.js`

**Interfaces:**
- Consumes: existing `MockEndpointV2.send` and OApp `sendAction`.
- Produces: `setOptionalDvn(address)` and a `DVNFeePaid(address[],address[],uint256[])` event paired with `PacketSent` in the same transaction.

- [ ] **Step 1: Write the failing paired-event test**

Add a local optional DVN address to the OApp fixture, call `setOptionalDvn`, then assert the source receipt contains exactly one matching fee event:

```js
const feeEvent = receipt.logs
  .map(log => { try { return epA.interface.parseLog(log); } catch { return null; } })
  .find(log => log?.name === "DVNFeePaid");
assert.ok(feeEvent);
assert.deepEqual([...feeEvent.args.requiredDVNs], []);
assert.deepEqual(
  [...feeEvent.args.optionalDVNs].map(value => value.toLowerCase()),
  [(await s[5].getAddress()).toLowerCase()]
);
assert.deepEqual([...feeEvent.args.fees], [1000000000000n]);
```

- [ ] **Step 2: Run the focused contract test and verify RED**

Run:

```bash
npm run build
node --test contracts/test/oapp.test.js
```

Expected: FAIL because `setOptionalDvn` and `DVNFeePaid` do not exist.

- [ ] **Step 3: Add the minimal fixture event implementation**

Add to `MockEndpointV2`:

```solidity
event DVNFeePaid(
    address[] requiredDVNs,
    address[] optionalDVNs,
    uint256[] fees
);
address public optionalDvn;

function setOptionalDvn(address dvn) external {
    require(dvn != address(0), "dvn");
    optionalDvn = dvn;
}
```

Inside `send`, require the fixture DVN to be configured and emit:

```solidity
address[] memory requiredDvns = new address[](0);
address[] memory optionalDvns = new address[](1);
optionalDvns[0] = optionalDvn;
uint256[] memory fees = new uint256[](1);
fees[0] = NATIVE_FEE;
emit DVNFeePaid(requiredDvns, optionalDvns, fees);
```

Keep `PacketSent.sendLibrary == address(this)` so the existing listener can pair both events from the configured send library.

- [ ] **Step 4: Run contract and listener regression tests**

Run:

```bash
npm run build
node --test contracts/test/oapp.test.js services/coordinator/test/listener.test.js
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add contracts/test/MockEndpointV2.sol contracts/test/oapp.test.js
git commit -m "test: emit paired local DVN fee evidence"
```

---

### Task 2: Add a strict demo capability boundary

**Files:**
- Create: `services/coordinator/src/demo-capability.ts`
- Create: `services/coordinator/test/demo-capability.test.js`
- Modify: `services/coordinator/src/status-api.ts`
- Modify: `services/coordinator/test/status-api.test.js`
- Modify: `services/coordinator/src/compose-runtime.ts`
- Modify: `services/coordinator/test/compose-runtime.test.js`

**Interfaces:**
- Produces: `DemoCapability`, `parseDemoCapability(value)`, and `publicDemoCapability(capability)`.
- Produces: optional `demo?: DemoCapability` argument on status/dashboard server functions.
- Preserves: existing status-server call sites with demo disabled by default.

- [ ] **Step 1: Write failing parser tests**

Test one valid capability and table-drive invalid cases:

```js
const valid = {
  mode: "LOCAL_WALLET_DEMO",
  chainId: "31337",
  chainName: "Sentinel Local",
  rpcUrl: "http://127.0.0.1:8545/",
  sourceOApp: address("1"),
  sourceEndpoint: address("2"),
  destinationEid: 40231,
  authorizedTarget: address("3"),
  actionSelector: "0xb5c645bd",
  actionSignature: "record(bytes32)",
  approvedRecordLabel: "approved",
  approvedArgument: id("approved"),
  approvedAuthorizationId: hash("5"),
  options: "0x",
  payInLzToken: false,
  semanticSource: "LOCAL_POLICY_FIXTURE"
};
assert.equal(parseDemoCapability(valid).chainId, 31337n);
```

Reject: non-loopback RPC, credentials/query/hash in the URL, chain other than `31337`, wrong selector/signature, malformed addresses/hashes, non-empty unknown fields, nonzero-style options not explicitly accepted, and changed semantic source.

- [ ] **Step 2: Run the parser test and verify RED**

Run:

```bash
npm run build
node --test services/coordinator/test/demo-capability.test.js
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the strict parser**

Implement:

```ts
export interface DemoCapability {
  mode:"LOCAL_WALLET_DEMO";
  chainId:31337n;
  chainName:string;
  rpcUrl:string;
  sourceOApp:Hex;
  sourceEndpoint:Hex;
  destinationEid:number;
  authorizedTarget:Hex;
  actionSelector:Hex;
  actionSignature:"record(bytes32)";
  approvedRecordLabel:string;
  approvedArgument:Hex;
  approvedAuthorizationId:Hex;
  options:Hex;
  payInLzToken:false;
  semanticSource:"LOCAL_POLICY_FIXTURE";
}

export function parseDemoCapability(value:unknown):DemoCapability;
export function publicDemoCapability(value:DemoCapability):Record<string,unknown>;
```

Use exact-key validation. Accept only `http://127.0.0.1:<port>/` or `http://[::1]:<port>/`, no credentials, query, or hash. Normalize addresses and hashes to lowercase. Require `actionSelector === id("record(bytes32)").slice(0,10)`, `approvedRecordLabel` to be nonempty printable text no longer than 80 characters, `id(approvedRecordLabel) === approvedArgument`, and `options === "0x"`.

- [ ] **Step 4: Write failing API capability tests**

Assert:

```js
assert.equal((await statusResponse(c, "GET", "/api/demo/config")).status, 404);
const response = await statusResponse(
  c, "GET", "/api/demo/config", undefined, undefined, presentation, capability
);
assert.equal(response.status, 200);
const body = JSON.parse(response.body);
assert.equal(body.chainId, "31337");
assert.equal(body.semanticSource, "LOCAL_POLICY_FIXTURE");
assert.equal(JSON.stringify(body).includes("private"), false);
assert.equal(
  (await statusResponse(c, "POST", "/api/demo/config", undefined, undefined, presentation, capability)).status,
  405
);
```

- [ ] **Step 5: Expose only the sanitized GET endpoint**

Thread `demo?:DemoCapability` through `statusResponse`, `dashboardResponse`, `createStatusServer`, and `createDashboardServer`. Add:

```ts
if (url.pathname === "/api/demo/config") {
  return demo
    ? {status:200, body:json(publicDemoCapability(demo))}
    : {status:404, body:json({error:"demo capability unavailable"})};
}
```

Leave `composeRuntime` explicitly demo-disabled. Extend its test to prove external and ordinary local composition return `404`.

- [ ] **Step 6: Run focused capability, API, and composition tests**

Run:

```bash
npm run build
node --test services/coordinator/test/demo-capability.test.js services/coordinator/test/status-api.test.js services/coordinator/test/compose-runtime.test.js
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add services/coordinator/src/demo-capability.ts services/coordinator/src/status-api.ts services/coordinator/src/compose-runtime.ts services/coordinator/test/demo-capability.test.js services/coordinator/test/status-api.test.js services/coordinator/test/compose-runtime.test.js
git commit -m "feat: gate public local demo capability"
```

---

### Task 3: Implement the EIP-1193 wallet action client

**Files:**
- Create: `apps/dashboard/src/wallet-action.ts`
- Create: `apps/dashboard/test/wallet-action.test.js`

**Interfaces:**
- Consumes: `DemoCapability` public JSON shape and an injected `Eip1193Provider`.
- Produces: `parsePublicDemoConfig`, `WalletActionClient.connect`, `.quote`, `.submit`, `WalletActionError`, `PreparedQuote`, and `SourceSubmission`.

- [ ] **Step 1: Write failing connection and quote tests**

Define a recording provider that returns deterministic values for `eth_requestAccounts`, `eth_chainId`, `eth_call`, `eth_sendTransaction`, and `eth_getTransactionReceipt`.

Assert the wished-for API:

```js
const client = new WalletActionClient(provider, {pollIntervalMs:0, maxReceiptPolls:3});
const parsed = parsePublicDemoConfig(config);
const session = await client.connect(parsed);
assert.equal(session.account, owner);
const quote = await client.quote(parsed, session, parsed.approvedRecordLabel);
assert.equal(quote.action.authorizationId, config.approvedAuthorizationId);
assert.equal(quote.action.target, config.authorizedTarget);
assert.equal(quote.action.value, 0n);
assert.equal(quote.nativeFee, 1000000000000n);
```

The provider must observe `eth_call` to `owner()` before the quote call.

- [ ] **Step 2: Run the wallet test and verify RED**

Run:

```bash
npm run build
node --test apps/dashboard/test/wallet-action.test.js
```

Expected: FAIL because `WalletActionClient` does not exist.

- [ ] **Step 3: Implement connection, fixed action encoding, and quoting**

Define:

```ts
export type WalletActionErrorCode =
  | "WALLET_UNAVAILABLE" | "ACCOUNT_UNAVAILABLE" | "WRONG_CHAIN"
  | "WRONG_OWNER" | "CONFIG_INVALID" | "QUOTE_REVERTED"
  | "INSUFFICIENT_LOCAL_FUNDS" | "USER_REJECTED" | "SOURCE_REVERTED"
  | "SOURCE_RECEIPT_UNAVAILABLE" | "ACTION_EVENT_MISSING"
  | "ACTION_EVENT_AMBIGUOUS";

export interface Eip1193Provider {
  request(args:{method:string;params?:unknown[]}):Promise<unknown>;
  on?(event:"accountsChanged"|"chainChanged", listener:(value:unknown)=>void):void;
  removeListener?(event:"accountsChanged"|"chainChanged", listener:(value:unknown)=>void):void;
}
```

Define a strict `PublicDemoConfig` that mirrors the sanitized API with decimal-string `chainId`. `parsePublicDemoConfig` must reject missing or extra keys, malformed values, a changed selector/signature, and a record label whose `id(label)` does not equal `approvedArgument`.

Use ethers `Interface` with only:

```ts
"function owner() view returns(address)"
"function quoteAction(uint32,(bytes32 authorizationId,address target,uint256 value,bytes data),bytes,bool) view returns((uint256 nativeFee,uint256 lzTokenFee) fee)"
"function sendAction(uint32,(bytes32 authorizationId,address target,uint256 value,bytes data),bytes,(uint256 nativeFee,uint256 lzTokenFee) fee) payable"
"event ActionSent(bytes32 indexed authorizationId,bytes32 indexed guid,uint32 indexed dstEid,address target,uint256 value)"
"function record(bytes32)"
```

Call EIP-1193 directly. Do not ask for or inspect keys.

- [ ] **Step 4: Write failing source submission and error tests**

Assert:

```js
const submission = await client.submit(config, session, quote);
assert.equal(submission.transactionHash, transactionHash);
assert.equal(submission.guid, guid);
assert.equal(submission.blockNumber, 12n);
assert.equal(sendRequest.params[0].from, owner);
assert.equal(sendRequest.params[0].to, config.sourceOApp);
```

Table-drive wrong chain, wrong owner, provider code `4001`, quote revert, receipt status `0x0`, missing matching OApp event, two matching events, and receipt timeout. Assert only stable `WalletActionError.code`, not raw provider text.

- [ ] **Step 5: Implement send-once receipt handling**

`submit` must:

1. recheck `eth_chainId` and `owner()`;
2. issue exactly one `eth_sendTransaction`;
3. poll `eth_getTransactionReceipt` without resending;
4. require `status === "0x1"`;
5. filter by configured OApp and `ActionSent` topic;
6. require exactly one event matching authorization ID, destination EID, target, and zero value;
7. return the canonical transaction hash, GUID, and block number.

Map EIP-1193 code `4001` to `USER_REJECTED`; sanitize all other provider failures.

- [ ] **Step 6: Add invalidation subscription tests**

Expose:

```ts
subscribeInvalidation(provider:Eip1193Provider, invalidate:()=>void):()=>void
```

Assert both account and chain changes invalidate the quote and the returned cleanup removes both listeners.

- [ ] **Step 7: Run the wallet-client suite**

Run:

```bash
npm run build
node --test apps/dashboard/test/wallet-action.test.js
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add apps/dashboard/src/wallet-action.ts apps/dashboard/test/wallet-action.test.js
git commit -m "feat: add wallet-originated OApp client"
```

---

### Task 4: Build the capability-gated action workspace

**Files:**
- Create: `apps/dashboard/src/demo-state.ts`
- Create: `apps/dashboard/test/demo-state.test.js`
- Create: `apps/dashboard/src/demo-entry.ts`
- Create: `apps/dashboard/src/demo.css`
- Create: `scripts/build-dashboard.mjs`
- Modify: `apps/dashboard/index.html`
- Modify: `apps/dashboard/src/app.js`
- Modify: `services/coordinator/src/status-api.ts`
- Modify: `services/coordinator/test/status-api.test.js`
- Modify: `scripts/check-dashboard.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: `WalletActionClient`, `/api/demo/config`, and coordinator read APIs.
- Produces: `/assets/demo.js`, pure `reduceDemoState`, and `sentinel:guid-observed` browser event.

- [ ] **Step 1: Write failing state-machine tests**

Define exact presentation states from the spec. Assert legal transitions:

```js
let state = initialDemoState();
state = reduceDemoState(state, {type:"CAPABILITY_AVAILABLE"});
state = reduceDemoState(state, {type:"WALLET_READY", account:owner});
state = reduceDemoState(state, {type:"QUOTE_READY", nativeFee:"1000000000000"});
state = reduceDemoState(state, {type:"SOURCE_SUBMITTED", transactionHash});
state = reduceDemoState(state, {type:"GUID_OBSERVED", guid});
assert.equal(state.phase, "COORDINATOR_PENDING");
```

Assert a source receipt can never transition directly to `SENTINEL_EXECUTED`, and only a coordinator event can produce `POLICY_REJECTED`, `SENTINEL_EXECUTED`, or `SENTINEL_INCIDENT`.

- [ ] **Step 2: Run the state test and verify RED**

Run:

```bash
npm run build
node --test apps/dashboard/test/demo-state.test.js
```

Expected: FAIL because `demo-state` does not exist.

- [ ] **Step 3: Implement the pure state machine**

Use a discriminated `DemoEvent` union and reject impossible transitions with `Error("invalid demo transition")`. Store only account, quoted fee, transaction hash, GUID, and stable presentation error code.

- [ ] **Step 4: Add the dashboard build script**

Pin direct dev dependency `"esbuild": "0.28.1"` using:

```bash
npm install --save-dev --save-exact esbuild@0.28.1 --legacy-peer-deps
```

Create `scripts/build-dashboard.mjs`:

```js
import {build} from "esbuild";
await build({
  entryPoints:["apps/dashboard/src/demo-entry.ts"],
  outfile:"dist/apps/dashboard/demo.js",
  bundle:true,
  format:"esm",
  platform:"browser",
  target:["es2022"],
  sourcemap:false,
  legalComments:"none"
});
```

Add `build:dashboard` and invoke it during `build` before `check:dashboard`.

- [ ] **Step 5: Write failing asset/API guard tests**

Extend status API tests to require `/assets/demo.js`, while `/assets/anything-else.js` and arbitrary `dist` paths remain `404`. Extend `check-dashboard.mjs` to require:

```text
LOCAL TEST · FIXTURE POLICY
Connect wallet
Quote LayerZero fee
Packet emitted; Sentinel decision pending
sentinel:guid-observed
```

Reject `POST`, CDN URLs, inline scripts, seed/private-key fields, simulated jobs, and direct signer/destination controls.

- [ ] **Step 6: Implement the generated-asset allowlist**

Keep source assets under the existing root. Resolve the generated bundle to `dist/apps/dashboard/demo.js` and expose only:

```ts
"/assets/demo.js" -> "text/javascript; charset=utf-8"
```

If the bundle is missing, return the existing sanitized asset-unavailable response.

- [ ] **Step 7: Implement the action workspace**

Add semantic HTML for:

- fixture/local labels;
- connect button;
- account and chain result;
- immutable action summary;
- record-label input with `approvedRecordLabel` prefilled and its derived `bytes32` argument shown read-only;
- quote button and fee;
- send button;
- transaction hash, GUID, and status message.

`demo-entry.ts` must:

1. fetch capability;
2. stay disabled on `404`;
3. connect only after user action;
4. invalidate quote on account/chain/input change;
5. quote and send through `WalletActionClient`;
6. display “Packet emitted; Sentinel decision pending” after mining;
7. dispatch `CustomEvent("sentinel:guid-observed", {detail:{guid}})`;
8. derive terminal Sentinel state only by fetching `/api/jobs/<guid>` and `/api/deliveries`.

Add an `app.js` listener that selects the GUID when it appears in the real jobs collection. Do not create a placeholder job.

- [ ] **Step 8: Run dashboard unit, asset, and guard tests**

Run:

```bash
npm run build
node --test apps/dashboard/test/*.test.js services/coordinator/test/status-api.test.js
npm run check:dashboard
```

Expected: all tests pass and the generated bundle exists only under `dist`.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json scripts/build-dashboard.mjs scripts/check-dashboard.mjs apps/dashboard/index.html apps/dashboard/src/app.js apps/dashboard/src/demo-state.ts apps/dashboard/src/demo-entry.ts apps/dashboard/src/demo.css apps/dashboard/test/demo-state.test.js services/coordinator/src/status-api.ts services/coordinator/test/status-api.test.js
git commit -m "feat: add governed action workspace"
```

---

### Task 5: Implement the honest local policy fixture

**Files:**
- Create: `services/coordinator/src/local-demo-policy.ts`
- Create: `services/coordinator/test/local-demo-policy.test.js`

**Interfaces:**
- Consumes: `PolicyRequest`, exact authoritative action fields, and the existing `GenLayerFinality` interface.
- Produces: `LocalDemoFinality`, `LocalDemoEvidenceSource`, and reason codes `LOCAL_FIXTURE_ALLOW` or `LOCAL_FIXTURE_DENY`.

- [ ] **Step 1: Write failing pending/allow/deny tests**

Construct requests with the same authorization ID and target. Change only the `record(bytes32)` argument for denial:

```js
const finality = new LocalDemoFinality(authority, () => 1000);
const requestId = await finality.submit(allowedRequest);
assert.equal(await finality.finalized(requestId), undefined);
const allowed = await finality.finalized(requestId);
assert.equal(allowed.decision, "ALLOW");
assert.equal(allowed.reasonCode, "LOCAL_FIXTURE_ALLOW");

const deniedId = await finality.submit(changedCalldataRequest);
assert.equal(await finality.finalized(deniedId), undefined);
assert.equal((await finality.finalized(deniedId)).decision, "DENY");
```

Also reject changed GUID binding on `register`, expired evidence, malformed decoded-action JSON, changed authorization ID, target, value, selector, and evidence digest.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm run build
node --test services/coordinator/test/local-demo-policy.test.js
```

Expected: FAIL because the fixture module does not exist.

- [ ] **Step 3: Implement deterministic fixture request IDs**

Define:

```ts
export interface LocalDemoAuthority {
  authorizationId:Hex;
  target:Hex;
  selector:Hex;
  approvedCalldata:Hex;
  policyVersion:"local-demo-v1";
  evidenceBody:string;
}
```

`submit` must generate a stable hash over GUID, packet digest, evidence digest, and canonical decoded action, persist the binding in memory, and return the hash. `finalized` returns `undefined` exactly once per request, then returns a bound result.

`DENY` is a valid finalized result for semantic mismatches. Malformed or stale requests throw and never become signable.

- [ ] **Step 4: Implement static authoritative evidence**

`LocalDemoEvidenceSource.read(uri)` accepts exactly `https://governance.fixture.invalid/authorization` and returns the fixed canonical JSON body. It rejects all other URIs. This source is injected directly; it does not make a network request.

- [ ] **Step 5: Run policy fixture and coordinator finality tests**

Run:

```bash
npm run build
node --test services/coordinator/test/local-demo-policy.test.js services/coordinator/test/coordinator.test.js
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add services/coordinator/src/local-demo-policy.ts services/coordinator/test/local-demo-policy.test.js
git commit -m "feat: add labeled local policy fixture"
```

---

### Task 6: Add local EDR proof and execution adapters

**Files:**
- Create: `services/coordinator/src/local-demo-proofs.ts`
- Create: `services/coordinator/test/local-demo-proofs.test.js`

**Interfaces:**
- Consumes: one loopback EDR RPC transport, deployed fixture addresses, coordinator requests, and existing verifier interfaces.
- Produces: `LocalEdrPacketVerifier`, `LocalEdrPathVerifier`, `LocalEdrDestinationVerifier`, and `LocalOAppExecutionConfirmer`.

- [ ] **Step 1: Write failing packet-proof tests**

Deploy the mock Endpoint and source OApp, send a real action, construct the canonical packet, then assert:

```js
const proofs = await verifier.verify(packet);
assert.deepEqual(proofs.map(value => value.provider), [
  "LOCAL_EDR_FIXTURE_PACKET",
  "LOCAL_EDR_FIXTURE_RECEIPT"
]);
assert.ok(proofs.every(value => value.confirmations >= 1n));
```

Reject failed receipt, wrong Endpoint address, altered block, altered canonical packet, or insufficient local confirmations.

- [ ] **Step 2: Run the proof test and verify RED**

Run:

```bash
npm run build
node --test services/coordinator/test/local-demo-proofs.test.js
```

Expected: FAIL because the local proof adapters do not exist.

- [ ] **Step 3: Implement packet and path adapters**

`LocalEdrPacketVerifier` reads the actual receipt, block, `PacketSent` event, encoded packet, payload hash, and confirmations. It returns two proof records only after both distinct checks pass; both labels contain `LOCAL_EDR_FIXTURE`.

`LocalEdrPathVerifier.verify()` reads:

- code at destination OApp, adapter, and verification target;
- adapter `verificationTarget`, `quorum`, and all five `signer(address)` values;
- destination OApp `peers(srcEid)` binding;
- latest block number and hash.

It constructs `VerifiedDestinationPath` with explicit fixture required/optional DVN arrays and a canonical configuration digest. It rejects any mismatch before signing.

- [ ] **Step 4: Write failing destination and OApp execution tests**

After real adapter submission, assert the destination verifier requires the exact receipt, `Verified` event, digest, confirmations, and `used(digest)`.

Create `LocalOAppExecutionConfirmer` around the coordinator:

```ts
await confirmer.assertDeliveryReady(guid, signers);
await confirmer.confirmExecution(guid);
assert.equal(await destinationOApp.executedGuid(guid), true);
assert.equal(await actionTarget.recorded(), approvedArgument);
assert.equal(coordinator.jobs.get(guid).snapshot.stage, "EXECUTED");
```

Assert a second confirmation is idempotent and does not call `deliver` again. Reject wrong peer, message, GUID, or action target.

- [ ] **Step 5: Implement destination and execution adapters**

`LocalEdrDestinationVerifier` implements `DestinationConfirmationVerifier` and returns only the existing `PENDING`, `CONFIRMED`, or allowlisted `FAILED` values.

`LocalOAppExecutionConfirmer` implements `ExecutionConfirmer`:

1. delegates exact-quorum assertion to `Coordinator`;
2. reads the durable request for GUID;
3. checks `destinationOApp.executedGuid(guid)`;
4. if false, submits exactly one `MockEndpointV2.deliver` with the request nonce, source EID, sender, GUID, and message;
5. requires a successful receipt and exact `ActionExecuted` event;
6. verifies `executedGuid(guid)` and target state;
7. calls `coordinator.confirmExecution(guid)`.

It never retries an ambiguous delivery transaction automatically.

- [ ] **Step 6: Run local proof and existing destination suites**

Run:

```bash
npm run build
node --test services/coordinator/test/local-demo-proofs.test.js services/coordinator/test/destination-verifier.test.js services/coordinator/test/destination-worker.test.js
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add services/coordinator/src/local-demo-proofs.ts services/coordinator/test/local-demo-proofs.test.js
git commit -m "feat: verify local demo proofs and OApp execution"
```

---

### Task 7: Compose a runnable loopback-only demo harness

**Files:**
- Create: `services/coordinator/src/local-demo-harness.ts`
- Create: `services/coordinator/src/local-demo-cli.ts`
- Create: `services/coordinator/test/local-demo-harness.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: user-supplied owner address, existing runtime components, Task 2 capability, Task 5 policy, and Task 6 proof adapters.
- Produces: `startLocalDemo(options):Promise<LocalDemoSession>` and `npm run demo:local -- --owner 0x...`.

- [ ] **Step 1: Write failing option and startup tests**

Assert invalid owner, non-loopback host, invalid port, and missing owner fail before EVM startup. Assert the wished-for session:

```js
const session = await startLocalDemo({
  owner,
  appHost:"127.0.0.1",
  appPort:0,
  pollIntervalMs:25
});
t.after(() => session.stop());
assert.equal(session.capability.mode, "LOCAL_WALLET_DEMO");
assert.equal(session.capability.chainId, 31337n);
assert.equal(await session.sourceOApp.owner(), owner);
assert.equal(new URL(session.appUrl).hostname, "127.0.0.1");
assert.equal(new URL(session.rpcUrl).hostname, "127.0.0.1");
```

Assert the owner receives local-only balance and no output field contains signer keys.

- [ ] **Step 2: Run the harness test and verify RED**

Run:

```bash
npm run build
node --test services/coordinator/test/local-demo-harness.test.js
```

Expected: FAIL because the harness does not exist.

- [ ] **Step 3: Extract a production-quality local EVM lifecycle**

Move the reusable EDR server lifecycle into `local-demo-harness.ts` with:

```ts
interface LocalEvm {
  rpcUrl:string;
  provider:JsonRpcProvider;
  signers:JsonRpcSigner[];
  close():Promise<void>;
}
```

Bind to `127.0.0.1` and an OS-selected port. Confirm chain ID `31337`. Make cleanup idempotent and reverse construction on partial failure.

- [ ] **Step 4: Deploy and configure the session**

Deploy:

- source and destination `MockEndpointV2`;
- source and destination `TreasuryPolicyOApp`;
- `ActionTarget`;
- `MockVerificationTarget`;
- `SentinelDVNAdapter` with five sorted ephemeral EDR signer addresses and quorum 3.

Configure optional DVN fee emission, peers, authorized targets, and source ownership transfer. Fund only the supplied owner on the isolated EDR chain using `hardhat_setBalance`.

- [ ] **Step 5: Compose the real coordinator pipeline**

Use:

- `PacketFeeListener` with actual EDR logs;
- `PolicyRequestFactory` with `LocalDemoEvidenceSource`;
- `Coordinator` with `LocalEdrPacketVerifier` and `LocalDemoFinality`;
- five `IsolatedSignerService` instances signing with EDR signers;
- `SqliteJobStore`, `SqliteListenerStore`, `SqliteRecoveryStore`, and `SqliteVerificationOutbox` in a session temp directory;
- `DeliveryPlanner`, `DestinationWorker`, local path/destination adapters, and local OApp execution confirmer;
- `createDashboardServer` with `presentationMode:"LOCAL_TEST"` and the demo capability.

The harness must expose:

```ts
export interface LocalDemoSession {
  appUrl:string;
  rpcUrl:string;
  capability:DemoCapability;
  provider:JsonRpcProvider;
  coordinator:Coordinator;
  outbox:SqliteVerificationOutbox;
  sourceOApp:Contract;
  destinationOApp:Contract;
  actionTarget:Contract;
  metrics:{signerCalls:number;destinationSubmissions:number};
  tickOnce():Promise<void>;
  stop():Promise<void>;
}
```

`tickOnce` runs ingest, finality poll, planner, and destination worker serially. `stop` drains a tick, closes HTTP, stores, provider, and EDR server exactly once.

- [ ] **Step 6: Implement the CLI**

Accept only:

```text
--owner 0x<40 hex>
--port <1..65535>       optional, default 4173
```

Print the app URL, RPC URL, chain ID, owner, source OApp, target, approved argument, and the labels `LOCAL TEST`, `LOCAL_POLICY_FIXTURE`, and `NOT DEPLOYED`. Never print signer identities as secrets, private keys, or raw database paths.

Handle `SIGINT` and `SIGTERM` through one idempotent shutdown path.

- [ ] **Step 7: Run harness and runtime regression tests**

Run:

```bash
npm run build
node --test services/coordinator/test/local-demo-harness.test.js services/coordinator/test/runtime.test.js services/coordinator/test/compose-runtime.test.js
```

Expected: all tests pass and no EDR or HTTP handle remains open.

- [ ] **Step 8: Commit**

```bash
git add package.json services/coordinator/src/local-demo-harness.ts services/coordinator/src/local-demo-cli.ts services/coordinator/test/local-demo-harness.test.js
git commit -m "feat: run loopback wallet demo harness"
```

---

### Task 8: Prove the wallet-to-execution allow and deny paths

**Files:**
- Create: `services/coordinator/test/local-demo-wallet-e2e.test.js`
- Modify: `apps/dashboard/test/wallet-action.test.js`
- Modify: `scripts/check-dashboard.mjs`

**Interfaces:**
- Consumes: `startLocalDemo`, real EDR JSON-RPC, `WalletActionClient`, and read-only app APIs.
- Produces: one full real-bytecode ALLOW test and one full real-bytecode DENY test.

- [ ] **Step 1: Write the failing wallet-backed ALLOW E2E**

Create an ephemeral ethers `Wallet` in the test, pass only its address to the harness, and fund it through harness setup. The test EIP-1193 adapter owns that test-only wallet and converts `eth_sendTransaction` into one signed `eth_sendRawTransaction`; `WalletActionClient` receives only the provider interface and never sees the key.

```js
const client = new WalletActionClient(eip1193(session.provider, testWallet));
const config = parsePublicDemoConfig(JSON.parse(await get(`${session.appUrl}/api/demo/config`)));
const connected = await client.connect(config);
const quote = await client.quote(config, connected, config.approvedRecordLabel);
const source = await client.submit(config, connected, quote);

for (let i = 0; i < 8; i++) await session.tickOnce();
const job = JSON.parse(await get(`${session.appUrl}/api/jobs/${source.guid}`));
assert.equal(job.stage, "EXECUTED");
assert.equal(await session.destinationOApp.executedGuid(source.guid), true);
assert.equal(await session.actionTarget.recorded(), config.approvedArgument);
```

Assert the source receipt contains the same GUID as the job and the adapter delivery is `CONFIRMED`.

- [ ] **Step 2: Run the E2E and verify RED**

Run:

```bash
npm run build
node --test services/coordinator/test/local-demo-wallet-e2e.test.js
```

Expected: FAIL at the first incomplete harness/proof integration boundary.

- [ ] **Step 3: Complete only the integration wiring required by ALLOW**

Fix the smallest production boundary responsible for the failure. Re-run the focused E2E after each change. Do not bypass receipt, packet, policy, signature, adapter, or OApp checks.

- [ ] **Step 4: Write the failing semantic DENY E2E**

Use the same authorization ID and target but a different record label:

```js
const quote = await client.quote(config, connected, "not-authorized");
const source = await client.submit(config, connected, quote);
const signerCallsBefore = session.metrics.signerCalls;
for (let i = 0; i < 4; i++) await session.tickOnce();
const job = JSON.parse(await get(`${session.appUrl}/api/jobs/${source.guid}`));
assert.equal(job.stage, "REJECTED");
assert.equal(session.metrics.signerCalls, signerCallsBefore);
assert.equal(await session.outbox.get(source.guid), undefined);
assert.equal(await session.destinationOApp.executedGuid(source.guid), false);
```

- [ ] **Step 5: Make DENY pass without weakening ALLOW**

Ensure policy comparison uses exact authorization ID, target, value, selector, and full calldata. The signer, planner, worker, adapter, and destination OApp must remain untouched for denial.

- [ ] **Step 6: Add restart/no-resend coverage**

After source mining and before coordinator ingestion, restart only the coordinator/store composition against the same running EDR session. Assert the GUID is restored/ingested and the wallet provider observed exactly one `eth_sendTransaction`.

- [ ] **Step 7: Run all demo and existing E2E tests**

Run:

```bash
npm run build
node --test apps/dashboard/test/*.test.js services/coordinator/test/local-demo-*.test.js services/coordinator/test/uln302-runtime-e2e.test.js contracts/test/*.test.js
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add services/coordinator/test/local-demo-wallet-e2e.test.js apps/dashboard/test/wallet-action.test.js scripts/check-dashboard.mjs services/coordinator/src/local-demo-harness.ts services/coordinator/src/local-demo-proofs.ts services/coordinator/src/local-demo-policy.ts
git commit -m "test: prove wallet-originated Sentinel lifecycle"
```

---

### Task 9: Document, audit, review, and release the milestone

**Files:**
- Modify: `README.md`
- Modify: `docs/DEMO.md`
- Modify: `docs/OPERATIONS.md`
- Modify: `docs/SECURITY_STATUS.md`
- Modify: `docs/MILESTONES.md`
- Modify: `docs/THREAT_MODEL.md`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: final commands, test counts, capability labels, and actual implementation limits.
- Produces: version `0.23.0`, runnable walkthrough, updated threat model, and evidence-backed status.

- [ ] **Step 1: Update the local demo walkthrough**

Document:

```bash
npm install --legacy-peer-deps
npm run build
npm run demo:local -- --owner 0xYOUR_INJECTED_WALLET_ADDRESS
```

Explain how to add the printed loopback RPC and chain ID `31337` to the wallet, run the approved argument, change the argument for denial, and follow the exact GUID.

- [ ] **Step 2: Update every trust label**

State precisely:

- source/destination OApps and adapter are real compiled local bytecode;
- wallet quote, signature, send, receipt, packet, GUID, threshold signatures, adapter call, and destination OApp execution are real local transactions;
- EDR, governance evidence, semantic policy, proof origins, executor, signers, and funding are local fixtures;
- fixture semantic finality is not GenLayer consensus;
- no testnet deployment or live URL exists;
- source mining does not mean Sentinel approval;
- the app contains no key or recovery controls.

- [ ] **Step 3: Update threat model and operational recovery**

Add wrong-wallet, malicious provider, chain switch, stale quote, source replacement/revert, GUID spoofing, fixture-label confusion, browser reload, and local RPC exposure threats. Document that ambiguous wallet or executor submissions are never automatically resent.

- [ ] **Step 4: Bump version and lockfile**

Run:

```bash
npm version 0.23.0 --no-git-tag-version
```

Verify package and lock versions match and no unrelated dependency changed.

- [ ] **Step 5: Run the full verification gate**

Run:

```bash
npm run check
git diff --check
npm ls --omit=dev --depth=2
npm audit --omit=dev
npm audit
```

Expected:

- typecheck and build exit zero;
- all existing and new tests pass with zero failures;
- production dependency tree exits zero;
- production audit has zero advisories;
- full development audit findings are recorded exactly and not silently waived.

- [ ] **Step 6: Review requirements line by line**

Check each acceptance criterion in the design against a test or direct code path. Confirm:

- no secret-bearing field or log;
- no server relay;
- no simulated dashboard job;
- no external-mode send capability;
- no weakening of production URL/path validation;
- same authorization ID used for semantic allow/deny;
- real destination OApp execution before `EXECUTED`.

- [ ] **Step 7: Perform a complete code and security review**

Review the complete branch against the design, threat model, and trust claims for Critical, Important, and Minor findings. Fix Critical and Important issues through new red-green tests before release. Record any accepted Minor limitation in `docs/SECURITY_STATUS.md`.

- [ ] **Step 8: Re-run the full gate after review fixes**

Run:

```bash
npm run check
git diff --check
git status --short
```

Expected: zero failures and only the intended release files before commit.

- [ ] **Step 9: Commit**

```bash
git add README.md docs/DEMO.md docs/OPERATIONS.md docs/SECURITY_STATUS.md docs/MILESTONES.md docs/THREAT_MODEL.md package.json package-lock.json
git commit -m "chore: release wallet-originated local demo"
```
