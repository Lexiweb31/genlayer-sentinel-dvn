# LayerZero Endpoint Code Check Design

## Goal

Add a wallet-mediated, no-spend readiness check that reads bytecode at the configured LayerZero EndpointV2 address on Ethereum Sepolia and Arbitrum Sepolia.

## Scope

The console will expose a status and button in its portal bar. When invoked, it will switch the user's wallet provider to each testnet and call `eth_getCode` for `0x6EDCE65403992e310A62460808c4b910D972f10f` at `latest`.

## Truth Boundary

A positive result establishes only that non-empty EVM bytecode was observed at that configured address through the selected wallet provider. It does not prove an official LayerZero identity, DVN onboarding, ULN configuration, peers, signer quorum, GenLayer finality, or deployment readiness. The control makes no signature request and emits no transaction.

## Error Handling

The control requires a browser EIP-1193 provider and a connected account. It reports an unavailable state if either chain switch or code read fails, then restores the selected wallet state.

## Testing

The dashboard shell test requires the accessible control and live status, the `eth_getCode` method, both official configured endpoint address, and the continued absence of `eth_sendTransaction`.
