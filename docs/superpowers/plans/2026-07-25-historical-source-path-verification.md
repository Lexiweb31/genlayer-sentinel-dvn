# Historical Source Path Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bind every testnet policy request to two-provider proof of the exact explicit LayerZero source pathway at the packet block.

**Architecture:** Extend the fail-closed runtime manifest with the complete source SendUln302 configuration, verify that configuration independently at the packet's historical block, and compose that proof with the existing canonical receipt verifier before GenLayer submission. Persist a shared source-configuration digest in both deterministic verification records and harden the destination verifier against inherited ULN defaults.

**Tech Stack:** TypeScript 5.8, Node.js 22 test runner, ethers 6 ABI encoding/decoding, LayerZero V2 pinned packages, SQLite job snapshots, local Hardhat EDR E2E.

## Global Constraints

- Ethereum Sepolia → Arbitrum Sepolia is the only M2 direction.
- Sentinel remains an optional DVN and at least one independent DVN remains required.
- Only explicit application libraries and ULN configuration are accepted; merged defaults are insufficient.
- Two independent public HTTPS RPC origins must agree.
- Deterministic pathway verification remains separate from GenLayer semantic consensus.
- This plan performs no deployment, transaction, faucet use, funding, cloud creation, GitHub publication, or credential construction.

---

### Task 1: Source manifest schema

**Files:**
- Modify: `services/coordinator/test/runtime-config.test.js`
- Modify: `services/coordinator/src/runtime-config.ts`
- Modify: `config/sentinel-runtime.example.json`

**Interfaces:**
- Produces: `SourcePathConfig` and `RuntimeConfig.pathway: SourcePathConfig`
- Produces: the fields `sourceOAppAddress`, `executor`, `maxMessageSize`, `deadDvn`, `requiredDvns`, `optionalDvns`, and `optionalDvnThreshold`

- [ ] **Step 1: Write failing schema tests**

Add a valid source manifest with:

```js
sourceOAppAddress: a("3"),
executor: a("6"),
maxMessageSize: 10000,
deadDvn: a("d"),
requiredDvns: [a("a")],
optionalDvns: [a("5"), a("b")],
optionalDvnThreshold: 1
```

Use a zero-padded `sourceOApp` bytes32 value and assert failures for a mismatched address binding, Sentinel in `requiredDvns`, Sentinel absent from `optionalDvns`, Dead DVN in either array, empty required DVNs, unsorted/duplicate arrays, invalid threshold, zero executor, and zero message size.

- [ ] **Step 2: Verify RED**

Run:

```bash
npm run build
node --test services/coordinator/test/runtime-config.test.js
```

Expected: failure because the source schema fields are not parsed or validated.

- [ ] **Step 3: Implement the schema**

Define:

```ts
export interface SourcePathConfig {
  name:string;
  sourceChainId:number;
  destinationChainId:number;
  srcEid:number;
  dstEid:number;
  endpoint:Hex;
  sendLibrary:Hex;
  sourceOApp:Hex;
  sourceOAppAddress:Hex;
  destinationOApp:Hex;
  sentinelDvn:Hex;
  executor:Hex;
  maxMessageSize:number;
  deadDvn:Hex;
  requiredDvns:Hex[];
  optionalDvns:Hex[];
  optionalDvnThreshold:number;
  startBlock:bigint;
  confirmations:bigint;
  rpcUrls:string[];
}
```

Require exact source keys, validate the padded address binding, reuse sorted nonzero address validation, enforce Sentinel optional-only, reject Dead DVN membership, require a nonempty required set, and validate the optional threshold.

- [ ] **Step 4: Verify GREEN**

Run the same build and focused test. Expected: all runtime-config tests pass.

- [ ] **Step 5: Commit**

```bash
git add services/coordinator/src/runtime-config.ts services/coordinator/test/runtime-config.test.js config/sentinel-runtime.example.json
git commit -m "feat: pin source pathway manifest"
```

### Task 2: Historical source pathway verifier

**Files:**
- Create: `services/coordinator/test/source-path-verifier.test.js`
- Create: `services/coordinator/src/source-path-verifier.ts`

**Interfaces:**
- Consumes: `SourcePathConfig`, `PolicyRequest["packet"]`, and `SourcePathRpc`
- Produces:

```ts
export interface VerifiedSourcePath {
  observedBlockNumber:bigint;
  observedBlockHash:Hex;
  chainId:bigint;
  dstEid:number;
  endpoint:Hex;
  sendLibrary:Hex;
  sourceOApp:Hex;
  destinationOApp:Hex;
  executor:Hex;
  maxMessageSize:number;
  confirmations:bigint;
  requiredDvns:Hex[];
  optionalDvns:Hex[];
  optionalDvnThreshold:number;
  configurationDigest:Hex;
}

export interface SourcePathVerifier {
  verify(packet:PolicyRequest["packet"]):Promise<VerifiedSourcePath>;
}
```

- [ ] **Step 1: Write the happy-path failing test**

Build an injected RPC fixture that serves the exact packet block, chain ID, bytecode, explicit send library, supported EID, raw app ULN config, raw executor config, and peer. Assert both providers are queried with the packet block tag and the returned digest is nonzero.

- [ ] **Step 2: Verify RED**

Run:

```bash
npm run build
node --test services/coordinator/test/source-path-verifier.test.js
```

Expected: module-not-found failure because the verifier does not exist.

- [ ] **Step 3: Implement the minimum verifier**

Use ethers `Interface` definitions for:

```ts
const endpointInterface = new Interface([
  "function getSendLibrary(address sender,uint32 dstEid) view returns(address lib)",
  "function isDefaultSendLibrary(address sender,uint32 dstEid) view returns(bool)"
]);
const sendInterface = new Interface([
  "function isSupportedEid(uint32 eid) view returns(bool)",
  "function getAppUlnConfig(address oapp,uint32 remoteEid) view returns(tuple(uint64 confirmations,uint8 requiredDVNCount,uint8 optionalDVNCount,uint8 optionalDVNThreshold,address[] requiredDVNs,address[] optionalDVNs))",
  "function executorConfigs(address oapp,uint32 remoteEid) view returns(uint32 maxMessageSize,address executor)"
]);
const oappInterface = new Interface([
  "function peers(uint32 eid) view returns(bytes32 peer)"
]);
```

Read every call at the packet block tag, require the exact packet block hash, normalize addresses, compare complete observations, assert every pinned field, and hash the observation using ABI encoding.

- [ ] **Step 4: Add failing adversarial tests**

Cover chain disagreement, wrong block hash, missing code, default library, unsupported EID, merged/default ULN values represented by an empty raw app config, executor drift, message-size drift, peer drift, confirmation drift, DVN drift, threshold drift, malformed counts, and an RPC error containing a credential-like path.

- [ ] **Step 5: Implement fail-closed handling**

Return `source pathway RPC unavailable` for transport/malformed-response failures without including raw URLs. Return `source pathway configuration drift` for valid observations that do not match the manifest.

- [ ] **Step 6: Verify GREEN**

Run the focused test. Expected: every happy-path and adversarial test passes.

- [ ] **Step 7: Commit**

```bash
git add services/coordinator/src/source-path-verifier.ts services/coordinator/test/source-path-verifier.test.js
git commit -m "feat: verify historical source pathway"
```

### Task 3: Persist the source configuration proof

**Files:**
- Modify: `packages/core/test/state-machine.test.js`
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/state-machine.ts`
- Create: `services/coordinator/test/source-bound-packet-verifier.test.js`
- Create: `services/coordinator/src/source-bound-packet-verifier.ts`
- Modify: `services/coordinator/src/rpc-verifier.ts`
- Modify: `services/coordinator/src/local-demo-proofs.ts`
- Modify: affected coordinator test fixtures returning `Verification`

**Interfaces:**
- Extends `Verification` with `configurationDigest: Hex`
- Produces:

```ts
export class SourceBoundPacketVerifier implements PacketVerifier {
  constructor(
    receiptVerifier:PacketVerifier,
    pathVerifier:SourcePathVerifier
  );
  verify(packet:PolicyRequest["packet"]):Promise<Verification[]>;
}
```

- [ ] **Step 1: Write failing state-machine tests**

Require two confirmations to contain the same nonzero 32-byte configuration digest. Assert rejection for a missing, zero, malformed, or disagreeing digest.

- [ ] **Step 2: Verify RED**

Run:

```bash
npm run build
node --test packages/core/test/state-machine.test.js
```

Expected: the state machine accepts missing or conflicting configuration digests.

- [ ] **Step 3: Add the digest invariant**

Add `configurationDigest` to `Verification` and make `SentinelJob.addVerification` validate it and compare it with the first verification.

- [ ] **Step 4: Write the composite verifier failing tests**

Assert that the composite:

- attaches the historical verifier's digest to every receipt verification;
- returns nothing when receipt verification fails;
- returns nothing when pathway verification fails;
- rejects fewer than two receipt records.

- [ ] **Step 5: Implement the composite and update producers**

Run receipt and historical verification together, require at least two receipt records, and attach the shared digest. Remove digest responsibility from `IndependentRpcPacketVerifier`; update the local proof verifier to use a deterministic `LOCAL_EDR_FIXTURE` configuration digest.

- [ ] **Step 6: Update existing fixtures and verify GREEN**

Run:

```bash
npm run build
node --test packages/core/test/state-machine.test.js services/coordinator/test/source-bound-packet-verifier.test.js services/coordinator/test/coordinator.test.js services/coordinator/test/job-store.test.js services/coordinator/test/local-demo-proofs.test.js
```

Expected: all focused tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/core services/coordinator/src services/coordinator/test
git commit -m "feat: persist source pathway proof"
```

