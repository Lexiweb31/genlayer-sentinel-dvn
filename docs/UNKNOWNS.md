# External confirmation register

| Question | Owner | Current safe behavior |
|---|---|---|
| Does Essence retry a failed or unavailable extra-context request, at what cadence/backoff, and can anything other than a bare boolean represent pending? | LayerZero | The documented hook is synchronous boolean-only and Essence owns submission/retry; keep async GenLayer decisions in Sentinel's explicit coordinator. |
| Will LayerZero onboard this testnet DVN, what authenticated ingress/caller contract is required, and what VID will its deployed contracts use? | LayerZero | The documented sequence is URL handoff → `/signer-info` → LayerZero DVN deployment/address return. Treat the adapter as local until LayerZero accepts the integration and returns addresses. |
| Which independent operators and exact directional ULN302 configuration should protect the Sepolia → Arbitrum Sepolia OApps at deployment time? | LayerZero + security review | Protocol libraries and active provider listings were audited on 2026-07-22; do not infer resolved pathway defaults. Query both sides, select diverse providers, sort addresses, reject Dead DVNs and pin matching confirmations. |
| Does SentinelPolicy execute unchanged in the current GenVM direct-mode runtime and produce stable rendered-text SHA-256 across validator configurations? | GenLayer | The finality RPC is documented, but the Intelligent Contract still needs direct-mode and validator-variance tests before signing is enabled. |
| Are external web responses pinned/reproducible across GenLayer validators for the chosen governance endpoint? | GenLayer | Digest evidence and fail closed on disagreement/staleness. |
| Are 15/64 confirmations appropriate for the production candidate? | Security review | Values are placeholders, never production claims. |
