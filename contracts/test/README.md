# Contract test status

The contracts compile with Sentinel's pinned solc script against the exact LayerZero/OZ versions in `package.json`. Hardhat `3.10.0` is used only as a local EDR execution server configured for chain ID `31337` and Shanghai; it is not the compiler or a deployment framework. Each test fixture starts a loopback server on an operating-system-selected port and uses disposable unlocked test identities without storing private keys.

The deterministic deployed-adapter tests cover sorted quorum signatures, insufficient quorum, replay rejection, target-call success, atomic rollback on target failure, and rejection of native value at the zero-fee job hook. The deployed-OApp tests cover quote/send, `PacketSent` decoding, trusted-peer delivery and execution, replay rejection, untrusted-peer rejection, unauthorized-target rejection, and quote/send rejection for nonzero action value. OpenZeppelin ECDSA rejects malformed/high-s signatures. These EDR tests validate Solidity/OApp/adapter behavior only.

`contracts/assurance` adds four generated-input campaigns with EVM snapshot isolation:

- adapter authorization — seed `1597463007`, 32 runs;
- adapter atomicity — seed `324508639`, 24 runs;
- OApp execution/replay — seed `610839776`, 24 runs;
- OApp rejection/rollback — seed `195948557`, 32 runs.

The campaigns deploy the compiled production contracts, use real ECDSA shares, independently recompute the adapter digest, decode actual fixture `PacketSent` bytes, and cover threshold, signer ordering/membership, replay, expiry, domain, packet/evidence/call, peer, target, zero-value and rollback invariants. Deliberately weakened quorum and replay predicates were each caught on the first generated case and shrank to minimal counterexamples.

`npm run analyze:contracts` separately runs repository-local Slither `0.11.5` with a checksum-pinned native solc `0.8.30` over the adapter and OApp. The closed finding gate rejects every High/Medium result and every Low/Informational result that does not match one reviewed source-bound fingerprint. The current accepted result is High `0`, Medium `0`, Low `1`, Informational `6`.

`intelligent-contract/tests` separately executes `SentinelPolicy` with pinned `genlayer-test` direct mode, strict web/LLM mocks, pickling checks and controlled validator re-execution. That evidence is neither a Solidity test nor live GenLayer consensus.

Still required before testnet deployment: conformance against a real LayerZero EndpointV2 and ULN302 receive-library calldata, broader sequence/invariant fuzzing, formal verification, Studio/Bradbury multi-validator testing, live GenLayer finality validation and an independent third-party audit. The fixed 112 generated runs and detector-based static pass do not exhaust state space or prove deployed behavior. `MockEndpointV2` is a behavioral fixture, not a model of LayerZero's security. Exact evidence and limits are in [`../../docs/research/2026-07-29-contract-assurance-audit.md`](../../docs/research/2026-07-29-contract-assurance-audit.md).
