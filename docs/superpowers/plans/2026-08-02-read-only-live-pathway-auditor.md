# Read-only Live Pathway Auditor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a keyless, read-only auditor that compares Ethereum Sepolia and Arbitrum Sepolia LayerZero/Sentinel pathway state through two public RPC transports per chain and emits a canonical, fail-closed evidence bundle without deploying, signing, funding, or mutating either chain.

**Architecture:** A closed public manifest and repository policy binding feed four restricted JSON-RPC clients. Each chain is pinned to a block hash agreed by both providers; shared LayerZero readers, deployment-transaction verification, and a pure evaluator produce normalized observations and blockers. A thin CLI prints or exclusively creates the unsigned artifact, while readiness and dashboard integrations consume a separately supplied artifact without clearing gates or simulating live state.

**Tech Stack:** Node.js 22.13+, TypeScript 5.8.3, ESM, native `node:https` and `node:dns`, ethers 6.17.0 ABI/Keccak utilities, fast-check 4.9.0, node:test, existing static JavaScript dashboard.

## Global Constraints

- Support only Ethereum Sepolia chain ID 11155111/EID 40161 to Arbitrum Sepolia chain ID 421614/EID 40231.
- Use exactly two explicit credential-free public HTTPS RPC endpoints per chain; do not read RPC configuration from environment variables or `.env` files.
- Permit only `eth_chainId`, `eth_blockNumber`, `eth_getBlockByNumber`, `eth_getCode`, `eth_call`, `eth_getTransactionByHash`, and `eth_getTransactionReceipt`.
- Reject every wallet, signer, private key, mnemonic, keystore, account provider, faucet, transaction submission, raw transaction, deployment, funding, cloud, and environment-variable capability.
- Pin state reads with EIP-1898 `{blockHash, requireCanonical: true}`; a provider that cannot honor the reference blocks the run.
- Treat distinct URLs as transport diversity only; provider independence requires a current committed operator-evidence record.
- Keep confirmation values 15 and 64 labeled `UNAPPROVED_PROJECT_POLICY`; observation lags are stability settings, not finality or message confirmation claims.
- Require an all-or-null deployment record for source OApp, destination OApp, source adapter, and destination adapter. Partial records are invalid.
- Prove exact adapter signer membership only from repository-bound creation bytecode plus decoded deployment constructor arguments and a successful receipt; mapping reads alone are insufficient.
- Sentinel must be additional or optional beside at least one separately reviewed independent DVN and must never be the sole effective verifier.
- Permanently label every artifact `READ_ONLY_UNSIGNED_NOT_DEPLOYED_NOT_ONBOARDED`.
- A consistent observation does not prove LayerZero onboarding, DVN liveness, GenLayer finality, signer isolation, production safety, or deployment approval.
- Preserve package pins and add no dependency.
- Use TDD for every source change: observe the narrow test fail, add the minimum implementation, then rerun the narrow test and affected regression tests.
- Commit each task separately. Do not push, publish, deploy, create cloud resources, request funds, or spend funds.
- Preserve the unrelated untracked `.DS_Store` without staging, editing, or deleting it.

## File map

| File | Responsibility |
|---|---|
| `services/coordinator/src/pathway-audit-model.ts` | Shared status, blocker, provider, deployment, observation, and bundle types. |
| `services/coordinator/src/pathway-audit-manifest.ts` | Closed canonical public-manifest parser and capability/URL refusal rules. |
| `config/pathway-auditor.json` | Pin tool version, repository evidence paths, direction, audit age, and official code-identity state. |
| `config/rpc-provider-audit.json` | Hold reviewed public operator-family evidence; initially records that no provider has been reviewed. |
| `services/coordinator/src/pathway-audit-policy.ts` | Bind manifest metadata to committed network/provider audits and emit independence/input blockers. |
| `services/coordinator/src/read-only-json-rpc.ts` | DNS-pinned public HTTPS JSON-RPC transport with method/shape/size/time limits and sanitized errors. |
| `services/coordinator/src/pathway-audit-block.ts` | Select, normalize, and recheck one block hash agreed by both providers per chain. |
| `services/coordinator/src/pathway-audit-deployment.ts` | Verify creation transaction, receipt, repository creation bytecode, constructor values, and observed runtime code. |
| `services/coordinator/src/source-path-verifier.ts` | Export the existing source LayerZero observation reader for reuse by runtime and auditor. |
| `services/coordinator/src/destination-path-verifier.ts` | Export the existing destination LayerZero/adapter observation reader and destination peer read. |
| `services/coordinator/src/pathway-audit-observer.ts` | Orchestrate dual-provider reads, compare normalized evidence, and evaluate pathway invariants. |
| `services/coordinator/src/pathway-audit-bundle.ts` | Apply blocker precedence, canonicalize public evidence, and compute the final evidence SHA-256. |
| `services/coordinator/src/pathway-audit-command.ts` | Parse CLI arguments, load explicit local inputs, construct restricted clients, and map failures to exit codes. |
| `services/coordinator/src/pathway-audit-cli.ts` | Production process wrapper only. |
| `services/coordinator/src/deployment-readiness-manifest.ts` | Add an optional exact pathway-audit digest reference to readiness input. |
| `services/coordinator/src/deployment-readiness-command.ts` | Load and validate the referenced pathway artifact without changing readiness gates. |
| `services/coordinator/src/deployment-readiness-bundle.ts` | Surface the bound pathway observation and preserve manual gate control. |
| `config/deployment-readiness.json` | Move the closed readiness contract to schema/tool version 2 while leaving every human approval gate explicit. |
| `apps/dashboard/src/pathway-audit.js` | Validate and render an operator-selected local audit artifact in the browser. |
| `apps/dashboard/index.html`, `apps/dashboard/src/style.css`, `apps/dashboard/src/app.js` | Add the read-only observation panel and local file-loading boundary. |
| `services/coordinator/test/pathway-audit-*.test.js` | Parser, policy, transport, block, deployment, observation, bundle, command, property, and integration tests. |
| `apps/dashboard/test/pathway-audit.test.js` | Closed browser model, truthful rendering, and unavailable-state tests. |
| `docs/examples/public-pathway-observation-manifest.template.json` | Safe, nonoperational manifest template with a null deployment record. |
| `docs/PATHWAY_AUDITOR.md` | Operator procedure, evidence glossary, drift monitoring, and failure handling. |
| `README.md`, `docs/DEMO.md`, `docs/OPERATIONS.md`, `docs/SECURITY_STATUS.md`, `docs/THREAT_MODEL.md`, `docs/UNKNOWNS.md`, `docs/MILESTONES.md` | Truthful product, operations, demo, risk, and milestone updates. |
| `package.json`, `package-lock.json`, `scripts/check-dashboard.mjs` | Add the audit command, update local version metadata, and enforce dashboard truth labels. |

---

### Task 1: Closed audit model and public manifest

**Files:**
- Create: `services/coordinator/src/pathway-audit-model.ts`
- Create: `services/coordinator/src/pathway-audit-manifest.ts`
- Create: `services/coordinator/test/pathway-audit-manifest.test.js`

