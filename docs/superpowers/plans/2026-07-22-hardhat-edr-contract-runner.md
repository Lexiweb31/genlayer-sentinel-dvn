# Hardhat EDR Contract Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Ganache with an exact-version Hardhat 3 EDR JSON-RPC server while preserving Sentinel's real deployed-contract integration coverage and compiled Solidity artifacts.

**Architecture:** Add one explicit Hardhat simulated-network configuration and one test-only lifecycle helper that starts a loopback server on a random port. Migrate the adapter and OApp fixtures to ethers unlocked JSON-RPC signers, then remove Ganache and capture the resulting test, artifact and dependency evidence.

**Tech Stack:** Node.js 22.13+, npm 10.9.2, Hardhat 3.10.0 EDR, ethers 6.17.0, Node test runner, solc 0.8.30 targeting Shanghai.

## Global Constraints

- Hardhat is a test-only local EVM; `scripts/compile-contracts.mjs` remains the sole compiler path.
- Configure `edr-simulated`, L1, chain ID `31337`, hardfork `shanghai`, loopback-only binding and operating-system-selected ports.
- Use unlocked ephemeral JSON-RPC signers; add no mnemonic, raw private key or production account provider.
- Preserve all existing adapter and OApp assertions against actually deployed bytecode.
- Do not change Solidity sources, ABIs, bytecode, LayerZero configuration or production dependencies.
- Normalize the lockfile with exact npm `10.9.2` and pin Hardhat exactly to `3.10.0`.
- Follow red-green-refactor for the new harness behavior and keep each migration green.
- Do not deploy, fund, create cloud resources, publish to GitHub or claim live/testnet compatibility.

---

### Task 1: Explicit local-EVM lifecycle

**Files:**
- Create: `hardhat.config.ts`
- Create: `contracts/test/local-evm.js`
- Create: `contracts/test/local-evm.test.js`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: `startLocalEvm(signerCount?: number): Promise<{provider: JsonRpcProvider; signers: JsonRpcSigner[]; close: () => Promise<void>}>`.
- Produces: Hardhat network `sentinelTest` with chain ID `31337` and hardfork `shanghai`.

- [ ] **Step 1: Write the failing harness behavior test**

```js
import test from "node:test";
import assert from "node:assert/strict";
import {verifyMessage} from "ethers";
import {startLocalEvm} from "./local-evm.js";

test("starts an isolated Shanghai node with funded unlocked signers and idempotent cleanup", async t => {
  const evm = await startLocalEvm(8);
  t.after(evm.close);
  const network = await evm.provider.getNetwork();
  assert.equal(network.chainId, 31337n);
  assert.equal(evm.signers.length, 8);
  const addresses = await Promise.all(evm.signers.map(signer => signer.getAddress()));
  assert.equal(new Set(addresses.map(address => address.toLowerCase())).size, 8);
  assert.ok(await evm.provider.getBalance(addresses[0]) > 0n);
  const signature = await evm.signers[0].signMessage("sentinel-local-evm");
  assert.equal(verifyMessage("sentinel-local-evm", signature).toLowerCase(), addresses[0].toLowerCase());
  await evm.close();
  await evm.close();
});
```

- [ ] **Step 2: Run the focused test and verify the missing-helper failure**

Run: `node --test contracts/test/local-evm.test.js`  
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `contracts/test/local-evm.js`.

- [ ] **Step 3: Install the exact test dependency with the pinned package manager**

Run: `npx npm@10.9.2 install --save-dev --save-exact hardhat@3.10.0`  
Expected: `package.json` contains exact `"hardhat": "3.10.0"`; Ganache remains temporarily until both existing fixtures migrate.

- [ ] **Step 4: Add the explicit Hardhat network configuration**

```ts
import {defineConfig} from "hardhat/config";

export default defineConfig({
  networks: {
    sentinelTest: {
      type: "edr-simulated",
      chainType: "l1",
      chainId: 31337,
      hardfork: "shanghai",
      loggingEnabled: false,
      mining: {auto: true}
    }
  }
});
```

- [ ] **Step 5: Implement the minimal lifecycle helper**

