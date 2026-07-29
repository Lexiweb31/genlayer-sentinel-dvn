# Keyless Deployment Readiness Bundle Design

Status: approved design; implementation has not started. This design authorizes only a deterministic, local, read-only readiness tool. It does not authorize deployment, signing, broadcasting, funding, RPC access, cloud resources, LayerZero onboarding, GenLayer account creation, publication, or any production-readiness claim.

## Purpose

GenLayer Sentinel has a tested local vertical slice, but it has no deployment and must not cross from local evidence into a misleading testnet claim. The next milestone will create a **Keyless Deployment Readiness Bundle**: a canonical JSON artifact that binds proposed public deployment inputs to the audited repository source, compiled artifacts, official network metadata, explicit trust assumptions, and unresolved blockers.

The tool answers one narrow question:

> Is this exact source state structurally ready to be handed to a separately approved deployment workflow, and if not, what blocks it?

It never answers “is this production-safe,” “is this an onboarded LayerZero DVN,” or “was this deployed.” A ready bundle remains unsigned, unbroadcast, and subject to a separate explicit user approval.

## Approved approach

The approved approach is a local Node.js library and CLI with five parts:

1. a closed-schema public manifest decoder;
2. a local network-audit and artifact-binding verifier;
3. a topology and LayerZero-conformance gate;
4. a deterministic canonical bundle encoder;
5. a read-only CLI that prints or creates the bundle without overwriting an existing file.

This was selected over two alternatives:

- A Hardhat deployment framework would make deployment convenient, but it would introduce accounts, providers, gas estimation, transaction execution, and mutable chain state before Sentinel's DVN conformance and onboarding model are resolved.
- A live account-backed executor would be premature and would make secret handling, funds, nonce recovery, partial configuration, and chain rollback part of this milestone.

The selected design deliberately stops before either alternative. It creates reviewable deployment inputs without gaining the capability to sign or send a transaction.

## Official-source recheck

The design was rechecked on 2026-07-29 against LayerZero's primary documentation:

- [DVN overview](https://docs.layerzero.network/v2/workers/off-chain/dvn-overview)
- [Build DVNs](https://docs.layerzero.network/v2/workers/off-chain/build-dvns)
- [DVN technical reference](https://docs.layerzero.network/v2/workers/off-chain/dvn-technical-reference)
- [Ethereum Sepolia deployments](https://docs.layerzero.network/v2/deployments/chains/sepolia)
- [Arbitrum Sepolia deployments](https://docs.layerzero.network/v2/deployments/chains/arbitrum-sepolia)
- [Deployed contracts](https://docs.layerzero.network/v2/deployments/deployed-contracts)

The official architecture requires more than a contract exposing familiar selectors. A DVN operator deploys a DVN contract on supported chains, observes source-chain jobs, verifies destination-chain configuration and packet evidence after confirmations, and commits verification through the destination receive library. The technical reference also describes production concerns including message libraries, VID, price feed, administrative roles, quorum execution, and per-chain deployment.

The currently compiled `SentinelDVNAdapter` is intentionally a smaller prototype. It imports the official `ILayerZeroDVN.AssignJobParam` shape and exposes `getFee` and `assignJob`, but it does not inherit `ILayerZeroDVN`; its `assignJob` is nonpayable while the current official interface is payable. Its constructor and execution path also do not establish the complete production DVN topology described in the official reference.

Therefore this milestone must not identify the current adapter as an officially conformant or onboardable LayerZero DVN. That question is a separate contract-design, integration, security-review, and LayerZero-confirmation milestone.

The official addresses recorded in `config/networks.json` remain audited metadata only. They are not proof that the Ethereum Sepolia to Arbitrum Sepolia OApp pathway is configured, that every address remains current at deployment time, that `isSupportedEid` passes, or that a Sentinel DVN is accepted by LayerZero.

## Capability boundary

The implementation must have no capability to:

- read or accept a private key, mnemonic, keystore, hardware-wallet session, cloud-signing handle, or secret;
- read environment variables for configuration;
- accept or open an RPC URL, WebSocket URL, account provider, wallet provider, or browser wallet;
- connect to any chain or network;
- estimate gas, obtain a nonce, sign, submit, simulate, or wait for a transaction;
- deploy or configure a contract;
- create or mutate a deployment record;
- choose independent LayerZero DVNs or confirmation depths on behalf of the user;
- create a GenLayer account or claim a live GenLayer finality reader exists;
- modify `config/networks.json`, compiled artifacts, `deployments/`, or another project;
- overwrite an existing output file.

The implementation must not import an account or deployment framework. Its library boundary accepts only plain public data and repository-local byte arrays or parsed JSON supplied by an explicit caller.

The public address previously supplied by the user, `0xE6e40CFe775fd15BED4c21a0Fae1cD6F042743dc`, is not hard-coded. A future manifest may name it as an explicit public owner or delegate, but this repository never infers that it controls the address and never requests its private key.

## Readiness classifications

Every valid bundle contains exactly one classification:

### `LOCAL_ADAPTER_PROTOTYPE`

This classification describes the current adapter as local, non-onboarded prototype evidence. It may include constructor analysis and proposed public roles, but it can never emit deployable transaction steps and can never use the labels `LayerZero DVN`, `onboarded`, `verified`, or `deployed` without a qualifying warning.

### `LAYERZERO_DVN_CANDIDATE`

This classification is unavailable until a later approved milestone supplies:

- a reviewed contract that satisfies the selected official DVN integration model;
- an exact destination verification target and receive-library call model;
- a current LayerZero onboarding and support decision;
- a confirmed pathway topology on both chains;
- a selected independent-DVN configuration in which Sentinel is additional or optional;
- reviewed production-grade confirmation settings;
- a live, authoritative GenLayer decision-finality consumption design;
- a security review covering the resulting contract and off-chain topology.

Requesting this classification before those inputs exist creates a blocked bundle with no transactions.

No classification is a mainnet-readiness signal.

## Fail-closed status model

Every structurally valid invocation emits a bundle with one status:

- `READY_FOR_SEPARATE_DEPLOYMENT_APPROVAL`
- `BLOCKED_DVN_CONFORMANCE`
- `BLOCKED_NETWORK_AUDIT`
- `BLOCKED_ARTIFACT_BINDING`
- `BLOCKED_CONFIGURATION`

When more than one blocker exists, the primary status is selected in this fixed precedence: artifact binding, network audit, DVN conformance, then configuration. Every blocker is still included in the sorted blocker list. Status selection must not depend on object insertion order, filesystem enumeration order, or which validation promise completes first.

`READY_FOR_SEPARATE_DEPLOYMENT_APPROVAL` means only that the local checks defined here passed. It does not authorize execution. Every bundle permanently contains:

```text
UNSIGNED_NOT_DEPLOYED_NOT_VERIFIED
```

The current repository is expected to produce `BLOCKED_DVN_CONFORMANCE` for a `LAYERZERO_DVN_CANDIDATE` request and no transaction steps. The implementation is defective if it turns the current adapter into a ready DVN candidate merely because its ABI contains `getFee` and `assignJob`.

## Input manifest

The CLI accepts one explicit absolute path to a UTF-8 JSON manifest. Relative paths, standard input, environment-driven defaults, URLs, inline JSON, and implicit working-directory discovery are rejected.

The manifest uses a versioned closed schema. Unknown, missing, duplicated, incorrectly typed, or noncanonical fields fail validation. It contains only public values:

- schema version and requested classification;
- exact source commit;
- exact network-audit date and audit-evidence digest;
- evaluation date supplied to the library by the CLI's injected UTC date boundary;
- source and destination chain identifiers and LayerZero EIDs;
- proposed public owner and delegate addresses;
- exactly five proposed threshold signer addresses;
- quorum exactly three;
- exactly five proposed recovery-operator addresses;
- intended confirmation values, each explicitly labeled project policy rather than LayerZero guidance;
- expected compiled-artifact digests;
- an explicit acknowledgement that the output is unsigned and nonauthorizing.

All Ethereum addresses must be nonzero EIP-55 checksummed values. Signers and recovery operators must each be strictly sorted and internally distinct. The two groups must not overlap. The owner and delegate may not be inferred from the signer groups. Quorum values other than three and signer groups other than five are outside this testnet milestone.

Placeholder values, example domains, credential-bearing URLs, RPC fields, secret-shaped field names, shell substitutions, filesystem traversal, NUL bytes, and control characters are rejected. Errors identify the field category and stable error code without echoing the rejected value.

## Repository and artifact binding

The readiness result binds to:

- the exact Git commit supplied in the manifest;
- a clean worktree at generation time;
- `config/networks.json`;
- its cited research evidence;
- the production contract source files;
- the production compiled artifact JSON;
- the compiler version and settings recorded by the build;
- the ABI and creation bytecode SHA-256 of every proposed contract;
- the readiness tool schema and implementation version.

The CLI may inspect Git through an argument-array child process with a minimal allowlisted environment, but it may not invoke a shell, Git hook, network operation, submodule update, or repository mutation. A dirty worktree, untracked production input, mismatched commit, missing artifact, empty bytecode, unknown compiler setting, or digest drift blocks the bundle.

Build output is not regenerated implicitly. The operator must run the documented local build first, making compilation a visible step rather than a hidden side effect.

The bundle records repository-relative paths only. It never exposes the user's home directory or other absolute host paths.

## Network-audit binding

The tool is offline. It does not browse official documentation or query chain state. Instead, it verifies that the manifest and repository metadata agree with a committed, dated audit record.

The audit binding includes:

- audit date;
- canonical official source URLs;
- chain IDs and EIDs;
- EndpointV2, send ULN302, receive ULN302, and executor addresses;
- explicit status of pathway validation;
- explicit status of independent-DVN selection;
- explicit status of OApp deployment and peer configuration;
- explicit status of LayerZero DVN conformance and onboarding;
- a digest over the normalized audit record.

An audit older than the implementation's configured maximum age relative to the evaluation date cannot produce a ready bundle. The production CLI obtains the evaluation date once from an injected clock boundary, normalizes it to UTC `YYYY-MM-DD`, and passes it explicitly to the pure readiness library. Tests use a fixed clock. Updating the maximum age or audit record requires a new dated primary-source recheck and code review. The tool never treats the Dead DVN address as a selectable verifier.

Matching an official documentation page does not prove live chain code or pathway configuration. Those checks belong to a later, separately approved read-only RPC audit and deployment workflow.

## Topology and policy gate

The conformance gate evaluates explicit evidence, not name or ABI resemblance. For the initial repository it must recognize at least these blockers:

- current adapter does not claim full official `ILayerZeroDVN` conformance;
- current payable-interface compatibility is unresolved;
- destination receive-library verification topology is unresolved;
- LayerZero DVN onboarding/support is unconfirmed;
- independent LayerZero DVNs are unselected;
- live bidirectional pathway configuration is unverified;
- final confirmation depths are unapproved project policy;
- live GenLayer consensus/finality consumption is not deployed;
- five isolated signer operators and five independent recovery operators do not exist;
- no deployment/security approval exists.

The gate also preserves the system's semantic boundary:

- deterministic verification proves packet inclusion, packet and payload hashes, confirmations, pathway configuration, and replay/idempotency;
- GenLayer semantic consensus evaluates whether the decoded treasury/governance action matches authoritative authorization and policy;
- threshold signers attest only after both classes of evidence have finalized;
- Sentinel is initially additional or optional beside independent LayerZero DVNs, never the sole production verifier.

The bundle may describe this intended topology. It must not claim those components are live.

## Output bundle

The output is canonical JSON with recursively sorted object keys, stable array order, UTF-8 encoding, a single terminal newline, and no hidden nondeterministic fields. The audit date and normalized evaluation date are explicit library inputs; the encoder does not read the clock. It uses no randomness.

The bundle contains:

- schema and tool version;
- status and requested classification;
- permanent truth label;
- normalized UTC evaluation date;
- source commit and repository-input digest;
- compiler and artifact bindings;
- audited network metadata and sources;
- proposed public roles and quorum policy;
- deterministic-versus-semantic policy boundary;
- sorted blockers with stable codes and remediation categories;
- `userApprovalRequired: true`;
- `transactions: []` unless every defined readiness gate passes.

If a future approved contract and topology pass all gates, transaction entries may contain unsigned EVM transaction data:

- chain ID and EID;
- purpose and prerequisite step identifiers;
- destination address or explicit contract-creation marker;
- zero or fixed public value;
- calldata or creation bytecode;
- decoded constructor or function arguments;
- expected artifact digest;
- explicit postcondition for a future receipt-backed verifier.

They contain no nonce, fee estimate, gas price, signature, raw signed transaction, provider, RPC URL, or assertion that execution occurred.

Identical repository state, manifest bytes, and normalized evaluation date must produce byte-identical output. A new UTC date intentionally changes the bundle and reruns audit-staleness evaluation.

## CLI behavior

The intended command is:

```bash
npm run readiness:bundle -- --manifest /absolute/path/to/public-readiness.json
```

By default, the canonical bundle is printed to standard output. An optional explicit absolute output path may be supplied. The file is created with exclusive-create semantics and restrictive user permissions; an existing path is never truncated, appended, renamed, or overwritten.

Exit codes are stable:

- `0`: ready for a separate deployment approval;
- `2`: valid bundle, but blocked;
- `1`: invalid input, local integrity failure, or internal failure.

A blocked invocation still prints or creates its complete canonical bundle before exiting `2`. Human diagnostics go to standard error, are bounded, and contain stable codes without raw exception objects, manifest values, environment values, or absolute user paths.

The CLI must close all file descriptors and remove only its own explicitly created temporary resources after both success and failure.

## Error model

The public error vocabulary includes:

- `READINESS_MANIFEST_INVALID`
- `READINESS_SECRET_FIELD_REJECTED`
- `READINESS_METADATA_STALE`
- `READINESS_METADATA_MISMATCH`
- `READINESS_ARTIFACT_DRIFT`
- `READINESS_SOURCE_DIRTY`
- `READINESS_DVN_CONFORMANCE_BLOCKED`
- `READINESS_CONFIGURATION_BLOCKED`
- `READINESS_OUTPUT_EXISTS`
- `READINESS_INTERNAL_FAILURE`

Expected blockers are data in a valid bundle, not thrown stack traces. Unexpected failures are sanitized to `READINESS_INTERNAL_FAILURE`; debug stacks are not printed by the production CLI.

## Security invariants

The implementation must preserve these invariants:

1. No accepted input can cause network, wallet, signing, deployment, or chain-state activity.
2. No private or secret-bearing field can enter the manifest or output schema.
3. A blocked topology can never contain transaction steps.
4. Current adapter ABI resemblance cannot satisfy the DVN conformance gate.
5. A bundle cannot be detached from its exact source commit, audit record, compiler settings, ABI, and creation bytecode.
6. A ready bundle remains nonauthorizing and unsigned.
7. Existing files and deployment records are never modified.
8. User-controlled values are not echoed in errors.
9. Repeated generation is deterministic.
10. No address, confirmation value, DVN selection, or trust operator is silently defaulted.

## Test strategy

Implementation follows test-driven development. Tests must be written to fail before implementation and cover:

### Manifest and schema

- one exact valid public manifest parses;
- every missing, extra, duplicate, mistyped, placeholder, zero, nonchecksummed, or secret-shaped field fails;
- signer and recovery groups require exactly five sorted distinct addresses and no overlap;
- quorum must equal three;
- relative input and output paths fail;
- rejected values never appear in public errors.

### Binding and audit

- exact commit, clean tree, artifact, compiler, ABI, bytecode, config, and audit digests pass;
- dirty source, untracked production inputs, commit drift, empty bytecode, compiler drift, stale audit, official metadata mismatch, and altered research evidence fail closed;
- network metadata remains classified as audited but not pathway-validated;
- the Dead DVN cannot be selected.

### Conformance and topology

- the current `SentinelDVNAdapter` requested as `LAYERZERO_DVN_CANDIDATE` emits `BLOCKED_DVN_CONFORMANCE`;
- that blocked bundle contains no transactions;
- a local-prototype request remains explicitly local and non-onboarded;
- selector or ABI-name matching alone cannot pass conformance;
- unresolved independent DVNs, confirmations, GenLayer finality, signer isolation, recovery operators, or user approval block readiness.

### Capability isolation

- injected network, wallet, signer, account, provider, deployment, and environment capabilities receive zero calls;
- the production module has no deployment-framework or account-provider import;
- secret-like ambient environment variables are neither read nor forwarded;
- no test requires internet access or a funded account;
- `deployments/` and repository inputs are byte-identical before and after success and failure.

### Output and filesystem

- identical inputs and fixed evaluation date produce byte-identical canonical JSON;
- blocker ordering and transaction ordering are stable;
- all output contains the permanent truth label and `userApprovalRequired: true`;
- no output contains private-key, mnemonic, RPC, cloud-credential, home-directory, or raw exception material;
- output uses exclusive creation and refuses overwrite;
- interrupted and failed writes leave no partial final file;
- ready, blocked, and invalid invocations return `0`, `2`, and `1` respectively.

The full repository `npm run check` must include these tests. No test may weaken the existing contract assurance, direct GenLayer, signer, coordinator, dashboard, security, integration, or end-to-end gates.

## Documentation and truth labels

Implementation updates:

- `README.md`;
- `deployments/README.md`;
- `docs/SECURITY_STATUS.md`;
- `docs/THREAT_MODEL.md`;
- `docs/MILESTONES.md`;
- a dated official-source audit under `docs/research/`;
- a public example manifest containing nonoperational example addresses only.

Documentation must continue to state:

- not deployed;
- no live app URL;
- no live LayerZero pathway;
- no live GenLayer consensus/finality;
- no onboarded LayerZero DVN;
- no independent production signers or recovery operators;
- no funded deployer and no secret-handling workflow in this feature;
- not externally audited and not mainnet-ready.

The public demo may show a blocked bundle and explain each blocker. It must not simulate a successful deployment or label the local dashboard as chain-backed.

## Non-goals

This milestone does not:

- deploy, configure, verify, fund, publish, or register anything;
- connect the dashboard to a deployed contract;
- resolve LayerZero DVN conformance or onboarding;
- select external DVNs, Gasolina behavior, or confirmation policy;
- implement a receipt recorder;
- implement a signer or transaction broadcaster;
- produce a live GenLayer Intelligent Contract address;
- assert that Sepolia to Arbitrum Sepolia is currently usable by Sentinel;
- update `deployments/` with an address;
- claim production or mainnet readiness.

## Acceptance criteria

The milestone is complete only when:

1. The closed public manifest, artifact binding, network-audit binding, topology gate, canonical encoder, and read-only CLI are implemented.
2. The tool has no wallet, signer, provider, RPC, deployment, environment-configuration, or network capability.
3. The current adapter fails closed as a LayerZero DVN candidate and emits no transaction steps.
4. Every source, compiler, artifact, audit, address, role, and policy value is explicit and digest-bound.
5. Output is deterministic, sanitized, nonoverwriting, and permanently labeled unsigned, undeployed, and unverified.
6. A ready result still requires a separate explicit user approval.
7. Existing deployment records and repository inputs are unchanged.
8. Unit, integration, security, filesystem, determinism, capability-isolation, and full repository tests pass.
9. Documentation describes exactly what is working, blocked, simulated, and not production-safe.
10. An independent read-only review reports no remaining Critical or Important issue.
11. No deployment, funds, RPC request, signing action, cloud resource, publication, external message, or secret is created.

## Rollback

The feature is local and stateless. Rollback removes its source, tests, example manifest, npm command, and documentation claims. It does not migrate or delete contracts, deployments, keys, accounts, chain state, databases, or cloud resources.

Generated bundles are review artifacts, not repository truth. Removing the feature does not turn any previous bundle into authorization or deployment evidence.
