# Keyless Deployment Readiness Bundle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an offline, deterministic, keyless CLI that binds a public deployment-readiness manifest to the exact Sentinel source, compiler output, official network audit, and unresolved topology blockers without signing, broadcasting, querying RPC, or claiming a deployment.

**Architecture:** A pure canonical-JSON and manifest layer feeds a pure repository-binding evaluator and topology gate. A thin capability-injected CLI reads only explicit local files and sanitized Git state, then prints or exclusively creates one canonical bundle; the production configuration intentionally yields `BLOCKED_DVN_CONFORMANCE` for the current adapter and no transactions.

**Tech Stack:** Node.js 22.13+, TypeScript 5.8.3, ESM, ethers 6.17.0 address normalization, node:test, repository-pinned solc-js 0.8.30, Git read-only plumbing.

## Global Constraints

- Do not add a wallet, signer, account provider, RPC client, deployment framework, cloud SDK, network call, secret field, or environment-variable configuration.
- Do not deploy, fund, sign, simulate, estimate, broadcast, register, publish, or modify chain state.
- Do not modify `deployments/` except its human documentation; no deployment address or transaction claim may be added.
- Do not hard-code `0xE6e40CFe775fd15BED4c21a0Fae1cD6F042743dc`; it may appear only in an operator-supplied public manifest.
- Accept only absolute manifest and output paths; never discover either from environment variables.
- Require exactly five strictly sorted, distinct EIP-55 signer addresses, quorum three, and exactly five strictly sorted, distinct, nonoverlapping recovery-operator addresses.
- Permanently label every bundle `UNSIGNED_NOT_DEPLOYED_NOT_VERIFIED` and set `userApprovalRequired` to `true`.
- The current `SentinelDVNAdapter` must produce `BLOCKED_DVN_CONFORMANCE` as a `LAYERZERO_DVN_CANDIDATE` and `transactions: []`.
- Treat `config/networks.json` addresses as dated audited metadata, not live pathway evidence.
- Preserve the distinction between deterministic packet/path verification and GenLayer semantic consensus.
- Preserve package pins and add no dependency.
- Use TDD for every source change: observe the exact new test fail, add the minimum implementation, then rerun the narrow and full relevant tests.
- Commit each task separately. Do not push or publish.

## File map

| File | Responsibility |
|---|---|
| `services/coordinator/src/canonical-json.ts` | Encode recursively sorted canonical JSON and reject any input document that is not byte-canonical. |
| `services/coordinator/src/deployment-readiness-manifest.ts` | Define and parse the closed public manifest schema and its security invariants. |
| `scripts/solidity-build-config.mjs` | Build the deterministic compiler/source/ABI/creation-bytecode provenance record. |
| `scripts/compile-contracts.mjs` | Emit `dist/contracts/build-manifest.json` beside compiled artifacts. |
| `config/deployment-readiness.json` | Pin tool version, audit-age limit, repository inputs, supported direction, and every unresolved production gate. |
| `services/coordinator/src/deployment-readiness-binding.ts` | Verify Git, audit, source, compiler, ABI, and creation-bytecode bindings without filesystem or network access. |
| `services/coordinator/src/deployment-readiness-bundle.ts` | Apply status precedence, topology gates, permanent truth labels, and deterministic bundle encoding. |
| `services/coordinator/src/deployment-readiness-command.ts` | Parse the narrow CLI, acquire local evidence through injected capabilities, sanitize failures, and write atomically without overwrite. |
| `services/coordinator/src/deployment-readiness-cli.ts` | Production process wrapper only. |
| `services/coordinator/test/deployment-readiness-*.test.js` | Unit, integration, determinism, capability-isolation, and filesystem tests. |
| `scripts/test/solidity-build-config.test.js` | Provenance-manifest hashing and drift tests. |
| `docs/research/2026-07-29-deployment-readiness-audit.md` | Dated primary-source findings and exact unresolved LayerZero questions. |
| `docs/examples/public-readiness-manifest.json` | Nonoperational canonical schema example that cannot match the final implementation commit. |
| `README.md`, `deployments/README.md`, `docs/SECURITY_STATUS.md`, `docs/THREAT_MODEL.md`, `docs/MILESTONES.md` | Truthful operator and security documentation. |
| `package.json`, `package-lock.json` | Add `readiness:bundle` and bump the local package version to `0.29.0` without changing dependencies. |

---

### Task 1: Canonical JSON boundary

**Files:**
- Create: `services/coordinator/src/canonical-json.ts`
- Create: `services/coordinator/test/deployment-readiness-canonical-json.test.js`

**Interfaces:**
- Produces: `canonicalJson(value: unknown): string`
- Produces: `parseCanonicalJsonDocument(text: string): unknown`
- Consumes: only JavaScript primitives, arrays, and plain objects; it performs no I/O.

- [ ] **Step 1: Write the failing canonicalization tests**

Create tests that hand-check recursive key sorting, a single terminal newline, and rejection of duplicate keys through byte-canonical comparison:

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalJson,
  parseCanonicalJsonDocument
} from "../../../dist/services/coordinator/src/canonical-json.js";

