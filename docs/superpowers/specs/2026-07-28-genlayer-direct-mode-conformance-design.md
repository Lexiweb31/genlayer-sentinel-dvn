# GenLayer Direct-Mode Conformance and Auditable Policy Record Design

**Status:** Approved for implementation on 2026-07-28  
**Target release:** `0.26.0`  
**Product boundary:** GenLayer Sentinel only

## Purpose

GenLayer Sentinel currently has a syntax-and-string checker for its Intelligent Contract and a strict off-chain adapter that consumes finalized records. Those checks do not execute `SentinelPolicy` in GenVM, test its storage representation, or exercise its equivalence principle under validator agreement and disagreement.

This milestone will run the policy contract through GenLayer's official direct-mode test framework and strengthen the GUID-keyed record into an auditable, versioned policy result. It closes a material code-only readiness gap without deploying contracts, funding accounts, contacting Bradbury, starting GenLayer Studio, handling private keys, or claiming live validator consensus.

## Success Criteria

The milestone is successful when:

1. the contract deploys and executes under the pinned official GenLayer direct-mode tooling on Python 3.12 or newer;
2. strict web and LLM mocks, storage pickling validation, transaction-time behavior, and validator re-execution are covered;
3. only the configured coordinator can create one immutable result for a canonical LayerZero GUID;
4. the stored result binds the packet, evidence, decoded action, policy, policy version, decision, reason, and deterministic GenVM transaction time;
5. evidence-rendering disagreement, digest mismatch, ambiguous semantic output, malformed input, unauthorized access, and duplicate GUIDs fail closed;
6. the existing off-chain finality adapter can consume the compatibility view without weakening its finalized-status gate;
7. normal test execution performs no network calls and reads no secrets; and
8. documentation states exactly what direct mode proves and what still requires Studio, Bradbury, independent validators, and a funded testnet pathway.

## Scope

### Included

- A repository-local, pinned Python 3.12 test environment for the official `genlayer-test` direct-mode framework and GenVM linter.
- Direct-mode tests for contract deployment, storage, authorization, idempotency, evidence hashing, semantic decisions, timestamps, and validator variance.
- A versioned structured policy record stored by GUID.
- Canonical validation and bounded inputs at the Intelligent Contract boundary.
- A stable compatibility view for `GenLayerRpcFinality`.
- A structured audit view for future operators and dashboard/API integration.
- Cross-language tests for the compatibility record decoder.
- README, milestone, threat-model, testing, and unknowns updates.

### Excluded

- GenLayer Studio or Docker-based integration.
- Bradbury deployment, accounts, GEN funding, live RPC writes, or validator fees.
- LayerZero testnet deployment or pathway configuration.
- A production GenLayer account provider.
- Signer key custody, HSM/KMS integration, or production mutual TLS.
- A claim that mocked direct-mode validators demonstrate independent decentralized consensus.
- Any code, configuration, history, environment, infrastructure, or branding from Merit or `genlayer-escrow`.

## Approaches Considered

### 1. Official direct mode plus record hardening — selected

Execute the contract with `genlayer-test`, add validator-variance and serialization coverage, and harden the record format at the same time. This validates the actual policy boundary rather than preserving a minimally tested storage schema.

The trade-off is a Python 3.12 development dependency and a deliberate compatibility surface between the structured record and the TypeScript coordinator.

### 2. Direct-mode tests against the current pipe-delimited record

This is smaller, but it would certify a record that omits important audit bindings and exposes no structured operator view. It does not satisfy the original contract-record requirement strongly enough.

### 3. GenLayer Studio integration first

Studio provides higher-fidelity network behavior and multi-validator execution. It also requires Docker and longer-lived local infrastructure, and it still would not prove Bradbury compatibility. It is deferred until the direct contract surface is stable.

## Authoritative Tooling Baseline

The implementation will use current official GenLayer guidance:

- Python 3.12 or newer.
- `genlayer-test` direct mode as the first test layer.
- strict mock matching so unused or misspelled mocks fail.
- pickling validation to detect production serialization incompatibilities.
- `run_validator()` to exercise equivalence-principle agreement and disagreement.
- the GenVM linter before runtime tests.

