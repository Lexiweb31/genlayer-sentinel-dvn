# Contract test status

The contracts compile against exact LayerZero/OZ versions in `package.json`. Local-EVM tests cover sorted quorum signatures, insufficient quorum, replay rejection, target-call success, and atomic rollback on target failure. OpenZeppelin ECDSA rejects malformed/high-s signatures.

Still required before testnet deployment: an EndpointV2 integration harness, ULN302 receive-library calldata fixture, OApp send/receive tests, fuzz/property testing, static analysis, GenLayer direct-mode tests, and an independent review. No audit is claimed.