**Interfaces:**
- Produces: `PathwayAuditStatus`, `PathwayAuditBlocker`, `PathwayAuditManifest`, `AuditRpcEndpoint`, `AuditDeploymentManifest`, and `PathwayAuditError`.
- Produces: `parsePathwayAuditManifest(value: unknown): PathwayAuditManifest`.
- Produces: `parsePathwayAuditManifestText(text: string): PathwayAuditManifest`.
- Consumes: `parseCanonicalJsonDocument(text)` and ethers `getAddress`.

- [ ] **Step 1: Write the failing manifest tests**

Create a canonical valid fixture with this exact public shape:

```js
const manifest={
  schemaVersion:1,
  networkAuditSha256:"a".repeat(64),
  source:{
    name:"ethereum-sepolia",chainId:11155111,eid:40161,observationLag:3,
    contracts:{endpointV2:address(1),sendUln302:address(2),executor:address(3),deadDvn:address(4)},
    rpcs:[rpc("source-a","https://rpc-a.example/","operator-a","b"),rpc("source-b","https://rpc-b.example/","operator-b","c")]
  },
  destination:{
    name:"arbitrum-sepolia",chainId:421614,eid:40231,observationLag:20,
    contracts:{endpointV2:address(5),receiveUln302:address(6),deadDvn:address(7)},
    rpcs:[rpc("destination-a","https://rpc-c.example/rpc","operator-c","d"),rpc("destination-b","https://rpc-d.example/","operator-d","e")]
  },
  deployment:null,
  confirmationPolicy:{source:15,destination:64,label:"UNAPPROVED_PROJECT_POLICY"},
  acknowledgement:"READ_ONLY_UNSIGNED_NOT_DEPLOYED_NOT_ONBOARDED"
};
```

Assert the parser returns a detached value and rejects unknown/missing keys, noncanonical JSON, duplicate JSON keys, bad chain/EID tuples, zero or non-EIP-55 addresses, observation lag outside 1–256, duplicate origins, URL user information/query/fragment/port, paths other than `/` or `/rpc`, IP literals, `.localhost`, secret-shaped keys, four RPCs, one RPC, partial deployments, malformed transaction hashes, fewer or more than five signers, unsorted/duplicate signers, and quorum other than three. Assert errors expose only `PATHWAY_AUDIT_MANIFEST_INVALID` or `PATHWAY_AUDIT_SECRET_FIELD_REJECTED` and never echo the rejected value.

- [ ] **Step 2: Run the manifest test and verify RED**

Run:

```bash
npm run build
node --test services/coordinator/test/pathway-audit-manifest.test.js
```

Expected: the build or test fails because `pathway-audit-manifest.js` does not exist.

- [ ] **Step 3: Define the exact model and parser**

Implement these central shapes in `pathway-audit-model.ts`:

```ts
export type PathwayAuditStatus=
  "BLOCKED_INPUT_BINDING"|"BLOCKED_RPC_INDEPENDENCE"|
  "BLOCKED_RPC_CONSENSUS"|"BLOCKED_CODE_IDENTITY"|
  "BLOCKED_PATHWAY_CONFIGURATION"|"OBSERVED_PATHWAY_CONSISTENT";

export type PathwayAuditBlockerCategory=
  "INPUT_BINDING"|"RPC_INDEPENDENCE"|"RPC_CONSENSUS"|
  "CODE_IDENTITY"|"PATHWAY_CONFIGURATION";

export type PathwayAuditBlockerCode=
  "AUDIT_NETWORK_METADATA_MISMATCH"|"AUDIT_NETWORK_AUDIT_STALE"|
  "AUDIT_PROVIDER_EVIDENCE_MISSING"|"AUDIT_PROVIDER_EVIDENCE_STALE"|
  "AUDIT_PROVIDER_OPERATOR_DUPLICATED"|"AUDIT_RPC_UNAVAILABLE"|
  "AUDIT_CHAIN_MISMATCH"|"AUDIT_BLOCK_DISAGREEMENT"|
  "AUDIT_BLOCK_UNSTABLE"|"AUDIT_PROVIDER_RESULT_DISAGREEMENT"|
  "AUDIT_CODE_MISSING"|"AUDIT_CODE_IDENTITY_UNPROVEN"|
  "AUDIT_DEPLOYMENT_EVIDENCE_MISSING"|"AUDIT_DEPLOYMENT_ARTIFACT_MISMATCH"|
  "AUDIT_PATHWAY_DEPLOYMENTS_MISSING"|"AUDIT_DEFAULT_LIBRARY"|
  "AUDIT_INHERITED_ULN_CONFIG"|"AUDIT_UNSUPPORTED_EID"|
  "AUDIT_PEER_MISMATCH"|"AUDIT_EXECUTOR_MISMATCH"|
  "AUDIT_DVN_ORDER_INVALID"|"AUDIT_DVN_THRESHOLD_INVALID"|
  "AUDIT_DEAD_DVN_PRESENT"|"AUDIT_ULN_MISMATCH"|
  "AUDIT_SENTINEL_NOT_OPTIONAL"|"AUDIT_SENTINEL_SOLE_EFFECTIVE_VERIFIER"|
  "AUDIT_ADAPTER_BINDING_MISMATCH"|"AUDIT_SIGNER_MEMBERSHIP_MISMATCH";

export type PathwayAuditRemediation=
  "RECHECK_NETWORK_AUDIT"|"REVIEW_RPC_OPERATORS"|
  "REPLACE_RPC_TRANSPORT"|"RETRY_AT_STABLE_BLOCK"|
  "PIN_REVIEWED_CODE_IDENTITY"|"SUPPLY_COMPLETE_DEPLOYMENT_EVIDENCE"|
  "CONFIGURE_EXPLICIT_LIBRARIES"|"CONFIGURE_MATCHING_ULN"|
  "REMOVE_DEAD_DVN"|"SELECT_INDEPENDENT_DVNS"|
  "CONFIGURE_SENTINEL_OPTIONAL"|"CORRECT_PEERS"|
  "CORRECT_EXECUTOR"|"CORRECT_ADAPTER_BINDINGS"|
  "CORRECT_SIGNER_MEMBERSHIP";

export interface PathwayAuditBlocker{
  code:PathwayAuditBlockerCode;
  category:PathwayAuditBlockerCategory;
  remediation:PathwayAuditRemediation;
}

export class PathwayAuditError extends Error{
  constructor(public readonly code:
    "PATHWAY_AUDIT_MANIFEST_INVALID"|
    "PATHWAY_AUDIT_SECRET_FIELD_REJECTED"|
    "PATHWAY_AUDIT_TRANSPORT_FAILED"|
    "PATHWAY_AUDIT_OBSERVATION_FAILED"
  ){super(code)}
}
```

Define the deployment union so the four contracts cannot be supplied partially:

