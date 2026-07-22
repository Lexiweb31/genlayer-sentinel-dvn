# Hardhat EDR Contract Runner Design

**Status:** Approved for local implementation  
**Date:** 2026-07-22

## Objective

Replace the archived Ganache development dependency with a maintained, repository-pinned local EVM for Sentinel's Solidity integration tests. The replacement must preserve the existing contract behavior, explicit chain configuration, parallel-test isolation and deterministic compilation while removing Ganache's native-module fallback warnings and bundled legacy dependency tree.

This milestone changes local test infrastructure only. It does not change contract source, ABIs, bytecode, deployment scripts, LayerZero configuration, GenLayer integration, production runtime behavior or testnet readiness.

## Selected Boundary

Sentinel will use Hardhat `3.10.0` only through its documented programmatic Network Manager server API:

1. `hardhat.config.ts` declares one `edr-simulated` L1 network named `sentinelTest`, chain ID `31337`, the `shanghai` hardfork and disabled node logging.
2. `contracts/test/local-evm.js` starts that network as an HTTP JSON-RPC server bound to `127.0.0.1` on an operating-system-selected port.
3. The helper returns an ethers `JsonRpcProvider`, the requested unlocked `JsonRpcSigner` instances and an idempotent cleanup function.
4. Every contract fixture registers cleanup with Node's test context before deploying contracts.
5. Contract artifacts continue to come exclusively from Sentinel's existing `solc@0.8.30` compiler script.

Hardhat is therefore an ephemeral local execution engine, not Sentinel's compiler, task framework, deployer, account-custody layer or production dependency.

## Alternatives Considered

### Foundry Anvil subprocess

Anvil is a maintained, high-quality local node and remains a credible future CI option. It is not installed in the current environment, however, and would introduce a separately installed binary, subprocess supervision and platform-specific installation/integrity work. That is unnecessary for this focused replacement.

### Direct EthereumJS VM or custom EIP-1193 provider

A pure JavaScript VM could remain in-process, but Sentinel would need to own account setup, JSON-RPC/EIP-1193 adaptation, transaction routing and lifecycle behavior. That creates more test infrastructure than the contracts require and makes the harness itself a larger security-review target.

### Selected Hardhat 3 EDR server

Hardhat is pinned through npm, supports the project's Node `>=22.13.0` floor, exposes a documented programmatic server lifecycle and uses a maintained EDR simulated network. An HTTP boundary also exercises the same ethers JSON-RPC behavior used by real node integrations without requiring a global executable.

## Network and Lifecycle Model

The test network is explicitly configured as:

- network type: `edr-simulated`;
- chain type: `l1`;
- chain ID: `31337`;
- hardfork: `shanghai`;
- mining: automatic, with default interval behavior;
- logging: disabled;
- bind address: `127.0.0.1` only;
- port: `0`, allowing the operating system to allocate an unused port.

Tests use Hardhat's ephemeral default funded accounts only through unlocked JSON-RPC signers. No mnemonic or private key is copied into repository source. The accounts are test identities, are recreated with the disposable node and must never be described as secure custody.

The helper registers cleanup immediately after startup. Cleanup destroys the ethers provider, closes the Hardhat server and waits for its closed state. It is safe to call more than once, so setup failures and Node test teardown cannot leave a listening process behind. Random ports allow Node to run contract test files concurrently without port collisions or shared-chain state.

## Test Migration

The first red-green cycle adds a focused harness test that expects:

- the reported chain ID to equal `31337`;
- at least eight funded, unlocked signers;
- distinct signer addresses;
- `signMessage` to recover the expected signer; and
- a second cleanup call to remain harmless.

That test must initially fail because `contracts/test/local-evm.js` does not exist. The minimal helper and Hardhat configuration are then added.

The adapter fixture will replace Ganache's private-key extraction and ethers `Wallet` objects with unlocked `JsonRpcSigner` instances. Signers are sorted by resolved address before producing quorum signatures, preserving the adapter's strict ordered-signer requirement without exposing raw keys.

The OApp fixture will use the same helper and signers while preserving its real contract deployment, quote, `PacketSent`, trusted-peer delivery, replay and unauthorized-target assertions. These remain integration tests against deployed bytecode rather than mocks.

## Dependency and Artifact Controls

- Replace `ganache@7.9.2` with exact `hardhat@3.10.0` in `devDependencies`.
- Keep `ethers@6.17.0` as the only production dependency.
- Keep `solc@0.8.30` and the current `scripts/compile-contracts.mjs` path as the sole compiler boundary.
- Normalize `package-lock.json` with the repository-declared `npm@10.9.2`.
- Capture Solidity artifact hashes before the migration and require byte-for-byte identical ABI and bytecode artifact output afterward.
- Run production-only and full dependency audits after installation. Results must be documented rather than inferred from Ganache's removal.

The version advances to `0.21.0` because the repository gains a maintained, reproducible contract-test runtime without changing the product protocol.

## Failure Semantics

- Failure to start the test server fails the relevant test; there is no fallback to Ganache or an externally running node.
- Failure to obtain the requested signers or a chain-ID mismatch fails before contract deployment.
- Cleanup failures are surfaced by Node's test runner and are not silently swallowed.
- Hardhat node logs remain disabled during success; warnings or errors in test output are treated as verification failures.
- If the pinned Hardhat tree introduces an unacceptable new production dependency, changes Solidity artifacts or cannot pass the existing contract tests under Shanghai, the migration is rejected rather than weakening the checks.

## Documentation Effects

`contracts/test/README.md` will state that OApp send/receive behavior is covered by the local integration harness and retain the still-open EndpointV2, ULN302, fuzzing, static-analysis, live GenLayer and independent-review gaps. The root README, milestone status, security status and dependency audit will identify Hardhat as test-only and will not claim a production audit, testnet deployment or live compatibility.

## Acceptance Criteria

1. No production or test source imports `ganache`, and `npm ls ganache` is empty.
2. The new harness test proves chain configuration, unlocked signing and idempotent teardown.
3. Both existing contract suites pass through real deployed contracts on the Hardhat EDR JSON-RPC server.
4. The full `npm run check` suite passes with clean output apart from explicitly understood compiler informational output.
5. Production dependencies remain limited to ethers and have zero audit advisories.
6. Full dependency-audit results are captured honestly.
7. Solidity ABI and bytecode artifacts are byte-for-byte unchanged.
8. No deployment, funding, cloud resource or GitHub publication occurs.

## Non-Goals

- No contract-source, protocol or threshold-policy changes.
- No adoption of Hardhat compilation, plugins, deployment tasks or network configuration for testnets.
- No private-key fixture, production wallet or signer custody.
- No replacement for an EndpointV2/ULN302 conformance fixture.
- No claim of mainnet readiness, testnet deployment, live LayerZero verification or live GenLayer consensus.
