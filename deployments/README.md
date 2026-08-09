# Deployments

No deployments exist. Do not add an address here without transaction hash, chain ID/EID, bytecode verification link, git commit, deployer identity, configuration snapshot, and explicit user approval.

A deployment-readiness bundle is not a deployment record, transaction plan, signature, authorization, or proof of live-chain validation. `npm run readiness:bundle` never writes this directory. Keep generated bundles outside `deployments/`; this directory remains intentionally empty of chain records.

A read-only pathway-audit artifact is also not a deployment record or permission. Predeployment manifests must keep `deployment:null`; the resulting artifact must remain blocked and contain no invented OApp, adapter, transaction, signer, ULN, peer, or execution state. Keep pathway artifacts outside `deployments/`.

A future complete pathway manifest may describe four public contracts only after a separately approved deployment: source/destination OApps and source/destination adapters, with all four creation transaction hashes, both OApp delegates, five sorted authorized signers, and quorum three. Before adding any record here, independently verify chain ID/EID, successful creation receipts, constructor arguments, source commit and compiler/artifact hashes, runtime bytecode, ownership/delegate, LayerZero libraries/peers/ULN/DVNs/Executor, adapter bindings, signer membership, explorer links, deployer identity, configuration snapshot, funding source, and explicit user approval.

Current facts: no contract address or transaction hash is recorded; no funds were spent; no LayerZero onboarding occurred; no GenLayer Bradbury account/finality path, signer infrastructure, cloud resource, publication, or live app URL is claimed. Rollback for the keyless auditor is Git revert plus rejection of generated local evidence because it performs no chain write.
