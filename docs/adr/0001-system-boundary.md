# ADR 0001: Sentinel system boundary

Status: accepted for testnet prototype, 2026-07-21.

Sentinel is a new clean-room product. It has no dependency on, reference to, shared configuration with, or operational relationship to Merit/genlayer-escrow. The first pathway is Ethereum Sepolia (EID 40161) to Arbitrum Sepolia (EID 40231), bidirectional only after the one-way slice passes.

## Decision

Use LayerZero ULN302 with Sentinel configured as an additional/optional DVN beside independent DVNs. Deterministic verification proves the canonical packet, source inclusion, payload hash, configured pathway, confirmations, and replay state. A GenLayer Intelligent Contract independently fetches authoritative governance evidence and reaches semantic consensus on whether the decoded treasury action is authorized. Isolated signers sign only a finalized `ALLOW` decision whose evidence and packet digests match. The destination DVN adapter records the verification; the OApp remains subject to LayerZero's configured security stack.

Gasolina's documented extra-context hook returns only a boolean and has no documented pending/retry contract. Therefore the initial vertical slice uses an explicit coordinator state machine and does not claim native Gasolina integration. Adapter onboarding and production DVN registration remain external prerequisites.

## Invariants

One GUID maps to one immutable packet digest. No signature before GenLayer finality. Fail closed on RPC disagreement, stale evidence, undecodable action, policy mismatch, signer mismatch, or expired authorization. A decision cannot bypass independent LayerZero DVNs.