Top-level Python packages will be exact-version pinned. The resolved dependency graph will be committed as a hash-checked lock file. Installation is an explicit setup command; repository checks never silently install packages or access the network.

The implementation will re-verify package versions before fixing the lock. The design baseline observed on 2026-07-28 is `genlayer-test==0.29.2` and `genvm-linter==0.11.0`.

## Contract Architecture

### Coordinator identity

`SentinelPolicy` will store the authorized coordinator as GenLayer's `Address` type instead of an unconstrained string. Deployment rejects the zero address and an empty or malformed policy version. `evaluate` compares `gl.message.sender_address` directly with the stored address.

This controls who may request policy evaluation. It does not make the coordinator decentralized and does not replace threshold DVN signing.

### Canonical request validation

Before any nondeterministic work, `evaluate` will validate:

- `guid`, `packet_digest`, and `evidence_digest` are lowercase-normalized `0x`-prefixed 32-byte hex values;
- `evidence_uri` is a bounded credential-free HTTPS URL;
- `decoded_action`, `policy`, and `policy_version` are non-empty and bounded;
- the GUID has no existing record.

The initial prototype bounds will be constants measured after UTF-8 encoding and tested at their exact edges:

- evidence URI: 2,048 bytes;
- decoded action: 8,192 bytes;
- policy: 8,192 bytes;
- policy version: 64 ASCII characters from `[A-Za-z0-9._-]`; and
- stored semantic reason: 1,024 bytes.

The authorized coordinator remains responsible for deterministic ABI decoding, governance evidence construction, freshness, LayerZero packet inclusion, pathway configuration, and confirmation depth before calling the contract.

### Versioned policy record

The contract will define a storage-compatible `@allow_storage` dataclass and store it in `TreeMap[str, PolicyRecord]`, keyed by normalized GUID.

Each record contains:

- schema version;
- status, fixed to `DECIDED`;
- normalized GUID;
- normalized packet digest;
- evidence URI;
- normalized evidence-content digest;
- exact decoded action;
- SHA-256 digest of the decoded action;
- exact policy;
- SHA-256 digest of the policy;
- policy version;
- final semantic decision, `ALLOW` or `DENY`;
- bounded semantic reason;
- deterministic decision timestamp in UTC ISO 8601 form; and
- a canonical request-binding digest over the length-prefixed signing-critical inputs.

The request-binding digest is SHA-256 over the UTF-8 bytes of the domain tag `SENTINEL_POLICY_REQUEST_V1`, followed by each of these fields in order: schema version, GUID, packet digest, evidence URI, evidence digest, decoded action, policy, and policy version. Every field is encoded as its decimal UTF-8 byte length, one ASCII colon, and the exact bytes. The resulting value is a lowercase `0x`-prefixed 32-byte hex digest.

The contract cannot truthfully mark the GenLayer transaction `FINALIZED` from inside its own execution. Network finality happens later. `DECIDED` therefore describes contract execution, while the coordinator continues to require the external `FINALIZED`/`7` transaction status, successful execution, and a `latest-final` contract read before asking any signer to sign. The coordinator's `finalizedAt` remains the observation time of that external finality gate.

### Read interfaces

`get_record_details(guid)` returns the structured stored record for audit consumers.

`get_record(guid)` remains the narrow signing compatibility interface:

```text
v1|ALLOW|<packet-digest>|<evidence-digest>|<policy-version>|<request-binding-digest>|<bounded-reason>
```

The first six fields are signing-critical compatibility fields. The TypeScript decoder will be isolated into a named function, require the exact `v1` schema plus valid decision, digest, and version values, recompute the request-binding digest from the registered `PolicyRequest`, ignore the reason for authorization, and reject malformed or contradictory records. The trailing reason may contain delimiter characters because the decoder consumes exactly the first six delimiters and treats the remaining bounded text as one non-authoritative field.