test("encodes recursively sorted canonical JSON with one terminal newline",()=>{
  const value={z:[{b:2,a:1}],a:{d:false,c:null}};
  const encoded='{"a":{"c":null,"d":false},"z":[{"a":1,"b":2}]}\n';
  assert.equal(canonicalJson(value),encoded);
  assert.deepEqual(parseCanonicalJsonDocument(encoded),value);
});

test("rejects noncanonical, duplicate, unsafe and unsupported JSON values",()=>{
  for(const text of[
    '{"b":1,"a":2}\n',
    '{"a":1,"a":2}\n',
    '{"a":1}',
    '{"a":1}\n\n',
    '\uFEFF{"a":1}\n',
    '{"a":1} trailing\n'
  ])assert.throws(()=>parseCanonicalJsonDocument(text),/canonical JSON/);
  for(const value of[
    undefined,
    NaN,
    Infinity,
    1n,
    new Date(0),
    {value:undefined}
  ])assert.throws(()=>canonicalJson(value),/canonical JSON/);
});
```

- [ ] **Step 2: Run the new test and verify RED**

Run:

```bash
node --test services/coordinator/test/deployment-readiness-canonical-json.test.js
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `canonical-json.js`.

- [ ] **Step 3: Implement the minimum pure encoder and parser**

Implement a recursive encoder that:

```ts
export function canonicalJson(value:unknown):string {
  return `${encode(value)}\n`;
}

export function parseCanonicalJsonDocument(text:string):unknown {
  if(typeof text!=="string"||text.includes("\0"))throw new Error("invalid canonical JSON");
  let value:unknown;
  try{value=JSON.parse(text)}catch{throw new Error("invalid canonical JSON")}
  if(canonicalJson(value)!==text)throw new Error("invalid canonical JSON");
  return value;
}
```

`encode` must accept only `null`, booleans, strings, finite numbers, dense arrays, and objects whose prototype is `Object.prototype` or `null`. It must reject accessors, symbol keys, undefined values, nonfinite numbers, bigint, class instances, sparse arrays, and cyclic structures. Object keys are sorted by JavaScript code-unit order before encoding; every string and primitive uses `JSON.stringify`.

- [ ] **Step 4: Build and verify GREEN**

Run:

```bash
npm run build
node --test services/coordinator/test/deployment-readiness-canonical-json.test.js
```

Expected: build succeeds; 2 tests pass with zero failures.

- [ ] **Step 5: Commit**

```bash
git add services/coordinator/src/canonical-json.ts services/coordinator/test/deployment-readiness-canonical-json.test.js
git commit -m "feat: add canonical readiness JSON boundary"
```

### Task 2: Closed public manifest

**Files:**
- Create: `services/coordinator/src/deployment-readiness-manifest.ts`
- Create: `services/coordinator/test/deployment-readiness-manifest.test.js`

**Interfaces:**
- Consumes: `parseCanonicalJsonDocument(text)` from Task 1.
- Produces: `parseDeploymentReadinessManifest(value: unknown): DeploymentReadinessManifest`
- Produces: `parseDeploymentReadinessManifestText(text: string): DeploymentReadinessManifest`
- Produces exact types `ReadinessClassification`, `DeploymentReadinessManifest`, `ArtifactExpectation`, and `ReadinessError`.

- [ ] **Step 1: Write the valid-manifest and invariant tests**

Use one hand-built canonical fixture with this exact schema:

```ts
interface DeploymentReadinessManifest {
  schemaVersion:1;
  classification:"LOCAL_ADAPTER_PROTOTYPE"|"LAYERZERO_DVN_CANDIDATE";
  sourceCommit:string;
  audit:{
    date:string;
    evidenceSha256:string;
    networkConfigSha256:string;
  };
  source:{name:"ethereum-sepolia";chainId:11155111;eid:40161};
  destination:{name:"arbitrum-sepolia";chainId:421614;eid:40231};
  owner:string;
  delegate:string;
  signers:[string,string,string,string,string];
  quorum:3;
  recoveryOperators:[string,string,string,string,string];
  confirmations:{
    source:15;
    destination:64;
    label:"UNAPPROVED_PROJECT_POLICY";
  };
  artifacts:{
    SentinelDVNAdapter:{abiSha256:string;creationBytecodeSha256:string};
    TreasuryPolicyOApp:{abiSha256:string;creationBytecodeSha256:string};
  };
  acknowledgement:"UNSIGNED_NOT_DEPLOYED_NOT_VERIFIED";
}
```

The tests must use ten fixed EIP-55 addresses obtained by checksumming literal private-test vectors with ethers `getAddress`, sort them by lowercase address, and assert the parser returns a detached object.

Add a table of mutations that must throw `ReadinessError` with `READINESS_MANIFEST_INVALID` or `READINESS_SECRET_FIELD_REJECTED`:

```js
const invalid=[
  value=>{value.extra=true},
  value=>{delete value.delegate},
  value=>{value.schemaVersion=2},
  value=>{value.sourceCommit="0".repeat(40)},
  value=>{value.owner="0x0000000000000000000000000000000000000000"},
  value=>{value.signers=value.signers.slice(0,4)},
  value=>{value.signers[1]=value.signers[0]},
  value=>{value.signers.reverse()},
  value=>{value.quorum=2},
  value=>{value.recoveryOperators[0]=value.signers[0]},
  value=>{value.confirmations.source=3},
  value=>{value.confirmations.label="OFFICIAL_RECOMMENDATION"},
  value=>{value.source.eid=40231},
  value=>{value.artifacts.SentinelDVNAdapter.abiSha256="a".repeat(63)},
  value=>{value.requiredDvns=[]},
  value=>{value.deadDvn="0x0000000000000000000000000000000000000001"},
  value=>{value.privateKey="0xdead"},
  value=>{value.rpcUrl="https://rpc.example/secret"}
];
```

Also assert no thrown message contains any mutated address, digest, URL, home path, mnemonic, or private-key value.

- [ ] **Step 2: Run the manifest test and verify RED**

Run:

```bash
node --test services/coordinator/test/deployment-readiness-manifest.test.js
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `deployment-readiness-manifest.js`.

- [ ] **Step 3: Implement the exact parser**

Implement:

```ts
export class ReadinessError extends Error {
  constructor(public readonly code:
    "READINESS_MANIFEST_INVALID"|"READINESS_SECRET_FIELD_REJECTED"
  ){super(code)}
}

export function parseDeploymentReadinessManifestText(text:string):DeploymentReadinessManifest {
  return parseDeploymentReadinessManifest(parseCanonicalJsonDocument(text));
}
```

Every object boundary must compare sorted actual keys with an exact literal key list. Before ordinary validation, recursively reject keys matching:

```ts
/private|secret|mnemonic|seed|keystore|rpc|websocket|provider|wallet|signerkey|cloud|credential|token/i
```

The allowlisted public key `signers` must remain valid. Validate dates as real UTC calendar dates in `YYYY-MM-DD`, commits as 40 lowercase nonzero hex characters, digests as 64 lowercase hex characters, exact chain/EID/name tuples, exact confirmation values, and the permanent acknowledgement. Require `getAddress(value) === value`; compare ordering by `value.toLowerCase()`. Clone every returned array and object.

- [ ] **Step 4: Build and verify GREEN**

Run:

```bash
npm run build
node --test services/coordinator/test/deployment-readiness-manifest.test.js
node --test services/coordinator/test/deployment-readiness-canonical-json.test.js
```

Expected: all readiness manifest and canonical JSON tests pass.

- [ ] **Step 5: Commit**

```bash
git add services/coordinator/src/deployment-readiness-manifest.ts services/coordinator/test/deployment-readiness-manifest.test.js
git commit -m "feat: validate public readiness manifests"
```

### Task 3: Compiler and artifact provenance

**Files:**
- Modify: `scripts/solidity-build-config.mjs`
- Modify: `scripts/compile-contracts.mjs`
- Create: `scripts/test/solidity-build-config.test.js`
- Generated, ignored: `dist/contracts/build-manifest.json`

**Interfaces:**
- Produces: `contractBuildManifest(input)` from `scripts/solidity-build-config.mjs`.
- Produces ignored local file `dist/contracts/build-manifest.json`.
- Consumes: exact production source bytes, compiler version, shared compilation settings, compiled ABI, and creation bytecode.

- [ ] **Step 1: Write failing provenance tests**

Add tests for:

```js
import {contractBuildManifest,solidityBuildConfig} from "../solidity-build-config.mjs";

test("binds exact compiler settings, source, ABI and creation bytecode",()=>{
  const manifest=contractBuildManifest({
    compilerVersion:solidityBuildConfig.solcJsVersion,
    settings:{evmVersion:"shanghai",optimizer:{enabled:true,runs:200}},
    contracts:[
      {name:"SentinelDVNAdapter",source:"contracts/src/SentinelDVNAdapter.sol",sourceText:"contract A{}",
       abi:[{type:"constructor",inputs:[]}],creationBytecode:"6000"},
      {name:"TreasuryPolicyOApp",source:"contracts/src/TreasuryPolicyOApp.sol",sourceText:"contract B{}",
       abi:[],creationBytecode:"6001"}
    ]
  });
  assert.equal(manifest.schemaVersion,1);
  assert.deepEqual(manifest.compiler,{
    version:"0.8.30+commit.73712a01.Emscripten.clang",
    evmVersion:"shanghai",
    optimizer:{enabled:true,runs:200}
  });
  assert.deepEqual(manifest.contracts.map(value=>value.name),["SentinelDVNAdapter","TreasuryPolicyOApp"]);
  for(const contract of manifest.contracts){
    assert.match(contract.sourceSha256,/^[a-f0-9]{64}$/);
    assert.match(contract.abiSha256,/^[a-f0-9]{64}$/);
    assert.match(contract.creationBytecodeSha256,/^[a-f0-9]{64}$/);
  }
});
```

Add negative cases for reversed contract order, an unknown contract, source traversal, wrong compiler version, changed optimizer settings, nonhex bytecode, empty bytecode, and duplicate names.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
node --test scripts/test/solidity-build-config.test.js
```

