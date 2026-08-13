# RPC provider operator audit — 2026-08-13

## Scope

This review establishes only a repository-bound operator-family label for the
four public HTTPS transports used by the read-only Ethereum Sepolia to Arbitrum
Sepolia pathway audit. It does not establish uptime, censorship resistance,
upstream node independence, commercial support, availability, ownership beyond
the publishers' own documentation, or a production recommendation.

## Reviewed public operator evidence

### PublicNode

PublicNode's Ethereum Sepolia page publishes
`https://ethereum-sepolia-rpc.publicnode.com`. Its Arbitrum Sepolia page
publishes `https://arbitrum-sepolia-rpc.publicnode.com`. Both pages identify
the service as PublicNode. The audit records these origins as the `publicnode`
operator family.

Sources:

- https://ethereum-sepolia.publicnode.com/
- https://arbitrum-sepolia.publicnode.com/

### Tenderly

Tenderly's Node RPC reference publishes both
`https://sepolia.gateway.tenderly.co` for Ethereum Sepolia (chain ID 11155111)
and `https://arbitrum-sepolia.gateway.tenderly.co` for Arbitrum Sepolia (chain
ID 421614). The audit records these origins as the `tenderly` operator family.

Source:

- https://docs.tenderly.co/node-rpc/rpc-reference

## Conclusion and retained limits

The `publicnode` and `tenderly` labels are distinct documented operator
families for the specific audited origins. That permits the auditor to
distinguish this evidence from mere URL diversity. It does not clear any other
Sentinel blocker: no Sentinel contracts are deployed, official runtime code
identity remains unpinned, no LayerZero DVN is onboarded or selected, no
GenLayer finality reader is deployed, and no five-party signer set exists.

All endpoints remain subject to the read-only client's method allowlist,
HTTPS-only transport, DNS public-address checks, block-hash agreement, and
per-run failure handling. The provider audit expires under Sentinel's current
30-day policy and must be re-reviewed before it is treated as current.
