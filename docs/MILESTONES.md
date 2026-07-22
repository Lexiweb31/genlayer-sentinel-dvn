# Milestones

- M0 (this repository): audited architecture, state machine, policy record IC, adapter/OApp contracts, quorum abstraction, fixture-based tests, honest dashboard shell.
- M1 (in progress): pinned LayerZero compilation, canonical PacketV1 verification, strict treasury-action request assembly, local adapter/OApp lifecycle, fixture-tested GenLayerJS finality, authenticated/replay-resistant remote signer protocol, signer quorum, crash-safe destination outbox with independent receipt/event confirmation, acknowledged at-least-once event ingestion, durable SQLite recovery, supervised runtime composition and read-only packet/quarantine/delivery inspector complete; approved GenLayer and destination account-provider construction, production mutual TLS, real five-operator signers, ULN302 and GenLayer Studio/direct-mode tests remain.
- M2: user-approved funded one-way Sepolia → Arbitrum Sepolia deployment, independent DVN config, live event ingestion, real finalized GenLayer read.
- M3: five isolated signer processes across distinct operators/failure domains, 3-of-5 quorum, monitoring, runbooks, adversarial E2E.
- M4: LayerZero/GenLayer confirmations resolved, external audit, design partner pilot. Mainnet is a separate decision.