```ts
export type AuditDeploymentManifest=null|{
  sourceOApp:{address:string;deploymentTxHash:string;delegate:string};
  destinationOApp:{address:string;deploymentTxHash:string;delegate:string};
  sourceAdapter:{address:string;deploymentTxHash:string};
  destinationAdapter:{address:string;deploymentTxHash:string};
  authorizedSigners:[string,string,string,string,string];
  quorum:3;
};
```

Use exact-key checks at every object boundary, a recursive secret-key scan, EIP-55 equality through `getAddress`, two-element tuple cloning, and the existing duplicate-key-aware canonical parser. URL parsing must require HTTPS, no port/user information/query/fragment, a DNS hostname, and pathname `/` or `/rpc`.

- [ ] **Step 4: Build and verify GREEN**

Run:

```bash
npm run build
node --test services/coordinator/test/pathway-audit-manifest.test.js
node --test services/coordinator/test/deployment-readiness-canonical-json.test.js
```

Expected: all tests pass with zero failures.

- [ ] **Step 5: Commit**

```bash
git add services/coordinator/src/pathway-audit-model.ts services/coordinator/src/pathway-audit-manifest.ts services/coordinator/test/pathway-audit-manifest.test.js
git commit -m "feat: validate public pathway audit manifests"
```

### Task 2: Repository metadata and provider-independence binding

**Files:**
- Create: `config/pathway-auditor.json`
- Create: `config/rpc-provider-audit.json`
- Create: `services/coordinator/src/pathway-audit-policy.ts`
- Create: `services/coordinator/test/pathway-audit-policy.test.js`

**Interfaces:**
- Consumes: `PathwayAuditManifest` from Task 1 plus raw `config/networks.json`, LayerZero audit, auditor policy, and provider-audit bytes.
- Produces: `parsePathwayAuditorPolicy(text: string): PathwayAuditorPolicy`.
- Produces: `bindPathwayAuditPolicy(input: PathwayAuditPolicyInput): PathwayAuditPolicyBinding`.
- Produces: reviewed/unproven state for every manifest RPC and immutable official network expectations.

- [ ] **Step 1: Write failing policy-binding tests**

Test exact agreement with `config/networks.json`, digest binding to the manifest, evaluation-date validation, provider-audit age, source/destination operator-family separation, origin-digest matching, and stable blockers. The initial empty provider audit must yield four `AUDIT_PROVIDER_EVIDENCE_MISSING` blockers without treating distinct URLs as independent.

Use a second fixture with four reviewed records and assert:

```js
assert.deepEqual(binding.rpcIndependence,{
  source:"OPERATOR_INDEPENDENCE_REVIEWED",
  destination:"OPERATOR_INDEPENDENCE_REVIEWED"
});
assert.equal(binding.blockers.some(value=>value.category==="RPC_INDEPENDENCE"),false);
```

Mutate audit dates, evidence digests, origins, operator families, official addresses, Dead-DVN addresses, and chain direction one field at a time; each mutation must produce the specified blocker and no raw URL.

- [ ] **Step 2: Run the policy test and verify RED**

Run:

```bash
npm run build
node --test services/coordinator/test/pathway-audit-policy.test.js
```

Expected: FAIL because `pathway-audit-policy.js` and both policy files do not exist.

- [ ] **Step 3: Add the repository policies**

Create `config/pathway-auditor.json` with this closed structure:

```json
{
  "schemaVersion": 1,
  "toolVersion": "sentinel-pathway-auditor/v1",
  "maximumProviderAuditAgeDays": 30,
  "networkConfig": "config/networks.json",
  "networkAuditEvidence": "docs/research/2026-08-02-layerzero-interface-conformance-audit.md",
  "providerAudit": "config/rpc-provider-audit.json",
  "pathway": {
    "source": "ethereum-sepolia",
    "destination": "arbitrum-sepolia"
  },
  "officialRuntimeCodeKeccak256": {
    "sourceEndpointV2": null,
    "sourceSendUln302": null,
    "sourceExecutor": null,
    "destinationEndpointV2": null,
    "destinationReceiveUln302": null
  }
}
```

Create `config/rpc-provider-audit.json` as a canonical reviewed-state record with `schemaVersion: 1`, `auditDate: "2026-08-02"`, `status: "NO_PROVIDER_OPERATORS_REVIEWED"`, empty `providers` and `sources` arrays, and a warning that URL diversity is not operator independence.

- [ ] **Step 4: Implement pure policy binding**

Hash raw evidence with SHA-256. Parse both config files with exact-key checks. Normalize reviewed provider rows as:

```ts
interface ReviewedProvider{
  label:string;
  operatorFamily:string;
  originSha256:string;
  operatorEvidenceSha256:string;
  sources:string[];
}
```

`bindPathwayAuditPolicy` must never browse or call RPC. It returns public network values, official-code expectations, provider state, a repository binding digest, and sorted blockers. `OPERATOR_INDEPENDENCE_REVIEWED` requires two matched records with different operator families on that chain; all other cases remain blocked.

Define `networkAuditSha256` as SHA-256 over canonical JSON containing exactly the raw `config/networks.json` SHA-256, raw LayerZero audit-evidence SHA-256, and the fixed source/destination names. The manifest must match this derived digest; it is not the digest of either file alone. Provider-audit evidence remains a separate binding because it has an independent review lifecycle.

- [ ] **Step 5: Build, verify GREEN, and commit**

Run:

```bash
npm run build
node --test services/coordinator/test/pathway-audit-policy.test.js services/coordinator/test/pathway-audit-manifest.test.js
```

Expected: all focused tests pass.

```bash
git add config/pathway-auditor.json config/rpc-provider-audit.json services/coordinator/src/pathway-audit-policy.ts services/coordinator/test/pathway-audit-policy.test.js
git commit -m "feat: bind pathway audits to reviewed metadata"
```

### Task 3: DNS-pinned read-only JSON-RPC transport

**Files:**
- Create: `services/coordinator/src/read-only-json-rpc.ts`
- Create: `services/coordinator/test/read-only-json-rpc.test.js`

**Interfaces:**
- Produces: `ReadOnlyRpcMethod` union containing the seven globally allowed methods.
- Produces: `ReadOnlyRpcClient` with `call(method: ReadOnlyRpcMethod, params: unknown[]): Promise<unknown>` and `descriptor(): {label:string;originSha256:string;operatorFamily:string}`.
- Produces: `createReadOnlyRpcClient(endpoint: AuditRpcEndpoint, dependencies?: ReadOnlyRpcDependencies): ReadOnlyRpcClient`.
- Consumes: DNS resolver and HTTPS exchange ports; no wallet or general provider object.

- [ ] **Step 1: Write failing transport tests**

Test the exact method allowlist and parameter grammar, monotonic request IDs, JSON-RPC 2.0 correlation, HTTP 200 and JSON content type, 2 MiB response limit, connect/response/whole-operation timeouts, duplicate-key rejection through `parseJsonDocument`, sanitized provider errors, no redirect following, and response detachment.

Test resolution refusal for IPv4/IPv6 loopback, RFC1918, link-local, multicast, unspecified, and metadata-service ranges. Test DNS rebinding by returning a public address during the first call and a private address during the second; the second call must fail before the HTTPS port is invoked.