Expected: FAIL because `contractBuildManifest` is not exported.

- [ ] **Step 3: Implement deterministic provenance**

Add `contractBuildManifest` using Node `createHash("sha256")`:

- source digest is SHA-256 over exact UTF-8 source bytes;
- ABI digest is SHA-256 over `JSON.stringify(abi)`;
- bytecode digest is SHA-256 over decoded creation-bytecode bytes, not its hex text;
- only `SentinelDVNAdapter` and `TreasuryPolicyOApp`, in that order, are accepted;
- compiler version and settings must equal `solidityBuildConfig`.

Modify `compile-contracts.mjs` to retain the two production source texts and compiled artifacts, call this function, and write:

```js
fs.writeFileSync(
  "dist/contracts/build-manifest.json",
  `${JSON.stringify(buildManifest,null,2)}\n`,
  {encoding:"utf8",mode:0o600}
);
```

Do not include mock/test contracts in the provenance manifest.

- [ ] **Step 4: Verify build output**

Run:

```bash
node --test scripts/test/solidity-build-config.test.js
npm run compile:contracts
node -e 'const x=require("./dist/contracts/build-manifest.json"); if(x.contracts.length!==2)process.exit(1)'
```

Expected: tests pass, six Solidity sources compile, and the ignored build manifest contains exactly two production contracts.

- [ ] **Step 5: Run contract regression tests**

Run:

```bash
node --test contracts/test/*.test.js
```

Expected: all contract tests pass; no ABI or bytecode behavior changed.

- [ ] **Step 6: Commit**

```bash
git add scripts/solidity-build-config.mjs scripts/compile-contracts.mjs scripts/test/solidity-build-config.test.js
git commit -m "build: bind production contract provenance"
```

### Task 4: Repository and official-audit binding

**Files:**
- Create: `config/deployment-readiness.json`
- Create: `services/coordinator/src/deployment-readiness-binding.ts`
- Create: `services/coordinator/test/deployment-readiness-binding.test.js`
- Create: `docs/research/2026-07-29-deployment-readiness-audit.md`
- Modify: `config/networks.json`

**Interfaces:**
- Consumes: `DeploymentReadinessManifest`.
- Produces: `inspectDeploymentReadinessBindings(input: BindingInput): ReadinessBinding`.
- Produces: `ReadinessBlocker {code,category,remediation}` without raw rejected values.

- [ ] **Step 1: Write failing binding tests with exact byte fixtures**

Define:

```ts
interface BindingInput {
  manifest:DeploymentReadinessManifest;
  evaluationDate:string;
  git:{commit:string;dirty:boolean};
  networkConfigText:string;
  auditEvidenceText:string;
  readinessConfigText:string;
  buildManifestText:string;
  productionSources:{
    SentinelDVNAdapter:string;
    TreasuryPolicyOApp:string;
  };
}
```

The passing fixture must:

- use a fixed `2026-07-29` evaluation date;
- hash the exact network config and audit evidence bytes into the manifest;
- use a matching Git commit;
- use a clean tree;
- provide compiler settings and both production artifacts matching Task 3;
- use readiness configuration with `maximumAuditAgeDays: 7`.

Assert the result carries detached compiler, source, ABI, bytecode, audit, chain, EID, and official-address bindings without absolute paths.

Assert each audited Dead-DVN address is retained only as `{address,selectable:false}` metadata, no input schema accepts a required/optional DVN selection, and no Dead-DVN address can enter a proposed role.

Add one mutation per blocker:

```js
[
  ["READINESS_SOURCE_DIRTY",input=>{input.git.dirty=true}],
  ["READINESS_ARTIFACT_DRIFT",input=>{input.git.commit="f".repeat(40)}],
  ["READINESS_ARTIFACT_DRIFT",input=>{input.buildManifestText=input.buildManifestText.replace("0.8.30","0.8.29")}],
  ["READINESS_ARTIFACT_DRIFT",input=>{input.productionSources.SentinelDVNAdapter+="\n"}],
  ["READINESS_METADATA_MISMATCH",input=>{input.networkConfigText=input.networkConfigText.replace("40161","40162")}],
  ["READINESS_METADATA_MISMATCH",input=>{input.auditEvidenceText+="altered"}],
  ["READINESS_METADATA_STALE",input=>{input.evaluationDate="2026-08-06"}]
]
```

Assert blockers never contain source text, absolute paths, manifest values, or raw parse exceptions.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
node --test services/coordinator/test/deployment-readiness-binding.test.js
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `deployment-readiness-binding.js`.

- [ ] **Step 3: Create the dated audit data**

Create `config/deployment-readiness.json` with this closed top-level structure:

