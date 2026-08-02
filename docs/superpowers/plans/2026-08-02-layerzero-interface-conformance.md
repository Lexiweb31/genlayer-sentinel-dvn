# LayerZero Interface-Conformant Sentinel Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the zero-fee Sentinel policy adapter explicitly implement the pinned official LayerZero `ILayerZeroDVN` interface while keeping onboarding, destination topology, live pathway validation, and deployment blocked.

**Architecture:** The Solidity adapter inherits the pinned official interface and exposes its required payable job hook, but rejects all nonzero native value. After independent review exposed Slither's structural locked-Ether warning, the design added a permissionless, nonredirectable recovery path that can return only force-sent balance to the immutable authorized message library, plus analyzer configuration that surfaces ignored findings. Deployment readiness gains an intermediate repository-evidence state that proves interface-level conformance only; it cannot satisfy the existing `LAYERZERO_DVN_CANDIDATE` gate. A dated primary-source audit refreshes unchanged chain metadata and records remaining documentation conflicts and external dependencies.

**Tech Stack:** Solidity 0.8.30, `@layerzerolabs/lz-evm-messagelib-v2@3.0.168`, ethers 6.17.0, Node.js 22.13+, TypeScript 5.8.3, Node test runner, Slither 0.11.5, native solc 0.8.30.

## Global Constraints

- Scope is only Ethereum Sepolia EID 40161 to Arbitrum Sepolia EID 40231.
- Create no account, cloud resource, signer, RPC subscription, funding request, transaction, deployment, or publication.
- Keep Sentinel additional/optional beside independently operated LayerZero DVNs; never claim it is the sole production verifier.
- The payable `assignJob` surface exists only for interface compatibility and must reject nonzero `msg.value`.
- Force-sent native balance may be recovered only to the immutable authorized message library; callers cannot choose a recipient, and no admin fee-custody path is introduced.
- Only `LAYERZERO_DVN_CANDIDATE` can satisfy the candidate readiness gate; `ILAYERZERO_DVN_INTERFACE_ADAPTER` must remain blocked.
- Do not claim Gasolina extra-context compatibility, LayerZero onboarding, live GenLayer finality, live pathway validation, signer isolation, audit completion, or mainnet readiness.
- High and Medium production Slither findings remain unallowlistable.
- Preserve the unrelated untracked `.DS_Store` and do not stage it.

## File structure

- Modify `contracts/src/SentinelDVNAdapter.sol`: explicit official interface inheritance, overrides, and nonzero-value refusal.
- Modify `contracts/test/adapter.test.js`: ABI, selector, zero-value, caller, EID, and retained-balance regression coverage.
- Modify `config/slither-allowlist.json`: remove obsolete missing-inheritance evidence and refresh only changed exact fingerprints after review.
- Modify `services/coordinator/src/deployment-readiness-binding.ts`: intermediate adapter-conformance type and new dated audit path.
- Modify `services/coordinator/test/deployment-readiness-binding.test.js`: parsing/binding coverage for the intermediate state and new evidence date.
- Modify `services/coordinator/test/deployment-readiness-bundle.test.js`: prove the intermediate state removes only the payable blocker and remains conformance-blocked.
- Modify `config/deployment-readiness.json`: record intermediate interface conformance and resolved payable signature only.
- Modify `config/networks.json`: refresh audit date/evidence while leaving live pathway state unresolved.
- Create `docs/research/2026-08-02-layerzero-interface-conformance-audit.md`: primary-source evidence and explicit non-claims.
- Modify `README.md`, `docs/MILESTONES.md`, `docs/UNKNOWNS.md`, `docs/SECURITY_STATUS.md`, and `docs/THREAT_MODEL.md`: honest current status and residual risk.

---

### Task 1: Prove and implement the official payable interface

**Files:**
- Modify: `contracts/test/adapter.test.js`
- Modify: `contracts/src/SentinelDVNAdapter.sol`
- Modify after analyzer review: `config/slither-allowlist.json`

**Interfaces:**
- Consumes: pinned `ILayerZeroDVN.AssignJobParam` and the existing adapter constructor.
- Produces: `SentinelDVNAdapter is ILayerZeroDVN`, `error UnexpectedNativeValue()`, payable override `assignJob`, and view override `getFee`.

- [ ] **Step 1: Add ABI and official-selector assertions before changing Solidity**

Extend `contracts/test/adapter.test.js` with a test that reads the generated artifact and asserts:

```js
test("implements the pinned LayerZero DVN ABI exactly at the job boundary",()=>{
  const abi=artifact("SentinelDVNAdapter").abi;
  const assign=abi.find(item=>item.type==="function"&&item.name==="assignJob");
  const fee=abi.find(item=>item.type==="function"&&item.name==="getFee");
  assert.equal(assign.stateMutability,"payable");
  assert.equal(fee.stateMutability,"view");
  const official=new Interface([
    "function assignJob((uint32 dstEid,bytes packetHeader,bytes32 payloadHash,uint64 confirmations,address sender),bytes) payable returns (uint256)",
    "function getFee(uint32,uint64,address,bytes) view returns (uint256)"
  ]);
  const generated=new Interface(abi);
  assert.equal(generated.getFunction("assignJob").selector,official.getFunction("assignJob").selector);
  assert.equal(generated.getFunction("getFee").selector,official.getFunction("getFee").selector);
});
```

Expand the existing native-value test so the authorized message-library path proves `assignJob.staticCall(job,"0x") === 0n`, the transaction emits the existing job event, a nonzero-value call rejects, and the adapter balance remains `0n`. Add separate unauthorized-caller and unsupported-EID assertions so error precedence stays explicit.

- [ ] **Step 2: Build and run only the adapter test to verify RED**

Run:

```bash
npm run build
node --test --test-concurrency=1 contracts/test/adapter.test.js
```

Expected: the ABI test fails because generated `assignJob` is `nonpayable`; existing quorum tests may still pass.

- [ ] **Step 3: Implement the minimal Solidity change**

Change the contract declaration and functions to the following shape:

```solidity
contract SentinelDVNAdapter is ILayerZeroDVN, ReentrancyGuard {
    error UnexpectedNativeValue();

    function getFee(uint32 dstEid, uint64, address, bytes calldata)
        external view override returns (uint256)
    {
        if (dstEid != supportedDstEid) revert UnsupportedDestination();
        return 0;
    }

    function assignJob(ILayerZeroDVN.AssignJobParam calldata p, bytes calldata)
        external payable override returns (uint256)
    {
        if (msg.sender != messageLib) revert Unauthorized();
        if (msg.value != 0) revert UnexpectedNativeValue();
        if (p.dstEid != supportedDstEid) revert UnsupportedDestination();
        bytes32 jobId = keccak256(abi.encode(
            p.dstEid,p.packetHeader,p.payloadHash,p.confirmations,p.sender
        ));
        emit JobAssigned(jobId,p.dstEid,p.payloadHash,p.confirmations,p.sender);
        return 0;
    }
}
```

Do not add `receive`, `fallback`, caller-selected withdrawal, fee-accounting, admin, VID, price-feed, or multi-message-library behavior. The post-review `recoverNative` correction may return the complete force-sent balance only to the immutable authorized message library.

- [ ] **Step 4: Rebuild and verify GREEN**

Run the same two commands from Step 2.

Expected: build exits zero and every adapter test passes, including payable ABI, selector equality, zero-fee success, exact refusal errors and precedence, unsupported EID, nonzero-value refusal, zero retained balance through `assignJob`, and fixed-recipient force-sent balance recovery.

- [ ] **Step 5: Run focused contract assurance and review every changed finding**

Run Slither with ignored findings shown, then run:

```bash
npm run analyze:contracts
```

Expected before allowlist maintenance: exact-fingerprint failure caused by the changed adapter source. Inspect the generated finding report; reject the task if any High or Medium production finding exists. Remove the obsolete `missing-inheritance` entry. Refresh only the byte offsets/source hashes of unchanged reviewed `timestamp` and `low-level-calls` findings. A `locked-ether` result must not be suppressed or allowlisted: resolve the actual force-sent-balance recovery boundary and keep ignored findings visible to the gate.

- [ ] **Step 6: Re-run focused assurance**

Run:

```bash
npm run analyze:contracts
node --test --test-concurrency=1 contracts/test/adapter.test.js contracts/assurance/adapter.property.test.js
```

Expected: zero High, zero Medium, reviewed exact Low/Informational findings only; all focused adapter tests pass.

- [ ] **Step 7: Commit Task 1**

```bash
git add contracts/src/SentinelDVNAdapter.sol contracts/test/adapter.test.js config/slither-allowlist.json
git commit -m "feat: implement LayerZero DVN interface boundary"
```

---

### Task 2: Add the fail-closed intermediate readiness state

**Files:**
- Modify: `services/coordinator/test/deployment-readiness-binding.test.js`
- Modify: `services/coordinator/test/deployment-readiness-bundle.test.js`
- Modify: `services/coordinator/src/deployment-readiness-binding.ts`
- Modify: `config/deployment-readiness.json`

