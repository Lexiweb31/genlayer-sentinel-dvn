# Threshold signer architecture

The intended testnet topology is 3-of-5, with five independently operated signer services in distinct failure domains. “Five processes on one host” is not acceptable. Each operator should use a separate cloud/account or physical domain, network policy, monitoring path and KMS/HSM key. The coordinator is untrusted for authorization: it can request shares but cannot make a signer accept a packet.

Each signer independently checks the GenLayer transaction is `FINALIZED`, execution finished successfully, and the stored decision is `ALLOW` with the expected GUID, packet digest, evidence digest and policy version. It also enforces an allowlisted chain ID, adapter, verification target and maximum signature TTL. It signs the exact digest implemented by `SentinelDVNAdapter.executionDigest`:

`keccak256(abi.encode(chainId, adapter, verificationTarget, guid, packetDigest, evidenceDigest, keccak256(callData), expiry))`

The raw key never enters the coordinator or repository. `DigestSigner` is the boundary for a KMS, HSM, enclave or remote signing daemon. The local wallet objects used by tests are fixtures only. Shares are recovered, deduplicated, checked against the on-chain signer allowlist, sorted by address for the adapter, and truncated to quorum. A rejected or unavailable signer does not count.

## Authenticated remote protocol

`sentinel-signer/v1` is the only supported wire version. The coordinator sends a fixed-order canonical JSON request containing a random 32-byte request ID, coordinator identity, issued/expiry times, complete signing envelope and expected finalized policy result. Bigints are decimal strings and all hex is canonical lowercase. Transport metadata does not change the adapter execution digest.

Production transport must use mutual TLS. `RemoteSignerClient` deliberately accepts an injected `AuthenticatedSignerTransport`; there is no default `fetch` shortcut because ordinary HTTP response handling cannot prove the authenticated peer SPKI. The client supplies the configured SPKI SHA-256 pin and independently verifies the reported authenticated fingerprint, request ID, signer address, execution digest and recovered signature. Endpoints must be public HTTPS without credentials, custom ports, localhost or literal IPs. Certificates, endpoints and pins belong in a private signer-specific deployment system, not this repository or another product's environment.

Each signer authenticates the coordinator fingerprint before parsing the request. It then enforces coordinator identity, request freshness and maximum transport TTL. `SqliteSignerReplayStore` transactionally reserves request IDs and permanently binds each coordinator/GUID to one execution digest before the isolated signer is called. A duplicate request ID or conflicting GUID digest is rejected. A crash after reservation can consume a request ID without returning a share; the coordinator may retry the same digest with a fresh random request ID. Destination digest idempotency makes repeat shares safe.

The five intended services must have five separately controlled signer addresses, TLS identities, key providers, replay databases, operations teams or accounts, network policies and monitoring paths. Multiple processes or URLs using one address count once in quorum collection and do not create an independent operator. The current composed runtime still instantiates zero signers because no approved private endpoint/certificate/custody configuration exists.

Destination submission checks `used(digest)` before sending and again after confirmation. A previously used digest returns `ALREADY_VERIFIED`; failure to observe the used flag after submission is an error. Production must additionally supply and audit the mutual-TLS transport, certificate issuance/rotation/revocation, rate limiting, durable coordinator share/transaction state, receipt confirmation depth, and alerts for authentication failures, replay/conflict refusals, anomalous TTLs, signer divergence and quorum latency.

Rotation and incident response require an audited threshold-controlled signer update mechanism in a future adapter revision. Until that exists, deployment is disposable testnet infrastructure: pause signers, remove Sentinel from the optional DVN set, deploy a new adapter/signers, verify configuration, then retire the old instance.