### Task 4: Reject inherited destination ULN configuration

**Files:**
- Modify: `services/coordinator/test/destination-path-verifier.test.js`
- Modify: `services/coordinator/src/destination-path-verifier.ts`

**Interfaces:**
- Keeps `DestinationPathVerifier.verify(): Promise<VerifiedDestinationPath>`
- Adds no runtime capability and performs no write

- [ ] **Step 1: Write the failing test**

Extend the receive-library fixture with `getAppUlnConfig`. Return an empty/default raw application config while `getUlnConfig` still returns matching effective values, and assert `destination pathway configuration drift`.

- [ ] **Step 2: Verify RED**

Run:

```bash
npm run build
node --test services/coordinator/test/destination-path-verifier.test.js
```

Expected: inherited config is incorrectly accepted.

- [ ] **Step 3: Implement the explicit-config check**

Read and decode `getAppUlnConfig(oapp, srcEid)` at the agreed block. Require its confirmations, counts, arrays, and threshold to exactly match both the effective observation and manifest.

- [ ] **Step 4: Verify GREEN**

Run the focused destination test. Expected: explicit config passes and inherited config fails.

- [ ] **Step 5: Commit**

```bash
git add services/coordinator/src/destination-path-verifier.ts services/coordinator/test/destination-path-verifier.test.js
git commit -m "fix: reject inherited destination ULN config"
```

### Task 5: Compose the testnet runtime and update operational evidence

**Files:**
- Modify: `services/coordinator/test/compose-runtime.test.js`
- Modify: `services/coordinator/src/compose-runtime.ts`
- Modify: `docs/OPERATIONS.md`
- Modify: `docs/THREAT_MODEL.md`
- Modify: `docs/MILESTONES.md`
- Modify: `docs/research/2026-07-22-official-audit.md`
- Modify: `config/networks.json`
- Modify: `README.md`

**Interfaces:**
- `composeRuntime` constructs `IndependentSourcePathVerifier` and wraps `IndependentRpcPacketVerifier` in `SourceBoundPacketVerifier`
- No new account or secret capability is introduced

- [ ] **Step 1: Write a failing composition test**

Inject a packet into a composed runtime fixture and assert that no GenLayer submission occurs when source-path verification fails. Assert that construction itself still performs no network or signer work.

- [ ] **Step 2: Verify RED**

Run:

```bash
npm run build
node --test services/coordinator/test/compose-runtime.test.js
```

Expected: source-path verification is not present in the composition.

- [ ] **Step 3: Wire the verifier**

Construct the source verifier from `config.pathway`, wrap the receipt verifier, and pass the composite to `Coordinator`.

- [ ] **Step 4: Update documentation and audit evidence**

Record the 2026-07-25 official metadata recheck: both relevant chain entries remain active; chain IDs, EIDs, EndpointV2, SendUln302, ReceiveUln302, Executor, and Dead DVN addresses are unchanged. Record current GenLayer Bradbury RPC availability while preserving the requirement for funded, user-approved direct-mode and validator-variance testing. Do not select DVNs or confirmation values.

- [ ] **Step 5: Run the complete verification suite**

Run:

```bash
npm run check
npm audit --omit=dev
git diff --check
```

Expected: all tests pass, production dependency audit reports zero vulnerabilities, and Git reports no whitespace errors.

- [ ] **Step 6: Review scope and commit**

Confirm no deployment files contain invented addresses, no secrets or private-key loaders were introduced, no external resource was created, and the dashboard still labels local fixture evidence honestly.

```bash
git add README.md config docs packages services apps contracts package.json
git commit -m "chore: complete source pathway readiness milestone"
```
