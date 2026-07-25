# Official-source feasibility and deployment audit — 2026-07-22

Superseded for current metadata by [`2026-07-25-official-recheck.md`](2026-07-25-official-recheck.md). Retained as dated audit history.

Status: contract metadata audited; pathway not deployed or validated; no funds or external resources used.

## Outcome

Ethereum Sepolia → Arbitrum Sepolia remains a feasible first LayerZero V2 testnet target. Official chain pages currently identify chain IDs `11155111` and `421614`, EIDs `40161` and `40231`, and active V2 deployments on both chains. The pages load contract details from LayerZero's official metadata API; the records below were retrieved through that documented page data source and normalized to EIP-55 checksum form.

This does **not** prove that a particular OApp pair is configured, that a default pathway is safe, or that Sentinel has been onboarded as a DVN. LayerZero explicitly requires directional configuration checks and exposes `isSupportedEid()` for contract-to-contract support. Deployment remains blocked until a user-approved live preflight resolves both directions on-chain.

| Field | Ethereum Sepolia | Arbitrum Sepolia |
|---|---|---|
| Chain ID | `11155111` | `421614` |
| LayerZero EID | `40161` | `40231` |
| EndpointV2 | `0x6EDCE65403992e310A62460808c4b910D972f10f` | `0x6EDCE65403992e310A62460808c4b910D972f10f` |
| SendUln302 | `0xcc1ae8Cf5D3904Cef3360A9532B477529b177cCE` | `0x4f7cd4DA19ABB31b0eC98b9066B9e857B1bf9C0E` |
| ReceiveUln302 | `0xdAf00F5eE2158dD58E0d3857851c432E34A3A851` | `0x75Db67CDab2824970131D5aa9CECfC9F69c69636` |
| Executor | `0x718B92b5CB0a5552039B593faF724D182A881eDA` | `0x5Df3a1cEbBD9c8BA7F8dF51Fd632A9aef8308897` |
| Dead DVN | `0x8b450b0acF56E1B0e25C581bB04FBAbeeb0644b8` | `0xA85BE08A6Ce2771C730661766AACf2c8Bb24C611` |

The official metadata currently lists multiple non-deprecated V2 push DVN providers on both chains, including LayerZero Labs, Japan Blockchain Foundation, Frax, Citrea, Wyoming, Paxos, Nethermind, AltLayer and Horizen. This is a coverage observation, not a security-stack selection. The exact addresses, operator independence, current health and resolved OApp configuration must be re-read immediately before deployment.

## LayerZero security implications

- A 1-of-1 DVN can forge or censor every message in its pathway. Production guidance calls for independent operator, infrastructure and verification-method diversity and flags fewer than two effective DVNs.
- Required and optional DVNs implement X-of-Y-of-N security. Sentinel remains an additional optional verifier for the prototype, never the only verifier.
- Send and receive configuration is directional. Both sides must explicitly pin compatible confirmations, use sorted DVN arrays, avoid Dead DVNs and be checked after every default migration.
- The official confirmation guidance is class-based: Ethereum mainnet uses 15 minimum/32 preferred for high value, while optimistic L2s typically use 15–30. It is not an approval of Sentinel's Sepolia test values. The repository's `3`, `20`, `15` and `64` values remain project placeholders pending a pathway-specific review.

## Gasolina and DVN onboarding

Gasolina performs mandatory chain-derived verification before its optional extra-context policy. The policy endpoint receives the decoded `PacketSent` evidence and must return a bare JSON boolean: `true` permits signing and `false` refuses. A refusal can block the nonce and later ordered messages when the DVN is required.

The current official integration sequence is clearer than the earlier audit:

1. Provide LayerZero an authenticated Gasolina endpoint, not an unauthenticated public URL.
2. LayerZero queries `/signer-info`, deploys DVN contracts with the signer set/threshold and returns their addresses.
3. OApps add those addresses to their ULN configuration.

For multiple signer instances, Essence requests them in parallel and combines signatures. Official examples use multiple Gasolina instances and a cross-instance quorum, consistent with Sentinel's intended isolated 3-of-5 design. The documented `vid` rule for V2 administration is EID modulo 30000, but the actual Sentinel VID and onboarding acceptance still require LayerZero confirmation.

No official contract was found for representing `PENDING` in the extra-context boolean or for retry cadence/backoff when that endpoint is unavailable. The safe architecture remains an explicit Sentinel coordinator that waits for GenLayer finality before any signer is asked to sign; it does not pretend an asynchronous decision is a native Gasolina boolean.

## GenLayer finality and network status

GenLayer now documents `gen_getTransactionStatus` as the lightweight polling method. It returns a string plus numeric code; only `FINALIZED`/`7` is irreversible for Sentinel's signing gate. `ACCEPTED`/`5` and `READY_TO_FINALIZE`/`11` are not sufficient.

The network guide lists Localnet (`http://localhost:4000/api`), Studionet (`https://studio.genlayer.com/api`), Testnet Asimov and Testnet Bradbury. Bradbury is described as the production-like real-AI test environment, but its page still says detailed configuration will be supplied when it goes live. The current repository has not contacted any of them. Direct-mode syntax checks are not evidence of validator consensus, web access reproducibility or finality integration.

## Required live preflight before deployment

1. Re-fetch both official chain records and compare every address byte-for-byte with `config/networks.json`.
2. Call Endpoint/message-library `isSupportedEid()` for the intended direction.
3. Resolve the source send and destination receive ULN configs for the actual OApp addresses; do not rely on merged defaults.
4. Select at least two effective independent DVNs in addition to any Sentinel optional policy role, verify current coverage and sort the address arrays.
5. Pin send/receive confirmations explicitly and obtain pathway-specific security approval.
6. Confirm there is no Dead DVN, the Executor is explicit and both OApp peers are correct.
7. Obtain LayerZero testnet DVN onboarding confirmation, authenticated ingress requirements, VID and deployed adapter addresses.
8. Run SentinelPolicy against the chosen GenLayer environment with multiple validators and consume only `FINALIZED` status.

## Primary sources

- [Ethereum Sepolia deployment](https://docs.layerzero.network/v2/deployments/chains/sepolia)
- [Arbitrum Sepolia deployment](https://docs.layerzero.network/v2/deployments/chains/arbitrum-sepolia)
- [LayerZero deployment metadata API](https://metadata.layerzero-api.com/v1/metadata/deployments)
- [LayerZero endpoint technical reference](https://docs.layerzero.network/v2/developers/evm/technical-reference/endpoints)
- [LayerZero pathway configuration](https://docs.layerzero.network/v2/get-started/create-lz-oapp/configuring-pathways)
- [LayerZero production DVN configuration](https://docs.layerzero.network/v2/concepts/modular-security/production-dvn-configuration)
- [Gasolina API reference](https://docs.layerzero.network/v2/workers/off-chain/gasolina-api-reference)
- [Gasolina implementation guide](https://docs.layerzero.network/v2/workers/off-chain/gasolina-implementation)
- [GenLayer transaction-status RPC](https://docs.genlayer.com/api-references/genlayer-node/gen/gen_getTransactionStatus)
- [GenLayer transaction statuses](https://docs.genlayer.com/understand-genlayer-protocol/core-concepts/transactions/transaction-statuses)
- [GenLayer network configuration](https://docs.genlayer.com/developers/intelligent-contracts/deploying/network-configuration)
- [GenLayer testing](https://docs.genlayer.com/developers/intelligent-contracts/testing)
- [GenLayer Studio limitations](https://docs.genlayer.com/developers/intelligent-contracts/tools/genlayer-studio/limitations)
