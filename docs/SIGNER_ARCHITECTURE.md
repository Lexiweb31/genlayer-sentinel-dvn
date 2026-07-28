# Threshold signer architecture

The intended testnet topology is 3-of-5, with five independently operated signer services in distinct failure domains. “Five processes on one host” is not acceptable. Each operator should use a separate cloud/account or physical domain, network policy, monitoring path and KMS/HSM key. The coordinator is untrusted for authorization: it can request shares but cannot make a signer accept a packet.

Each signer independently checks the GenLayer transaction is exactly `FINALIZED`/`7`, its execution result is `FINISHED_WITH_RETURN`, and it called `evaluate` on the pinned policy contract with the exact GUID, packet digest, evidence URI, evidence digest, decoded action and policy. It then reads the immutable policy record, recomputes the request binding and requires the expected decision, policy version and finalized reason code. It also enforces an allowlisted chain ID, adapter, verification target and maximum signature TTL. It signs the exact digest implemented by `SentinelDVNAdapter.executionDigest`:

`keccak256(abi.encode(chainId, adapter, verificationTarget, guid, packetDigest, evidenceDigest, keccak256(callData), expiry))`

The raw key never enters the coordinator or repository. `DigestSigner` is the boundary for a KMS, HSM, enclave or remote signing daemon. The local wallet objects used by tests are fixtures only. Shares are recovered, deduplicated, checked against the on-chain signer allowlist, sorted by address for the adapter, and truncated to quorum. A rejected or unavailable signer does not count.

## Authorization witness

`sentinel-signer/v2` is the only accepted wire version; v1 is rejected and there is no deployed v1 migration to preserve. The coordinator sends a fixed-order canonical JSON request containing a random 32-byte request ID, coordinator identity, issued/expiry times, complete signing envelope and a bounded authorization:

- `witness.transactionId`: canonical lowercase GenLayer transaction ID;
- `witness.evidenceUri`: credential-free HTTPS URI, at most 2,048 UTF-8 bytes;
- `witness.decodedAction`: at most 8,192 UTF-8 bytes;
- `witness.policy`: at most 8,192 UTF-8 bytes; and
- `result`: the exact finalized GUID, packet/evidence digests, decision, reason, timestamp and policy version.

The complete request is limited to 32,768 UTF-8 bytes. Bigints are decimal strings and hex is canonical lowercase. The coordinator constructs the witness only from its durable request ID, original policy request and finalized result. Missing or inconsistent durable context prevents all signer contact.

`GenLayerSignerFinalityAttestor` consumes the witness through injected status and transaction/record readers. It does not trust the coordinator’s result as proof of finality. The transaction-witness reader is still an interface: no approved official GenLayer SDK/RPC adapter has been implemented or live-tested, so this milestone proves the fail-closed signer boundary with controlled readers, not live independent finality.

## Authenticated remote protocol

Production transport must use mutual TLS. `RemoteSignerClient` deliberately accepts an injected `AuthenticatedSignerTransport`; there is no default `fetch` shortcut because ordinary HTTP response handling cannot prove the authenticated peer SPKI. The client supplies the configured SPKI SHA-256 pin and independently verifies the reported authenticated fingerprint, request ID, signer address, execution digest and recovered signature. Endpoints must be public HTTPS without credentials, custom ports, localhost or literal IPs. Certificates, endpoints and pins belong in a private signer-specific deployment system, not this repository or another product’s environment.

Each signer authenticates the coordinator fingerprint before parsing the request. It then enforces coordinator identity, request freshness and maximum transport TTL. `SqliteSignerReplayStore` transactionally reserves request IDs and permanently binds each coordinator/GUID to both the adapter execution digest and canonical authorization digest before the isolated signer is called. A duplicate request ID or either conflicting digest is rejected. An empty v1 replay database migrates; a populated v1 database fails closed and requires an explicit operator migration. A crash after reservation can consume a request ID without returning a share; the coordinator may retry the same two digests with a fresh random request ID. Destination digest idempotency makes repeat shares safe.

The five intended services must have five separately controlled signer addresses, TLS identities, key providers, replay databases, operations teams or accounts, network policies and monitoring paths. Multiple processes or URLs using one address count once in quorum collection and do not create an independent operator. The current composed runtime still instantiates zero signers because no approved private endpoint/certificate/custody configuration exists.

The repository does not yet contain a listening mutual-TLS signer daemon, certificate lifecycle, official live GenLayer transaction reader, HSM/KMS adapter, rate limiter or five-operator deployment. The implemented protocol handler and remote client are authenticated-transport abstractions exercised with controlled transports. They must not be described as deployed isolation.

Destination submission checks `used(digest)` before sending and again after confirmation. A previously used digest returns `ALREADY_VERIFIED`; failure to observe the used flag after submission is an error. Production must additionally supply and audit the mutual-TLS transport, certificate issuance/rotation/revocation, rate limiting, durable coordinator share/transaction state, receipt confirmation depth, and alerts for authentication failures, replay/conflict refusals, anomalous TTLs, signer divergence and quorum latency.

Rotation and incident response require an audited threshold-controlled signer update mechanism in a future adapter revision. Until that exists, deployment is disposable testnet infrastructure: pause signers, remove Sentinel from the optional DVN set, deploy a new adapter/signers, verify configuration, then retire the old instance.