```js
import {network} from "hardhat";
import {JsonRpcProvider} from "ethers";

export async function startLocalEvm(signerCount = 8) {
  if (!Number.isSafeInteger(signerCount) || signerCount < 1 || signerCount > 20) {
    throw new Error("local EVM signer count must be between 1 and 20");
  }
  const server = await network.createServer({network: "sentinelTest"}, "127.0.0.1", 0);
  let provider;
  let closing;
  try {
    const {address, port} = await server.listen();
    provider = new JsonRpcProvider(`http://${address}:${port}`, 31337, {staticNetwork: true});
    const actual = await provider.getNetwork();
    if (actual.chainId !== 31337n) throw new Error("local EVM chain ID mismatch");
    const signers = await Promise.all(Array.from({length: signerCount}, (_, index) => provider.getSigner(index)));
    const close = () => {
      if (!closing) {
        closing = (async () => {
          provider.destroy();
          await server.close();
          await server.afterClosed();
        })();
      }
      return closing;
    };
    return {provider, signers, close};
  } catch (error) {
    provider?.destroy();
    await server.close();
    await server.afterClosed();
    throw error;
  }
}
```

- [ ] **Step 6: Run the focused test and verify clean success**

Run: `node --test contracts/test/local-evm.test.js`  
Expected: 1 test passes, the process exits normally and output contains no Ganache native-module warning.

- [ ] **Step 7: Commit the harness**

```bash
git add hardhat.config.ts contracts/test/local-evm.js contracts/test/local-evm.test.js package.json package-lock.json
git commit -m "test: add isolated Hardhat EDR harness"
```

### Task 2: Adapter fixture migration

**Files:**
- Modify: `contracts/test/adapter.test.js`

**Interfaces:**
- Consumes: `startLocalEvm(6)` from Task 1.
- Preserves: quorum ordering, digest agreement, replay rejection, insufficient-quorum rejection and atomic target failure behavior.

- [ ] **Step 1: Run the existing adapter characterization tests before editing**

Run: `npm run build && node --test contracts/test/adapter.test.js`  
Expected: 2 tests pass through Ganache, establishing the behavior that the new runner must preserve.

- [ ] **Step 2: Replace raw-key extraction with unlocked JSON-RPC signers**

Use this fixture shape and pass Node's test context into every `fixture(t)` call:

```js
import {ContractFactory, Interface, getBytes, id} from "ethers";
import {startLocalEvm} from "./local-evm.js";

async function fixture(t) {
  const {provider, signers, close} = await startLocalEvm(6);
  t.after(close);
  const deployerAddress = await signers[0].getAddress();
  const targetArtifact = artifact("MockVerificationTarget");
  const target = await new ContractFactory(targetArtifact.abi, targetArtifact.evm.bytecode.object, signers[0]).deploy();
  await target.waitForDeployment();
  const signerRecords = await Promise.all(signers.slice(2, 5).map(async signer => ({
    signer,
    address: (await signer.getAddress()).toLowerCase()
  })));
  signerRecords.sort((a, b) => a.address.localeCompare(b.address));
  const adapterArtifact = artifact("SentinelDVNAdapter");
  const adapter = await new ContractFactory(adapterArtifact.abi, adapterArtifact.evm.bytecode.object, signers[1]).deploy(
    deployerAddress,
    await target.getAddress(),
    40231,
    signerRecords.map(record => record.address),
    2
  );
  await adapter.waitForDeployment();
  assert.notEqual(await adapter.getAddress(), await target.getAddress());
  assert.equal((await adapter.verificationTarget()).toLowerCase(), (await target.getAddress()).toLowerCase());
  return {adapter: adapter.connect(signers[5]), target, signerRecords, provider};
}
```

Replace each quorum signature expression with `record.signer.signMessage(getBytes(digest))`, retaining the sort by `record.address`. No `Wallet`, `BrowserProvider`, `getInitialAccounts` or raw `secretKey` remains.

- [ ] **Step 3: Run the migrated adapter and harness tests**

Run: `npm run build && node --test contracts/test/local-evm.test.js contracts/test/adapter.test.js`  
Expected: 3 tests pass against Hardhat EDR with no native-module warning.

- [ ] **Step 4: Commit the adapter migration**

```bash
git add contracts/test/adapter.test.js
git commit -m "test: run DVN adapter on Hardhat EDR"
```

### Task 3: OApp fixture migration and Ganache removal

**Files:**
- Modify: `contracts/test/oapp.test.js`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: `startLocalEvm(8)` from Task 1.
- Preserves: quote/send behavior, `PacketSent` decoding, trusted-peer execution, replay rejection, untrusted-peer rejection and target authorization.

- [ ] **Step 1: Run the existing OApp characterization tests before editing**

Run: `npm run build && node --test contracts/test/oapp.test.js`  
Expected: 2 tests pass through Ganache.

- [ ] **Step 2: Move the OApp fixture to the shared local-EVM helper**

Replace the Ganache/BrowserProvider import and fixture start with:

```js
import {ContractFactory, Interface, id, zeroPadValue} from "ethers";
import {startLocalEvm} from "./local-evm.js";