The compatibility view and structured view are both explicitly versioned. A future incompatible schema requires a new version and coordinated decoder update.

## Semantic Decision Flow

1. Perform all caller, format, size, HTTPS, and duplicate-GUID checks deterministically.
2. Render the authoritative evidence URI as text inside the nondeterministic leader function.
3. Hash the exact rendered text with SHA-256.
4. Return a canonical denial when the rendered digest differs from the supplied authoritative evidence digest. Do not invoke the LLM on this path.
5. Present action, policy, and evidence to the model as explicitly labeled, JSON-escaped untrusted data.
6. Require a short `ALLOW ...` or `DENY ...` answer. Treat any other prefix, empty result, excessive result, exception, or ambiguity as `DENY`.
7. Use `prompt_comparative` so validators compare the decision and referenced authorization. The principle states that digest mismatch, ambiguity, unsafe interpretation, or materially different authorization references are denial conditions.
8. Store one immutable `DECIDED` record after the equivalence principle returns.

Deterministic checks remain separate from semantic consensus. GenLayer does not establish LayerZero packet inclusion, payload hashing, source confirmations, pathway configuration, or DVN quorum; those remain deterministic coordinator responsibilities.

## Timestamp Semantics

The decision timestamp uses GenVM's deterministic transaction time through the Python datetime interface wired to the transaction context. Direct-mode tests will use `vm.warp()` and assert the exact stored UTC value.

This timestamp is neither the source-chain packet time nor the later GenLayer finality time. Documentation and field names will preserve that distinction.

## Tooling and Commands

The repository will add:

- a human-readable exact top-level requirements file;
- a fully resolved hash-checked Python lock file;
- `.venv/` to `.gitignore`;
- an explicit setup script that selects Python 3.12+, creates only the repository-local virtual environment, and installs the lock with hash verification;
- a direct-test runner that refuses to use a missing or incompatible environment;
- `npm run setup:ic:direct`;
- `npm run lint:ic`;
- `npm run test:ic:direct`; and
- direct-mode and linter execution in the full `npm run check` path.

`npm run build` will retain the fast AST safety checker and will not require package installation or network access. `npm run check` assumes the explicit setup command has been run, then performs only local execution.

No script accepts or reads private keys, `.env` files, cloud credentials, GenLayer accounts, wallet addresses, or RPC credentials.

## Test Design

### Direct contract tests

The Python suite will cover:

1. deployment with a valid coordinator and policy version;
2. rejection of zero coordinator and invalid policy versions;
3. an empty record before evaluation;
4. rejection of a non-coordinator sender without web or LLM work;
5. rejection of malformed hashes, non-HTTPS or credential-bearing evidence URIs, empty inputs, and over-limit inputs;
6. an exact rendered-evidence digest plus an `ALLOW` result;
7. an exact rendered-evidence digest plus an explicit `DENY` result;
8. ambiguous, empty, oversized, and exception-like semantic results becoming `DENY`;
9. evidence-digest mismatch becoming `DENY` without an LLM call;
10. prompt-injection text remaining data and never bypassing digest or decision handling;
11. immutable duplicate-GUID rejection without overwriting the first record;
12. exact action, policy, evidence, request-binding, and timestamp fields;
13. pickling validation for every state-changing path;
14. validator agreement for materially equivalent decisions;
15. validator disagreement for a changed decision or changed authorization; and
16. renderer variance causing validator disagreement or a fail-closed denial.

Strict mock mode will be enabled by default. Tests will clear and replace mocks before validator re-execution so the suite demonstrates both agreement and disagreement intentionally.

### TypeScript compatibility tests

Coordinator tests will cover:

- decoding both `ALLOW` and `DENY`;
- accepting a bounded reason containing delimiter characters without changing the first six fields;
- rejecting a missing field, invalid decision, invalid digest, empty/invalid policy version, unexpected schema form, and request-binding mismatch;
- requiring `FINALIZED`/`7`, successful transaction execution, and `latest-final` state exactly as today; and
- never using the human-readable reason as signing authorization.

