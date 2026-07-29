# Contract Assurance Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reproducible, repository-local contract assurance gate that runs seeded generated-input properties against real Sentinel bytecode and analyzes both production Solidity contracts with pinned Slither and native solc.

**Architecture:** A dedicated assurance toolchain module owns platform/version/checksum validation and a network-only setup command. Property campaigns live outside the ordinary deterministic contract-test glob and use fast-check with EVM snapshot isolation. A separate Slither runner emits temporary JSON, validates it through a closed-schema finding/allowlist boundary, and fails on every unreviewed result.

**Tech Stack:** Node.js `>=22.13.0`, npm `10.9.2`, fast-check `4.9.0`, Hardhat EDR `3.10.0`, ethers `6.17.0`, Python `>=3.12.0 <3.13.0`, Slither `0.11.5`, native Solidity `0.8.30`, SHA-256, Node test runner.

## Global Constraints

- No deployment, funding, cloud resource, GitHub publication, external message, or production secret.
- `npm run setup:assurance` is the only network-enabled assurance command.
- Ordinary assurance checks never bootstrap, download, install globally, or read another product's environment.
- `.venv-assurance` is separate from the GenLayer direct-mode `.venv`.
- `darwin-arm64` uses the official macOS x86_64 solc `0.8.30` binary under verified Rosetta with SHA-256 `738dcdc6afddeb505ee4e4ef24f1c1fdba2b8c924e614cbbf5801a5b062dd683`.
- `linux-x64` uses the official Linux x86_64 solc `0.8.30` binary with SHA-256 `f3e987dc6ecebd4bd350c48edcbc320b46cf9e3109bd3fc3d88f1acaf4c428f7`.
- High and Medium Slither findings cannot be allowlisted.
- Every accepted Low or Informational finding must have one exact drift-sensitive fingerprint and technical rationale.
- Property campaigns use fixed seeds/run counts, shrinking, serial execution, and EVM snapshot/revert isolation.
- Production Solidity changes are permitted only for a demonstrated finding with a failing deterministic or property regression.
- Passing assurance must not be described as formal verification, a third-party audit, deployed-chain evidence, or mainnet readiness.

---

## File structure

- `config/contract-assurance-toolchain.json` — exact schema, versions, platform downloads, and hashes.
- `config/slither-allowlist.json` — exact reviewed Low/Informational findings only.
- `requirements/contract-assurance.in` — direct Python requirement (`slither-analyzer==0.11.5`).
- `requirements/contract-assurance.lock` — complete pip hash lock.
- `scripts/contract-assurance-toolchain.mjs` — config parsing, interpreter discovery, environment sanitization, checksum/version verification, and process execution.
- `scripts/setup-contract-assurance.mjs` — explicit network bootstrap.
- `scripts/slither-findings.mjs` — closed-schema Slither report normalization, fingerprinting, and allowlist enforcement.
- `scripts/run-slither-assurance.mjs` — two-target real analyzer orchestration and bounded output.
- `scripts/test/contract-assurance-toolchain.test.js` — setup/toolchain behavior.
- `scripts/test/slither-findings.test.js` — report and allowlist behavior.
- `scripts/test/run-slither-assurance.test.js` — orchestration, sanitation, cleanup, and target behavior.
- `contracts/assurance/property-support.js` — artifacts, generated values, snapshot isolation, seeds, and campaign runner.
- `contracts/assurance/adapter.property.test.js` — real 3-of-5 adapter properties.
- `contracts/assurance/oapp.property.test.js` — real OApp execution/replay/rollback properties.
- `docs/research/2026-07-29-contract-assurance-audit.md` — dated versions, sources, findings, dependency evidence, commands, and limitations.

---

### Task 1: Pin and isolate the assurance toolchain

**Files:**
- Create: `config/contract-assurance-toolchain.json`
- Create: `requirements/contract-assurance.in`
- Create: `requirements/contract-assurance.lock`
- Create: `scripts/contract-assurance-toolchain.mjs`
- Create: `scripts/setup-contract-assurance.mjs`
- Create: `scripts/test/contract-assurance-toolchain.test.js`
- Modify: `.gitignore`
- Modify: `package.json`

