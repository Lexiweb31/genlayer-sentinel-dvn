# Deployment Readiness Primary-Source Audit

Audit date: 2026-07-29

Status: `AUDITED_METADATA_NOT_DEPLOYMENT_AUTHORIZATION`

## Scope

This audit rechecked the public contract metadata and DVN architecture needed to design an offline GenLayer Sentinel readiness bundle. It did not call an RPC, inspect live bytecode, validate an OApp pathway, select independent DVNs, onboard Sentinel, approve confirmation depths, deploy a contract, create an account, or spend funds.

Primary sources:

- [LayerZero DVN overview](https://docs.layerzero.network/v2/workers/off-chain/dvn-overview)
- [Build DVNs](https://docs.layerzero.network/v2/workers/off-chain/build-dvns)
- [DVN technical reference](https://docs.layerzero.network/v2/workers/off-chain/dvn-technical-reference)
- [Gasolina overview](https://docs.layerzero.network/v2/workers/off-chain/gasolina-overview)
- [Gasolina API reference](https://docs.layerzero.network/v2/workers/off-chain/gasolina-api-reference)
- [Ethereum Sepolia deployments](https://docs.layerzero.network/v2/deployments/chains/sepolia)
- [Arbitrum Sepolia deployments](https://docs.layerzero.network/v2/deployments/chains/arbitrum-sepolia)
- [GenLayer network configuration](https://docs.genlayer.com/developers/intelligent-contracts/deploying/network-configuration)
- [GenLayer optimistic democracy and finality](https://docs.genlayer.com/understand-genlayer-protocol/optimistic-democracy-how-genlayer-works)

## Rechecked LayerZero metadata

| Network | Chain ID | EID | EndpointV2 | SendUln302 | ReceiveUln302 | Executor | Dead DVN |
|---|---:|---:|---|---|---|---|---|
| Ethereum Sepolia | 11155111 | 40161 | `0x6EDCE65403992e310A62460808c4b910D972f10f` | `0xcc1ae8Cf5D3904Cef3360A9532B477529b177cCE` | `0xdAf00F5eE2158dD58E0d3857851c432E34A3A851` | `0x718B92b5CB0a5552039B593faF724D182A881eDA` | `0x8b450b0acF56E1B0e25C581bB04FBAbeeb0644b8` |
| Arbitrum Sepolia | 421614 | 40231 | `0x6EDCE65403992e310A62460808c4b910D972f10f` | `0x4f7cd4DA19ABB31b0eC98b9066B9e857B1bf9C0E` | `0x75Db67CDab2824970131D5aa9CECfC9F69c69636` | `0x5Df3a1cEbBD9c8BA7F8dF51Fd632A9aef8308897` | `0xA85BE08A6Ce2771C730661766AACf2c8Bb24C611` |

These addresses are dated metadata only. The Dead-DVN addresses are recorded as forbidden verifier metadata and must never be selected as required or optional DVNs.

## DVN conformance finding

LayerZero documents a DVN as an on-chain contract deployed on supported chains plus an off-chain verification system. The source contract accepts jobs, the off-chain system observes packet and fee events, waits for configured confirmations, resolves destination configuration, verifies the packet, and commits verification through the destination receive library. The technical reference also describes VID, price feed, message-library, administrative, signer, and quorum concerns.

The current `SentinelDVNAdapter` is a narrower local policy/quorum prototype:

- it imports the official `ILayerZeroDVN.AssignJobParam` data shape;
- it exposes selector-compatible `getFee` and `assignJob` functions;
- it deliberately does not inherit `ILayerZeroDVN`;
- its `assignJob` is nonpayable while the current official interface declares `assignJob` payable;
- its constructor contains one message library, one verification target, one destination EID, five signers, and a quorum rather than the complete topology in the official technical reference;
- its threshold execution uses an injected verification target and has not been proven against a live receive library.

ABI or selector resemblance is therefore insufficient. The current contract must be classified `LOCAL_ADAPTER_PROTOTYPE`, and a `LAYERZERO_DVN_CANDIDATE` readiness request must fail closed.

## Unresolved external confirmations

LayerZero confirmation is still required for:

- the current DVN onboarding path and testnet support expectations;
- the exact contract topology expected for the selected DVN or DVN-adapter model;
- live Ethereum Sepolia to Arbitrum Sepolia directional configuration;
- which independent DVNs can accompany Sentinel as an additional or optional verifier;
- whether and how Gasolina/Essence retries an extra-context decision that is pending or temporarily unavailable.

GenLayer confirmation is still required for:

- the supported live testnet and account-provider construction;
- the authoritative transaction-status/finality consumption interface for this deployment;
- appeal/finality timing and the exact safe point at which an external threshold signer may act;
- live multi-validator behavior for the Intelligent Contract and its web evidence.

## Project policy values

The values 15 Ethereum Sepolia confirmations and 64 Arbitrum Sepolia confirmations remain unapproved project security-review candidates. The values 3 and 20 remain local prototype test values. None is represented as an official LayerZero recommendation.

## Conclusion

The audited metadata is sufficient to bind an offline readiness report. It is not sufficient to produce deployment transactions or claim a supported, onboarded, configured, verified, or live LayerZero DVN.