### Static and integration checks

The existing AST safety checker remains a fast build guard and will be updated for the structured record and JSON framing. The official linter and direct-mode suite provide the runtime layer. The full repository suite then proves that the strengthened contract interface still composes with coordinator recovery, threshold signing, destination verification, OApp execution, and dashboard behavior.

## Failure Handling

- Missing Python 3.12 produces one actionable setup error.
- A lock hash mismatch aborts installation.
- A missing local virtual environment aborts direct testing; it does not auto-install.
- Any unmocked web or model call fails the test.
- Any contract input violation raises a bounded user error before nondeterministic work.
- Any evidence mismatch or semantic ambiguity produces `DENY`.
- Any validator disagreement is asserted as disagreement and must never be relabeled as finalized approval.
- Any compatibility record mismatch throws before constructing a `PolicyResult`.

Errors and documentation will not print dependency credentials, URLs with embedded credentials, private inputs, or raw transport errors.

## Security and Trust Boundaries

This milestone proves local GenVM surface compatibility against pinned mocks and validates the equivalence-principle predicate under controlled validator results. It does not prove:

- independent validators render the same live website;
- production models agree;
- Bradbury accepts the deployment unchanged;
- GenLayer finality is available within a required latency;
- the coordinator account is securely hosted;
- LayerZero has onboarded the adapter as a DVN;
- five signer identities have independent operators; or
- the Sepolia pathway and independent LayerZero DVNs are configured.

Sentinel remains intended as an additional or optional verifier alongside independent LayerZero DVNs. A direct-mode `ALLOW` is test evidence, not a destination-chain DVN signature and not permission to market the prototype as mainnet-ready.

## Documentation Changes

The release will update:

- `README.md` with setup, test commands, proof boundaries, and a direct-mode demo walkthrough;
- `docs/MILESTONES.md` to close direct-mode testing while preserving live M2 gates;
- `docs/THREAT_MODEL.md` with renderer/model correlation and record-size controls;
- `docs/UNKNOWNS.md` to replace the direct-mode unknown with narrower Studio/Bradbury and validator-diversity unknowns;
- test documentation with direct versus Studio coverage; and
- dependency audit notes with the verified versions and official sources.

No live application URL will be added because no deployment is authorized.

## Implementation Sequence

1. Pin and lock the official Python tooling and add explicit setup/run commands.
2. Write failing direct-mode tests against the current contract.
3. Harden request validation and the structured record until those tests pass.
4. Isolate and harden the TypeScript compatibility decoder with failing-first tests.
5. Add validator agreement, disagreement, renderer variance, pickling, and cross-language boundary tests.
6. Update documentation and milestone status truthfully.
7. Run the linter, direct-mode suite, TypeScript/Solidity/dashboard tests, secret scan, and full repository check.
8. Commit the completed `0.26.0` code-only milestone locally.

## Rollback

The release is code-only and produces no external state. Rollback is a normal Git revert of the implementation commit. No chain rollback, key rotation, cloud teardown, database migration, or fund recovery is required.

The coordinator retains a narrow compatibility view rather than depending on the complete storage dataclass, which keeps rollback and staged adoption simple. Because no Intelligent Contract is deployed, the format can be upgraded to explicit `v1` atomically with its TypeScript decoder. A future live deployment must deploy the exact reviewed contract artifact and record its source hash, dependency pin, chain, address, coordinator identity, and policy version separately.

## Primary References

- [GenLayer: Testing Intelligent Contracts](https://docs.genlayer.com/developers/intelligent-contracts/testing)
- [GenLayer Test: Direct Mode API](https://docs.genlayer.com/api-references/genlayer-test/direct)
- [GenLayer: Transaction Context](https://docs.genlayer.com/developers/intelligent-contracts/features/transaction-context)
- [GenLayer: Persisting Data](https://docs.genlayer.com/developers/intelligent-contracts/storage)
- [GenLayer: Storage-Compatible Dataclasses](https://docs.genlayer.com/developers/intelligent-contracts/types/dataclasses)
