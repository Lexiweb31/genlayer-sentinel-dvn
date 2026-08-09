# Read-only live pathway auditor

## Purpose and current truth

The pathway auditor is a keyless, read-only observation command for the one-way Ethereum Sepolia (`chainId` `11155111`, LayerZero EID `40161`) to Arbitrum Sepolia (`chainId` `421614`, LayerZero EID `40231`) candidate pathway. It records what two explicit transports per chain agree is true at provider-agreed canonical blocks, binds those observations to reviewed repository policy, and fails closed when evidence is missing or inconsistent.

It does **not** deploy contracts, build or submit transactions, request wallet access, load signer keys, fund an account, create a GenLayer account, provision signer or cloud infrastructure, configure LayerZero, publish a site, or prove that endpoint URLs are independently operated. Its permanent artifact label is `READ_ONLY_UNSIGNED_NOT_DEPLOYED_NOT_ONBOARDED`.

Current live smoke status: **NOT RUN — PUBLIC RPC INPUTS NOT SUPPLIED**. The deterministic test suite uses injected transports and makes no public RPC request.

## Command and exit contract

Run from a clean reviewed repository checkout after `npm install --legacy-peer-deps`:

```bash
npm run audit:pathway -- --manifest /absolute/path/to/public-pathway-observation.json --output /absolute/path/to/new-pathway-evidence.json
```

The accepted grammar is exactly `--manifest ABSOLUTE_PATH`, optionally followed by `--output ABSOLUTE_PATH`. The command reads bounded regular files without following symlinks. Output mode creates a new mode-`0600` file atomically and refuses to overwrite an existing path. Without `--output`, canonical JSON is written to standard output after npm build logs; use `--output` for machine consumption.

Exit codes are stable:

| Exit | Meaning | Operator action |
| --- | --- | --- |
| `0` | A canonical artifact was produced with status `OBSERVED_PATHWAY_CONSISTENT`. | Review the artifact and all source evidence. This is still not deployment authorization or proof of production readiness. |
| `2` | A canonical artifact was produced, but one or more fail-closed blockers remain. | Archive the artifact, resolve its categorized remediation, and run again with fresh immutable inputs. |
| `1` | The command could not safely trust its manifest, repository inputs, transports, observation, build, or output path. | Use only the allowlisted stderr code; do not infer partial evidence or repair output by hand. |

Exit `1` writes one sanitized JSON error with one of:

- `PATHWAY_AUDIT_MANIFEST_INVALID`
- `PATHWAY_AUDIT_SECRET_FIELD_REJECTED`
- `PATHWAY_AUDIT_INPUT_READ_FAILED`
- `PATHWAY_AUDIT_POLICY_BINDING_FAILED`
- `PATHWAY_AUDIT_TRANSPORT_FAILED`
- `PATHWAY_AUDIT_OBSERVATION_FAILED`
- `PATHWAY_AUDIT_BUILD_FAILED`
- `PATHWAY_AUDIT_OUTPUT_FAILED`
- `PATHWAY_AUDIT_OUTPUT_EXISTS`

The command can issue only `eth_chainId`, `eth_blockNumber`, `eth_getBlockByNumber`, `eth_getCode`, `eth_call`, `eth_getTransactionByHash`, and `eth_getTransactionReceipt`. Parameter shapes are closed. State reads use EIP-1898 `{blockHash, requireCanonical:true}` references. The HTTPS client uses no credentials, redirect, retry, decompression, connection pool, caller-supplied headers, or custom port.

## Preparing the public manifest

Start from [`examples/public-pathway-observation-manifest.template.json`](examples/public-pathway-observation-manifest.template.json). It is intentionally invalid: all endpoint hosts use the reserved `.invalid` suffix, required values use `REPLACE_...`, and `deployment` is `null`. Do not weaken the parser or substitute fixture values. Replace every placeholder, then encode the result as canonical JSON with a trailing newline before running the command.

### Select four credential-free transports

Choose two public endpoints for each chain under all of these conditions:

