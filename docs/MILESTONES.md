# Milestones

- M0 (this repository): audited architecture, state machine, policy record IC, adapter/OApp contracts, quorum abstraction, fixture-based tests, honest dashboard shell.
- M1 (in progress): pinned LayerZero compilation, canonical PacketV1 verification, strict treasury-action request assembly, local adapter/OApp lifecycle, fixture-tested GenLayerJS finality, signer quorum, destination submission, acknowledged at-least-once event ingestion, durable SQLite listener/job/request-binding recovery, bounded poison-packet quarantine and safe local requeue, supervised runtime composition and read-only live packet/quarantine inspector complete; approved GenLayer account-provider construction, real ULN302 and GenLayer Studio/direct-mode tests remain.
- M2: user-approved funded one-way Sepolia → Arbitrum Sepolia deployment, independent DVN config, live event ingestion, real finalized GenLayer read.
- M3: five isolated signer processes across distinct operators/failure domains, 3-of-5 quorum, monitoring, runbooks, adversarial E2E.
- M4: LayerZero/GenLayer confirmations resolved, external audit, design partner pilot. Mainnet is a separate decision.