**Interfaces:**
- Produces: `loadAssuranceConfig(value?: unknown): AssuranceConfig`
- Produces: `assurancePaths(root: string): AssurancePaths`
- Produces: `assuranceEnvironment(paths: AssurancePaths, input?: NodeJS.ProcessEnv): NodeJS.ProcessEnv`
- Produces: `findPython312(candidates?: string[]): Promise<string>`
- Produces: `verifyAssuranceInstallation(paths, config, platform): Promise<ToolVersions>`
- Produces: `runAssuranceFile(command, args, options): Promise<ProcessResult>`
- Consumes later: Slither runner uses the verified `slither` and native `solc` paths.

- [ ] **Step 1: Write failing toolchain/config tests**

Add tests that independently assert:

```js
assert.deepEqual(config.versions,{
  python:">=3.12.0 <3.13.0",
  slither:"0.11.5",
  solc:"0.8.30"
});
assert.equal(
  config.platforms["darwin-arm64"].sha256,
  "738dcdc6afddeb505ee4e4ef24f1c1fdba2b8c924e614cbbf5801a5b062dd683"
);
assert.equal(
  config.platforms["linux-x64"].sha256,
  "f3e987dc6ecebd4bd350c48edcbc320b46cf9e3109bd3fc3d88f1acaf4c428f7"
);
```

Cover exact-key rejection, unsupported platform, missing/invalid Python, missing environment, lock/config drift, checksum mismatch, version mismatch, and sanitization of `PRIVATE_KEY`, `MNEMONIC`, `RPC_URL`, `API_KEY`, `AWS_SECRET_ACCESS_KEY`, `GOOGLE_APPLICATION_CREDENTIALS`, and arbitrary `*_TOKEN` inputs.

- [ ] **Step 2: Run the tests to verify RED**

Run:

```bash
node --test scripts/test/contract-assurance-toolchain.test.js
```

Expected: FAIL because `contract-assurance-toolchain.mjs` and the config do not exist.

- [ ] **Step 3: Add the exact config and direct requirement**

Create `config/contract-assurance-toolchain.json` with this semantic content:

```json
{
  "version": 1,
  "versions": {
    "python": ">=3.12.0 <3.13.0",
    "slither": "0.11.5",
    "solc": "0.8.30"
  },
  "platforms": {
    "darwin-arm64": {
      "url": "https://binaries.soliditylang.org/macosx-amd64/solc-macosx-amd64-v0.8.30+commit.73712a01",
      "sha256": "738dcdc6afddeb505ee4e4ef24f1c1fdba2b8c924e614cbbf5801a5b062dd683",
      "execution": "ROSETTA_X86_64"
    },
    "linux-x64": {
      "url": "https://binaries.soliditylang.org/linux-amd64/solc-linux-amd64-v0.8.30+commit.73712a01",
      "sha256": "f3e987dc6ecebd4bd350c48edcbc320b46cf9e3109bd3fc3d88f1acaf4c428f7",
      "execution": "NATIVE"
    }
  }
}
```

Create `requirements/contract-assurance.in` containing only:

```text
slither-analyzer==0.11.5
```

- [ ] **Step 4: Implement the minimal toolchain boundary**

Use `spawn`/`execFile` only—never a shell. Resolve paths from the repository root:

```js
{
  venvRoot: join(root,".venv-assurance"),
  venvPython: join(root,".venv-assurance","bin","python"),
  slither: join(root,".venv-assurance","bin","slither"),
  cacheRoot: join(root,".cache","contract-assurance"),
  solc: join(root,".cache","contract-assurance","solc","solc-0.8.30")
}
```