**Interfaces:**
- Produces: `AdapterConformance = "LOCAL_ADAPTER_PROTOTYPE" | "ILAYERZERO_DVN_INTERFACE_ADAPTER" | "LAYERZERO_DVN_CANDIDATE"`.
- Preserves: only exact `LAYERZERO_DVN_CANDIDATE` clears `DESIGN_CONFORMANT_DVN_CONTRACT`.

- [ ] **Step 1: Write failing binding and bundle tests**

In the binding fixture, set:

```js
adapterConformance:"ILAYERZERO_DVN_INTERFACE_ADAPTER",
payableAssignJobResolved:true,
destinationVerificationTopologyResolved:false
```

Assert parsing succeeds, the bound gates preserve those values, and a malformed value such as `OFFICIAL_DVN` still throws `READINESS_MANIFEST_INVALID`.

In the bundle test, build a `LAYERZERO_DVN_CANDIDATE` public request against that intermediate binding and assert:

```js
assert.equal(result.status,"BLOCKED_DVN_CONFORMANCE");
assert(result.blockers.some(value=>value.remediation==="DESIGN_CONFORMANT_DVN_CONTRACT"));
assert.equal(result.blockers.some(value=>value.remediation==="RESOLVE_PAYABLE_ASSIGN_JOB"),false);
assert.deepEqual(result.transactions,[]);
```

- [ ] **Step 2: Run focused tests to verify RED**

Run:

```bash
npm run build
node --test --test-concurrency=1 services/coordinator/test/deployment-readiness-binding.test.js services/coordinator/test/deployment-readiness-bundle.test.js
```

Expected: the parser rejects `ILAYERZERO_DVN_INTERFACE_ADAPTER`.

- [ ] **Step 3: Add the intermediate type and config values**

Update `AdapterConformance` and the parser's closed allowlist to accept the exact new literal. Change `config/deployment-readiness.json` to:

```json
"adapterConformance": "ILAYERZERO_DVN_INTERFACE_ADAPTER",
"payableAssignJobResolved": true,
"destinationVerificationTopologyResolved": false
```

Do not change any other boolean gate. Do not change the public manifest classification union; public callers may still request only the local or future candidate truth labels.

- [ ] **Step 4: Run focused tests to verify GREEN**

Run the Step 2 commands again.

Expected: all readiness binding and bundle tests pass; intermediate conformance remains blocked and emits no transactions.

- [ ] **Step 5: Commit Task 2**

```bash
git add config/deployment-readiness.json services/coordinator/src/deployment-readiness-binding.ts services/coordinator/test/deployment-readiness-binding.test.js services/coordinator/test/deployment-readiness-bundle.test.js
git commit -m "feat: record interface-only DVN conformance"
```

---

### Task 3: Refresh dated official evidence without live-pathway claims

**Files:**
- Create: `docs/research/2026-08-02-layerzero-interface-conformance-audit.md`
- Modify: `config/networks.json`
- Modify: `config/deployment-readiness.json`
- Modify: `services/coordinator/src/deployment-readiness-binding.ts`
- Modify: `services/coordinator/test/deployment-readiness-binding.test.js`

**Interfaces:**
- Produces: fixed audit path `docs/research/2026-08-02-layerzero-interface-conformance-audit.md` and audit date `2026-08-02`.
- Preserves: `AUDITED_CONTRACT_METADATA_NOT_PATHWAY_VALIDATED`, `NOT_CHAIN_VALIDATED`, `UNSELECTED`, and `NOT_DEPLOYED`.

- [ ] **Step 1: Write the failing dated-evidence test**

Update test fixtures to expect the new fixed audit path and date, but leave production parsing unchanged. Add an assertion that the parser rejects the old 2026-07-29 evidence path.

- [ ] **Step 2: Run the binding tests to verify RED**

Run:

```bash
npm run build
node --test --test-concurrency=1 services/coordinator/test/deployment-readiness-binding.test.js
```

Expected: failure because production code still requires the old path.

- [ ] **Step 3: Write the primary-source audit**

The audit must record exact URLs, access date 2026-08-02, unchanged Sepolia/Arbitrum chain IDs, EIDs, EndpointV2, SendUln302, ReceiveUln302, Executor, and Dead-DVN addresses. It must separately record:

- official payable interface and pinned package agreement;
- zero-value `SendUlnBase` call behavior;
- authenticated-gateway `/signer-info` onboarding sequence;
- the extra-context response-shape conflict and absence of pending semantics;
- Bradbury RPC/chain ID and `FINALIZED`/7 status discovery; and
- every remaining deployment, operator, topology, pathway, finality-reader, and confirmation-policy blocker.