1. Each URL is a public `https://` origin on port 443 with no username, password, token, query, fragment, or secret path. Only `/` or `/rpc` is accepted.
2. All four URL origins are distinct. Use four unique public labels as well.
3. Each pair is documented as a different `operatorFamily` only after reviewing ownership, control plane, infrastructure, upstream dependencies, and failure domains.
4. Each endpoint supports the seven allowlisted methods, EIP-1898 block-hash state reads, the target chain, the configured observation lag, and responses below 2 MiB.
5. DNS for every endpoint resolves entirely to globally routable addresses. If any answer is loopback, private, link-local, documentation, multicast, unspecified, metadata-service, or otherwise nonpublic, the request is rejected. DNS is resolved again for every call.
6. The operator has explicitly approved the four outbound public network requests before invoking the live command.

`originSha256` is the reviewed public identity digest carried by both the manifest and provider registry. Define the reviewed procedure before recording it; the recommended procedure is SHA-256 of the lowercase WHATWG URL origin, encoded as UTF-8 without a trailing newline. Record the exact procedure and evidence source in the provider review. The auditor checks equality of this field; it does not derive operator ownership from it.

Different URLs, domains, IP addresses, accounts, regions, or commercial plans do **not** prove operator independence. Two brands may share one parent, backend, cloud, archive provider, gateway, or administrative team. Transport agreement and operator-independence review are deliberately separate fields and gates.

### Review provider independence

The checked-in [`../config/rpc-provider-audit.json`](../config/rpc-provider-audit.json) currently states `NO_PROVIDER_OPERATORS_REVIEWED`; therefore a live run must remain blocked on RPC independence until a separate evidence review is committed.

For each of the four manifest entries, add one exact provider row to `config/rpc-provider-audit.json`:

```json
{
  "label": "source-primary",
  "operatorFamily": "reviewed-operator-family",
  "originSha256": "64-lowercase-hex-origin-digest",
  "operatorEvidenceSha256": "64-lowercase-hex-digest-of-reviewed-evidence",
  "sources": ["public source identifier or reviewed evidence reference"]
}
```

Set `status` to `PROVIDER_OPERATORS_REVIEWED`, set `auditDate` to the actual review date, list the full reviewed source set once in the top-level `sources`, preserve the warning, and keep provider labels unique. Each provider row must match manifest `label`, `originSha256`, and `operatorFamily` exactly. Within each chain pair, both matched families must be different. The review expires after the `maximumProviderAuditAgeDays` in `config/pathway-auditor.json`; changing only a label or URL cannot renew it.

This is a repository policy change. Review the evidence, canonicalize the JSON, run the full gate, and commit it separately. Never paste API keys or credential-bearing URLs into the manifest, registry, shell history, or evidence artifact.

### Bind the official network audit

`networkAuditSha256` is not a file hash. It is SHA-256 over canonical JSON containing exactly:

- SHA-256 of the raw `config/networks.json` bytes;
- SHA-256 of the raw `docs/research/2026-08-02-layerzero-interface-conformance-audit.md` bytes;
- source name `ethereum-sepolia`; and
- destination name `arbitrum-sepolia`.

The canonical preimage has these exact key names:

```ts
canonicalJson({
  destination: "arbitrum-sepolia",
  networkAuditEvidenceSha256: sha256(rawNetworkAuditEvidenceBytes),
  networkConfigSha256: sha256(rawNetworkConfigBytes),
  source: "ethereum-sepolia"
})
```

The manifest's EndpointV2, source SendUln302, source Executor, destination ReceiveUln302, Dead-DVN, chain ID, EID, and unapproved confirmation values must exactly match the reviewed repository network record. Refresh that record from official primary sources before relying on a later run.

The official runtime-code expectations in `config/pathway-auditor.json` are currently `null`. Code can therefore be observed, but official code identity remains unproven and must produce `AUDIT_CODE_IDENTITY_UNPROVEN` until independently reviewed Keccak-256 runtime hashes are committed. Presence of bytecode is not identity evidence.

## Null and complete deployment workflows

### Null deployment: the honest predeployment run

Keep `deployment` as `null` before contracts exist. The auditor may still bind repository policy, test transport/chain agreement, pin blocks, and observe official contract code. It must not invent OApps, adapters, ULN state, peers, quorum, or signers. The canonical artifact is expected to exit `2`, include `AUDIT_PATHWAY_DEPLOYMENTS_MISSING`, leave `deployments`, `source`, `destination`, and `configurationSha256` null, and carry no transaction-building or signing data.

