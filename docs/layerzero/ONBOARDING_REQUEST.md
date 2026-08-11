# GenLayer Sentinel — LayerZero DVN testnet integration request

## Request summary

GenLayer Sentinel is a clean-room, open-source testnet prototype for a policy firewall on high-value cross-chain treasury/governance messages. It performs deterministic packet checks independently, waits for a GenLayer policy decision to finalize, then seeks a threshold of isolated signer approvals. It is **not** presented as production-ready or as a sole required verifier.

We request the current official testnet onboarding guidance for a candidate DVN/adaptor on the one directional prototype pathway:

| Field | Proposed scope |
| --- | --- |
| Source | Ethereum Sepolia — EID `40161`, chain ID `11155111` |
| Destination | Arbitrum Sepolia — EID `40231`, chain ID `421614` |
| Direction | Ethereum Sepolia → Arbitrum Sepolia only; no reverse path is implied. |
| Initial security posture | Sentinel as an additional/optional verifier beside independently operated LayerZero DVNs; never the sole verifier. |
| Signer target | Intended 3-of-5 isolated operator architecture. No live operator set is claimed. |
| Repository | <https://github.com/Lexiweb31/genlayer-sentinel-dvn> |
| Console | <https://genlayer-sentinel-console.damilexi2005.chatgpt.site/> |

## Questions requiring an official answer

1. Is the current `SentinelDVNAdapter` integration shape suitable for a testnet candidate, or is a different LayerZero DVN/adaptor contract boundary required?
2. What authenticated ingress/caller contract, registration process, public discovery endpoint, and return values (including VID) are required for this testnet onboarding?
3. Which official pathway configuration calls and ordering are required after both OApps and adapters exist, including explicit Send/Receive ULN302, executor, confirmations, required DVNs, optional DVNs, threshold, and peers?
4. Can a pending extra-context result be retried by the LayerZero flow? If yes, what response shape, cadence/backoff, and terminal behavior are supported? Sentinel currently retains asynchronous GenLayer finality in its coordinator and does not claim native pending support.
5. Which independent public testnet DVNs are suitable to accompany Sentinel, and what evidence is sufficient to establish that they are not the same operator/failure domain?
6. What deployment/address evidence should Sentinel return to LayerZero before a testnet pathway is considered observable?

## Evidence supplied now

- Pinned LayerZero interface compilation and local integration coverage.
- Read-only two-provider pathway auditor that treats a null deployment as blocked rather than fabricated.
- Read-only wallet controls for Sepolia / Arbitrum Sepolia balances and EndpointV2 bytecode presence.
- Fail-closed GenLayer receipt boundary: no signer authorization until a real finalized decision plus reviewed call-data codec are available.
- Public operator attestation package that accepts no secret material and does not treat a form as proof of independence.

## Explicit limitations

No Sentinel OApp, adapter, signer endpoint, GenLayer Bradbury policy contract, independent DVN selection, or LayerZero onboarding is deployed or confirmed. No private keys, secrets, cloud credentials, or funding are requested or supplied. Any eventual deployment must be wallet-owner-controlled and separately approved after LayerZero and security-review confirmation.

## Requested response format

Please provide a written confirmation or ticket reference covering the six questions above, current official testnet addresses/versions, and any required onboarding contact or form. Sentinel will pin that response as reviewed evidence before producing deployment transactions.
