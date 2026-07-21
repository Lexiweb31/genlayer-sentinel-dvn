# External confirmation register

| Question | Owner | Current safe behavior |
|---|---|---|
| Does Gasolina retry an extra-context request that is pending, and what response triggers it? | LayerZero | Do not wire async GenLayer decisions into the boolean hook. |
| What onboarding/VID/address publication steps apply to a new testnet DVN? | LayerZero | Treat adapter as local/prototype only. |
| Which exact ULN302 receive libraries and independent DVNs should be used on this pathway today? | LayerZero | Re-audit immediately before deployment; no defaults. |
| What canonical RPC/API field proves a GenLayer transaction is beyond its appeal window? | GenLayer | Sign only after an adapter implementation explicitly returns `FINALIZED`; mock is test-only. |
| Are external web responses pinned/reproducible across GenLayer validators for the chosen governance endpoint? | GenLayer | Digest evidence and fail closed on disagreement/staleness. |
| Are 15/64 confirmations appropriate for the production candidate? | Security review | Values are placeholders, never production claims. |
