# Threshold signer architecture

The intended testnet topology is 3-of-5, with five independently operated signer services in distinct failure domains. “Five processes on one host” is not acceptable. Each operator should use a separate cloud/account or physical domain, network policy, monitoring path and KMS/HSM key. The coordinator is untrusted for authorization: it can request shares but cannot make a signer accept a packet.

Each signer independently checks the GenLayer transaction is `FINALIZED`, execution finished successfully, and the stored decision is `ALLOW` with the expected GUID, packet digest, evidence digest and policy version. It also enforces an allowlisted chain ID, adapter, verification target and maximum signature TTL. It signs the exact digest implemented by `SentinelDVNAdapter.executionDigest`:

`keccak256(abi.encode(chainId, adapter, verificationTarget, guid, packetDigest, evidenceDigest, keccak256(callData), expiry))`

The raw key never enters the coordinator or repository. `DigestSigner` is the boundary for a KMS, HSM, enclave or remote signing daemon. The local wallet objects used by tests are fixtures only. Shares are recovered, deduplicated, checked against the on-chain signer allowlist, sorted by address for the adapter, and truncated to quorum. A rejected or unavailable signer does not count.

Destination submission checks `used(digest)` before sending and again after confirmation. A previously used digest returns `ALREADY_VERIFIED`; failure to observe the used flag after submission is an error. Production must additionally persist request/share/transaction state durably, authenticate and rate-limit signer transport, verify chain receipts at confirmation depth, and alert on conflicting requests, anomalous TTLs, signer divergence and quorum latency.

Rotation and incident response require an audited threshold-controlled signer update mechanism in a future adapter revision. Until that exists, deployment is disposable testnet infrastructure: pause signers, remove Sentinel from the optional DVN set, deploy a new adapter/signers, verify configuration, then retire the old instance.