`assuranceEnvironment` must build a new object rather than spread `process.env`. Permit only `PATH`, `LANG`, `LC_ALL`, `SSL_CERT_FILE`, `SSL_CERT_DIR`, and `REQUESTS_CA_BUNDLE` from the caller, then overwrite:

```js
{
  PATH:`${paths.venvBin}:${safeSystemPath}`,
  VIRTUAL_ENV:paths.venvRoot,
  PYTHONHASHSEED:"0",
  PIP_DISABLE_PIP_VERSION_CHECK:"1",
  PYTHONDONTWRITEBYTECODE:"1",
  LC_ALL:"C",
  LANG:"C"
}
```

Validate that retained values contain no URI credentials and that no retained key matches `/KEY|TOKEN|SECRET|MNEMONIC|WALLET|RPC|CLOUD|AWS|GOOGLE|AZURE/i`.

- [ ] **Step 5: Generate the complete hash lock**

Create a unique temporary Python 3.12 environment and install only the lock generator:

```bash
assurance_lock_dir="$(mktemp -d /private/tmp/sentinel-assurance-lock.XXXXXX)"
python3.12 -m venv "$assurance_lock_dir"
"$assurance_lock_dir/bin/python" -m pip install pip-tools==7.6.0
"$assurance_lock_dir/bin/pip-compile" \
  --generate-hashes \
  --resolver=backtracking \
  --strip-extras \
  --output-file requirements/contract-assurance.lock \
  requirements/contract-assurance.in
```

Inspect the resulting file, confirm every installable requirement has at least one `--hash=sha256:...`, record the exact generated temporary path, and remove only that validated path after the lock is committed. Do not reuse this generator environment at runtime.

- [ ] **Step 6: Implement the network-only setup command**

`setup-contract-assurance.mjs` must:

1. find Python `3.12.x`;
2. create `.venv-assurance` if absent;
3. install with `pip install --require-hashes -r requirements/contract-assurance.lock`;
4. select the exact current platform entry;
5. prove Rosetta on `darwin-arm64` using `/usr/bin/arch -x86_64 /usr/bin/true`;
6. download the compiler to a temporary file using Node HTTPS with redirects disabled;
7. verify SHA-256 before atomic rename and executable mode;
8. verify `solc --version` contains `0.8.30+commit.73712a01`;
9. verify `slither --version` is exactly `0.11.5`;
10. print only relative cache paths and exact versions.

No setup failure may leave an unverified compiler at the final path.

- [ ] **Step 7: Add command and ignore entries**

Add:

```json
"setup:assurance": "node scripts/setup-contract-assurance.mjs"
```

Ignore:

```text
.venv-assurance/
.cache/contract-assurance/
```

- [ ] **Step 8: Run toolchain tests GREEN**

Run:

```bash
node --test scripts/test/contract-assurance-toolchain.test.js
git diff --check
```

Expected: all toolchain tests pass without network access.

- [ ] **Step 9: Commit**

```bash
git add .gitignore package.json config/contract-assurance-toolchain.json requirements/contract-assurance.in requirements/contract-assurance.lock scripts/contract-assurance-toolchain.mjs scripts/setup-contract-assurance.mjs scripts/test/contract-assurance-toolchain.test.js
git commit -m "build: pin contract assurance toolchain"
```

---

### Task 2: Enforce a closed Slither finding and allowlist model

**Files:**
- Create: `config/slither-allowlist.json`
- Create: `scripts/slither-findings.mjs`
- Create: `scripts/test/slither-findings.test.js`

**Interfaces:**
- Produces: `normalizeSlitherReport(raw, root): NormalizedFinding[]`
- Produces: `findingFingerprint(finding, sourceBytes): FindingFingerprint`
- Produces: `validateAllowlist(raw): Allowlist`
- Produces: `enforceSlitherFindings(findings, allowlist, sources, now): AssuranceSummary`
- Consumes: Slither JSON `results.detectors[]`.

- [ ] **Step 1: Write failing parser and policy tests**

Use literal Slither-shaped fixtures, not helper-generated expected output. Cover:

- clean `{success:true, results:{detectors:[]}}`;
- `success:false`;
- missing/extra root, result, detector, element, or source-mapping fields;
- unknown impact/confidence;
- absolute paths outside the repository;
- High/Medium finding rejection even if an allowlist entry exists;
- one exact Low finding accepted;
- unexpected Low/Informational finding rejected;
- stale fingerprint, source offset, description hash, and snippet hash rejected;
- duplicate and unused allowlist entries rejected;
- `reviewedAt` after the audit date or invalid date rejected;
- raw description output excluded from the public summary.

- [ ] **Step 2: Run parser tests RED**

Run:

```bash
node --test scripts/test/slither-findings.test.js
```

Expected: FAIL because the module is missing.

- [ ] **Step 3: Implement exact normalization**

Normalize only detector records with:

```js
{
  check:string,
  impact:"High"|"Medium"|"Low"|"Informational",
  confidence:"High"|"Medium"|"Low",
  description:string,
  elements:[{
    type:string,
    name:string,
    source_mapping:{
      filename_relative:string,
      start:number,
      length:number
    },
    type_specific_fields:object
  }]
}
```

Require every canonical relative source to resolve inside the repository and below `contracts/src/`. Reject dependency findings rather than silently accepting them if they reach this boundary.

- [ ] **Step 4: Implement drift-sensitive fingerprinting**

Hash with SHA-256:

```js
const descriptionSha256=sha256(normalizeWhitespace(finding.description));
const sourceSnippetSha256=sha256(
  sourceBytes.subarray(mapping.start,mapping.start+mapping.length)
);
```

The identity contains detector, impact, confidence, path, contract/function names if present, source start/length, and both hashes.

- [ ] **Step 5: Implement allowlist enforcement**

Create an initially empty exact file:

```json
{
  "version": 1,
  "entries": []
}
```

Reject High/Medium before allowlist lookup. For Low/Informational, require one-to-one matching. Reject unused entries to force review when a finding disappears.

- [ ] **Step 6: Run parser tests GREEN and commit**

Run:

```bash
node --test scripts/test/slither-findings.test.js
git diff --check
```

Commit:

```bash
git add config/slither-allowlist.json scripts/slither-findings.mjs scripts/test/slither-findings.test.js
git commit -m "feat: enforce exact Slither findings"
```

---

### Task 3: Run real pinned Slither over both production contracts

