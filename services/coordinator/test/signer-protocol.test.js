import test from "node:test";
import assert from "node:assert/strict";
import {
  decodeSignerRequest,
  decodeSignerResponse,
  encodeSignerRequest,
  encodeSignerResponse,
  signerAuthorizationHash,
  signerRequestHash,
} from "../../../dist/services/coordinator/src/signer-protocol.js";

const h = (n) => `0x${n.repeat(64)}`;
const a = (n) => `0x${n.repeat(40)}`;
const envelope = {
  chainId: 421614n,
  adapter: a("1"),
  verificationTarget: a("2"),
  guid: h("3"),
  packetDigest: h("4"),
  evidenceDigest: h("5"),
  callData: "0x1234",
  expiry: 200n,
};
const result = {
  guid: h("3"),
  packetDigest: h("4"),
  evidenceDigest: h("5"),
  decision: "ALLOW",
  reasonCode: "GENLAYER_FINALIZED_ALLOW",
  finalizedAt: 100,
  policyVersion: "v1",
};
const authorization = {
  witness: {
    transactionId: h("9"),
    evidenceUri: "https://governance.example/proposal/7",
    decodedAction: "transfer 1 token",
    policy: "authorization required",
  },
  result,
};
const request = {
  version: "sentinel-signer/v2",
  requestId: h("a"),
  coordinatorId: "coordinator-west",
  issuedAt: 100,
  expiresAt: 130,
  envelope,
  authorization,
};

test("encodes a fixed-order canonical v2 request and round trips bigint fields", () => {
  const body = encodeSignerRequest(request);
  assert.equal(
    body,
    `{"version":"sentinel-signer/v2","requestId":"${h("a")}","coordinatorId":"coordinator-west","issuedAt":100,"expiresAt":130,"envelope":{"chainId":"421614","adapter":"${a("1")}","verificationTarget":"${a("2")}","guid":"${h("3")}","packetDigest":"${h("4")}","evidenceDigest":"${h("5")}","callData":"0x1234","expiry":"200"},"authorization":{"witness":{"transactionId":"${h("9")}","evidenceUri":"https://governance.example/proposal/7","decodedAction":"transfer 1 token","policy":"authorization required"},"result":{"guid":"${h("3")}","packetDigest":"${h("4")}","evidenceDigest":"${h("5")}","decision":"ALLOW","reasonCode":"GENLAYER_FINALIZED_ALLOW","finalizedAt":100,"policyVersion":"v1"}}}`,
  );
  assert.deepEqual(decodeSignerRequest(body), request);
  assert.match(signerRequestHash(request), /^0x[0-9a-f]{64}$/);
  assert.match(signerAuthorizationHash(authorization), /^0x[0-9a-f]{64}$/);
});

test("authorization hash binds every witness and result field", () => {
  const digest = signerAuthorizationHash(authorization);
  const changes = [
    { ...authorization, witness: { ...authorization.witness, transactionId: h("8") } },
    {
      ...authorization,
      witness: { ...authorization.witness, evidenceUri: "https://governance.example/proposal/8" },
    },
    { ...authorization, witness: { ...authorization.witness, decodedAction: "different" } },
    { ...authorization, witness: { ...authorization.witness, policy: "different" } },
    { ...authorization, result: { ...result, guid: h("8") } },
    { ...authorization, result: { ...result, packetDigest: h("8") } },
    { ...authorization, result: { ...result, evidenceDigest: h("8") } },
    { ...authorization, result: { ...result, decision: "DENY" } },
    { ...authorization, result: { ...result, reasonCode: "GENLAYER_FINALIZED_DENY" } },
    { ...authorization, result: { ...result, finalizedAt: 101 } },
    { ...authorization, result: { ...result, policyVersion: "v2" } },
  ];
  for (const changed of changes) {
    assert.notEqual(signerAuthorizationHash(changed), digest);
  }
});

test("rejects malformed, v1, reordered, missing, or inconsistently bound requests", () => {
  const valid = JSON.parse(encodeSignerRequest(request));
  const reordered = {
    ...valid,
    authorization: {
      result: valid.authorization.result,
      witness: valid.authorization.witness,
    },
  };
  const missingWitnessField = structuredClone(valid);
  delete missingWitnessField.authorization.witness.policy;
  const bad = [
    { ...valid, version: "sentinel-signer/v1" },
    { ...valid, extra: true },
    { ...valid, requestId: h("A") },
    { ...valid, issuedAt: 1.5 },
    { ...valid, envelope: { ...valid.envelope, chainId: "01" } },
    { ...valid, envelope: { ...valid.envelope, guid: h("8") } },
    { ...valid, authorization: { ...valid.authorization, extra: true } },
    reordered,
    missingWitnessField,
    {
      ...valid,
      authorization: {
        ...valid.authorization,
        witness: { ...valid.authorization.witness, transactionId: h("A") },
      },
    },
    {
      ...valid,
      authorization: {
        ...valid.authorization,
        witness: { ...valid.authorization.witness, evidenceUri: "http://governance.example" },
      },
    },
    {
      ...valid,
      authorization: {
        ...valid.authorization,
        witness: {
          ...valid.authorization.witness,
          evidenceUri: "https://user:secret@governance.example",
        },
      },
    },
    {
      ...valid,
      authorization: {
        ...valid.authorization,
        witness: { ...valid.authorization.witness, evidenceUri: "https://" },
      },
    },
    {
      ...valid,
      authorization: {
        ...valid.authorization,
        witness: { ...valid.authorization.witness, decodedAction: "" },
      },
    },
    {
      ...valid,
      authorization: {
        ...valid.authorization,
        witness: { ...valid.authorization.witness, policy: "" },
      },
    },
    {
      ...valid,
      authorization: {
        ...valid.authorization,
        result: { ...valid.authorization.result, decision: "MAYBE" },
      },
    },
    {
      ...valid,
      authorization: {
        ...valid.authorization,
        result: { ...valid.authorization.result, reasonCode: "" },
      },
    },
  ];
  for (const value of bad) {
    assert.throws(() => decodeSignerRequest(JSON.stringify(value)));
  }
  assert.throws(() => decodeSignerRequest("not json"));
  assert.throws(() => decodeSignerRequest("[]"));
});

test("enforces UTF-8 semantic and total request byte bounds", () => {
  const valid = JSON.parse(encodeSignerRequest(request));
  const oversized = [
    ["evidenceUri", `https://governance.example/${"é".repeat(1020)}`],
    ["decodedAction", "é".repeat(4097)],
    ["policy", "é".repeat(4097)],
  ];
  for (const [field, value] of oversized) {
    const changed = structuredClone(valid);
    changed.authorization.witness[field] = value;
    assert.throws(() => decodeSignerRequest(JSON.stringify(changed)));
  }
  assert.throws(() =>
    decodeSignerRequest(`${encodeSignerRequest(request)}${" ".repeat(32769)}`),
  );
});

test("strictly encodes and decodes v2 signer responses", () => {
  const response = {
    version: "sentinel-signer/v2",
    requestId: h("a"),
    signer: a("6"),
    digest: h("7"),
    signature: `0x${"1".repeat(130)}`,
  };
  const body = encodeSignerResponse(response);
  assert.deepEqual(decodeSignerResponse(body), response);
  for (const value of [
    { ...response, version: "sentinel-signer/v1" },
    { ...response, signer: a("F") },
    { ...response, signature: "0x12" },
    { ...response, extra: true },
  ]) {
    assert.throws(() => decodeSignerResponse(JSON.stringify(value)));
  }
});