The conclusion must remain `AUDITED_METADATA_NOT_DEPLOYMENT_AUTHORIZATION`.

- [ ] **Step 4: Bind the new evidence path and date**

Update the `DeploymentReadinessConfig.auditEvidence` literal and parser check/return. Point both checked-in JSON files at the new audit and change only `config/networks.json.auditDate` to `2026-08-02`. Keep every recorded address and pathway-validation value byte-for-byte unchanged.

- [ ] **Step 5: Verify GREEN and drift rejection**

Run:

```bash
npm run build
node --test --test-concurrency=1 services/coordinator/test/deployment-readiness-binding.test.js services/coordinator/test/deployment-readiness-command.test.js
```

Expected: all tests pass; altered audit text/date/path still yields a stable metadata blocker or manifest-invalid error.

- [ ] **Step 6: Commit Task 3**

```bash
git add docs/research/2026-08-02-layerzero-interface-conformance-audit.md config/networks.json config/deployment-readiness.json services/coordinator/src/deployment-readiness-binding.ts services/coordinator/test/deployment-readiness-binding.test.js
git commit -m "docs: refresh official DVN conformance evidence"
```

---

### Task 4: Align product truth labels and complete verification

**Files:**
- Modify: `README.md`
- Modify: `docs/MILESTONES.md`
- Modify: `docs/UNKNOWNS.md`
- Modify: `docs/SECURITY_STATUS.md`
- Modify: `docs/THREAT_MODEL.md`

**Interfaces:**
- Consumes: committed Task 1–3 behavior and exact final test/analyzer counts.
- Produces: truthful operator-facing status for the interface-only adapter milestone.

- [ ] **Step 1: Update documentation without promoting readiness**

State that the adapter now explicitly implements the pinned payable interface while rejecting nonzero value, but remains an interface-conformant adapter prototype. Explain that LayerZero's current Gasolina guidance requires authenticated ingress and conflicts on extra-context response shape. Preserve “no live app URL,” “not deployed,” “not audited,” “not onboarded,” “not pathway validated,” and “not mainnet-ready.”

Close only the payable-signature unknown. Keep destination verification topology, onboarding acceptance, independent DVN selection, live GenLayer witness reading, confirmations, signer/recovery operators, PKI/HSM, monitoring, funding, and deployment unresolved.

- [ ] **Step 2: Run documentation and diff checks**

Run:

```bash
rg -n "LOCAL_ADAPTER_PROTOTYPE|2026-07-29-deployment-readiness-audit|payableAssignJobResolved" README.md config docs services/coordinator --glob '!docs/superpowers/plans/2026-07-29-keyless-deployment-readiness.md' --glob '!docs/superpowers/specs/2026-07-29-keyless-deployment-readiness-design.md'
git diff --check
```

Expected: historical plan/spec references may remain; current status/config/code contain no stale claim that the adapter is nonpayable or merely selector-compatible.

- [ ] **Step 3: Run the complete gate**

Run:

```bash
npm run check
```

Expected: TypeScript, GenVM lint, 24 direct Intelligent Contract cases, all ordinary Node tests, all four property campaigns (112 generated runs), and Slither complete with zero High and zero Medium production findings.

- [ ] **Step 4: Run the clean-tree readiness proof after committing**

First stage and commit the documentation:

```bash
git add README.md docs/MILESTONES.md docs/UNKNOWNS.md docs/SECURITY_STATUS.md docs/THREAT_MODEL.md
git commit -m "docs: record interface-conformant adapter limits"
```

Then verify the branch is clean except for the pre-existing `.DS_Store`, build, copy `docs/examples/public-readiness-manifest.json` to a new `mktemp -d` directory, and run:

```bash
node dist/services/coordinator/src/deployment-readiness-cli.js --manifest /absolute/temporary/public.json --output /absolute/temporary/bundle.json
```

Expected: exit 2, `truthLabel` equals `UNSIGNED_NOT_DEPLOYED_NOT_VERIFIED`, `transactions` is empty, the new interface state remains blocked, output mode is `0600`, no local path or secret-like field is present, and no deployment file changes.

- [ ] **Step 5: Record final evidence**

If final test counts differ because new tests were added, update `docs/SECURITY_STATUS.md` with the exact fresh counts and commit that evidence:

```bash
git add docs/SECURITY_STATUS.md
git commit -m "docs: record adapter conformance verification"
```

Do not push, deploy, fund, publish, or create cloud resources.
