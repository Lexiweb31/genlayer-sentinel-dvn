# Contract test status

The contracts compile with Sentinel's pinned solc script against the exact LayerZero/OZ versions in `package.json`. Hardhat `3.10.0` is used only as a local EDR execution server configured for chain ID `31337` and Shanghai; it is not the compiler or a deployment framework. Each test fixture starts a loopback server on an operating-system-selected port and uses disposable unlocked test identities without storing private keys.

The deployed-adapter tests cover sorted quorum signatures, insufficient quorum, replay rejection, target-call success and atomic rollback on target failure. The deployed-OApp tests cover quote/send, `PacketSent` decoding, trusted-peer delivery and execution, replay rejection, untrusted-peer rejection and unauthorized-target rejection. OpenZeppelin ECDSA rejects malformed/high-s signatures. These EDR tests validate Solidity/OApp/adapter behavior only.

`intelligent-contract/tests` separately executes `SentinelPolicy` with pinned `genlayer-test` direct mode, strict web/LLM mocks, pickling checks and controlled validator re-execution. That evidence is neither a Solidity test nor live GenLayer consensus.

Still required before testnet deployment: conformance against a real LayerZero EndpointV2 and ULN302 receive-library calldata, fuzz/property testing, Solidity static analysis, Studio/Bradbury multi-validator testing, live GenLayer finality validation and an independent review. `MockEndpointV2` is a behavioral fixture, not a model of LayerZero's security. No audit is claimed.