Provider evidence and official code identity may add earlier blockers. The top-level status is chosen by stable category precedence: `INPUT_BINDING`, `RPC_INDEPENDENCE`, `RPC_CONSENSUS`, `CODE_IDENTITY`, then `PATHWAY_CONFIGURATION`.

### Complete deployment record

Only after a separately approved deployment exists, replace `deployment:null` with one closed record containing:

- source OApp address, its creation transaction hash, and constructor delegate;
- destination OApp address, its creation transaction hash, and constructor delegate;
- source Sentinel adapter address and its creation transaction hash;
- destination Sentinel adapter address and its creation transaction hash;
- exactly five distinct, checksummed, ascending authorized signer addresses; and
- quorum `3`.

All four transaction hashes must be nonzero 32-byte hashes. The four addresses and hashes are public evidence, not permission to deploy or reconfigure anything.

For each contract, both providers on that chain must agree on the creation transaction, successful receipt, contract address, creation block/hash, deployer, input, and runtime code. The auditor checks the transaction chain ID, recompiles the repository artifacts, matches the creation bytecode prefix, decodes exact constructor arguments, masks only declared Solidity immutables, and binds ABI, creation bytecode, deployed bytecode, immutable-reference, transaction-input, and runtime-code digests. A deployment after the selected observation block is rejected.

## Deterministic pathway evidence

When a complete deployment is supplied, both transports on each chain must agree at one canonical block selected from the lower provider head minus `observationLag`. The block header is reread after all state calls to catch instability. The artifact records chain ID, decimal block number and timestamp, block/parent/state/transaction-root hashes, provider identities, transcript result digests, and operator-independence review state.

The source observation checks:

- explicit non-default SendUln302 selection for the source OApp;
- destination EID support;
- the raw source OApp ULN confirmations, sorted required/optional DVNs, and optional threshold;
- bytecode for each configured DVN and the reviewed independent-DVN registry;
- source Executor address and maximum message size;
- source OApp peer for the destination OApp;
- source adapter address, send/receive library bindings, supported destination EID, quorum `3`, and all five signer mappings.

The destination observation checks:

- explicit non-default ReceiveUln302 selection;
- source EID support;
- raw OApp ULN and resolved ULN equality, rejecting inherited zero/default values;
- destination OApp peer for the source OApp;
- destination adapter address, library bindings, supported EID, quorum `3`, and all five signer mappings.

Cross-path checks require matching confirmations (`15` source and `64` destination, both labeled `UNAPPROVED_PROJECT_POLICY`), ordered nonoverlapping DVN lists, no Dead DVN, at least one reviewed independent verifier guaranteed by the effective quorum, and Sentinel configured as optional rather than required or the sole effective verifier. These confirmation counts are candidate project values, not official or approved production policy.

Deterministic observation answers whether the public chain configuration and deployment evidence match the declared pathway. It does not answer whether governance authorized a packet. GenLayer semantic consensus remains a distinct future live gate, and signing may occur only after both deterministic checks and finalized semantic consensus bind the same GUID/packet/evidence.

## Artifact schema and integrity

Every artifact is canonical JSON with:

- `schemaVersion:1`, `toolVersion:"sentinel-pathway-auditor/v1"`, `runTimestamp`, and derived `status`;
- permanent `truthLabel:"READ_ONLY_UNSIGNED_NOT_DEPLOYED_NOT_ONBOARDED"`;
- `repositoryBindingSha256` over network, provider, DVN-operator, and auditor-policy inputs;
- separate `rpcIndependence` and `providerAgreement` values for source and destination;
- `blocks`, `officialCode`, optional `deployments`, optional source/destination pathway observations, and `configurationSha256`;
- sorted `{code, category, remediation}` blockers; and
- `evidenceSha256`, recomputed over every other artifact field.

The strict parser recomputes the evidence digest, per-chain provider-result digests, and configuration digest; validates status from blockers; enforces canonical ordering and exact keys; and rejects contradictory “consistent” artifacts. It rejects secret-shaped keys anywhere. Archive the exact bytes; do not pretty-print, reorder, annotate, merge, or edit them.

Stable blocker categories and corresponding top-level statuses are:

| Category | Status | Examples |
| --- | --- | --- |
| `INPUT_BINDING` | `BLOCKED_INPUT_BINDING` | repository/network mismatch or stale network evidence |
| `RPC_INDEPENDENCE` | `BLOCKED_RPC_INDEPENDENCE` | missing/stale provider review or duplicated operator family |
| `RPC_CONSENSUS` | `BLOCKED_RPC_CONSENSUS` | unavailable RPC, chain mismatch, block/transcript disagreement, unstable block |
| `CODE_IDENTITY` | `BLOCKED_CODE_IDENTITY` | missing/unreviewed official code or incomplete/mismatched deployment provenance |
| `PATHWAY_CONFIGURATION` | `BLOCKED_PATHWAY_CONFIGURATION` | absent deployment, default/inherited library, peer/ULN/Executor/DVN/adapter/signer mismatch |

Only an empty blocker list yields `OBSERVED_PATHWAY_CONSISTENT`.

## Drift monitoring and dashboard review

Treat every generated artifact as immutable evidence. Record its file SHA-256, repository commit, operator review ticket, command, exit code, and capture time in an external append-only operations record. Never overwrite an artifact path.

For each approved observation window:

1. Generate a new artifact to a new absolute filename.
2. Validate each file through the strict Sentinel parser or the local dashboard selector; a generic JSON parser is insufficient.
3. Compare `repositoryBindingSha256` first. A change means policy, network, provider, or DVN-operator evidence changed and requires review.
4. Compare `rpcIndependence` and provider identities. URL agreement must never conceal expired or correlated operator evidence.
5. Compare source/destination block hashes and numbers. New blocks are expected across runs; reusing one block number with a different hash is a reorg/integrity alert.
6. Compare official runtime-code hashes and identities, deployment provenance, and per-chain `resultSha256`.
7. Compare `configurationSha256` and the decoded source/destination fields. Any library, peer, Executor, confirmation, DVN, threshold, adapter, or signer drift is a stop-signing event until reviewed.
8. Compare status and the complete sorted blocker set; a removed blocker must have corresponding authoritative evidence, not just changed labels.

The operations-first dashboard can inspect one operator-selected local artifact. The browser validates the artifact in memory, uploads nothing, persists nothing, and keeps it separate from packet, GenLayer, signer, delivery, and execution state. `NOT OBSERVED` is the honest default. The packaged static site can be built with `npm run build:site` and checked with `npm run test:site`; it is not currently published and has no live URL.

## Incident response, recovery, and rollback

On RPC disagreement, DNS rejection, code/configuration drift, artifact-integrity failure, or stale evidence:

1. Stop any separately deployed signer intake; the auditor itself has no signer control.
2. Preserve both immutable artifacts and external provider/review evidence.
3. Do not retry through an unreviewed replacement endpoint or edit a blocker out of an artifact.
4. Re-establish official metadata, provider ownership/independence, and canonical chain state through a reviewed ceremony.
5. Generate a new artifact to a new file and require human review before any downstream readiness or signing decision.

The auditor performs no chain write, so its rollback is a Git revert of the reviewed repository change plus deletion or archival rejection of local generated artifacts. There is no on-chain rollback and no state migration. Never claim that reverting documentation or policy reverses an already executed cross-chain action.

A readiness manifest may optionally bind one exact `OBSERVED_PATHWAY_CONSISTENT` artifact by raw file SHA-256 and the `--pathway-audit` argument. Readiness then includes only its status, truth label, artifact digest, run timestamp, and pinned block hashes. It does **not** set `config/deployment-readiness.json` `livePathwayValidated`, approve confirmation policy, select DVNs, authorize deployment, or replace human review.

## Approval boundaries and nonclaims

Each of these requires separate, explicit user approval after its own evidence review:

- contract deployment and any later configuration transaction;
- faucet use, testnet/native-token funding, or other spending;
- creation or use of a GenLayer Bradbury/Studio account and account-aware submission;
- production signer and recovery-operator infrastructure, keys, PKI, HSM/KMS, and operator ceremony;
- cloud resources, databases, monitoring, domains, or external infrastructure;
- LayerZero DVN onboarding, authenticated ingress, and production pathway configuration;
- GitHub/public source publication;
- web deployment/publication and any claimed live app URL.

No current artifact proves LayerZero onboarding, GenLayer live finality, provider independence, independent DVNs, approved confirmations, isolated 3-of-5 operators, production monitoring, external audit, testnet readiness, or mainnet readiness. No deployment record or live app URL exists in this repository.