**Files:**
- Create: `scripts/run-slither-assurance.mjs`
- Create: `scripts/test/run-slither-assurance.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `analyzeContract(target, capabilities): Promise<NormalizedFinding[]>`
- Produces CLI: `npm run analyze:contracts`
- Consumes: verified toolchain paths, exact allowlist, and the Task 2 finding policy.

- [ ] **Step 1: Write failing orchestration tests**

Inject fake `runFile`, `mkdtemp`, and cleanup capabilities. Assert:

- exactly these targets, in order:
  - `contracts/src/SentinelDVNAdapter.sol`
  - `contracts/src/TreasuryPolicyOApp.sol`;
- exact `--solc`, `--solc-args`, `--exclude-dependencies`, and JSON output arguments;
- optimizer `--optimize --optimize-runs 200`;
- base path repository root and include path `node_modules`;
- no shell;
- no non-allowlisted environment;
- temporary output removed after success and failure;
- child errors map to `contract static analysis failed`;
- console summary contains only versions, target count, impact counts, and accepted detector IDs.

- [ ] **Step 2: Run orchestration tests RED**

Run:

```bash
node --test scripts/test/run-slither-assurance.test.js
```

Expected: FAIL because the runner is missing.

- [ ] **Step 3: Implement the runner**

For each production target, run the verified Slither executable with the verified native compiler. Use explicit compiler arguments equivalent to:

```text
--base-path <repo>
--include-path <repo>/node_modules
--evm-version shanghai
--optimize
--optimize-runs 200
```

Write JSON to a unique OS temporary directory. Parse even when Slither returns a finding-related nonzero code, but reject missing/malformed reports and genuine compilation/tool failure.

- [ ] **Step 4: Add the standalone command**

Add:

```json
"analyze:contracts": "node scripts/run-slither-assurance.mjs"
```

- [ ] **Step 5: Run orchestration tests GREEN**

Run:

```bash
node --test scripts/test/run-slither-assurance.test.js
git diff --check
```

- [ ] **Step 6: Bootstrap the real toolchain**

Run with explicit network approval:

```bash
npm run setup:assurance
```

Then verify offline:

```bash
.venv-assurance/bin/slither --version
.cache/contract-assurance/solc/solc-0.8.30 --version
```

Expected: Slither `0.11.5`; solc `0.8.30+commit.73712a01`.

- [ ] **Step 7: Run the first real analysis**

Run:

```bash
npm run analyze:contracts
```

Expected at this stage: either a clean pass or a deliberate failure listing only normalized detector IDs/impacts. Do not add broad suppressions.

- [ ] **Step 8: Commit the runner**

```bash
git add package.json scripts/run-slither-assurance.mjs scripts/test/run-slither-assurance.test.js
git commit -m "feat: run pinned contract static analysis"
```

---

### Task 4: Add real 3-of-5 adapter property campaigns

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `contracts/assurance/property-support.js`
- Create: `contracts/assurance/adapter.property.test.js`

**Interfaces:**
- Produces: `campaign(name, arbitrary, property, {seed,numRuns})`
- Produces: `withEvmSnapshot(provider, operation)`
- Produces: `bytes32Arbitrary`
- Consumes: compiled `SentinelDVNAdapter` and `MockVerificationTarget` artifacts.

- [ ] **Step 1: Add fast-check exactly**

Run with explicit registry access:

```bash
npm install --save-dev --save-exact fast-check@4.9.0
```

Confirm `package.json` contains exactly `"fast-check": "4.9.0"`.

- [ ] **Step 2: Write the adapter property campaigns**

Use exactly:

```js
const adapterAuthorization={seed:1597463007,numRuns:32};
const adapterAtomicity={seed:324508639,numRuns:24};
```

Deploy five sorted authorized signer addresses with quorum three and two outsiders. For each generated case, take a fresh `evm_snapshot`, run one case serially, and `evm_revert` in `finally`.

The first campaign must generate distinct GUID/packet/evidence/call values and authorized subsets of size 3–5, then assert:

```js
assert.equal(await adapter.used(digest),false);
await (await adapter.submitVerification(...args,sortedSignatures)).wait();
assert.equal(await adapter.used(digest),true);
await assert.rejects(sendSameVerificationAgain());
assert.equal(await target.calls(),1n);
```

It must also compare the on-chain digest with `services/coordinator/src/signing.ts`.

The second campaign generates 0–2 authorized signatures plus outsiders, duplicate signatures, malformed signature bytes, wrong packet/evidence/call digests, signatures for a different adapter, signatures for a different chain domain, unsorted signatures, expired envelopes, and reverting target calls. Every rejection asserts `used(digest) === false` and no target mutation.

- [ ] **Step 3: Prove the properties catch a quorum mutation**

Temporarily change:

```solidity
if (count < quorum) revert InvalidQuorum();
```

to:

```solidity
if (count + 1 < quorum) revert InvalidQuorum();
```

Rebuild and run:

```bash
npm run build
node --test contracts/assurance/adapter.property.test.js
```

Expected: FAIL because a two-authorized-signature generated case passes. Restore the original condition with `apply_patch`, rebuild, and do not commit the mutation.

- [ ] **Step 4: Run adapter properties GREEN**

Run with loopback permission:

```bash
node --test contracts/assurance/adapter.property.test.js
```

Expected: both fixed-seed campaigns pass and close EDR.

- [ ] **Step 5: Audit the npm graph**

Run:

```bash
npm ls
npm audit --omit=dev
npm audit
```

Record exact counts. Production audit must remain zero. Do not run automated fixes.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json contracts/assurance/property-support.js contracts/assurance/adapter.property.test.js
git commit -m "test: add adapter threshold properties"
```