Test that a valid exchange receives a checked address separately from the TLS name:

```js
assert.deepEqual(exchange.calls[0],{
  address:"203.0.113.10",
  servername:"rpc-a.example",
  hostHeader:"rpc-a.example",
  path:"/rpc",
  method:"POST"
});
```

The injected test address is a documentation-range fixture handled only by the fake exchange; production public-address validation must reject documentation ranges as non-routable.

- [ ] **Step 2: Run the transport test and verify RED**

Run:

```bash
npm run build
node --test services/coordinator/test/read-only-json-rpc.test.js
```

Expected: FAIL because the transport module does not exist.

- [ ] **Step 3: Implement the restricted client**

Define:

```ts
export type ReadOnlyRpcMethod=
  "eth_chainId"|"eth_blockNumber"|"eth_getBlockByNumber"|
  "eth_getCode"|"eth_call"|"eth_getTransactionByHash"|
  "eth_getTransactionReceipt";

export interface ReadOnlyRpcClient{
  call(method:ReadOnlyRpcMethod,params:unknown[]):Promise<unknown>;
  descriptor():{label:string;originSha256:string;operatorFamily:string};
}
```

The default resolver uses `dns.promises.lookup(hostname,{all:true,verbatim:true})`, rejects the entire resolution set if any address is nonpublic, and passes one checked address to a native `https.request` adapter using the original hostname as SNI and `Host`. The adapter never emits a redirect request, never retries implicitly, and destroys the socket on every limit or timeout failure. Every caught failure becomes `PathwayAuditError("PATHWAY_AUDIT_TRANSPORT_FAILED")`.

- [ ] **Step 4: Build, verify GREEN, and commit**

Run:

```bash
npm run build
node --test services/coordinator/test/read-only-json-rpc.test.js services/coordinator/test/json-rpc.test.js
```

Expected: both the new transport and existing runtime JSON-RPC tests pass.

```bash
git add services/coordinator/src/read-only-json-rpc.ts services/coordinator/test/read-only-json-rpc.test.js
git commit -m "feat: add restricted read-only RPC transport"
```

### Task 4: Agreed canonical block selection

**Files:**
- Create: `services/coordinator/src/pathway-audit-block.ts`
- Create: `services/coordinator/test/pathway-audit-block.test.js`

**Interfaces:**
- Consumes: exactly two `ReadOnlyRpcClient` instances, expected chain ID, and observation lag.
- Produces: `agreePinnedBlock(input): Promise<PinnedBlockObservation>`.
- Produces: `assertPinnedBlockStable(clients, observation): Promise<void>`.
- Produces: `eip1898(observation): {blockHash:string;requireCanonical:true}`.

- [ ] **Step 1: Write failing block-consensus tests**

Prove that heads 130 and 128 with lag 3 select block 125, both providers must return number 125 and identical hash, parent hash, state root, transactions root, and timestamp, and every field is normalized.

Add mutation cases for chain-ID mismatch, unexpected chain, head below lag, null block, wrong returned number, hash/root disagreement, malformed quantity, zero hash, pruned block, and a different hash during the final stability check.

Assert:

```js
assert.deepEqual(eip1898(block),{
  blockHash:block.blockHash,
  requireCanonical:true
});
```

- [ ] **Step 2: Run the block test and verify RED**

Run:

```bash
npm run build
node --test services/coordinator/test/pathway-audit-block.test.js
```

Expected: FAIL because `pathway-audit-block.js` does not exist.

- [ ] **Step 3: Implement selection and stability checks**

Select `min(providerHeads) - observationLag`; never use `latest` for state reads. Normalize quantities to bigint internally and decimal strings in public evidence. Compare the complete schema-defined header, not serialized raw provider objects. Throw only `PATHWAY_AUDIT_OBSERVATION_FAILED`; the later orchestrator assigns the stable blocker code.

- [ ] **Step 4: Build, verify GREEN, and commit**

Run:

```bash
npm run build
node --test services/coordinator/test/pathway-audit-block.test.js services/coordinator/test/read-only-json-rpc.test.js
```

Expected: all focused tests pass.

```bash
git add services/coordinator/src/pathway-audit-block.ts services/coordinator/test/pathway-audit-block.test.js
git commit -m "feat: pin pathway audits to agreed blocks"
```

### Task 5: Repository-bound deployment and constructor evidence

**Files:**
- Create: `services/coordinator/src/pathway-audit-deployment.ts`
- Create: `services/coordinator/test/pathway-audit-deployment.test.js`
- Modify: `scripts/solidity-build-config.mjs`
- Modify: `scripts/compile-sentinel-solidity.mjs`
- Modify: `scripts/test/solidity-build-config.test.js`
- Modify: `services/coordinator/src/deployment-readiness-binding.ts`
- Modify: `services/coordinator/test/deployment-readiness-binding.test.js`

**Interfaces:**
- Consumes: raw compiled artifact bytes, a manifest deployment entry, two read-only clients, and the chain's pinned observation block.
- Produces: `parseAuditContractArtifact(text, expectedName): AuditContractArtifact`.
- Produces: `verifyDeploymentEvidence(input): Promise<VerifiedDeploymentEvidence>`.
- Produces build-manifest schema version 2 with `deployedBytecodeSha256` and `immutableReferencesSha256` without changing compiler pins.

- [ ] **Step 1: Write failing artifact and deployment tests**

Construct a fixed creation bytecode plus ABI constructor suffix, two agreeing transaction/receipt fixtures, and an observed runtime code value. Assert the verifier checks:

```js
assert.deepEqual(result.constructorArguments,{
  messageLib:sourceSendUln,
  verificationTarget:sourceReceiveUln,
  supportedDstEid:40231,
  signers:sortedSigners,
  quorum:"3"
});
assert.equal(result.creationBytecodeSha256,expectedCreationSha256);
assert.match(result.runtimeCodeKeccak256,/^0x[0-9a-f]{64}$/);
```

Reject transaction `to` not null, failed receipt, address mismatch, receipt block after the observation block, transaction/receipt block mismatch, provider disagreement, creation-prefix drift, malformed constructor suffix, unexpected Endpoint/delegate, unsorted signers, extra signers, quorum drift, and empty runtime code.

