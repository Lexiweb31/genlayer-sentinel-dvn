# GenLayer Bradbury finality handoff

Sentinel already has a keyless, read-only receipt boundary for a future GenLayer policy decision. This directory defines the public evidence needed to bind that boundary to a real Bradbury deployment. It does not deploy, fund, create, import, or access a GenLayer account.

## What must exist before this can become live

1. The deployment owner uses their own GenLayer account and Bradbury test funds to deploy the reviewed `contracts/genlayer/SentinelPolicy.py` source.
2. The owner records the public deployment transaction hash, deployed policy-contract address, exact source digest, and the documented origin fingerprint in an out-of-band review record.
3. An independent reviewer checks the deployed transaction and a real `evaluate` call on Bradbury, including its `FINALIZED` status, successful receipt, intended recipient, and `latest-final` policy record.
4. The reviewer creates a canonical finality-source manifest from the provided template, replaces every placeholder, and runs the existing offline review command:

   ```bash
   npm run audit:finality-source -- --manifest /absolute/path/to/finality-source.json
   ```

The command deliberately exits with status `2` even for a structurally valid record. Its result is a review record, not signer authorization. Sentinel's signer code remains fail-closed until a reviewed transaction-call-data codec independently reconstructs and verifies the exact six `evaluate` arguments.

## Authoritative network facts, rechecked 2026-08-11

- GenLayer documents Bradbury as chain ID `4221` and gives its RPC as `https://rpc.testnet-chain.genlayer.com`.
- GenLayer documents `gen_getTransactionStatus` for lightweight polling; status code `7` is `FINALIZED`.
- The deployment workflow must be wallet/account-owner controlled. Do not provide a private key, seed phrase, account export, RPC credential, or testnet token to this repository, console, or coordinator.

See [GenLayer Networks](https://docs.genlayer.com/developers/networks), [Network Configuration](https://docs.genlayer.com/developers/intelligent-contracts/deploying/network-configuration), and [the GenLayer Node API](https://docs.genlayer.com/api-references/genlayer-node).

## Evidence handoff checklist

| Required evidence | Who supplies it | What Sentinel does with it |
| --- | --- | --- |
| EIP-55 policy-contract address | deployment owner | Pins the intended finality recipient. |
| SHA-256 of the reviewed public RPC origin | independent reviewer | Identifies the reviewed source without committing a live URL. |
| Canonical deployment/source record | deployment owner + reviewer | Makes source and address reviewable. |
| One finalized `evaluate` transaction and receipt | independent reviewer | Proves the live status/receipt path for review only. |
| Reviewed transaction call-data codec | independent reviewer | Required before signer-side authorization can be enabled. |

No record in this directory makes an operator independent, a signer active, a contract deployed, LayerZero onboarding complete, or Sentinel ready for production.