---

### Task 5: Add OApp execution, replay, and rollback properties

**Files:**
- Create: `contracts/assurance/oapp.property.test.js`
- Create: `contracts/test/RevertingActionTarget.sol`
- Modify: `scripts/compile-contracts.mjs`

**Interfaces:**
- Consumes: Task 4 `campaign`, `withEvmSnapshot`, and generated bytes32 values.
- Produces: fixed-seed real-bytecode OApp assurance campaigns.

- [ ] **Step 1: Add a minimal reverting action target**

Add:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract RevertingActionTarget {
    uint256 public calls;
    function record(bytes32) external payable {
        ++calls;
        revert("REJECTED");
    }
}
```

Include it in the compile script's reviewed test-source list. It is test code only.

- [ ] **Step 2: Write OApp property campaigns**

Use exactly:

```js
const oappExecution={seed:610839776,numRuns:24};
const oappRejection={seed:195948557,numRuns:32};
```

For valid generated authorization IDs, GUIDs, nonces, and record values:

- deliver from exact trusted peer;
- assert target value/call count;
- assert `executedGuid` and `executedAuthorization`;
- retry the GUID;
- try the same authorization under a different GUID;
- assert no second call.
- send an authorized action through `sendAction`, decode the endpoint receipt, and assert the emitted GUID and exact authorization ID, target, value, and payload bindings.

For rejection cases:

- untrusted peer;
- zero authorization;
- zero target;
- unauthorized target;
- malformed ABI payload;
- reverting authorized target;
- unauthorized `sendAction`;
- unauthorized `setAuthorizedTarget`.

After every revert, assert no execution flag and no retained target side effect.

- [ ] **Step 3: Prove replay properties catch an OR-to-AND mutation**

Temporarily change:

```solidity
if (executedGuid[guid] || executedAuthorization[action.authorizationId]) revert Replay();
```

to:

```solidity
if (executedGuid[guid] && executedAuthorization[action.authorizationId]) revert Replay();
```

Rebuild and run:

```bash
npm run build
node --test contracts/assurance/oapp.property.test.js
```

Expected: FAIL when a prior authorization is delivered under a new GUID. Restore the original OR with `apply_patch`, rebuild, and do not commit the mutation.

- [ ] **Step 4: Run OApp properties GREEN**

Run with loopback permission:

```bash
node --test contracts/assurance/oapp.property.test.js
```

Expected: both campaigns pass and all EDR resources close.

- [ ] **Step 5: Commit**

```bash
git add contracts/assurance/oapp.property.test.js contracts/test/RevertingActionTarget.sol scripts/compile-contracts.mjs
git commit -m "test: add OApp replay properties"
```

---

### Task 6: Triage the real Slither result without broad suppression

**Files:**
- Modify only if justified: `contracts/src/SentinelDVNAdapter.sol`
- Modify only if justified: `contracts/src/TreasuryPolicyOApp.sol`
- Modify only with a real defect: deterministic/property tests for the affected contract
- Modify only for reviewed Low/Informational results: `config/slither-allowlist.json`

**Interfaces:**
- Consumes: Task 3 real normalized findings and Task 2 exact fingerprint format.
- Produces: zero unreviewed findings.

- [ ] **Step 1: Capture the normalized failing result**

Run:

```bash
npm run analyze:contracts
```

Record each detector ID, impact, confidence, production source, contract/function, and source mapping. Do not copy host paths or raw tool stack traces into committed files.

- [ ] **Step 2: Resolve every High or Medium finding**

For each High/Medium result:

1. reproduce the dangerous behavior with the smallest deterministic or property test;
2. run it RED;
3. apply the smallest production fix;
4. run it GREEN;
5. rerun both property suites;
6. rerun Slither.

High/Medium allowlist entries are invalid by schema, so the gate cannot be bypassed.

- [ ] **Step 3: Review each Low or Informational finding**

Prefer a source fix when it improves correctness without weakening protocol behavior. If the behavior is intentional, copy every generated fingerprint field exactly, set `reviewedAt` to `2026-07-29`, and write a 40–400 character `rationale` naming the actual detector, affected function, intended behavior, and concrete security bound. The allowlist validator rejects empty, generic, or out-of-range rationale text.

- [ ] **Step 4: Prove stale/broad entries fail**

Temporarily alter one fingerprint byte and run:

```bash
npm run analyze:contracts
```

Expected: FAIL for an unused/stale entry. Restore the exact fingerprint and rerun GREEN.

- [ ] **Step 5: Review ABI and bytecode**

Save pre-change artifact digests before any production contract edit:

```bash
shasum -a 256 dist/contracts/SentinelDVNAdapter.json dist/contracts/TreasuryPolicyOApp.json
```

After a justified edit, compare ABI arrays structurally and report bytecode digest changes. Unexpected ABI changes block the task.

- [ ] **Step 6: Commit triage**

If only allowlist changes were required:

```bash
git add config/slither-allowlist.json
git commit -m "security: review Slither findings"
```

If a contract defect was fixed, include only the affected contract and its regression tests in a commit named for the behavior fixed.

---

### Task 7: Integrate the assurance gate into full verification

**Files:**
- Modify: `package.json`
- Create: `scripts/test/contract-assurance-entry.test.js`

**Interfaces:**
- Produces CLI: `npm run test:properties`
- Produces CLI: `npm run check:assurance`
- Modifies CLI: `npm run check` includes assurance.

- [ ] **Step 1: Write failing command-surface tests**

Load `package.json` and assert exact scripts:

```js
assert.equal(
  scripts["test:properties"],
  "node --test contracts/assurance/*.property.test.js"
);
assert.equal(
  scripts["check:assurance"],
  "npm run build && npm run test:properties && npm run analyze:contracts"
);
assert.match(scripts.check,/npm run check:assurance/);
```

Also execute `analyze:contracts` with the assurance cache temporarily made unavailable through injected paths and assert it fails with `run npm run setup:assurance`, without attempting network.

- [ ] **Step 2: Run entry tests RED**

Run:

```bash
node --test scripts/test/contract-assurance-entry.test.js
```

Expected: FAIL because the scripts are absent.

- [ ] **Step 3: Add exact scripts**

Add:

```json
"test:properties": "node --test contracts/assurance/*.property.test.js",
"check:assurance": "npm run build && npm run test:properties && npm run analyze:contracts"
```

Append `&& npm run check:assurance` to the existing top-level `check` script. Do not remove typecheck, GenVM lint, direct IC tests, or the ordinary repository test suite.

- [ ] **Step 4: Run entry and standalone assurance tests GREEN**

Run:

```bash
node --test scripts/test/contract-assurance-entry.test.js
npm run check:assurance
```

Expected: entry tests pass; both fixed-seed property campaigns and both Slither targets pass.

- [ ] **Step 5: Commit**

```bash
git add package.json scripts/test/contract-assurance-entry.test.js
git commit -m "test: gate full checks on contract assurance"
```

---

### Task 8: Record exact evidence and limitations

**Files:**
- Create: `docs/research/2026-07-29-contract-assurance-audit.md`
- Modify: `README.md`
- Modify: `contracts/test/README.md`
- Modify: `docs/SECURITY_STATUS.md`
- Modify: `docs/THREAT_MODEL.md`
- Modify: `docs/MILESTONES.md`

**Interfaces:**
- Consumes: actual tool versions, seeds, run counts, findings, audits, ABI/bytecode comparison, and test totals.
- Produces: reader-facing evidence with no overclaim.

- [ ] **Step 1: Collect fresh bounded evidence**

Run:

```bash
.venv-assurance/bin/slither --version
.cache/contract-assurance/solc/solc-0.8.30 --version
node -p "require('./node_modules/fast-check/package.json').version"
npm ls
npm audit --omit=dev
npm audit
npm run check:assurance
```

Record exact outputs and counts, not estimates.

- [ ] **Step 2: Write the dated audit**

Include:

- primary-source URLs and access date;
- Python, Slither, solc, fast-check, Hardhat, Node, and npm versions;
- compiler URLs and SHA-256 values;
- property names, exact seeds, exact run counts, and snapshot isolation;
- both analyzed production targets;
- every accepted finding with detector, impact/confidence, source binding, and rationale;
- npm production/development advisory totals;
- ABI and bytecode comparison;
- commands and offline/setup boundary;
- explicit non-claims.

- [ ] **Step 3: Update security and operator documentation**

Replace “fuzzing” and “Solidity static analysis” in missing-coverage lists with bounded completed evidence. Retain “formal verification” and “third-party audit” as missing. State that generated tests use local EDR and Slither analyzes source with pinned native solc; neither proves deployed LayerZero/GenLayer behavior.

- [ ] **Step 4: Check documentation consistency**

Run:

```bash
rg -n "fuzzing|static analysis|formal verification|third-party audit|0.11.5|4.9.0|1597463007|195948557" README.md contracts/test/README.md docs/SECURITY_STATUS.md docs/THREAT_MODEL.md docs/MILESTONES.md docs/research/2026-07-29-contract-assurance-audit.md
git diff --check
```

No document may say audited, formally verified, deployed, live, or mainnet-ready.

- [ ] **Step 5: Commit**

```bash
git add README.md contracts/test/README.md docs/SECURITY_STATUS.md docs/THREAT_MODEL.md docs/MILESTONES.md docs/research/2026-07-29-contract-assurance-audit.md
git commit -m "docs: record contract assurance evidence"
```

---

### Task 9: Final verification and independent review

**Files:**
- Verify all files from Tasks 1–8.

**Interfaces:**
- Produces: fresh completion evidence and read-only review verdict.

- [ ] **Step 1: Run focused assurance verification**

Run:

```bash
node --test scripts/test/contract-assurance-toolchain.test.js scripts/test/slither-findings.test.js scripts/test/run-slither-assurance.test.js scripts/test/contract-assurance-entry.test.js
npm run check:assurance
git diff --check
```

- [ ] **Step 2: Run dependency and repository hygiene checks**

Run:

```bash
npm ls
npm audit --omit=dev
npm audit
git status --short
```

Production vulnerabilities must remain zero. Development findings must match the dated audit.

- [ ] **Step 3: Run the complete gate fresh**

Run with loopback permission:

```bash
npm run check
```

Required evidence:

- TypeScript passes;
- GenVM lint passes;
- 24 direct Intelligent Contract tests pass;
- ordinary repository tests pass;
- all fixed-seed property campaigns pass;
- both Slither targets pass;
- zero test failures.

- [ ] **Step 4: Request independent read-only review**

Review the range from `cadc5a3` to the final assurance commit against:

- `docs/superpowers/specs/2026-07-29-contract-assurance-gate-design.md`;
- this implementation plan.

Reviewer priorities:

- setup is the only network path;
- no ambient secret forwarding;
- checksum/version/platform enforcement;
- exact Slither schema and fail policy;
- no High/Medium allowlisting;
- property snapshot isolation and meaningful mutations;
- real 3-of-5 behavior;
- EVM cleanup;
- no overclaim in docs.

- [ ] **Step 5: Address findings with review/TDD workflows**

Fix every Critical or Important issue, add regression tests, rerun focused verification, and request a narrow follow-up review.

- [ ] **Step 6: Run final full verification after the last change**

Run:

```bash
npm run check
git diff --check
git status --short
```

- [ ] **Step 7: Preserve the branch**

Keep `codex/isolated-signer-daemon` and its linked worktree intact under the user's previously selected option 3. Do not merge, push, publish, deploy, or remove the worktree.