Extend build-manifest tests to prove the deployed bytecode and immutable-reference structure are hashed and that any one-byte drift changes the digest. Update readiness binding fixtures to require the new fields rather than silently ignoring them.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
npm run build
node --test scripts/test/solidity-build-config.test.js services/coordinator/test/pathway-audit-deployment.test.js services/coordinator/test/deployment-readiness-binding.test.js
```

Expected: failures identify the missing deployment module and missing build-manifest fields.

- [ ] **Step 3: Extend deterministic Solidity provenance**

Request these compiler outputs:

```js
"evm.bytecode.object",
"evm.deployedBytecode.object",
"evm.deployedBytecode.immutableReferences"
```

Hash deployed bytecode bytes and canonical immutable-reference JSON inside `contractBuildManifest`, and change its schema version from 1 to 2 because the closed artifact shape changes. Preserve compiler `0.8.30+commit.73712a01.Emscripten.clang`, EVM `shanghai`, optimizer enabled, and 200 runs. Make readiness binding require and surface these new digests so the provenance schema cannot downgrade unnoticed.

- [ ] **Step 4: Implement deployment verification**

Use artifact constructor ABI and `AbiCoder` to split transaction input at the exact creation-bytecode byte length and decode the suffix. Normalize only the public decoded fields. For an OApp require constructor `[expectedEndpoint, expectedDelegate]`. For an adapter require `[messageLib, verificationTarget, supportedDstEid, signers, quorum]`, five sorted signers, and quorum three. Compare both provider responses field by field and record hashes rather than raw transaction input.

- [ ] **Step 5: Build, verify GREEN, and commit**

Run:

```bash
npm run build
node --test scripts/test/solidity-build-config.test.js services/coordinator/test/pathway-audit-deployment.test.js services/coordinator/test/deployment-readiness-binding.test.js services/coordinator/test/deployment-readiness-command.test.js
```

Expected: all artifact, deployment, and readiness regressions pass.

```bash
git add scripts/solidity-build-config.mjs scripts/compile-sentinel-solidity.mjs scripts/test/solidity-build-config.test.js services/coordinator/src/pathway-audit-deployment.ts services/coordinator/src/deployment-readiness-binding.ts services/coordinator/test/pathway-audit-deployment.test.js services/coordinator/test/deployment-readiness-binding.test.js
git commit -m "feat: verify pathway deployment provenance"
```

### Task 6: Shared LayerZero source and destination readers

**Files:**
- Modify: `services/coordinator/src/source-path-verifier.ts`
- Modify: `services/coordinator/src/destination-path-verifier.ts`
- Modify: `services/coordinator/test/source-path-verifier.test.js`
- Modify: `services/coordinator/test/destination-path-verifier.test.js`
- Create: `services/coordinator/test/pathway-audit-readers.test.js`

**Interfaces:**
- Produces: `readSourcePathObservation(input, reader): Promise<SourcePathObservation>`.
- Produces: `readDestinationPathObservation(input, reader): Promise<DestinationPathObservation>`.
- Consumes: `PinnedStateReader` with `getCode(address)` and `call(to,data)` already bound to one block reference.
- Existing `IndependentSourcePathVerifier` and `IndependentDestinationPathVerifier` continue to expose their current public interfaces and reuse these readers.

- [ ] **Step 1: Write failing shared-reader tests**

Use ABI-encoded fixed responses to prove source reads include Endpoint-selected send library/default state, supported EID, raw app ULN, Executor, destination peer, source adapter bindings, quorum, and all five signer checks. Prove destination reads include receive library/default state, raw and resolved app ULN, source peer, destination adapter target, adapter constructor-correlated public getters, quorum, and signer checks.

Assert both readers return observed values without comparing them to expected policy; policy evaluation belongs to Task 7. Add malformed ABI, zero address, count/array disagreement, duplicated DVN, unsorted DVN, invalid threshold, and empty code cases.

- [ ] **Step 2: Run the reader tests and verify RED**

Run:

```bash
npm run build
node --test services/coordinator/test/pathway-audit-readers.test.js
```

Expected: FAIL because the exported reader functions do not exist.

- [ ] **Step 3: Extract the readers and preserve runtime behavior**

Define:

```ts
export interface PinnedStateReader{
  getCode(address:Hex):Promise<Hex>;
  call(to:Hex,data:Hex):Promise<Hex>;
}
```

Move ABI encoding/decoding and shape checks from each class's private observation method into exported pure-I/O readers. Add adapter getters `messageLib()`, `verificationTarget()`, `supportedDstEid()`, `quorum()`, `signer(address)`, and destination `peers(srcEid)`. Existing runtime classes adapt their injected RPC functions into `PinnedStateReader` and retain their current error messages and pinned-config assertions.

- [ ] **Step 4: Build and run all path-verifier regressions**

Run:

```bash
npm run build
node --test services/coordinator/test/pathway-audit-readers.test.js services/coordinator/test/source-path-verifier.test.js services/coordinator/test/destination-path-verifier.test.js services/coordinator/test/source-bound-packet-verifier.test.js services/coordinator/test/destination-worker.test.js
```

Expected: all new and existing pathway tests pass.

- [ ] **Step 5: Commit**

```bash
git add services/coordinator/src/source-path-verifier.ts services/coordinator/src/destination-path-verifier.ts services/coordinator/test/source-path-verifier.test.js services/coordinator/test/destination-path-verifier.test.js services/coordinator/test/pathway-audit-readers.test.js
git commit -m "refactor: share pinned LayerZero pathway readers"
```

### Task 7: Dual-provider pathway observation and fail-closed evaluation

**Files:**
- Create: `services/coordinator/src/pathway-audit-observer.ts`
- Create: `services/coordinator/test/pathway-audit-observer.test.js`
- Create: `services/coordinator/test/pathway-audit-adversarial.test.js`

**Interfaces:**
- Consumes: manifest, policy binding, four `ReadOnlyRpcClient` instances, and two compiled artifacts.
- Produces: `observePathway(input): Promise<PathwayAuditObservation>`.
- Produces: normalized public source/destination observations plus all sorted blockers; it performs no file writes.

- [ ] **Step 1: Write the successful and predeployment failing tests**

The predeployment test uses `deployment: null`, four agreeing clients, and nonempty official contract code. It must still emit all official observations plus `AUDIT_PATHWAY_DEPLOYMENTS_MISSING` and must never call OApp/adapter or deployment-transaction methods.

The complete fixture supplies both OApps, both adapters, creation evidence, explicit nondefault ULN configuration, at least one independent required DVN, Sentinel adapters as optional, threshold one, matching peers, expected Executors, no Dead DVN, constructor-proven matching signer tuples, and quorum three. Assert zero configuration blockers and exact provider agreement digests.

- [ ] **Step 2: Write adversarial mutation tests**

Create one mutation per case: chain equivocation, block reorg, exact-block request replaced by latest, code disagreement, deployment transaction disagreement, creation drift, unexpected adapter message library/target/EID, default library, inherited zero ULN config, unsupported EID, peer mismatch, Executor mismatch, confirmation mismatch, Dead DVN in either list, duplicated/unsorted DVNs, threshold zero with optional DVNs, threshold above count, source/destination ULN mismatch, Sentinel absent, Sentinel required, Sentinel as sole effective verifier, one unauthorized signer, and constructor/mapping membership conflict.

For each mutation, assert the exact blocker code/category and that the observation never reaches `OBSERVED_PATHWAY_CONSISTENT`.

- [ ] **Step 3: Run observer tests and verify RED**

Run:

```bash
npm run build
node --test services/coordinator/test/pathway-audit-observer.test.js services/coordinator/test/pathway-audit-adversarial.test.js
```

Expected: FAIL because `pathway-audit-observer.js` does not exist.

- [ ] **Step 4: Implement the orchestration and invariant evaluator**

Run source and destination block selection concurrently, but keep every provider request independent. Wrap each client with a `PinnedStateReader` that always passes the chain's EIP-1898 reference. Compare normalized observations from provider A and B before applying policy. Recheck both pinned blocks after all contract and deployment reads.

Use stable blockers from the central model. The evaluator must compare source send and destination receive confirmations, required/optional DVN arrays, and optional threshold; require explicit libraries/config; ensure both Sentinel addresses occupy the intended additional/optional role; and preserve every earlier policy blocker.

- [ ] **Step 5: Build, verify GREEN, and commit**

Run:

```bash
npm run build
node --test services/coordinator/test/pathway-audit-observer.test.js services/coordinator/test/pathway-audit-adversarial.test.js services/coordinator/test/pathway-audit-readers.test.js services/coordinator/test/pathway-audit-block.test.js services/coordinator/test/pathway-audit-deployment.test.js
```

Expected: all focused observation tests pass.

```bash
git add services/coordinator/src/pathway-audit-observer.ts services/coordinator/test/pathway-audit-observer.test.js services/coordinator/test/pathway-audit-adversarial.test.js
git commit -m "feat: evaluate live pathway observations"
```

### Task 8: Canonical evidence bundle and property coverage

**Files:**
- Create: `services/coordinator/src/pathway-audit-bundle.ts`
- Create: `services/coordinator/test/pathway-audit-bundle.test.js`
- Create: `services/coordinator/test/pathway-audit-bundle.property.test.js`

**Interfaces:**
- Consumes: `PathwayAuditObservation` and explicit ISO-8601 UTC `runTimestamp`.
- Produces: `buildPathwayAuditBundle(input): PathwayAuditBundle`.
- Produces: `encodePathwayAuditBundle(bundle): string`.
- Produces: `parsePathwayAuditBundleText(text): PathwayAuditBundle` for readiness and dashboard boundaries.

- [ ] **Step 1: Write failing bundle/status tests**

Assert exact precedence:

```js
const precedence=[
  ["INPUT_BINDING","BLOCKED_INPUT_BINDING"],
  ["RPC_INDEPENDENCE","BLOCKED_RPC_INDEPENDENCE"],
  ["RPC_CONSENSUS","BLOCKED_RPC_CONSENSUS"],
  ["CODE_IDENTITY","BLOCKED_CODE_IDENTITY"],
  ["PATHWAY_CONFIGURATION","BLOCKED_PATHWAY_CONFIGURATION"]
];
```

Assert all blockers remain sorted, the bundle contains decoded public values and digests but no RPC URL, transaction input, response body, absolute path, environment value, or secret, and the permanent truth label is exact. Compute `evidenceSha256` over the canonical bundle body with that field omitted, then assert reparsing and recomputing reproduces it.

- [ ] **Step 2: Write failing fast-check properties**

With a fixed seed and at least 100 runs, generate valid normalized observations and prove: recursively reordered object insertion yields identical bytes; mutating one block hash/code digest/configuration value changes `evidenceSha256`; adding any blocker cannot yield a consistent status; blocker input order does not affect output; and serialized bytes round-trip through the strict parser.

- [ ] **Step 3: Run bundle tests and verify RED**

Run:

```bash
npm run build
node --test services/coordinator/test/pathway-audit-bundle.test.js services/coordinator/test/pathway-audit-bundle.property.test.js
```

Expected: FAIL because the bundle module does not exist.

- [ ] **Step 4: Implement canonical assembly and parsing**

Build the body first, encode with `canonicalJson`, hash its UTF-8 bytes using SHA-256, then add `evidenceSha256` and encode again. The strict parser must exact-check every public field, recompute the digest, validate status against blockers, and return detached values. `OBSERVED_PATHWAY_CONSISTENT` is allowed only with no blocker.

- [ ] **Step 5: Build, verify GREEN, and commit**

Run:

```bash
npm run build
node --test services/coordinator/test/pathway-audit-bundle.test.js services/coordinator/test/pathway-audit-bundle.property.test.js
```

Expected: all deterministic and generated tests pass.

```bash
git add services/coordinator/src/pathway-audit-bundle.ts services/coordinator/test/pathway-audit-bundle.test.js services/coordinator/test/pathway-audit-bundle.property.test.js
git commit -m "feat: emit canonical pathway audit evidence"
```

### Task 9: Keyless CLI and opt-in live smoke boundary

**Files:**
- Create: `services/coordinator/src/pathway-audit-command.ts`
- Create: `services/coordinator/src/pathway-audit-cli.ts`
- Create: `services/coordinator/test/pathway-audit-command.test.js`
- Create: `services/coordinator/test/pathway-audit-integration.test.js`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: `runPathwayAuditCommand(args, io, dependencies?): Promise<0|1|2>`.
- Produces: `PathwayAuditCommandErrorCode` as `PATHWAY_AUDIT_MANIFEST_INVALID`, `PATHWAY_AUDIT_SECRET_FIELD_REJECTED`, `PATHWAY_AUDIT_INPUT_READ_FAILED`, `PATHWAY_AUDIT_POLICY_BINDING_FAILED`, `PATHWAY_AUDIT_TRANSPORT_FAILED`, `PATHWAY_AUDIT_OBSERVATION_FAILED`, `PATHWAY_AUDIT_BUILD_FAILED`, `PATHWAY_AUDIT_OUTPUT_FAILED`, or `PATHWAY_AUDIT_OUTPUT_EXISTS`.
- Reuses: `readReadinessTextFile` and `writeReadinessFileExclusive` under pathway-specific aliases.
- Production command: `npm run audit:pathway -- --manifest /absolute/path/to/manifest.json [--output /absolute/path/to/new-evidence.json]`.

- [ ] **Step 1: Write failing command and capability-isolation tests**

Test stdout success, blocked exit two, invalid input exit one, exclusive output mode 0600, existing-output refusal, exact absolute-path argument grammar, one captured UTC timestamp, sanitized diagnostics, artifact/config read failures, transport failures, and output failures.

Install throwing getters on injected dependency properties named `wallet`, `signer`, `privateKey`, `mnemonic`, `provider`, `deploy`, `sendTransaction`, `fund`, `cloud`, and `environment`; a blocked audit must finish without accessing them. Snapshot `deployments/`, all production sources, compiled artifacts, and both configuration files before and after the command and require byte identity.

- [ ] **Step 2: Write the deterministic integration test**

Use four injected read-only clients with complete agreeing fixtures and real repository compiled artifacts. Assert the command emits one canonical bundle, never calls a write RPC method, and returns the status supplied by real policy/observer/bundle code. Use a second null-deployment manifest and assert it emits `BLOCKED_PATHWAY_CONFIGURATION` when earlier gates are supplied as reviewed test fixtures.

- [ ] **Step 3: Run command tests and verify RED**

Run:

```bash
npm run build
node --test services/coordinator/test/pathway-audit-command.test.js services/coordinator/test/pathway-audit-integration.test.js
```

Expected: FAIL because command and CLI modules do not exist.

- [ ] **Step 4: Implement the command composition**

Parse only the two accepted argument shapes. Read the manifest, auditor policy, network config, network audit, provider audit, and both production artifacts through bounded no-follow readers. Capture `new Date().toISOString()` exactly once through an injected clock. Bind policy, build four restricted clients, observe, assemble, then print or exclusively create the artifact. Do not cache network responses between providers or runs.

Map valid statuses to exit zero only for `OBSERVED_PATHWAY_CONSISTENT`, exit two for every blocked artifact, and exit one for invalid/unsafe/untrustworthy execution failures. Standard error contains canonical `{error:"PATHWAY_AUDIT_*"}` only.

- [ ] **Step 5: Add the package command, build, verify GREEN, and commit**

Add:

```json
"audit:pathway": "npm run build && node dist/services/coordinator/src/pathway-audit-cli.js"
```

Bump only the local package version from `0.29.0` to `0.30.0`; do not alter dependencies.

Run:

```bash
npm run build
node --test services/coordinator/test/pathway-audit-command.test.js services/coordinator/test/pathway-audit-integration.test.js
```

Expected: all command tests pass and no public network is contacted by the default test suite.

```bash
git add services/coordinator/src/pathway-audit-command.ts services/coordinator/src/pathway-audit-cli.ts services/coordinator/test/pathway-audit-command.test.js services/coordinator/test/pathway-audit-integration.test.js package.json package-lock.json
git commit -m "feat: add keyless pathway audit command"
```

### Task 10: Explicit readiness-artifact binding without automatic approval

**Files:**
- Modify: `services/coordinator/src/deployment-readiness-manifest.ts`
- Modify: `services/coordinator/src/deployment-readiness-binding.ts`
- Modify: `services/coordinator/src/deployment-readiness-bundle.ts`
- Modify: `services/coordinator/src/deployment-readiness-command.ts`
- Modify: `config/deployment-readiness.json`
- Modify: `services/coordinator/test/deployment-readiness-manifest.test.js`
- Modify: `services/coordinator/test/deployment-readiness-binding.test.js`
- Modify: `services/coordinator/test/deployment-readiness-bundle.test.js`
- Modify: `services/coordinator/test/deployment-readiness-command.test.js`
- Modify: `docs/examples/public-readiness-manifest.json`

**Interfaces:**
- Migrates readiness manifest/bundle/config to schema version 2 and `sentinel-readiness/v2`, adding `pathwayAudit: null | {evidenceSha256:string}`.
- Extends readiness CLI with an exact optional pair `--pathway-audit /absolute/path/to/evidence.json` required only when the manifest reference is non-null.
- Extends readiness bundle with a detached summary containing audit status, truth label, evidence digest, run timestamp, and pinned block hashes.
- Never mutates `config/deployment-readiness.json` or its `livePathwayValidated` gate.

- [ ] **Step 1: Write failing readiness-binding tests**

Test that `pathwayAudit: null` is valid and leaves `VALIDATE_LIVE_PATHWAY` blocked. When non-null, require the CLI path, file SHA-256 match, strict `parsePathwayAuditBundleText`, and the exact permanent truth label. Reject a missing/unexpected path, digest drift, malformed artifact, blocked artifact falsely labeled consistent, and any RPC URL or secret field in the artifact.

Most importantly, assert:

```js
assert.equal(bundle.pathwayAudit.status,"OBSERVED_PATHWAY_CONSISTENT");
assert.equal(binding.gates.livePathwayValidated,false);
assert.equal(bundle.blockers.some(value=>value.remediation==="VALIDATE_LIVE_PATHWAY"),true);
```

This proves evidence attachment cannot clear a human-controlled readiness gate.

- [ ] **Step 2: Run readiness tests and verify RED**

Run:

```bash
npm run build
node --test services/coordinator/test/deployment-readiness-manifest.test.js services/coordinator/test/deployment-readiness-binding.test.js services/coordinator/test/deployment-readiness-bundle.test.js services/coordinator/test/deployment-readiness-command.test.js
```

Expected: tests fail because readiness does not yet accept or surface pathway audit evidence.

- [ ] **Step 3: Implement exact attachment and preserve gate semantics**

Update the closed manifest, readiness config, bundle, and example to schema version 2 and `sentinel-readiness/v2`; schema-1 inputs must fail rather than being guessed forward. Add explicit command parsing, read the artifact with the bounded reader, hash raw canonical bytes, parse through Task 8's strict parser, and attach only the allowlisted summary. Do not infer `livePathwayValidated`, `independentDvnsSelected`, `confirmationPolicyApproved`, or any other readiness gate from the artifact.

- [ ] **Step 4: Build, verify GREEN, and commit**

Run:

```bash
npm run build
node --test services/coordinator/test/deployment-readiness-manifest.test.js services/coordinator/test/deployment-readiness-binding.test.js services/coordinator/test/deployment-readiness-bundle.test.js services/coordinator/test/deployment-readiness-command.test.js services/coordinator/test/pathway-audit-bundle.test.js
```

Expected: all readiness and pathway-bundle tests pass.

```bash
git add config/deployment-readiness.json services/coordinator/src/deployment-readiness-manifest.ts services/coordinator/src/deployment-readiness-binding.ts services/coordinator/src/deployment-readiness-bundle.ts services/coordinator/src/deployment-readiness-command.ts services/coordinator/test/deployment-readiness-manifest.test.js services/coordinator/test/deployment-readiness-binding.test.js services/coordinator/test/deployment-readiness-bundle.test.js services/coordinator/test/deployment-readiness-command.test.js docs/examples/public-readiness-manifest.json
git commit -m "feat: bind pathway evidence to readiness review"
```

### Task 11: Honest dashboard audit viewer

**Files:**
- Create: `apps/dashboard/src/pathway-audit.js`
- Create: `apps/dashboard/test/pathway-audit.test.js`
- Modify: `apps/dashboard/index.html`
- Modify: `apps/dashboard/src/app.js`
- Modify: `apps/dashboard/src/style.css`
- Modify: `scripts/check-dashboard.mjs`
- Modify: `services/coordinator/src/status-api.ts`
- Modify: `services/coordinator/test/status-api.test.js`

**Interfaces:**
- Produces: `validatePathwayAuditView(value)` and `renderPathwayAudit(elements, value, formatTime)`.
- Produces: `renderPathwayAuditUnavailable(elements, reason)`.
- Browser input: an operator-selected local canonical JSON file; the file is parsed locally, never uploaded, persisted, or treated as coordinator state.
- Adds the static asset route `/src/pathway-audit.js`; adds no mutation API.

- [ ] **Step 1: Write failing browser-model tests**

Use a minimal valid artifact and assert the renderer shows `READ-ONLY OBSERVATION`, exact blocked/consistent status, source/destination pinned block summaries, transport agreement, reviewed/unproven independence, code identity, configuration outcome, and all blocker codes. Reject unknown fields, bad status/blocker combinations, wrong truth label, malformed hashes, complete RPC URLs, raw transaction input, secrets, absolute paths, and packet/GenLayer/signer/execution fields.

Assert unavailable rendering clears stale content and displays `NOT OBSERVED`. Assert the file handler uses `file.text()`, validates one artifact, never calls `fetch`, and never writes local/session storage.

- [ ] **Step 2: Run dashboard tests and verify RED**

Run:

```bash
node --test apps/dashboard/test/pathway-audit.test.js
```

Expected: FAIL because `pathway-audit.js` does not exist.

- [ ] **Step 3: Implement the read-only panel**

Add an audit section with these IDs:

```text
pathway-audit-file
pathway-audit-status
pathway-audit-source-block
pathway-audit-destination-block
pathway-audit-rpc
pathway-audit-code
pathway-audit-configuration
pathway-audit-blockers
```

Initial copy must say `NOT OBSERVED` and `Select a locally generated read-only artifact. Nothing is uploaded.` The section must not reuse the packet timeline or imply a live coordinator result. Use `textContent` only for artifact data. Add `/src/pathway-audit.js` to the explicit dashboard asset allowlist.

- [ ] **Step 4: Extend dashboard guardrails and verify GREEN**

Update `scripts/check-dashboard.mjs` to require the new IDs and phrases and reject `mockPathway`, `samplePathway`, `simulated pathway`, external URL rendering, artifact upload requests, and storage writes from the audit module.

Run:

```bash
npm run build:dashboard
npm run check:dashboard
node --test apps/dashboard/test/pathway-audit.test.js apps/dashboard/test/runtime-status.test.js services/coordinator/test/status-api.test.js
```

Expected: build and all focused dashboard/API tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/pathway-audit.js apps/dashboard/test/pathway-audit.test.js apps/dashboard/index.html apps/dashboard/src/app.js apps/dashboard/src/style.css scripts/check-dashboard.mjs services/coordinator/src/status-api.ts services/coordinator/test/status-api.test.js
git commit -m "feat: display read-only pathway audit evidence"
```

