# Threat model and trust assumptions

Protected assets are DVN signing authority, policy integrity, packet/evidence bindings, and operator truthfulness. Attackers may control one RPC, coordinator instances, dashboard inputs, evidence hosting, or fewer than the signer threshold; reorder/replay requests; induce reorgs; or exploit semantic ambiguity.

Controls: two-provider agreement plus confirmation depth; canonical hash recomputation; immutable per-GUID request binding; strict ABI/allowlist checks before semantic review; evidence content digest and freshness window; finalized (not merely accepted) GenLayer state; domain-separated signing payload with chain, adapter, GUID, decision and expiry; unique signer recovery and on-chain used-digest tracking; idempotent state transitions; key isolation behind signer-provider interfaces; independent required/optional LayerZero DVNs.

Residual risks: GenLayer validator/model correlation, governance source compromise, both RPCs lying consistently, destination chain failure, signer implementation compromise, LayerZero or adapter bugs, finality/API interpretation errors, and denial of service. A semantic `ALLOW` is not proof of source-chain inclusion. A deterministic pass is not governance authorization.

Rollback: pause job intake and signer issuance; remove Sentinel from optional DVNs using OApp owner governance; rotate signers by threshold-authorized adapter update; never rewrite finalized decisions; deploy a new policy version and explicitly migrate future GUIDs. Already executed cross-chain actions are not reversible by Sentinel.
