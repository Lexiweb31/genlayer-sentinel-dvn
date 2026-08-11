import assert from "node:assert/strict";
import test from "node:test";
import { validateOperatorAttestation } from "../../../scripts/validate-operator-attestation.mjs";

const valid = {
  operatorId: "operator-example-01",
  signerAddress: "0x1111111111111111111111111111111111111111",
  certificateSpkiSha256:
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  contactUrl: "https://operator.example.invalid/sentinel-review",
  submittedAt: "2026-08-11T12:00:00.000Z",
  attestation: "UNVERIFIED_OPERATOR_ATTESTATION",
};

test("accepts a closed public-only operator attestation", () => {
  assert.deepEqual(validateOperatorAttestation(valid), valid);
});

test("rejects secret-like fields even when nested", () => {
  assert.throws(() =>
    validateOperatorAttestation({
      ...valid,
      review: { privateKey: "never-commit-a-key" },
    }),
  );
});

test("rejects fields that cannot establish a safe public review record", () => {
  for (const value of [
    { ...valid, operatorId: "Operator 1" },
    { ...valid, signerAddress: "0x1111" },
    { ...valid, certificateSpkiSha256: "A".repeat(64) },
    { ...valid, contactUrl: "http://operator.example.invalid" },
    { ...valid, submittedAt: "not-a-date" },
    { ...valid, attestation: "INDEPENDENT_OPERATOR" },
  ]) {
    assert.throws(() => validateOperatorAttestation(value));
  }
});