```json
{
  "schemaVersion": 1,
  "toolVersion": "sentinel-readiness/v1",
  "maximumAuditAgeDays": 7,
  "networkConfig": "config/networks.json",
  "auditEvidence": "docs/research/2026-07-29-deployment-readiness-audit.md",
  "buildManifest": "dist/contracts/build-manifest.json",
  "productionSources": {
    "SentinelDVNAdapter": "contracts/src/SentinelDVNAdapter.sol",
    "TreasuryPolicyOApp": "contracts/src/TreasuryPolicyOApp.sol"
  },
  "pathway": {
    "source": "ethereum-sepolia",
    "destination": "arbitrum-sepolia"
  },
  "gates": {
    "adapterConformance": "LOCAL_ADAPTER_PROTOTYPE",
    "payableAssignJobResolved": false,
    "destinationVerificationTopologyResolved": false,
    "layerZeroOnboardingConfirmed": false,
    "independentDvnsSelected": false,
    "livePathwayValidated": false,
    "confirmationPolicyApproved": false,
    "liveGenLayerFinalityReader": false,
    "isolatedSignerOperators": false,
    "independentRecoveryOperators": false,
    "deploymentSecurityApproval": false
  }
}
```

Update `config/networks.json` to audit date `2026-07-29` and point `auditEvidence` to the new research file without changing the currently verified addresses or truth labels.

The research file must record the official DVN overview, build-DVN reference, technical reference, Sepolia address page, Arbitrum Sepolia address page, exact recheck date, current address table, payable `assignJob` mismatch, current adapter constructor/topology mismatch, unresolved onboarding, unresolved Gasolina retry behavior, unresolved GenLayer finality consumption, and the conclusion `AUDITED_METADATA_NOT_DEPLOYMENT_AUTHORIZATION`.

The current address table must reproduce these rechecked official metadata values exactly:

| Network | EndpointV2 | SendUln302 | ReceiveUln302 | Executor | Dead DVN |
|---|---|---|---|---|---|
| Ethereum Sepolia | `0x6EDCE65403992e310A62460808c4b910D972f10f` | `0xcc1ae8Cf5D3904Cef3360A9532B477529b177cCE` | `0xdAf00F5eE2158dD58E0d3857851c432E34A3A851` | `0x718B92b5CB0a5552039B593faF724D182A881eDA` | `0x8b450b0acF56E1B0e25C581bB04FBAbeeb0644b8` |
| Arbitrum Sepolia | `0x6EDCE65403992e310A62460808c4b910D972f10f` | `0x4f7cd4DA19ABB31b0eC98b9066B9e857B1bf9C0E` | `0x75Db67CDab2824970131D5aa9CECfC9F69c69636` | `0x5Df3a1cEbBD9c8BA7F8dF51Fd632A9aef8308897` | `0xA85BE08A6Ce2771C730661766AACf2c8Bb24C611` |

Link directly to:

- `https://docs.layerzero.network/v2/workers/off-chain/dvn-overview`
- `https://docs.layerzero.network/v2/workers/off-chain/build-dvns`
- `https://docs.layerzero.network/v2/workers/off-chain/dvn-technical-reference`
- `https://docs.layerzero.network/v2/deployments/chains/sepolia`
- `https://docs.layerzero.network/v2/deployments/chains/arbitrum-sepolia`

- [ ] **Step 4: Implement pure binding evaluation**

Parse all four JSON inputs with exact key sets. Compute SHA-256 over exact bytes. Validate:

- Git commit equality and clean state;
- audit age as calendar-day difference from normalized evaluation date;
- exact official metadata tuples already pinned in `config/networks.json`;
- readiness-config paths are repository-relative, normalized, and traversal-free;
- build compiler settings equal the repository pins;
- source SHA-256 matches exact source text;
- ABI and bytecode expectations match the public manifest;
- every expected production contract occurs once.

Return every applicable blocker, sorted by code then category. Do not throw for ordinary drift; throw `ReadinessError("READINESS_MANIFEST_INVALID")` only for malformed local schemas.

- [ ] **Step 5: Build and verify GREEN**

Run:

```bash
npm run build
node --test services/coordinator/test/deployment-readiness-binding.test.js
node --test scripts/test/solidity-build-config.test.js
```

Expected: all binding and provenance tests pass.

- [ ] **Step 6: Commit**

```bash
git add config/deployment-readiness.json config/networks.json docs/research/2026-07-29-deployment-readiness-audit.md services/coordinator/src/deployment-readiness-binding.ts services/coordinator/test/deployment-readiness-binding.test.js
git commit -m "feat: bind readiness to audited repository evidence"
```

### Task 5: Fail-closed topology and bundle builder

**Files:**
- Create: `services/coordinator/src/deployment-readiness-bundle.ts`
- Create: `services/coordinator/test/deployment-readiness-bundle.test.js`

**Interfaces:**
- Consumes: `DeploymentReadinessManifest`, `ReadinessBinding`, normalized evaluation date, and parsed gates.
- Produces: `buildDeploymentReadinessBundle(input): DeploymentReadinessBundle`.
- Produces: `encodeDeploymentReadinessBundle(bundle): string`.

- [ ] **Step 1: Write failing status, topology, and determinism tests**

The current production-gate fixture requested as `LAYERZERO_DVN_CANDIDATE` must assert:

```js
assert.equal(bundle.status,"BLOCKED_DVN_CONFORMANCE");
assert.equal(bundle.truthLabel,"UNSIGNED_NOT_DEPLOYED_NOT_VERIFIED");
assert.equal(bundle.userApprovalRequired,true);
assert.deepEqual(bundle.transactions,[]);
assert.equal(bundle.network.source.deadDvn.selectable,false);
assert.equal(bundle.network.destination.deadDvn.selectable,false);
assert.deepEqual(bundle.policyBoundary,{
  deterministic:"PACKET_PATH_CONFIRMATIONS_REPLAY",
  semantic:"FINALIZED_GENLAYER_GOVERNANCE_POLICY",
  signing:"ONLY_AFTER_BOTH_FINALIZE",
  layerZeroRole:"ADDITIONAL_OR_OPTIONAL_WITH_INDEPENDENT_DVNS"
});
```

Its blocker list must include stable codes for all ten false gates from Task 4. Add assertions that:

- `LOCAL_ADAPTER_PROTOTYPE` remains blocked, local, and non-onboarded;
- an ABI containing `assignJob` and `getFee` cannot change status;
- artifact blockers outrank network, conformance, and configuration blockers;
- network blockers outrank conformance and configuration blockers;
- conformance blockers outrank configuration blockers;
- a fully true synthetic future-gate fixture with matching bindings yields `READY_FOR_SEPARATE_DEPLOYMENT_APPROVAL`, still unsigned, still approval-required, and still contains no signature or broadcast material;
- identical input and evaluation date produce byte-identical output;
- changing only the evaluation date changes output;
- output contains none of `privateKey`, `mnemonic`, `rpcUrl`, `gasPrice`, `nonce`, `rawTransaction`, an absolute home path, or a raw exception.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
node --test services/coordinator/test/deployment-readiness-bundle.test.js
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `deployment-readiness-bundle.js`.

- [ ] **Step 3: Implement status precedence and bundle construction**

Use this fixed precedence:

```ts
const precedence=[
  ["ARTIFACT","BLOCKED_ARTIFACT_BINDING"],
  ["NETWORK","BLOCKED_NETWORK_AUDIT"],
  ["CONFORMANCE","BLOCKED_DVN_CONFORMANCE"],
  ["CONFIGURATION","BLOCKED_CONFIGURATION"]
] as const;
```

Map every false gate to a stable blocker with category and fixed remediation identifier. Never put user-supplied content in blocker text.

The output must contain only:

- `schemaVersion`, `toolVersion`, `evaluationDate`;
- `status`, `classification`, `truthLabel`, `userApprovalRequired`;
- exact source commit and repository-input digest;
- compiler, source, ABI, bytecode, audit, network, owner/delegate, quorum, signer, recovery, and confirmation bindings;
- the fixed policy boundary;
- sorted blocker records;
- `transactions: []`.

Encode only through `canonicalJson`. No clock or filesystem access is allowed in this module.

- [ ] **Step 4: Build and verify GREEN**

Run:

```bash
npm run build
node --test services/coordinator/test/deployment-readiness-bundle.test.js
node --test services/coordinator/test/deployment-readiness-binding.test.js services/coordinator/test/deployment-readiness-manifest.test.js
```

Expected: all readiness library tests pass.

- [ ] **Step 5: Commit**

```bash
git add services/coordinator/src/deployment-readiness-bundle.ts services/coordinator/test/deployment-readiness-bundle.test.js
git commit -m "feat: build fail-closed readiness bundles"
```

### Task 6: Zero-capability CLI and exclusive output

**Files:**
- Create: `services/coordinator/src/deployment-readiness-command.ts`
- Create: `services/coordinator/src/deployment-readiness-cli.ts`
- Create: `services/coordinator/test/deployment-readiness-command.test.js`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: `runDeploymentReadinessCommand(args, io, dependencies): Promise<number>`.
- Produces: `writeReadinessFileExclusive(path, contents, filePort?): Promise<void>`.
- Consumes: exact absolute `--manifest` and optional absolute `--output`.
- Default dependencies read repository-local evidence, run two read-only Git commands, obtain one UTC date, and use atomic exclusive output.

- [ ] **Step 1: Write failing CLI and capability-isolation tests**

Define injected dependencies:

```ts
interface ReadinessCommandDependencies {
  readText(path:string):Promise<string>;
  repositoryRoot:string;
  gitState():Promise<{commit:string;dirty:boolean}>;
  evaluationDate():string;
  writeExclusive(path:string,contents:string):Promise<void>;
  inspect(input:BindingInput):ReadinessBinding;
  build(input:{
    manifest:DeploymentReadinessManifest;
    binding:ReadinessBinding;
    evaluationDate:string;
  }):DeploymentReadinessBundle;
}
```

Test these exact outcomes:

- valid ready bundle to stdout returns `0`;
- valid blocked bundle to stdout returns `2`;
- `--output /absolute/file.json` writes once, prints no bundle to stdout, and returns the status code;
- relative paths, duplicate flags, unknown flags, inline JSON, standard-input marker, missing values, NUL bytes, and extra arguments return `1` with `READINESS_MANIFEST_INVALID`;
- malformed canonical JSON returns `1`;
- existing output returns `1` with `READINESS_OUTPUT_EXISTS`;
- reader, Git, builder, and writer failures return `1` with only their stable sanitized code;
- every acquired file handle is closed on success and failure;
- fake file-port failures during `write`, `sync`, and `link` close the open handle, remove the exact sibling temporary file, and leave the final path absent;
- an actual pre-existing final path remains byte-identical and leaves no sibling temporary file;
- manifest values and raw errors never appear on stderr;
- getter traps named `wallet`, `signer`, `privateKey`, `mnemonic`, `provider`, `rpc`, `cloud`, and `environment` are never accessed;
- ambient secret-like environment variables do not change dependencies or output;
- `deployments/` and all repository inputs have identical byte digests before and after each invocation.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
node --test services/coordinator/test/deployment-readiness-command.test.js
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `deployment-readiness-command.js`.

- [ ] **Step 3: Implement the narrow command**

Accept only:

```text
--manifest /absolute/path.json
--manifest /absolute/path.json --output /absolute/output.json
```

The default repository loader must:

- require `process.cwd()` to equal the sanitized `git rev-parse --show-toplevel` result;
- run `git rev-parse HEAD` and `git status --porcelain=v1 --untracked-files=all` through `execFile` argument arrays, never a shell;
- use only `PATH=/usr/bin:/bin:/usr/local/bin`, `LC_ALL=C`, `GIT_CONFIG_NOSYSTEM=1`, and `GIT_CONFIG_GLOBAL=/dev/null`;
- read only the exact files named by the closed readiness configuration;
- never forward the ambient environment;
- normalize the injected clock once to UTC `YYYY-MM-DD`.

For exclusive output, implement `writeReadinessFileExclusive` over a narrow injectable file port (`open`, `link`, `unlink`). Write a mode-`0o600` sibling temporary file with `wx`, call `writeFile`, `sync`, and `close`, atomically `link` it to the final path so an existing destination fails, then unlink the temporary path. On every caught failure, close the handle and unlink only that exact temporary file. Map `EEXIST` to `READINESS_OUTPUT_EXISTS`.

Write only canonical bundle JSON to stdout or the output file. Write one canonical error object to stderr. Never print a stack trace.

- [ ] **Step 4: Add the process wrapper and package command**

`deployment-readiness-cli.ts` must contain only:

```ts
import{runDeploymentReadinessCommand}from"./deployment-readiness-command.js";
const code=await runDeploymentReadinessCommand(
  process.argv.slice(2),
  {stdout:value=>process.stdout.write(value),stderr:value=>process.stderr.write(value)}
);
process.exitCode=code;
```

Set `package.json` and the root `package-lock.json` version to `0.29.0`. Add:

```json
"readiness:bundle": "npm run build && node dist/services/coordinator/src/deployment-readiness-cli.js"
```

Do not change dependencies or package pins.

- [ ] **Step 5: Build and verify GREEN**

Run:

```bash
npm run build
node --test services/coordinator/test/deployment-readiness-command.test.js
node --test services/coordinator/test/deployment-readiness-*.test.js
```

Expected: all CLI and readiness tests pass.

- [ ] **Step 6: Exercise the production CLI with a blocked manifest**

Create a temporary canonical manifest outside the repository using the current public artifact/audit digests and a deliberately nonmatching nonzero source commit. Run:

```bash
npm run readiness:bundle -- --manifest /absolute/temporary/public-readiness.json
```

Expected: canonical bundle on stdout, exit `2`, primary status `BLOCKED_ARTIFACT_BINDING`, permanent truth label present, and `transactions` empty. No repository file changes.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json services/coordinator/src/deployment-readiness-command.ts services/coordinator/src/deployment-readiness-cli.ts services/coordinator/test/deployment-readiness-command.test.js
git commit -m "feat: add keyless readiness CLI"
```

### Task 7: Truthful operator documentation and final gate

**Files:**
- Create: `docs/examples/public-readiness-manifest.json`
- Modify: `README.md`
- Modify: `deployments/README.md`
- Modify: `docs/SECURITY_STATUS.md`
- Modify: `docs/THREAT_MODEL.md`
- Modify: `docs/MILESTONES.md`
- Modify: `services/coordinator/test/deployment-readiness-command.test.js`

**Interfaces:**
- Consumes the complete CLI from Task 6.
- Produces one public schema example and exact operator documentation.

- [ ] **Step 1: Add a failing end-to-end truthfulness test**

Extend the CLI test to run the real compiled command against:

- the committed canonical example manifest copied to an operating-system temporary directory;
- the real current readiness configuration, network configuration, research evidence, production sources, and build manifest;
- a fixed clock of `2026-07-29`;
- a read-only Git fixture with a deliberately different nonzero commit.

Assert:

```js
assert.equal(code,2);
assert.equal(bundle.status,"BLOCKED_ARTIFACT_BINDING");
assert.equal(bundle.truthLabel,"UNSIGNED_NOT_DEPLOYED_NOT_VERIFIED");
assert.equal(bundle.userApprovalRequired,true);
assert.deepEqual(bundle.transactions,[]);
assert.equal(networkCalls,0);
assert.equal(signingCalls,0);
assert.equal(deploymentCalls,0);
```

Hash every file under `deployments/` before and after and require equality.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
npm run build
node --test services/coordinator/test/deployment-readiness-command.test.js
```

