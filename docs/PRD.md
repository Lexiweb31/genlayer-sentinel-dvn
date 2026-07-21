# Product requirements

Sentinel DVN is a policy firewall for high-value LayerZero treasury and governance messages. Its user-visible promise is narrow: a message receives Sentinel verification only when the encoded action exactly matches a current authorization published by the configured governance authority and the security policy accepts its value, destination, target, selector, validity window, and replay domain.

## Prototype success

1. Detect a real or fixture-faithful `PacketSent` and related fee event.
2. Derive the canonical GUID/payload digest and confirm inclusion from two independent RPC providers.
3. Decode the allowlisted treasury action and bind it to immutable evidence.
4. Submit the request keyed by GUID to GenLayer; expose pending, accepted, finalized, rejected, and undetermined states.
5. Collect a quorum only after finalized `ALLOW`; reject duplicate or mismatched shares.
6. Submit verification idempotently and show the complete lifecycle without invented success states.

Non-goals: mainnet readiness, a general-purpose semantic firewall, replacing deterministic verification, serving as the only DVN, custody of treasury funds, or claiming decentralization from a single test key.
