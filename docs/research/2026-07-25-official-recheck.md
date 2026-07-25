# Official-source recheck — 2026-07-25

Status: official deployment metadata rechecked; no live OApp pathway queried, deployed, funded, or configured.

## Outcome

Ethereum Sepolia → Arbitrum Sepolia remains the selected one-way prototype pathway. On 2026-07-25 the official LayerZero chain pages and their official deployment-metadata source still reported the following active V2 core contracts:

| Field | Ethereum Sepolia | Arbitrum Sepolia |
|---|---|---|
| Chain ID | `11155111` | `421614` |
| LayerZero EID | `40161` | `40231` |
| EndpointV2 | `0x6EDCE65403992e310A62460808c4b910D972f10f` | `0x6EDCE65403992e310A62460808c4b910D972f10f` |
| SendUln302 | `0xcc1ae8Cf5D3904Cef3360A9532B477529b177cCE` | `0x4f7cd4DA19ABB31b0eC98b9066B9e857B1bf9C0E` |
| ReceiveUln302 | `0xdAf00F5eE2158dD58E0d3857851c432E34A3A851` | `0x75Db67CDab2824970131D5aa9CECfC9F69c69636` |
| Executor | `0x718B92b5CB0a5552039B593faF724D182A881eDA` | `0x5Df3a1cEbBD9c8BA7F8dF51Fd632A9aef8308897` |
| Dead DVN | `0x8b450b0acF56E1B0e25C581bB04FBAbeeb0644b8` | `0xA85BE08A6Ce2771C730661766AACf2c8Bb24C611` |

These values match the 2026-07-22 repository audit byte-for-byte. They are protocol deployment metadata, not a configured Sentinel pathway. No deployed OApp, Sentinel DVN address, independent DVN selection, confirmation policy, peer, executor config, or ULN app config has been approved or verified on-chain.

## Configuration rules confirmed

LayerZero's current pathway guidance continues to distinguish default and explicit OApp configuration and treats send and receive paths directionally. Sentinel therefore:

- rejects a source OApp using the default send library;
- reads the raw source app ULN config and executor config at the exact historical packet block from two configured RPC origins;
- requires source Endpoint, SendUln302, OApp, executor, DVNs and peers to have code or values matching the private runtime manifest;
- rejects Dead DVNs and keeps Sentinel optional, beside at least one independent required DVN;
- rejects a destination OApp whose receive ULN values are inherited from defaults, even if the merged effective configuration happens to match; and
- persists a nonzero digest of the agreed historical source configuration with both deterministic provider observations.

This proves implementation behavior in fixtures and injected transports. It does not prove that two configured RPC origins are independently operated or that a future live pathway is correctly configured.

## GenLayer network and finality recheck

The current GenLayer networks page lists Testnet Bradbury with RPC `https://rpc-bradbury.genlayer.com`, chain ID `4221`, and native token `GEN`. An older network-configuration page still contains pre-launch wording that detailed Bradbury configuration will be supplied when live. The newer networks page is treated as current discovery evidence, but the discrepancy is an integration warning rather than deployment approval.

Sentinel's signing gate remains unchanged: `gen_getTransactionStatus` must report the exact irreversible `FINALIZED`/`7` state, the transaction execution must have finished successfully, and the GUID-keyed finalized contract result must match the original packet and evidence bindings. The repository has not contacted Bradbury, submitted an Intelligent Contract transaction, or established validator/web-access reproducibility.

## Still blocked before a live testnet run

1. Obtain explicit user approval for deployment and testnet funding.
2. Re-fetch official metadata immediately before deployment.
3. Deploy the two OApps and two directional adapter instances under separate approved accounts.
4. Select and verify independent LayerZero DVNs; obtain Sentinel DVN onboarding details.
5. Configure source and destination app paths explicitly, then read the raw and effective settings from at least two genuinely independent RPC operators.
6. Approve the GenLayer account-provider/direct-mode client and prove finalized record consumption on the selected network.
7. Provision five isolated signer processes/operators and exercise the intended 3-of-5 design.
8. Run reorg, provider-disagreement, default-inheritance, signer-loss, replay, denial, recovery, and rollback drills.

## Primary sources

- [LayerZero Ethereum Sepolia deployment](https://docs.layerzero.network/v2/deployments/chains/sepolia)
- [LayerZero Arbitrum Sepolia deployment](https://docs.layerzero.network/v2/deployments/chains/arbitrum-sepolia)
- [LayerZero deployment metadata API](https://metadata.layerzero-api.com/v1/metadata/deployments)
- [LayerZero pathway configuration](https://docs.layerzero.network/v2/get-started/create-lz-oapp/configuring-pathways)
- [LayerZero production DVN configuration](https://docs.layerzero.network/v2/concepts/modular-security/production-dvn-configuration)
- [GenLayer networks](https://docs.genlayer.com/developers/networks)
- [GenLayer transaction-status RPC](https://docs.genlayer.com/api-references/genlayer-node/gen/gen_getTransactionStatus)
- [GenLayer network configuration](https://docs.genlayer.com/developers/intelligent-contracts/deploying/network-configuration)
