# Dependency and advisory audit — 2026-07-22

Status: registry metadata audited; no package changed; no automated remediation run.

## Published-version comparison

Exact versions remain mandatory. Registry `latest` is evidence for triage, not permission to upgrade.

| Package | Pinned | Registry latest | Decision |
|---|---:|---:|---|
| `@layerzerolabs/lz-evm-protocol-v2` | `3.0.168` | `3.0.168` | Current; retain. |
| `@layerzerolabs/lz-evm-messagelib-v2` | `3.0.168` | `3.0.168` | Current and aligned with protocol; retain. |
| `@layerzerolabs/lz-evm-v1-0.7` | `3.0.168` | `3.0.168` | Current transitive peer for the official packages; retain as development-only. |
| `@layerzerolabs/oapp-evm` | `0.4.1` | `0.4.1` | Current; its peer range accepts LayerZero `3.0.168`. |
| `genlayer-js` | `1.1.8` | `1.1.8` | Current; retain pending live API compatibility tests and upstream packaging cleanup. |
| `ethers` | `6.17.0` | `6.17.0` | Current runtime dependency; retain. |
| `@openzeppelin/contracts` | `5.4.0` | `5.6.1` | Upgrade candidate, not automatic; requires contract diff/compile/local-EVM review. |
| `@openzeppelin/contracts-upgradeable` | `5.4.0` | `5.6.1` | Kept aligned with Contracts; currently only an official LayerZero peer. |
| `solc` | `0.8.30` | `0.8.36` | Upgrade candidate; compiler output and EVM target need an explicit reproducibility review. |
| `typescript` | `5.8.3` | `7.0.2` | Major upgrade deferred; not needed for protocol behavior. |

The official LayerZero package manifests accept OpenZeppelin `^4.8.1 || ^5.0.0`; `oapp-evm@0.4.1` accepts LayerZero packages `^3.0.148`, so the current pins are peer-compatible. The compiler targets Shanghai explicitly even though the installed Solidity compiler is newer than the contracts' minimum pragmas.

## Advisory evidence

`npm audit --omit=dev --json` returned zero production vulnerabilities across 154 production dependency nodes. The full `npm audit --json` returned 22 advisory nodes: 12 low, 3 moderate, 6 high and 1 critical.

The affected full-tree paths are development/build paths:

- `ganache@7.9.2` and its bundled/transitive `elliptic`, `secp256k1`, `ws`, `lodash`, `bn.js` and uWS packages. Ganache's official repository is archived and read-only.
- `solc@0.8.30` → `tmp@0.0.33`, flagged for unsafe temporary-path handling.
- `@layerzerolabs/oapp-evm@0.4.1` → ethers 5 packages, which appear only because the official OApp package is a development dependency. Sentinel's direct runtime ethers is 6.17.0.

The registry's automated `fixAvailable` suggestions are not safe migrations: it proposes Ganache 6.4.5 and solc 0.5.0, both incompatible downgrades. No `npm audit fix` was run.

## Dependency-integrity finding

`npm ls --omit=dev --depth=2` fails with `ELSPROBLEMS` because `genlayer-js@1.1.8` lists `eslint-plugin-import` under production `dependencies`, and that plugin requires an `eslint` peer which is not installed. This condition existed when GenLayerJS was introduced; the 2026-07-22 documentation changes did not create it.

Sentinel does not import or execute the lint plugin. Adding ESLint merely to make `npm ls` green would retain unnecessary runtime surface and hide the source problem. Safe options for a separately designed milestone are:

1. Prefer an upstream `genlayer-js` release that moves lint tooling to development dependencies.
2. Replace the small runtime SDK boundary with an audited JSON-RPC/ABI client while retaining GenLayerJS only for development if needed.
3. As a temporary build-only measure, produce a pruned runtime artifact and verify its exact allowlist; do not mutate upstream package contents in `node_modules`.

## Upgrade gates

- Do not upgrade OpenZeppelin, solc or TypeScript solely because a newer version exists.
- Replace archived Ganache with a maintained local EVM runner before public/untrusted CI; Foundry Anvil is a candidate, not yet selected or installed.
- Keep all Solidity input paths fixed and reviewed until the vulnerable compiler wrapper is replaced or isolated.
- A dependency change must regenerate the lock, run `npm ls`, both advisory audits, `npm run check`, bytecode/ABI comparison and the two local contract lifecycle tests.
- Live deployment additionally requires official LayerZero package/address compatibility and GenLayer target-network testing; registry currency alone proves neither.

## Primary package sources

- [LayerZero V2 protocol package](https://www.npmjs.com/package/@layerzerolabs/lz-evm-protocol-v2)
- [LayerZero V2 message library package](https://www.npmjs.com/package/@layerzerolabs/lz-evm-messagelib-v2)
- [LayerZero OApp EVM package](https://www.npmjs.com/package/@layerzerolabs/oapp-evm)
- [GenLayerJS package](https://www.npmjs.com/package/genlayer-js)
- [ethers package](https://www.npmjs.com/package/ethers)
- [OpenZeppelin Contracts package](https://www.npmjs.com/package/@openzeppelin/contracts)
- [solc package](https://www.npmjs.com/package/solc)
- [TypeScript package](https://www.npmjs.com/package/typescript)
- [Archived Ganache repository](https://github.com/trufflesuite/ganache)
- [Foundry repository (Anvil candidate)](https://github.com/foundry-rs/foundry)
