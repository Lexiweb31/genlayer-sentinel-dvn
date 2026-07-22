# Dependency and advisory audit — 2026-07-22

Status: registry metadata audited; GenLayerJS removed from the runtime boundary; archived Ganache replaced by an exact test-only Hardhat EDR runner; no automated advisory remediation run.

## Published-version comparison

Exact versions remain mandatory. Registry `latest` is evidence for triage, not permission to upgrade.

| Package | Pinned | Registry latest | Decision |
|---|---:|---:|---|
| `@layerzerolabs/lz-evm-protocol-v2` | `3.0.168` | `3.0.168` | Current; retain. |
| `@layerzerolabs/lz-evm-messagelib-v2` | `3.0.168` | `3.0.168` | Current and aligned with protocol; retain. |
| `@layerzerolabs/lz-evm-v1-0.7` | `3.0.168` | `3.0.168` | Current transitive peer for the official packages; retain as development-only. |
| `@layerzerolabs/oapp-evm` | `0.4.1` | `0.4.1` | Current; its peer range accepts LayerZero `3.0.168`. |
| `genlayer-js` | removed | `1.1.8` | Removed from Sentinel runtime; direct status JSON-RPC plus a structural account-aware adapter replaced the enum-only import. |
| `ganache` | removed | `7.9.2` | Archived runner removed from tests and lockfile. |
| `hardhat` | `3.10.0` | `3.10.0` | Exact development-only EDR runner; not used to compile, deploy or serve production traffic. |
| `ethers` | `6.17.0` | `6.17.0` | Current runtime dependency; retain. |
| `@openzeppelin/contracts` | `5.4.0` | `5.6.1` | Upgrade candidate, not automatic; requires contract diff/compile/local-EVM review. |
| `@openzeppelin/contracts-upgradeable` | `5.4.0` | `5.6.1` | Kept aligned with Contracts; currently only an official LayerZero peer. |
| `solc` | `0.8.30` | `0.8.36` | Upgrade candidate; compiler output and EVM target need an explicit reproducibility review. |
| `typescript` | `5.8.3` | `7.0.2` | Major upgrade deferred; not needed for protocol behavior. |

The official LayerZero package manifests accept OpenZeppelin `^4.8.1 || ^5.0.0`; `oapp-evm@0.4.1` accepts LayerZero packages `^3.0.148`, so the current pins are peer-compatible. The compiler targets Shanghai explicitly even though the installed Solidity compiler is newer than the contracts' minimum pragmas.

## Advisory evidence

`npm audit --omit=dev --json` returned zero production vulnerabilities across ten production dependency nodes. The full normalized tree retains 19 advisory nodes: 13 low, 2 moderate, 4 high and 0 critical. Audit metadata reports 152 total dependency nodes, including 143 development and 34 optional nodes; those categories overlap in npm's metadata and are not summed.

The affected full-tree paths are development/build paths:

- `hardhat@3.10.0` → `adm-zip@0.4.16`, flagged for a crafted-ZIP memory-exhaustion path. Sentinel uses Hardhat only to start a loopback EDR server over reviewed local artifacts; it does not treat that scope restriction as remediation.
- `solc@0.8.30` → `tmp@0.0.33`, flagged for unsafe temporary-path handling.
- `@layerzerolabs/oapp-evm@0.4.1` → ethers 5 packages including advisory paths through `elliptic` and `ws`. They appear only because the official OApp package is a development dependency. Sentinel's direct runtime ethers is 6.17.0.

The registry's automated `fixAvailable` suggestions are not safe migrations: it proposes Hardhat 0.0.7 and solc 0.5.0, both incompatible downgrades. No `npm audit fix` was run.

## Dependency-integrity finding

