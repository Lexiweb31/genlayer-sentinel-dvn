# Contract Assurance Gate Design

Status: approved design for a local testnet-prototype assurance milestone. This design does not authorize deployment, funding, cloud resources, publication, or any production-readiness claim.

## Purpose

GenLayer Sentinel currently has deterministic contract tests for its LayerZero OApp and DVN adapter, but the repository truthfully lists Solidity property/fuzz testing and static analysis as missing. This milestone adds a reproducible local assurance gate for the two production Solidity contracts:

- `contracts/src/SentinelDVNAdapter.sol`
- `contracts/src/TreasuryPolicyOApp.sol`

The gate must test security invariants across generated inputs and run an established Solidity analyzer. It strengthens local evidence only. It is not formal verification, an external audit, live EndpointV2 or ULN302 conformance, deployed-chain evidence, or a mainnet-readiness signal.

## Approved approach

The approved approach combines:

1. `fast-check` `4.9.0`, pinned exactly as a development dependency, for seeded property tests that execute the compiled production contracts against Sentinel's isolated Hardhat EDR chain.
2. Slither `0.11.5`, installed with a fully hash-locked Python dependency graph in a dedicated repository-local `.venv-assurance`.
3. Native Solidity `0.8.30`, downloaded from Solidity's official binary manifests into `.cache/contract-assurance` and verified against repository-pinned platform checksums before use.

This was selected over two alternatives:

- Foundry/Echidna would provide native sequence fuzzing, but it adds a second Solidity build and execution system, larger binary/bootstrap surface, new test harness language, and duplicated deployment fixtures before the current contracts need that complexity.
- A JavaScript-only property suite plus Solhint or a custom AST scanner would be easier to bootstrap, but it would not provide an independent static-analysis engine and could misleadingly overstate a lint pass as security analysis.

Slither is an established Solidity/Vyper static analyzer with vulnerability detectors and direct Solidity-project support. It requires a native Solidity compiler when a supported compilation framework is not used. Fast-check is a property-based testing framework for JavaScript/TypeScript and supports deterministic seeds and shrinking.

Primary sources:

- [Slither repository and installation guidance](https://github.com/crytic/slither)
- [Slither detector documentation](https://github.com/crytic/slither/wiki/Detector-Documentation)
- [slither-analyzer 0.11.5 release metadata](https://pypi.org/project/slither-analyzer/0.11.5/)
- [fast-check package and version metadata](https://www.npmjs.com/package/fast-check)
- [fast-check repository](https://github.com/dubzzz/fast-check)
- [Foundry invariant-testing reference](https://getfoundry.sh/forge/invariant-testing)

## Trust and isolation boundaries

The assurance environment is independent from Sentinel's GenLayer direct-mode `.venv`. It must not install into the user's global Python, mutate the GenLayer environment, write outside the repository, load another product's environment, or accept a wallet, private key, RPC credential, API key, or cloud credential.

The only network-enabled assurance command is:

```bash
npm run setup:assurance
```

It creates `.venv-assurance`, installs the hash-locked Python graph, installs native Solidity `0.8.30` under `.cache/contract-assurance/solc`, verifies the compiler checksum and version, and prints the installed tool versions. It does not run a deployment or access a chain.

Ordinary property and static checks never bootstrap or download. If the exact environment is missing or wrong, they fail with one sanitized instruction to run `npm run setup:assurance`.

The runner constructs an allowlisted child-process environment. It supplies only the repository-local virtual environment, deterministic locale/hash settings, system executable path, and system certificate locations needed during explicit setup. It does not forward variables whose names or values indicate wallets, mnemonics, private keys, RPC URLs, API tokens, cloud credentials, or secrets.

`.venv-assurance/`, native compiler artifacts, temporary Slither output, fuzz state, and counterexample scratch data are ignored and never committed. The exact npm dependency and Python lock files are committed.

## Toolchain pinning

The repository will add:

- `fast-check: "4.9.0"` to `devDependencies`;
- `requirements/contract-assurance.lock`, containing the complete transitive Python graph with exact versions and SHA-256 hashes;
- `config/contract-assurance-toolchain.json`, with schema version, required Python range `>=3.12.0 <3.13.0`, Slither `0.11.5`, native solc `0.8.30`, supported platform identifiers, exact official download paths, and exact native-compiler SHA-256 digests;
- a setup script that refuses an unlisted platform, unexpected Python, compiler checksum, compiler version, Slither version, or lock drift.

The initial supported platforms are the current `darwin-arm64` development host and `linux-x64` CI/runtime-development host. Solidity's official manifest does not publish a native macOS ARM `0.8.30` binary, and the ARM source used by current `solc-select` stops at `0.8.24`. Therefore `darwin-arm64` uses Solidity's official macOS x86_64 `0.8.30` binary through Rosetta after setup proves `arch -x86_64 /usr/bin/true` succeeds. It is pinned to SHA-256 `738dcdc6afddeb505ee4e4ef24f1c1fdba2b8c924e614cbbf5801a5b062dd683`. `linux-x64` uses the official Linux x86_64 binary pinned to SHA-256 `f3e987dc6ecebd4bd350c48edcbc320b46cf9e3109bd3fc3d88f1acaf4c428f7`. Other platforms, or a Mac without Rosetta, fail explicitly rather than downloading an unreviewed binary or downgrading the compiler. Adding a platform requires a dated primary-source audit and a committed checksum.

The ordinary runner verifies all pinned versions before analysis. It invokes native solc with the same `0.8.30`, Shanghai EVM target, optimizer enabled, and 200 optimizer runs used by `scripts/compile-contracts.mjs`. A mismatch between the existing solc-js build and assurance compiler settings is a gate failure.

## Property-testing architecture

Property tests live under `contracts/assurance/`, outside the ordinary deterministic `contracts/test/*.test.js` glob. `npm run test:properties` builds the current sources once and then runs only these generated-input campaigns. `npm run check:assurance` runs the build, property campaigns, and static analysis. The repository's top-level `npm run check` invokes `check:assurance` so the gate cannot be omitted from a claimed full verification.

Every property campaign:

- uses a committed decimal seed and fixed run count;
- prints its seed and run count before execution;
- enables shrinking and verbose counterexample output;
- runs serially;
- deploys real compiled contract bytecode to an isolated loopback-only EDR chain;
- takes and reverts an EVM snapshot around each generated case so shrinking and replay are not contaminated by earlier generated state;
- closes the EDR server on success or failure;
- loads no account or key from disk or environment;
- uses only disposable unlocked EDR identities.

The default campaign budget is intentionally bounded for every local and CI run:

- adapter authorization properties: 32 generated cases;
- adapter atomicity and replay properties: 24 generated cases;
- OApp execution/replay properties: 24 generated cases;
- OApp rejection and rollback properties: 32 generated cases.

A failing campaign reports the fixed seed, shrink path, generated counterexample, property name, and underlying transaction/assertion error. Re-running the same command uses the same seed. A discovered defect must become a small deterministic regression test before production code is changed.

### Adapter properties

The adapter fixture uses exactly five sorted authorized signer addresses and quorum three, plus at least two unauthorized identities. Generated GUIDs, packet digests, evidence digests, expiries, calldata values, and signer subsets must establish:

1. Any three, four, or five distinct authorized signatures over the exact domain-separated execution digest succeed when supplied in recovered-address order.
2. Fewer than three authorized signatures never pass, even when combined with unauthorized signatures.
3. Duplicate, unsorted, malformed, wrong-digest, wrong-adapter, wrong-chain-domain, expired, or otherwise mismatched shares never set `used` and never call the verification target.
4. A successful digest is usable exactly once.
5. A reverting verification target rolls back the `used` write and every target side effect.
6. The on-chain digest equals the independently implemented coordinator digest for every generated valid input.

The properties do not model signer independence, HSM custody, transport authentication, live chain finality, or LayerZero's production receive library.

### OApp properties

The OApp fixture uses two production OApps behind the behavioral `MockEndpointV2`, one authorized action target, one unauthorized target, and exact trusted peers. Generated authorization IDs, GUIDs, nonces, and `record(bytes32)` arguments must establish:

1. A well-formed action from the exact trusted peer to an authorized target executes once and records the generated value.
2. Reusing either the GUID or authorization ID never produces a second target call.
3. An untrusted peer, zero authorization ID, zero target, unauthorized target, malformed action, or reverting target never leaves execution flags or target side effects behind.
4. Owner-only sending and target authorization remain inaccessible to generated unauthorized callers.
5. Successful `sendAction` messages retain the exact authorization, target, value, payload and emitted GUID bindings decoded from the receipt.

`MockEndpointV2` remains explicitly behavioral test code. These properties do not prove EndpointV2, ULN302, executor, DVN, fee, or pathway correctness.

## Static-analysis architecture

`npm run analyze:contracts` invokes the repository-local Slither executable separately for the two production source files. It supplies explicit base/include paths for `node_modules`, excludes dependency-only findings from production enforcement only after validating and reporting them, retains production elements from mixed findings, pins the compiler and optimizer settings, and writes machine-readable JSON only to an operating-system temporary directory. This explicit reporting rule reflects observed Slither `0.11.5` behavior: `--exclude-dependencies` does not remove dependency-only detector records from JSON, while blanket path filtering can hide mixed production findings.

The runner validates Slither output with a closed schema and rejects:

- analysis or compilation failure;
- missing or extra production targets;
- an unexpected compiler or analyzer version;
- malformed JSON or an unknown impact/confidence value;
- any High or Medium finding;
- any unexpected Low or Informational finding;
- an allowlist entry that no longer matches exactly one finding;
- duplicate, expired, malformed, or unused allowlist entries.

High and Medium findings cannot be allowlisted. They require a demonstrated fix or an explicit redesign decision before this milestone can pass.

Low and Informational findings may be accepted only in `config/slither-allowlist.json`. Each entry binds:

- Slither detector ID;
- impact and confidence;
- canonical repository source path;
- contract and function identity when present;
- source offset and length;
- normalized description SHA-256;
- referenced source-snippet SHA-256;
- review date;
- concise technical rationale.

This deliberately makes normal source movement or analyzer-output drift reopen the finding for review. Blanket detector exclusions, path globs, unbounded baselines, raw text suppression, and “all current findings” snapshots are forbidden.

The console result is a bounded summary: tool versions, two analyzed targets, detector counts by impact, accepted low/informational finding IDs, and pass/fail. It must not print environment variables, absolute user paths, compiler download URLs, or raw child-process errors that may contain host details.

## Script and parser tests

The assurance orchestration receives deterministic tests under `scripts/test/`:

- missing `.venv-assurance` fails with the exact setup instruction and does not bootstrap;
- unexpected Python, Slither, solc, platform, checksum, lock, or config schema fails closed;
- ambient secret-like environment variables are not forwarded;
- Slither JSON accepts one exact clean report;
- High and Medium findings always fail;
- exact reviewed Low/Informational findings pass;
- stale, duplicate, extra, broad, malformed, expired, or wrong-source allowlist entries fail;
- absolute paths and raw exception details are sanitized from public output;
- temporary report files are removed after success and failure.

Tests use controlled fixture JSON and fake executable boundaries for orchestration behavior. The final integration test runs the real pinned Slither binary and native compiler over both production contracts.

## Dependency and finding triage

Adding `fast-check` requires regenerating `package-lock.json` with the repository-pinned npm `10.9.2`, then running:

```bash
npm ls
npm audit --omit=dev
npm audit
```

The production audit must remain at zero vulnerabilities. Development findings are recorded exactly and are not auto-fixed. `npm audit fix --force` remains forbidden.

The first real Slither run is an evidence-gathering step, not an automatic pass. Each finding is classified:

- a real contract defect receives a deterministic failing test, the smallest contract fix, property re-run, static re-run, bytecode/ABI comparison, and full suite;
- an intended Low/Informational behavior receives a precise allowlist entry and rationale;
- a false positive that cannot be precisely bounded blocks the milestone rather than causing a blanket suppression.

Any production Solidity change requires explicit ABI and bytecode review. ABI changes are out of scope unless a demonstrated security defect cannot be fixed without one.

## Commands

The intended command surface is:

```bash
npm run setup:assurance
npm run test:properties
npm run analyze:contracts
npm run check:assurance
npm run check
```

`setup:assurance` is the only network-enabled assurance command. The remaining commands use only repository-local dependencies and loopback EDR.

## Documentation and truth labels

The implementation updates:

- `README.md`;
- `contracts/test/README.md`;
- `docs/SECURITY_STATUS.md`;
- `docs/THREAT_MODEL.md`;
- `docs/MILESTONES.md`;
- a dated `docs/research/2026-07-29-contract-assurance-audit.md`.

Documentation records exact seeds, run counts, tool/compiler versions, analyzed targets, accepted findings, dependency-audit counts, test totals, and commands. It must continue to say:

- not deployed;
- no live app URL;
- no live GenLayer consensus;
- no independent production signers or RPC operators;
- no formal verification;
- no third-party audit;
- not mainnet-ready.

Passing the gate means only that the committed generated-input campaigns and the pinned Slither detectors found no unreviewed violation under their documented bounds.

## Acceptance criteria

The milestone is complete only when:

1. The dependency graph and native compiler are exact, repository-local, reproducible, and separately bootstrapped.
2. Ordinary assurance checks perform no network download or global installation.
3. The property campaigns execute real contract bytecode with fixed seeds, fixed run counts, shrinking, snapshot isolation, and real negative/rollback behavior.
4. The adapter is exercised as the intended five-signer, three-signature threshold.
5. Both production contracts pass the pinned Slither gate with no High or Medium finding and no unreviewed Low or Informational finding.
6. All allowlist entries, if any, are precise, justified, drift-sensitive, and used exactly once.
7. Production dependency audit remains zero; development findings are recorded without forced remediation.
8. ABI and bytecode changes are explicitly reported; no security finding is hidden by a behavioral change.
9. Script, parser, property, contract, integration, security, and existing end-to-end tests pass.
10. An independent read-only review reports no remaining Critical or Important issue.
11. No deployment, funds, cloud resource, publication, external message, secret, or production-readiness claim is created.

## Rollback

The feature is development-only. Rollback removes the assurance scripts, property suites, configuration, dedicated virtual-environment ignore entry, fast-check development dependency, commands, and documentation claims. It does not migrate runtime state, contracts, deployments, keys, or databases.

If a future analyzer or compiler update changes findings, keep the previous pinned gate operational until the new version is separately audited. Never rewrite the allowlist to make an upgrade green without reviewing every changed finding and source binding.
