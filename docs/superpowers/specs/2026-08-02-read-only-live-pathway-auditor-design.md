# Read-only live pathway auditor design

Status: approved in conversation on 2026-08-02 for a keyless, non-deployment M2 increment; self-reviewed for clock trust, block-hash binding, DNS rebinding, and evidence reproducibility. Written specification awaiting final review approval.

## Outcome

Build a keyless, read-only auditor for the one-way Ethereum Sepolia (EID 40161) to Arbitrum Sepolia (EID 40231) Sentinel pathway. The auditor will query two explicitly supplied public RPC transports per chain, pin every observation to an agreed block number and hash, compare the live LayerZero and Sentinel configuration with the repository's expected public manifest, and emit a canonical evidence bundle plus a human-readable summary.

This increment advances M2 evidence collection only. It creates no account, signer, cloud resource, subscription, funding request, transaction, deployment, configuration change, publication, or readiness approval. Missing OApp or adapter deployments are reported as blockers, never replaced with fixtures or simulated success.

## Why this approach

Three approaches were considered:

1. **Keyless live pathway auditor** — selected. It produces executable, reproducible evidence while preserving the existing no-key and no-deployment boundary.
2. **Documentation-only operator checklist** — rejected as the primary increment. It would help external coordination but would not prove what the configured chains actually return.
3. **Immediate testnet deployment workflow** — rejected for this increment. It would require funding, account providers, signer custody, LayerZero onboarding assumptions, transaction recovery, and explicit deployment approval before the live topology is resolved.

The selected approach narrows uncertainty without gaining authority to mutate either chain.

## Current official evidence

The 2026-08-02 primary-source recheck establishes:

- LayerZero currently lists Ethereum Sepolia and Arbitrum Sepolia V2 deployments and documents per-pathway send/receive message libraries, confirmation depth, Executor, and required/optional DVN configuration.
- LayerZero requires the source send configuration and destination receive configuration for a pathway to match, requires DVN arrays to be address-sorted, warns against Dead DVNs, and says distinct-looking DVNs do not provide diversity when they share an operator, infrastructure, or verification method.
- LayerZero describes verification as all required DVNs plus the configured threshold of optional DVNs. Sentinel remains intended as an additional or optional verifier beside independent DVNs, not the sole production verifier.
- GenLayer currently lists Bradbury RPC `https://rpc-bradbury.genlayer.com`, chain ID 4221, and real-model workloads. `gen_getTransactionStatus` documents `FINALIZED` with status code 7.
- These documents establish interfaces and current published metadata; they do not prove Sentinel's OApps or adapter are deployed, that LayerZero has onboarded Sentinel, that a specific testnet pathway is configured, that public RPC providers are operationally independent, or that a live GenLayer transaction reader is approved.

Primary sources:

- https://docs.layerzero.network/v2/deployments/chains/sepolia
- https://docs.layerzero.network/v2/deployments/chains/arbitrum-sepolia
- https://docs.layerzero.network/v2/concepts/modular-security/production-dvn-configuration
- https://docs.layerzero.network/v2/concepts/modular-security/security-stack-dvns
- https://docs.layerzero.network/v2/workers/off-chain/dvn-overview
- https://docs.layerzero.network/v2/workers/off-chain/build-dvns
- https://docs.genlayer.com/developers/networks
- https://docs.genlayer.com/api-references/genlayer-node/gen/gen_getTransactionStatus

## Capability boundary

The auditor must have no capability to:

- read or accept a private key, mnemonic, keystore, hardware-wallet session, signer handle, account provider, or secret environment variable;
- call transaction, signing, wallet, faucet, deployment, contract-configuration, or cloud-resource APIs;
- estimate gas, obtain an account nonce, request a signature, submit a transaction, or wait for a receipt;
- mutate `config/networks.json`, a deployment record, compiled artifacts, readiness evidence, or chain state;
- select DVN operators, confirmation depths, or a GenLayer account provider on behalf of the operator;
- infer control of the user's public address or any other address;
- claim that two transports are independent merely because their URLs differ;
- turn an observation into LayerZero onboarding, deployment approval, or production readiness.

Only explicit, public, credential-free HTTPS JSON-RPC inputs are accepted. The library receives all inputs as ordinary values and receives network responses through injected read-only transports. It does not read configuration from ambient environment variables.

## Components

### Public observation manifest

The CLI accepts one explicit absolute path to a UTF-8 JSON manifest. Standard input, inline JSON, relative paths, implicit working-directory discovery, redirects, URL user information, URL fragments, placeholder values, shell substitutions, control characters, and secret-shaped fields are rejected.

The versioned closed schema contains:

- schema version, pathway direction, and expected repository network-audit digest;
- two source RPC entries and two destination RPC entries;
- a public operator-family label and committed operator-evidence digest for each RPC entry;
- expected chain IDs, EIDs, EndpointV2, send ULN302, receive ULN302, Executor, and Dead-DVN addresses;
- optional source OApp, destination OApp, and destination Sentinel adapter addresses;
- expected source and destination peers when the OApps exist;
- the intended source observation lag and destination observation lag, explicitly labeled observation stability settings rather than message-confirmation policy;
- an optional proposed confirmation policy, permanently labeled `UNAPPROVED_PROJECT_POLICY` until separately reviewed;
- explicit acknowledgement that the run is read-only, unsigned, nonauthorizing, and may remain blocked.

RPC URLs are used only at runtime. Output records a bounded public label, canonical origin digest, operator-family label, and evidence digest; it never prints a complete RPC URL. The implementation must not accept credential-bearing URLs or persist transport inputs.

OApp and adapter fields may be explicitly `null`. This supports an honest predeployment observation of official LayerZero contracts. A null deployment field creates stable pathway blockers and can never produce a configured-pathway result.

### Restricted JSON-RPC transport

The transport exposes only an allowlist of read methods required by the existing source and destination verifiers, including chain identity, block headers, bytecode, and `eth_call`. It rejects batch methods not defined by the auditor, notifications, subscriptions, transaction methods, debug/admin namespaces, redirects, oversized responses, invalid JSON-RPC envelopes, mismatched response IDs, duplicate keys, and unexpected result shapes.

Every request has bounded connect, response, and whole-operation deadlines plus a response-byte ceiling. HTTPS certificate verification remains enabled. Public-host validation rejects loopback, link-local, private, multicast, unspecified, and metadata-service targets. DNS results are checked before connection, the connection is pinned through a lookup boundary to a checked public address, every retry resolves and checks again, and redirects are disabled. This prevents a successful preflight lookup from becoming permission to connect to a later private address. Failures are returned as stable sanitized error codes without raw URLs, headers, bodies, host paths, or exception objects.

The auditor runs each provider independently. One provider's response is never reused as the other's evidence.

### Agreed block selection

Each chain is observed independently:

1. query both providers for `eth_chainId` and reject any disagreement or unexpected chain;
2. query both current heads;
3. subtract the manifest's explicit observation lag from the lower head to choose a candidate block number;
4. fetch that numbered block from both providers;
5. require identical block number, block hash, parent hash, state root, and transactions root;
6. use the exact agreed block hash with `requireCanonical: true` for all subsequent EIP-1898-capable bytecode and `eth_call` requests, rejecting providers that cannot honor the block-hash reference; and
7. repeat the block-header query after all calls and reject the run if either provider no longer returns the same block identity.

The observation lag reduces accidental tip instability but is not a message confirmation setting and is not evidence of finality. A reorganized, pruned, unavailable, or disagreeing block fails closed. Source and destination block numbers need not correspond in time; each receives its own identity and observation timestamp.

### RPC agreement and operator independence

For every requested value, both providers must independently return the same normalized result. Error-versus-result disagreement, bytecode disagreement, revert disagreement, or decoded-value disagreement creates `BLOCKED_RPC_CONSENSUS`.

Two distinct origins prove only transport diversity. Operational independence requires distinct operator-family labels whose evidence digests bind to a committed, reviewed provider audit. Missing, stale, duplicated, or unrecognized operator evidence creates `BLOCKED_RPC_INDEPENDENCE`, even when both transports agree. The report distinguishes:

- `TWO_TRANSPORTS_AGREE`;
- `OPERATOR_INDEPENDENCE_DECLARED`;
- `OPERATOR_INDEPENDENCE_REVIEWED`; and
- `OPERATOR_INDEPENDENCE_UNPROVEN`.

Only the reviewed state can satisfy the independence gate. The auditor does not perform organizational due diligence and never upgrades this state from URL inspection.

### Contract-code evidence

At the agreed block hash, the auditor reads code for every expected official and Sentinel address. It records non-emptiness, byte length, and Keccak-256 runtime-code digest from each provider. Empty code, disagreement, or a digest mismatch against an explicitly audited expected digest creates a stable blocker.

An address match and nonempty code do not prove official identity. If no reviewed expected runtime-code digest exists, the result is labeled `CODE_PRESENT_IDENTITY_UNPROVEN`. Proxy or immutable-configuration analysis is not inferred from bytecode alone. Any proxy expectation must be explicit in the manifest and its resolved implementation/admin evidence must be observed through approved read-only calls.

### Source pathway observation

When the source OApp exists, the existing historical source-path verifier is used through the dual-provider boundary to observe at the exact source block:

- Endpoint identity;
- selected send library and whether it is inherited/default;
- source OApp peer for Arbitrum Sepolia;
- explicit Executor configuration;
- raw ULN302 confirmations;
- required DVNs;
- optional DVNs and threshold; and
- Dead-DVN absence.

Inherited/default libraries or ULN values, unsorted or duplicated DVNs, an impossible optional threshold, an unsupported EID, a missing peer, an unexpected Executor, a Dead DVN, or provider disagreement fails closed.

### Destination pathway observation

When the destination OApp and adapter exist, the existing destination-path verifier is used through the dual-provider boundary to observe at the exact destination block:

- selected receive library and default/inherited status;
- destination raw ULN302 configuration for the source EID;
- destination OApp peer for Ethereum Sepolia;
- Sentinel adapter destination target;
- supported source EID;
- adapter quorum;
- exact signer membership and ordering; and
- adapter runtime-code digest.

The source send ULN302 and destination receive ULN302 security configuration must match for the one-way pathway. Any mismatch produces a field-specific blocker. Sentinel must not be the sole verifier: the observed topology must contain at least one separately reviewed independent DVN, and the configured threshold must not make Sentinel a hidden single point of acceptance.

This audit observes configuration only. It does not prove that any DVN daemon is live, independent, correctly operated, or willing to verify the pathway.

### Evidence assembler

The assembler combines schema-defined normalized observations, never raw response bodies. The bundle includes the decoded public configuration values needed for review as well as their digests; a digest alone is not presented as reproducible evidence. It computes:

- per-chain block identity digests;
- per-contract runtime-code digests;
- source and destination configuration digests;
- a cross-pathway configuration digest;
- an RPC-agreement digest;
- a repository network-audit binding; and
- one final canonical evidence digest.

Canonical JSON recursively sorts object keys, preserves only schema-defined array order, uses lowercase fixed-width hex where the schema requires bytes, uses checksummed addresses for presentation fields, contains one terminal newline, and contains no randomness or implicit clock reads. The CLI captures one UTC run timestamp through an injected clock boundary and supplies it explicitly to the pure assembler; tests use a fixed clock. Identical manifest bytes, repository binding, injected timestamp, and normalized RPC observations produce byte-identical output.

The bundle is unsigned. It is evidence for review, not an attestation from an RPC provider, LayerZero, GenLayer, a signer, or Sentinel.

### Readiness and dashboard integration

The existing keyless readiness system may ingest the auditor's canonical digest and blocker list, but the auditor cannot edit a readiness bundle or clear a gate. A new readiness run must explicitly bind the exact audit artifact.

The dashboard may display an explicitly loaded audit artifact with:

- the explicit run timestamp and pinned blocks;
- provider agreement and independence state;
- official-contract code state;
- source and destination pathway checks;
- the deterministic-versus-semantic boundary; and
- every blocker and non-claim.

It must label the artifact `READ_ONLY OBSERVATION`. It must not show packet progress, GenLayer consensus, signer quorum, LayerZero verification, or execution unless those states originate from the live coordinator. A missing audit artifact displays `NOT OBSERVED`, not a sample or simulated pathway.

## Status model

Every structurally valid run emits exactly one primary status using this precedence:

1. `BLOCKED_INPUT_BINDING`
2. `BLOCKED_RPC_INDEPENDENCE`
3. `BLOCKED_RPC_CONSENSUS`
4. `BLOCKED_CODE_IDENTITY`
5. `BLOCKED_PATHWAY_CONFIGURATION`
6. `OBSERVED_PATHWAY_CONSISTENT`

All blockers remain in a stably sorted list even when only one determines the primary status.

`OBSERVED_PATHWAY_CONSISTENT` means only that the exact read-only checks in this specification agreed at the recorded blocks. It does not mean deployed correctly, onboarded, live, decentralized, funded, signed, transaction-tested, audited, production-safe, or mainnet-ready.

Every artifact permanently contains:

```text
READ_ONLY_UNSIGNED_NOT_DEPLOYED_NOT_ONBOARDED
```

Before Sentinel OApp and adapter addresses exist, the expected honest status is `BLOCKED_PATHWAY_CONFIGURATION` with explicit missing-deployment blockers, assuming the earlier gates pass.

## CLI behavior

The intended command is:

```bash
npm run audit:pathway -- --manifest /absolute/path/to/public-pathway-observation.json
```

Canonical JSON is printed to standard output by default. An optional explicit absolute output path uses exclusive-create semantics with restrictive user permissions. Existing files are never overwritten, truncated, appended, or renamed.

Human diagnostics go to standard error and use stable error codes without complete RPC URLs, response bodies, environment values, or absolute host paths.

Exit codes are:

- `0`: `OBSERVED_PATHWAY_CONSISTENT`;
- `2`: a canonical evidence bundle was emitted but remains blocked;
- `1`: invalid input, unsafe transport, local integrity failure, or internal failure prevented a trustworthy bundle.

The CLI refuses to run when deployment, account, transaction, signer, or secret-shaped flags are present. It does not read `.env` files.

## Error and failure behavior

The public error vocabulary is closed and versioned. It includes categories for manifest validation, unsafe RPC target, timeout, response limit, JSON-RPC protocol violation, chain mismatch, block disagreement, block instability, provider disagreement, missing code, unproven code identity, call revert, ABI decode failure, default/inherited LayerZero configuration, peer mismatch, ULN mismatch, Dead DVN, invalid threshold, sole-verifier topology, missing deployment, stale provider evidence, and local artifact-binding failure.

No fallback can weaken a check. In particular:

- one provider cannot substitute for two;
- latest-state calls cannot substitute for exact-block calls;
- a default LayerZero value cannot substitute for explicit pathway configuration;
- a successful `eth_call` cannot substitute for expected runtime-code identity;
- transport agreement cannot substitute for reviewed operator independence;
- a local fixture cannot substitute for a missing deployment; and
- a GenLayer `ACCEPTED` state cannot substitute for `FINALIZED` in later signing work.

Partial observations are preserved only inside the emitted blocked bundle when they are schema-valid and safe. They are never cached as the next run's input.

## Test strategy

Implementation is test-first. The default test gate uses deterministic local JSON-RPC fixtures and local HTTPS test servers; it never depends on public testnet availability.

Unit and contract-boundary tests prove:

- closed-schema manifest parsing and secret/placeholder refusal;
- public-HTTPS and redirect restrictions;
- allowlisted JSON-RPC methods only;
- bounded timeouts, response sizes, IDs, and decoded shapes;
- deterministic common-block selection and block-stability recheck;
- exact-block forwarding to every code and call request;
- provider normalization and disagreement handling;
- operator-evidence binding without URL-based independence claims;
- runtime-code hashing and identity states;
- source/destination ULN, peer, Executor, quorum, and signer comparisons;
- Dead-DVN, default/inherited config, and sole-verifier refusal;
- canonical output determinism, blocker precedence, and redaction;
- exclusive-create output and stable exit codes; and
- readiness/dashboard ingestion without automatic gate clearing or simulated state.

Adversarial tests prove refusal of:

- same operator behind different origins;
- chain-ID equivocation;
- same-height block-hash disagreement;
- a reorg during observation;
- a provider returning latest state for an exact block request;
- code that changes between providers;
- proxy resolution disagreement;
- false success produced by null OApp/adapter fields;
- mismatched source and destination ULN values;
- a Dead DVN hidden in either array;
- duplicated or unsorted DVNs;
- an optional threshold outside its valid range;
- Sentinel as the only effective verifier;
- credential-bearing or local-network URLs;
- oversized, malformed, duplicated-key, or mismatched-ID responses; and
- attempts to pass private-key, deployment, transaction, wallet, or funding flags.

Property tests generate valid and mutated observations to prove canonical determinism, one-field disagreement detection, blocker ordering, address normalization, and evidence-digest sensitivity.

An opt-in live smoke test may run only with an explicit public manifest. It remains read-only, emits its artifact to a user-selected new path, and is excluded from the deterministic default test gate. Passing a live smoke test is not deployment approval.

The implementation completion gate is the full repository `npm run check` plus the new focused tests. Any changed Solidity production surface must still pass the existing compiler, contract, property, and Slither gates, though this design expects no Solidity change.

## Documentation deliverables

Implementation updates must include:

- a safe public-manifest template with null deployment fields;
- an operator guide for obtaining and reviewing two public RPC providers per chain;
- an evidence-bundle schema and field glossary;
- a demo walkthrough that begins blocked before deployment;
- monitoring guidance for repeated observations and drift comparison;
- rollback/recovery instructions stating that the tool has no chain rollback because it performs no writes;
- updates to `MILESTONES.md`, `UNKNOWNS.md`, the README, and the dashboard truth labels; and
- explicit instructions that deployment, funding, Bradbury account setup, signer infrastructure, and publication require separate user approval.

## Rollback

Rollback is a Git revert of this local increment. Generated audit files are immutable operator artifacts and are not repository truth unless separately reviewed and committed. There is no on-chain rollback because the auditor cannot write to a chain.

## Explicit non-claims

This milestone does not prove LayerZero onboarding, DVN availability, provider organizational independence, testnet deployment, OApp ownership, GenLayer live execution, GenLayer finality consumption, signer isolation, recovery-operator independence, fee economics, confirmation-policy adequacy, transaction delivery, destination execution, third-party audit, production safety, or mainnet readiness.