The prior `ELSPROBLEMS` condition is resolved. `genlayer-js@1.1.8` had published `eslint-plugin-import` as a production dependency with an unmet ESLint peer, while Sentinel imported only its transaction-status and execution-result enums. Version 0.20.0 removed that package, validates the documented `gen_getTransactionStatus` protocol locally, and represents execution results with a Sentinel-owned structural type. Version 0.21.0 removes Ganache and uses Hardhat only through its programmatic local JSON-RPC server. `npm ls --omit=dev --depth=2` exits zero.

This is not a custom custody implementation. Account-aware write, execution lookup and finalized contract-read behavior remain injected, so a separately approved adapter may wrap an official GenLayer SDK without pulling its packaging surface into the coordinator core. No live compatibility claim follows from the clean dependency tree.

The lockfile is pinned to npm 10.9.2. During the earlier audit, npm 11.17 expanded Ganache's bundled development dependencies without preserving their development classification. Ganache and that bundled-metadata surface are now absent. The version 0.21.0 lock was regenerated with npm 10.9.2 and independently yields the zero-advisory ten-node production audit. The full audit still reports every test/build finding above.

Hardhat does not replace Sentinel's compiler. `npm run check` still invokes `scripts/compile-contracts.mjs` with exact solc `0.8.30` and Shanghai output. SHA-256 hashes of all five regenerated JSON artifacts are identical to `main`, and no Solidity source changed in this milestone.

| Generated artifact | SHA-256 on `main` and version 0.21.0 branch |
|---|---|
| `ActionTarget.json` | `19fb6d7d05f156a149bdd7a85a8c6f409e1d4cf4ac2095d83b113e32b72b3c8c` |
| `MockEndpointV2.json` | `879fbecc887d4e1b9db4dce25235da515bba9df2e30139a517c2c0a9c69b809c` |
| `MockVerificationTarget.json` | `3a7b8f891183a00fee96206dd878ef81a51ec15324e793692b006174b3c4f159` |
| `SentinelDVNAdapter.json` | `2dec439726756f27f221dbb5877e8854484d323af317e78841ba7d5bfa0610c3` |
| `TreasuryPolicyOApp.json` | `9be42d4e62f946ea05fbf43869b3127a08608ac29b511e09ad2414148fb10e0e` |

## Upgrade gates

- Do not upgrade OpenZeppelin, solc or TypeScript solely because a newer version exists.
- Keep Hardhat restricted to the loopback test harness and reviewed local artifacts; reassess or replace it if the `adm-zip` advisory is not resolved upstream before public/untrusted CI.
- Keep all Solidity input paths fixed and reviewed until the vulnerable compiler wrapper is replaced or isolated.
- A dependency change must regenerate the lock, run `npm ls`, both advisory audits, `npm run check`, bytecode/ABI comparison and all local contract lifecycle tests.
- Regenerate `package-lock.json` with npm 10.9.2; review any package-manager-driven bundled dependency expansion before accepting it.
- Live deployment additionally requires official LayerZero package/address compatibility and GenLayer target-network testing; registry currency alone proves neither.

## Primary package sources

- [LayerZero V2 protocol package](https://www.npmjs.com/package/@layerzerolabs/lz-evm-protocol-v2)
- [LayerZero V2 message library package](https://www.npmjs.com/package/@layerzerolabs/lz-evm-messagelib-v2)
- [LayerZero OApp EVM package](https://www.npmjs.com/package/@layerzerolabs/oapp-evm)
- [GenLayerJS package](https://www.npmjs.com/package/genlayer-js)
- [Hardhat package](https://www.npmjs.com/package/hardhat)
- [Hardhat programmatic node guide](https://hardhat.org/docs/guides/hardhat-node)
- [ethers package](https://www.npmjs.com/package/ethers)
- [OpenZeppelin Contracts package](https://www.npmjs.com/package/@openzeppelin/contracts)
- [solc package](https://www.npmjs.com/package/solc)
- [TypeScript package](https://www.npmjs.com/package/typescript)
- [Archived Ganache repository](https://github.com/trufflesuite/ganache)