### Task 12: Operator documentation, full adversarial gate, and milestone handoff

**Files:**
- Create: `docs/PATHWAY_AUDITOR.md`
- Create: `docs/examples/public-pathway-observation-manifest.template.json`
- Modify: `README.md`
- Modify: `docs/DEMO.md`
- Modify: `docs/OPERATIONS.md`
- Modify: `docs/SECURITY_STATUS.md`
- Modify: `docs/THREAT_MODEL.md`
- Modify: `docs/UNKNOWNS.md`
- Modify: `docs/MILESTONES.md`
- Modify: `deployments/README.md`

**Interfaces:**
- Documents the exact keyless command, public manifest fields, evidence schema, monitoring comparison, recovery, and non-claims.
- Preserves deployment/funding/Bradbury/operator/publication approval gates.
- Produces no deployment record or live URL claim.

- [ ] **Step 1: Write the operator guide and safe template**

Document:

1. how to choose two credential-free public endpoints per chain;
2. why URLs do not prove operator independence;
3. how reviewed provider evidence is added to `config/rpc-provider-audit.json`;
4. the null deployment workflow and expected blocked output;
5. the complete deployment record including four addresses and four creation transaction hashes;
6. exact-block, code, creation, ULN, peer, quorum, and signer evidence;
7. how to compare two immutable artifacts for drift;
8. exit codes 0/1/2 and stable blocker categories;
9. rollback as Git revert only because no chain writes occur; and
10. explicit separate approvals required for deployment, funding, GenLayer Bradbury accounts, signer infrastructure, cloud resources, publication, and any live app URL.