async function fixture(t) {
  const {signers: s, close} = await startLocalEvm(8);
  t.after(close);
  const epA = await deploy("MockEndpointV2", s[0], 40161);
  const epB = await deploy("MockEndpointV2", s[1], 40231);
  const a = await deploy("TreasuryPolicyOApp", s[2], await epA.getAddress(), await s[2].getAddress());
  const b = await deploy("TreasuryPolicyOApp", s[3], await epB.getAddress(), await s[3].getAddress());
  const target = await deploy("ActionTarget", s[4]);
  const peerA = zeroPadValue(await a.getAddress(), 32);
  const peerB = zeroPadValue(await b.getAddress(), 32);
  await (await a.connect(s[2]).setPeer(40231, peerB)).wait();
  await (await b.connect(s[3]).setPeer(40161, peerA)).wait();
  await (await a.connect(s[2]).setAuthorizedTarget(await target.getAddress(), true)).wait();
  await (await b.connect(s[3]).setAuthorizedTarget(await target.getAddress(), true)).wait();
  return {a, b, epA, epB, target, s, peerA, peerB};
}
```

Pass `t` into both test callbacks and `fixture(t)` calls. Preserve every transaction receipt and rejection assertion.

- [ ] **Step 3: Run all three contract suites before removing Ganache**

Run: `npm run build && node --test contracts/test/local-evm.test.js contracts/test/adapter.test.js contracts/test/oapp.test.js`  
Expected: 5 tests pass through Hardhat EDR and no test imports Ganache.

- [ ] **Step 4: Remove Ganache and advance the repository version**

Run: `npx npm@10.9.2 uninstall --save-dev ganache`  
Then change root `package.json` version to exact `0.21.0` and run `npx npm@10.9.2 install --package-lock-only --ignore-scripts` so both lockfile version fields equal `0.21.0`.

- [ ] **Step 5: Prove the old runner is absent and the new runner remains green**

Run: `rg -n 'from "ganache"|require\("ganache"\)|BrowserProvider|getInitialAccounts|secretKey' contracts/test package.json`  
Expected: no matches.

Run: `npm ls ganache`  
Expected: an empty tree.

Run: `npm run build && node --test contracts/test/*.test.js`  
Expected: 5 tests pass with no Ganache or native-module warning.

- [ ] **Step 6: Commit the OApp migration and dependency removal**

```bash
git add contracts/test/oapp.test.js package.json package-lock.json
git commit -m "test: replace Ganache with Hardhat EDR"
```

### Task 4: Security evidence and honest documentation

**Files:**
- Modify: `README.md`
- Modify: `contracts/test/README.md`
- Modify: `docs/MILESTONES.md`
- Modify: `docs/SECURITY_STATUS.md`
- Modify: `docs/research/2026-07-22-dependency-audit.md`

**Interfaces:**
- Consumes: exact test counts, package-tree counts and advisory severities observed from the final lockfile.
- Produces: an honest test-only runner statement and an updated list of still-open protocol/deployment gates.

- [ ] **Step 1: Capture final verification evidence**

Run each command independently and retain its exact output for the documentation edits:

```bash
npx npm@10.9.2 ls --omit=dev --depth=2
npx npm@10.9.2 audit --omit=dev --json
npx npm@10.9.2 audit --json
npm run check
git diff --exit-code -- contracts/src dist/contracts
```

Expected: production tree contains only ethers; production audit reports zero advisories; `npm run check` reports 86 tests with zero failures; contract source and generated artifacts are unchanged. The full audit's observed counts are recorded exactly even if nonzero.

- [ ] **Step 2: Update the root status and setup text**

In `README.md`, state all of the following facts in the existing status, setup and limitation paragraphs:

- contract lifecycle tests run on a repository-pinned Hardhat EDR server configured for Shanghai;
- the suite contains 86 tests;
- Hardhat is test-only and the custom pinned solc script remains the compiler;
- Ganache has been removed;
- the production audit remains zero and the full development audit has the exact observed severity counts;
- no live EndpointV2/ULN302, deployed pathway or GenLayer direct-mode claim follows.

- [ ] **Step 3: Correct contract-test and milestone status**

Replace `contracts/test/README.md` with prose that says the local Hardhat EDR tests cover adapter quorum/replay/atomicity plus OApp quote/send, `PacketSent`, trusted delivery, replay, untrusted-peer and unauthorized-target behavior. Keep EndpointV2/ULN302 conformance, fuzz/property testing, static analysis, GenLayer direct-mode and independent review explicitly open.

In `docs/MILESTONES.md`, move archived development-runner replacement from the M1 remaining list to the completed local slice while retaining the compiler/LayerZero advisory review and every live-integration gate.

- [ ] **Step 4: Record the exact security and dependency results**

Update `docs/SECURITY_STATUS.md` and `docs/research/2026-07-22-dependency-audit.md` with the exact outputs from Step 1. Explain that Hardhat `3.10.0` is a development-only EDR runner, Ganache and its bundled native fallback tree are gone, the lock was generated by npm `10.9.2`, and remaining advisories are not waived merely because they are development-only.

- [ ] **Step 5: Run documentation and repository guardrails**

Run: `rg -n "85 tests|eighty-five|archived Ganache|Ganache must|Foundry Anvil is a candidate|OApp send/receive tests" README.md docs contracts/test`  
Expected: no stale status claims.

Run: `git diff --check`  
Expected: zero whitespace errors.

Run: `npm run check`  
Expected: 86 tests pass with zero failures.

- [ ] **Step 6: Commit the release evidence**

```bash
git add README.md contracts/test/README.md docs/MILESTONES.md docs/SECURITY_STATUS.md docs/research/2026-07-22-dependency-audit.md
git commit -m "chore: release Hardhat EDR runner milestone"
```

### Task 5: Final branch verification

**Files:**
- Verify only; modify files only if a newly reproduced defect receives a failing regression test first.

**Interfaces:**
- Produces: merge-ready local branch evidence.

- [ ] **Step 1: Verify exact versions and dependency boundaries**

Run:

```bash
node --version
npx npm@10.9.2 --version
npm pkg get version devDependencies.hardhat devDependencies.ganache dependencies
npm ls ganache hardhat --depth=0
npm ls --omit=dev --depth=2
```

Expected: Node satisfies `>=22.13.0`, npm is `10.9.2`, Sentinel is `0.21.0`, Hardhat is exactly `3.10.0`, Ganache is absent and ethers is the only production dependency.

- [ ] **Step 2: Run clean-install and full-suite verification**

Run: `npx npm@10.9.2 ci --ignore-scripts`  
Expected: installation succeeds from the committed lockfile.

Run: `npm run check`  
Expected: strict TypeScript, five Solidity sources, Intelligent Contract guardrails, dashboard checks and 86 tests all pass without Ganache warnings.

- [ ] **Step 3: Verify repository scope**

Run: `git status --short`  
Expected: clean branch.

Run: `git diff main...HEAD -- contracts/src`  
Expected: no Solidity source changes.

Run: `git log --oneline main..HEAD`  
Expected: only the focused harness, migrations and documentation commits from this plan.
