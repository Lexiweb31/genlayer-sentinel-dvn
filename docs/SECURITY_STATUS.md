# Security verification status — 2026-07-21

`npm run check` compiles three Solidity sources with solc 0.8.30 (Shanghai target), strictly type-checks TypeScript, and runs seven tests. Covered invariants include two distinct agreeing RPC providers, source receipt success, configured EndpointV2 `PacketSent`, block identity, confirmation depth, encoded-payload binding, no signing before finalized allow, GUID idempotency, signer quorum/order, execution-domain binding, target failure rollback and replay rejection.

Not covered: canonical LayerZero packet-field decoding from `encodedPayload`, real EndpointV2/ULN302 calls, OApp cross-chain execution, reorg polling, GenLayer SDK/direct-mode compatibility, finalized-state RPC semantics, durable coordinator storage, authenticated signer transport, key custody, five failure domains, fuzzing, static analysis, formal verification or third-party audit.

The installed development tree reports advisories inherited primarily through Ganache and LayerZero build-time tooling. These packages are not runtime coordinator dependencies; `npm ls --omit=dev` contains only ethers 6.17.0 and its runtime tree. This distinction does not waive the findings: replace or isolate affected test tooling before CI handles untrusted artifacts, and rerun audits whenever locks change.