Expected: FAIL because the public example and real integration fixture do not exist.

- [ ] **Step 3: Create the canonical public example**

Create `docs/examples/public-readiness-manifest.json` using:

- schema version one;
- `LAYERZERO_DVN_CANDIDATE`;
- the full nonzero commit `7bcd562306b478a23c24772e9900a3d5d053f2f2`, which intentionally cannot equal the final implementation commit;
- current audit and artifact digests calculated from the committed files and compiled provenance;
- Ethereum Sepolia to Arbitrum Sepolia exact tuples;
- ten valid checksummed deterministic test addresses, sorted and nonoverlapping;
- quorum three;
- source/destination confirmations 15 and 64 labeled `UNAPPROVED_PROJECT_POLICY`;
- the permanent acknowledgement.

Encode it with the production canonical encoder. Add a neighboring paragraph in README stating that it is a schema example expected to fail source binding after implementation commits; it is not deployment authorization.

- [ ] **Step 4: Update documentation without changing deployment truth**

Update README with:

- what `npm run readiness:bundle` does;
- exact CLI syntax and exit codes;
- an example blocked output;
- explanation of deterministic checks versus GenLayer semantic consensus;
- explanation that current adapter conformance, LayerZero onboarding, independent DVNs, live GenLayer finality, isolated signers, recovery operators, and confirmation policy remain blocked;
- no live app URL and no deployment;
- rollback and recovery: delete generated local bundle; no chain rollback exists because nothing is submitted.

Update `deployments/README.md` to state that a readiness bundle is not a deployment record and that the directory still has no deployments.

Update security status and threat model with the new local capability boundary, stale-audit risk, malicious-manifest risk, Git/worktree binding limits, ignored-build-artifact risk, and absence of live-chain verification.

Update milestones so M1 includes the keyless readiness bundle while M2 still requires explicit approval, current official re-audit, live read-only RPC validation, conformance resolution, independent DVN selection, account-provider review, funds, and deployment.

- [ ] **Step 5: Verify the integration test GREEN**

Run:

```bash
npm run build
node --test services/coordinator/test/deployment-readiness-command.test.js
node --test services/coordinator/test/deployment-readiness-*.test.js scripts/test/solidity-build-config.test.js
```

Expected: all readiness, provenance, CLI, filesystem, and truthful-integration tests pass.

- [ ] **Step 6: Run dependency and repository checks**

Run:

```bash
npm ls
npm audit --omit=dev
npm audit
git diff --check
```

Expected: dependency tree valid; production audit remains zero; development findings are recorded without forced remediation; diff check reports no whitespace error.

- [ ] **Step 7: Run the full verification gate**

Run:

```bash
npm run check
```

Expected:

- 24 direct GenLayer tests pass;
- all Node tests, including the new readiness tests, pass with zero failures, skips, or todos;
- all four fixed-seed property campaigns pass;
- Slither reports zero High and zero Medium production findings;
- no network download, deployment, signing, RPC call, funding, publication, or cloud action occurs.

- [ ] **Step 8: Perform a clean-tree production demonstration**

After committing all intended source and documentation files, rebuild, place the canonical example copy outside the repository, and run the production CLI. Verify exit `2`, exact blocker ordering, no transactions, no repository mutation, and no absolute paths or secrets in output.

- [ ] **Step 9: Independent read-only review**

Ask a reviewer to inspect:

- conformance fail closure;
- manifest and local-config closed schemas;
- canonical JSON and duplicate-key rejection;
- Git/source/compiler/ABI/bytecode/audit binding;
- zero network/wallet/signing/deployment capability;
- atomic exclusive output;
- sanitized errors;
- status precedence and deterministic output;
- documentation truth labels.

Resolve every Critical or Important finding with a failing regression test before changing implementation.

- [ ] **Step 10: Commit documentation and evidence**

```bash
git add README.md deployments/README.md docs/SECURITY_STATUS.md docs/THREAT_MODEL.md docs/MILESTONES.md docs/examples/public-readiness-manifest.json services/coordinator/test/deployment-readiness-command.test.js
git commit -m "docs: document keyless deployment readiness"
```

## Final completion conditions

- The current production command emits a valid blocked bundle and exit `2`.
- The current adapter is never described as conformant, onboarded, live, deployed, or production-ready.
- The bundle contains no transaction, signature, nonce, RPC, provider, gas, wallet, secret, cloud, or account material.
- Every source and audit input is digest-bound to the exact Git state and compiled provenance.
- The public example cannot authorize a deployment and cannot match the final implementation commit.
- Full tests and contract assurance pass from the final committed tree.
- Git status is clean.
- Nothing is deployed, funded, pushed, published, registered, or externally messaged.