The template uses reserved `.invalid` endpoint names and `REPLACE_...` strings so it is visibly nonoperational and rejected until the operator supplies real public values. Its deployment field is `null`.

- [ ] **Step 2: Update product and security truth**

Update the README architecture/status, demo walkthrough, operations monitoring, threat model SSRF/DNS/provider-correlation risks, security status, unresolved official code identity/provider evidence/LayerZero onboarding/confirmation policy, M2 milestone, and deployments warning. State exactly which parts work locally and which live checks require operator-supplied public inputs.

- [ ] **Step 3: Run the focused M2 gate**

Run:

```bash
npm run typecheck
npm run build
node --test services/coordinator/test/pathway-audit-*.test.js apps/dashboard/test/pathway-audit.test.js services/coordinator/test/source-path-verifier.test.js services/coordinator/test/destination-path-verifier.test.js services/coordinator/test/deployment-readiness-*.test.js
```

Expected: every focused pathway, dashboard, existing verifier, and readiness test passes with zero failures.

- [ ] **Step 4: Run the full repository gate**

Run:

```bash
npm run check
```

Expected: Intelligent Contract lint/direct tests, TypeScript, Solidity compilation, dashboard checks, all Node/contract tests, property tests, and Slither assurance pass. High and Medium Slither findings remain zero; every reviewed Low/Informational fingerprint is unchanged unless separately explained and bound.

