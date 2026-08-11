import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const REQUIRED_KEYS = [
  "operatorId",
  "signerAddress",
  "certificateSpkiSha256",
  "contactUrl",
  "submittedAt",
  "attestation",
];
const SECRET_KEY = /(private|mnemonic|seed|secret|password|token|credential)/i;
const OPERATOR_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ETHEREUM_ADDRESS = /^0x[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const ATTESTATION = "UNVERIFIED_OPERATOR_ATTESTATION";

export function validateOperatorAttestation(value) {
  rejectSecretLikeKeys(value);
  const record = object(value, "attestation");
  exactKeys(record, REQUIRED_KEYS);

  if (typeof record.operatorId !== "string" || !OPERATOR_ID.test(record.operatorId)) {
    throw new Error("operatorId must be a lowercase dash-separated identifier");
  }
  if (
    typeof record.signerAddress !== "string" ||
    !ETHEREUM_ADDRESS.test(record.signerAddress)
  ) {
    throw new Error("signerAddress must be a lowercase 20-byte Ethereum address");
  }
  if (
    typeof record.certificateSpkiSha256 !== "string" ||
    !SHA256.test(record.certificateSpkiSha256)
  ) {
    throw new Error("certificateSpkiSha256 must be a lowercase SHA-256 fingerprint");
  }
  validateHttpsUrl(record.contactUrl);
  validateTimestamp(record.submittedAt);
  if (record.attestation !== ATTESTATION) {
    throw new Error(`attestation must equal ${ATTESTATION}`);
  }
  return { ...record };
}

function object(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value;
}

function exactKeys(value, required) {
  const actual = Object.keys(value).sort();
  const expected = [...required].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error("attestation must contain exactly the approved public fields");
  }
}

function rejectSecretLikeKeys(value) {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) {
      throw new Error(`secret-like field rejected: ${key}`);
    }
    rejectSecretLikeKeys(child);
  }
}

function validateHttpsUrl(value) {
  if (typeof value !== "string") throw new Error("contactUrl must be a string");
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("contactUrl must be an HTTPS URL");
  }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password) {
    throw new Error("contactUrl must be a credential-free HTTPS URL");
  }
}

function validateTimestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    throw new Error("submittedAt must be an ISO-8601 timestamp");
  }
  if (!Number.isFinite(Date.parse(value))) {
    throw new Error("submittedAt must be an ISO-8601 timestamp");
  }
}

async function main() {
  const [path] = process.argv.slice(2);
  if (!path) {
    throw new Error("usage: validate-operator-attestation.mjs <attestation.json>");
  }
  const content = await readFile(resolve(path), "utf8");
  let value;
  try {
    value = JSON.parse(content);
  } catch {
    throw new Error("attestation file is not valid JSON");
  }
  const record = validateOperatorAttestation(value);
  process.stdout.write(
    `${JSON.stringify({ status: "ATTESTATION_VALID_NOT_INDEPENDENCE_PROOF", operatorId: record.operatorId })}\n`,
  );
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
