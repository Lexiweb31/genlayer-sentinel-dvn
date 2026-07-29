# Contract assurance audit — 2026-07-29

Status: reproducible local assurance gate complete for the two production Solidity contracts. No deployment, testnet transaction, funding, cloud resource, publication, or external message was performed.

## Scope and result

The gate covers exactly:

- `contracts/src/SentinelDVNAdapter.sol`
- `contracts/src/TreasuryPolicyOApp.sol`

`npm run check:assurance` builds the current source, runs four fixed-seed generated-input campaigns against isolated local Hardhat EDR chains, verifies the repository-local analyzer/compiler installation, and analyzes each production target separately. The final Slither result is:

- High: `0`
- Medium: `0`
- Low: `1`
- Informational: `6`
- reviewed exact findings: `7`

Every Low/Informational result must match its detector, impact, confidence, source element, byte offset/length, normalized description hash, and literal source-snippet hash in `config/slither-allowlist.json`. High and Medium entries are rejected by schema. An intentional one-byte allowlist mutation failed with `unreviewed Informational Slither finding: assembly`; restoring the exact fingerprint returned the gate to green.

This result means only that the pinned campaigns and Slither detectors found no unreviewed violation under the bounds below. It is not formal verification, a third-party audit, live LayerZero conformance, live GenLayer consensus, or deployment evidence.

## Primary-source recheck

Accessed 2026-07-29:

- [Slither 0.11.5 release](https://github.com/crytic/slither/releases/tag/0.11.5)
- [slither-analyzer 0.11.5 package metadata](https://pypi.org/project/slither-analyzer/0.11.5/)
- [Slither detector documentation](https://github.com/crytic/slither/wiki/Detector-Documentation)
- [Solidity macOS AMD64 binary manifest](https://binaries.soliditylang.org/macosx-amd64/list.json)
- [Solidity Linux AMD64 binary manifest](https://binaries.soliditylang.org/linux-amd64/list.json)
- [fast-check 4.9.0 release](https://github.com/dubzzz/fast-check/releases/tag/v4.9.0)
- [fast-check repository](https://github.com/dubzzz/fast-check)
- [Node.js test runner](https://nodejs.org/api/test.html)
- [npm package-lock documentation](https://docs.npmjs.com/cli/v10/configuring-npm/package-lock-json)

The Slither release and PyPI metadata identify `0.11.5`; PyPI describes Slither as a Solidity/Vyper static-analysis framework and says it requires a native `solc` outside supported compilation frameworks. Solidity's Linux manifest maps `0.8.30` to commit `73712a01` and SHA-256 `f3e987dc6ecebd4bd350c48edcbc320b46cf9e3109bd3fc3d88f1acaf4c428f7`.

## Exact toolchain

Observed on the macOS ARM assurance-review host:

| Component | Version / binding |
| --- | --- |
| Node.js | `26.4.0`; repository engine remains `>=22.13.0` |
| npm used to generate/audit the lock | Corepack `10.9.2`, matching `packageManager` |
| ambient host npm also exercised | `11.17.0` |
| fast-check | `4.9.0` |
| Hardhat / EDR package | `3.10.0` |
| ethers | `6.17.0` |
| solc-js build compiler | `0.8.30` / `0.8.30+commit.73712a01.Emscripten.clang` |
| assurance Python | `3.12.13` |
| Slither | `0.11.5` |
| assurance native solc | `0.8.30+commit.73712a01.Darwin.appleclang` |
| assurance platform policy | `darwin-arm64`, official macOS AMD64 binary through proved Rosetta |

Pinned artifacts:

- complete Python lock SHA-256: `b911699b9e21ffe7b1152d5d2ada51f67bc80d17ed12ca6fc2256b28924658d9`
- macOS AMD64 solc URL: `https://binaries.soliditylang.org/macosx-amd64/solc-macosx-amd64-v0.8.30+commit.73712a01`
- macOS AMD64 solc SHA-256: `738dcdc6afddeb505ee4e4ef24f1c1fdba2b8c924e614cbbf5801a5b062dd683`
- Linux AMD64 solc URL: `https://binaries.soliditylang.org/linux-amd64/solc-linux-amd64-v0.8.30+commit.73712a01`
- Linux AMD64 solc SHA-256: `f3e987dc6ecebd4bd350c48edcbc320b46cf9e3109bd3fc3d88f1acaf4c428f7`

The build compiler and static runner import one immutable Solidity build configuration containing the exact solc-js build, native compiler commit, Shanghai EVM target, optimizer flag, and 200 optimizer runs. Compilation rejects solc-js commit drift, and analysis rejects native/configuration drift before Slither. The runner also fails before analysis on an unsupported platform, missing local installation, lock drift, compiler checksum/version drift, Slither version drift, or malformed closed configuration.

## Setup, network, and secret boundary

`npm run setup:assurance` is the only assurance command allowed to download. It creates `.venv-assurance`, installs the complete hash-locked Python graph, downloads the one allowlisted compiler to a temporary path, verifies its SHA-256 and version, and only then renames it into `.cache/contract-assurance/solc`.

`test:properties`, `analyze:contracts`, `check:assurance`, and the top-level `check` do not bootstrap, install, or download. A missing cache fails with `assurance environment is missing; run npm run setup:assurance`. The entry test injects unavailable repository-local paths and proves that failure without network access.

Every Python discovery probe and analyzer child receives a new allowlisted environment containing repository-local executable paths, deterministic locale/hash settings, and optional system certificate paths. Absolute reviewed Python 3.12 locations are tried before PATH-based names. The pip subprocess uses Python `-I`, pip `--isolated`, `--keyring-provider disabled`, and a unique empty home, XDG config directory, pip config, and netrc inside the repository cache; that disposable boundary is removed in `finally`. An existing virtual environment is version-checked before pip runs. Tests inject wallet/private-key/mnemonic/RPC/API/cloud credentials plus hostile pip/home/netrc variables and prove none reach probes or installation. The real hardened bootstrap reran successfully with Python `3.12.13`, Slither `0.11.5`, and native solc `0.8.30+commit.73712a01`. Slither JSON is written only to an operating-system temporary directory and removed on success and failure.

## Property campaigns

Every generated case takes an EVM snapshot and always reverts it, including failure paths. Fixtures deploy the compiled production contracts and use disposable unlocked local identities; no repository or frontend key is loaded.

| Campaign | Seed | Runs | Main invariant |
| --- | ---: | ---: | --- |
| Adapter authorization | `1597463007` | `32` | A sorted authorized 3-of-5 quorum executes the exact domain-bound call once. |
| Adapter atomicity | `324508639` | `24` | Independently generated 0–2-authorized/outsider mixtures, quorum-length duplicates, malformed data after a valid quorum, reordering, expiry, altered domains, and reverting targets cannot persist execution. |
| OApp execution and replay | `610839776` | `24` | Trusted zero-value actions execute once; same-GUID or same-authorization replay fails; outbound packet and event bindings are exact. |
| OApp rejection and rollback | `195948557` | `32` | Bad peer/action/target/value/payload/owner and reverting-target cases leave replay and target state unchanged. |

The adapter campaign recomputes the on-chain digest with the independently compiled coordinator implementation and varies packet, evidence, call, chain/adapter domain, expiry, ordering, signer membership, and target behavior. The OApp campaign decodes the actual `PacketSent` payload and compares GUID, EIDs, sender, receiver, authorization, target, zero value, and calldata.

Mutation evidence:

- weakening adapter quorum from `count < quorum` to `count + 1 < quorum` failed on the first generated case and shrank to a two-signature counterexample;
- weakening strict signer ordering from `recovered <= previous` to `recovered < previous` failed on the first generated case because the quorum-length repeated signer was counted twice;
- weakening OApp replay from GUID **or** authorization reuse to GUID **and** authorization reuse failed on the first generated case and shrank to a minimal same-authorization/new-GUID counterexample.

Both mutations were restored before commit and all four campaigns reran green.

## Finding triage and production hardening

The first real run exposed one High `arbitrary-send-eth`, four Medium findings (`locked-ether` and three `uninitialized-local`), two Low `reentrancy-events`, and bounded informational results. The fixes were:

- the zero-fee DVN `assignJob` hook is now nonpayable while preserving the LayerZero tuple and function selector;
- nonzero OApp action value is rejected during quote, send, and receive; the OApp no longer has a payable receive hook;
- signer-loop locals are explicitly initialized;
- adapter verification submission and OApp sending are nonreentrant;
- both production sources select Solidity `0.8.30` exactly.

Deterministic regressions were observed red before the value-bound fixes: the adapter accepted and retained job value, and the OApp quoted and sent a nonzero-value action. They pass after the fixes. The complete deterministic and property suites were rerun afterward.

## Final reviewed findings

All entries were reviewed on `2026-07-29` and expire after 366 days unless re-reviewed. Full normalized-description hashes are committed in `config/slither-allowlist.json`.

- `timestamp`, Low/Medium, `SentinelDVNAdapter.submitVerification`, bytes `2882+1070`, snippet SHA-256 `07b147416271794b66b333c2a37a8f6c296370a3104bf7761d2ca0c99e2a19b6`: timestamp is only the rejection boundary for the signed `uint64` expiry and cannot authorize a packet.
- `pragma`, Informational/High, adapter pragma, bytes `32+23`, snippet SHA-256 `7ad2aadc95e298951e2642673055ef2985c9ca7719f3ceec5c38ee1193c68ab7`: the source selects exact `0.8.30`, and both compilers are independently version-checked.
- `low-level-calls`, Informational/High, `SentinelDVNAdapter.submitVerification`, bytes `2882+1070`, snippet SHA-256 `07b147416271794b66b333c2a37a8f6c296370a3104bf7761d2ca0c99e2a19b6`: immutable target plus calldata hash, adapter, chain, GUID, evidence, and expiry are bound into the threshold-signed digest; failure rolls back.
- `missing-inheritance`, Informational/High, `SentinelDVNAdapter`, bytes `544+3410`, snippet SHA-256 `eebe6a985fcc8fffffb10edaeb63782d37db26445a1d0203f2adf0e16cd504a2`: deliberate non-inheritance makes the zero-fee selector nonpayable; exact tuple/selector compatibility and value rejection are tested.
- `assembly`, Informational/High, `TreasuryPolicyOApp._lzReceive`, bytes `2215+671`, snippet SHA-256 `7f8b6d2082ab88bea92afd34a35f6b864258fc7a362b175906850a3dd45af641`: the block only bubbles failed authorized-target returndata and cannot continue or mutate storage.
- `pragma`, Informational/High, OApp pragma, bytes `32+23`, snippet SHA-256 `7ad2aadc95e298951e2642673055ef2985c9ca7719f3ceec5c38ee1193c68ab7`: the source and build use exact `0.8.30`.
- `low-level-calls`, Informational/High, `TreasuryPolicyOApp._lzReceive`, bytes `2215+671`, snippet SHA-256 `7f8b6d2082ab88bea92afd34a35f6b864258fc7a362b175906850a3dd45af641`: LayerZero peer authentication, owner target authorization, zero-value enforcement, dual replay gates, and nonreentrancy bound the call; failure rolls back.

There are no detector-name, path-pattern, dependency-pattern, or severity-wide suppressions. Slither `0.11.5` still returned dependency-only detector records despite `--exclude-dependencies`: High `1` (`incorrect-exp`), Medium `9` (`divide-before-multiply`), Low `0`, and Informational `58`, covering `166` dependency elements. It also returned `3` mixed findings. Rejecting any dependency record would therefore make the pinned production-target command permanently fail, while `--filter-paths node_modules` was separately observed to hide a mixed production `locked-ether` finding. The implemented boundary validates the complete closed shape and canonical repository path of every dependency element, reports all excluded dependency-only severity counts and detector IDs, and retains every production element from mixed findings. Production-source High/Medium enforcement remains fail-closed. Dependency risk is additionally bounded by the separate production npm audit below; these counts are not presented as a source audit of third-party packages.

## ABI and bytecode review

Baseline is commit `7fcbf98` immediately before production hardening. Both builds used current pinned solc-js, Shanghai, optimizer enabled, and 200 runs.

| Artifact | Baseline ABI SHA-256 | Current ABI SHA-256 | Baseline creation-bytecode hex-text SHA-256 | Current creation-bytecode hex-text SHA-256 |
| --- | --- | --- | --- | --- |
| SentinelDVNAdapter | `8029f87bf8d901dce921c90e5bb7e4017f25ff5cbcd2db4fcf331037b98f1e27` | `f3a6163f13ae5675658c6c091b49109bdb72c72d35a343445f09bde0b98d7169` | `1f678790c6fec74c718c154e917c48d25ba8e9debc2f2fce95be7463d16a0526` | `1105b4367563f430ef0e275c740d5e069ba8b3ab62e1c5824f3a9703f8637b4c` |
| TreasuryPolicyOApp | `76e5b858b16c2155bbbd4720c01c94dd572ddfb8bc0722e522468873d908ea60` | `9611c7180c9df9b5188f4e6f9e388ed17af2ff736c1054e1567c65590336132e` | `07dd7e3f631ea72efe5183c2276f2d49851e64bc5b554c87e73dfb0c014e6db8` | `a94a35067c8275c72d5dac8390ed23dbcc959c648bcb415727fa4a7dcd59c370` |

The adapter's only callable-function ABI change is `assignJob` mutability from payable to nonpayable; its selector and tuple are unchanged. `ReentrancyGuardReentrantCall` is an additive error. The OApp removed only its catch-all payable `receive` ABI item; no named function, event, or error signature changed. `Action.value` remains encoded for packet compatibility but is required to be zero. Bytecode changes are expected from those value bounds, exact pragmas, explicit initialization, quote validation, and reentrancy guards.

Whole generated artifact SHA-256 changed from `2dec439726756f27f221dbb5877e8854484d323af317e78841ba7d5bfa0610c3` to `f76bf146baf4ad70c75ac219cba43f05c9f293b53d664e82bc71c6626acd9097` for the adapter, and from `9be42d4e62f946ea05fbf43869b3127a08608ac29b511e09ad2414148fb10e0e` to `f86abbdb59c398e0df5b5e7494b9bce25486f97fc9ec78a087e734646462165a` for the OApp.

The creation-bytecode values above hash the lowercase hexadecimal artifact string as UTF-8 text, without a `0x` prefix; they are not hashes of decoded byte arrays.

## Dependency evidence

Using Corepack npm `10.9.2` on 2026-07-29:

- `npm ls --depth=0`: exits zero with the exact top-level graph;
- `npm audit --omit=dev`: `0 vulnerabilities`;
- complete `npm audit`: `19 vulnerabilities` — 13 low, 2 moderate, 4 high, 0 critical.

The development findings remain under Hardhat through `adm-zip`, solc-js through `tmp`, and LayerZero's development-only ethers 5 graph through `elliptic` and `ws`. Registry output identifies GHSA advisories `GHSA-xcpc-8h2w-3j85`, `GHSA-848j-6mx2-7j84`, `GHSA-52f5-9888-hmc6`, `GHSA-ph9p-34f9-6g65`, `GHSA-58qx-3vcg-4xpx`, and `GHSA-96hv-2xvq-fx4p`. Proposed forced remediations include incompatible Hardhat `0.0.7` and solc `0.5.0`; no audit fix was run.

## Fresh command evidence

The complete `npm run check` result on 2026-07-29:

- strict TypeScript: pass;
- pinned official GenVM lint: pass;
- direct Intelligent Contract tests: `24` pass;
- ordinary Node tests: `323` pass;
- fixed-seed contract property campaigns: `4` pass;
- Slither: High `0`, Medium `0`, reviewed Low `1`, reviewed Informational `6`;
- total executable test cases: `351`, with zero failures, skips, or todos.

The relevant commands are:

```bash
npm run setup:assurance
npm run test:properties
npm run analyze:contracts
npm run check:assurance
npm run check
```

Only setup may use the network. Property tests use loopback EDR; static analysis uses local source and a local native compiler.

## Remaining limits

Generated cases are bounded by four named generators, four fixed seeds, 112 total runs, and their current arbitraries. Shrinking demonstrates counterexamples but does not enumerate the full state space. Slither is detector-based static analysis and can miss defects or report bounded intentional behavior.

The gate does not test a real EndpointV2, ULN302 receive library, deployed bytecode, public RPC, real signer infrastructure, GenLayer Studio/Bradbury validators, live finality, appeals, web-render reproducibility, governance-source authenticity, gas economics, mainnet conditions, or operator independence. External audit, formal verification, live directional testnet conformance, production PKI/HSM custody, monitoring, and independent failure domains remain required.
