# Sentinel signer operator package

This package is for a prospective independent signer operator to submit a **public review record**. It does not enroll an operator, connect to a signer, create a key, or permit a deployment.

## Safe use

1. Copy `operator-attestation.template.json` outside this repository.
2. Replace only the six documented public values.
3. Validate the copy locally:

   ```bash
   npm run check:operator-attestation -- /absolute/path/to/operator-attestation.json
   ```

4. Share the resulting file and separate ownership evidence with the security reviewers through an approved out-of-band channel.

Never put a private key, seed phrase, mnemonic, password, API token, client certificate, certificate private key, or recovery secret in the JSON file. The validator rejects secret-like property names, but its use is not a substitute for operator key-handling procedures.

## Fields

| Field | Meaning |
| --- | --- |
| `operatorId` | Stable lowercase, dash-separated public label. |
| `signerAddress` | Lowercase public EVM address proposed for one signer slot. |
| `certificateSpkiSha256` | Public SHA-256 fingerprint of the operator's transport-certificate SPKI. |
| `contactUrl` | Credential-free HTTPS review/contact endpoint. |
| `submittedAt` | ISO-8601 submission timestamp. |
| `attestation` | Must remain `UNVERIFIED_OPERATOR_ATTESTATION`. |

The committed template uses `.example.invalid`, an illustrative address, and an illustrative fingerprint. None identifies an active operator.

## What validation does—and does not—mean

`ATTESTATION_VALID_NOT_INDEPENDENCE_PROOF` means the record has the expected public-only shape. It does **not** prove address control, operator identity, HSM usage, mTLS reachability, certificate ownership, separate infrastructure, recovery separation, or eligibility for Sentinel's intended 3-of-5 threshold.

Before an operator can be considered for production, independent reviewers must separately establish ownership and failure-domain separation for all five signer operators, approve CA issuance/rotation/revocation and emergency recovery procedures, and verify the finalized GenLayer and LayerZero evidence path. Those gates remain explicitly blocked in the deployment-readiness bundle until real evidence is reviewed.