- [ ] **Step 5: Run the opt-in command only with an explicit safe public manifest**

Do not run this step until the user or operator supplies four credential-free public RPC URLs and explicitly authorizes the network requests. When supplied, run:

```bash
npm run audit:pathway -- --manifest /absolute/path/to/public-pathway-observation.json --output /absolute/path/to/new-pathway-evidence.json
```

Expected before deployments: exit 2 and a canonical blocked artifact with no transaction, signer, wallet, funding, deployment, or cloud activity. If no explicit public manifest is supplied, record the live smoke test as `NOT RUN — PUBLIC RPC INPUTS NOT SUPPLIED` rather than substituting fixture evidence.

- [ ] **Step 6: Inspect scope and commit the milestone**

Run:

```bash
git status --short
git diff --check
git log --oneline --decorate -15
```

Confirm `.DS_Store` is the only unrelated path and remains untracked. Confirm `deployments/` contains no address, transaction hash, or deployment claim.

```bash
git add README.md docs/PATHWAY_AUDITOR.md docs/DEMO.md docs/OPERATIONS.md docs/SECURITY_STATUS.md docs/THREAT_MODEL.md docs/UNKNOWNS.md docs/MILESTONES.md docs/examples/public-pathway-observation-manifest.template.json deployments/README.md
git commit -m "docs: hand off read-only pathway auditor"
```

## Completion criteria

- The deterministic default suite performs no public network request.
- The CLI can call only the seven allowlisted read methods and has no signing, submission, deployment, funding, or cloud capability.
- Both chains are observed through two explicit transports at provider-agreed canonical block hashes.
- Provider agreement and reviewed operator independence remain separate evidence fields and gates.
- Official/Sentinel code, deployment transactions, receipts, constructor arguments, LayerZero configuration, peers, Executor, DVNs, quorum, and signer evidence are recorded or explicitly blocked.
- Null deployments produce an honest artifact rather than simulated pathway state.
- Readiness can bind the exact artifact but cannot clear `livePathwayValidated` automatically.
- The dashboard shows only an operator-selected artifact and never merges it with coordinator packet/GenLayer/signer/execution state.
- The full repository gate passes.
- No deployment, funding, publication, GitHub push, cloud resource, account creation, or live-app claim occurs.
