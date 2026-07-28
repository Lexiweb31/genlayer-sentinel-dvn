import test from "node:test";
import assert from "node:assert/strict";
import { Wallet, getBytes, verifyMessage } from "ethers";
import {
  IsolatedSignerService,
  executionDigest,
} from "../../../dist/services/coordinator/src/signing.js";
import {
  decodeSignerResponse,
  encodeSignerRequest,
  signerAuthorizationHash,
} from "../../../dist/services/coordinator/src/signer-protocol.js";
import {
  SignerProtocolHandler,
} from "../../../dist/services/coordinator/src/signer-protocol-handler.js";

const h = (n) => `0x${n.repeat(64)}`;
const a = (n) => `0x${n.repeat(40)}`;
const peer = h("f");
const adapter = a("1");
const target = a("2");
const envelope = {
  chainId: 421614n,
  adapter,
  verificationTarget: target,
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
  finalizedAt: 90,
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

function fixture(options = {}) {
  const wallet = Wallet.createRandom();
  const finalityCalls = [];
  const reserveCalls = [];
  const service = new IsolatedSignerService(
    {
      address: wallet.address,
      signMessageDigest: async (digest) => wallet.signMessage(getBytes(digest)),
    },
    {
      assertFinalized:
        options.assertFinalized ??
        (async (...args) => {
          finalityCalls.push(args);
        }),
    },
    {
      chainId: 421614n,
      adapter,
      verificationTarget: target,
      maxTtlSeconds: 120n,
    },
    () => 100n,
  );
  const store = {
    reserve:
      options.reserve ??
      (async (...args) => {
        reserveCalls.push(args);
        return "RESERVED";
      }),
    close: () => {},
  };
  const handler = new SignerProtocolHandler(
    service,
    store,
    {
      coordinatorId: "coordinator-west",
      coordinatorSpkiSha256: peer,
      maxRequestTtlSeconds: 60,
    },
    () => 100,
  );
  return { wallet, handler, finalityCalls, reserveCalls };
}

test("authenticates, binds replay state, independently validates, and signs v2", async () => {
  const { wallet, handler, finalityCalls, reserveCalls } = fixture();
  const reply = await handler.handle(peer, encodeSignerRequest(request));
  const response = decodeSignerResponse(reply.body);
  assert.equal(reply.status, 200);
  assert.equal(response.requestId, request.requestId);
  assert.equal(response.signer, wallet.address.toLowerCase());
  assert.equal(response.digest, executionDigest(envelope));
  assert.equal(
    verifyMessage(getBytes(response.digest), response.signature).toLowerCase(),
    wallet.address.toLowerCase(),
  );
  assert.deepEqual(reserveCalls, [
    [
      "coordinator-west",
      request.requestId,
      envelope.guid,
      executionDigest(envelope),
      signerAuthorizationHash(authorization),
      130,
      100,
    ],
  ]);
  assert.deepEqual(finalityCalls, [[envelope, authorization]]);
});

test("fails closed on peer, coordinator, freshness, and lifetime", async () => {
  const { handler } = fixture();
  for (const [authenticated, value, code] of [
    [h("e"), request, "AUTHENTICATION_FAILED"],
    [peer, { ...request, coordinatorId: "coordinator-east" }, "AUTHENTICATION_FAILED"],
    [peer, { ...request, issuedAt: 101, expiresAt: 130 }, "INVALID_REQUEST"],
    [peer, { ...request, issuedAt: 90, expiresAt: 99 }, "REQUEST_EXPIRED"],
    [peer, { ...request, expiresAt: 161 }, "INVALID_REQUEST"],
  ]) {
    const reply = await handler.handle(authenticated, encodeSignerRequest(value));
    assert.notEqual(reply.status, 200);
    assert.equal(JSON.parse(reply.body).error.code, code);
    assert.equal(JSON.parse(reply.body).version, "sentinel-signer/v2");
  }
});

test("maps replay, conflict, and finality refusal without leaking raw errors", async () => {
  for (const [disposition, code] of [
    ["DUPLICATE", "REPLAYED_REQUEST"],
    ["CONFLICT", "CONFLICTING_REQUEST"],
  ]) {
    const { handler } = fixture({ reserve: async () => disposition });
    const reply = await handler.handle(peer, encodeSignerRequest(request));
    assert.equal(JSON.parse(reply.body).error.code, code);
  }
  const { handler } = fixture({
    assertFinalized: async () => {
      throw new Error("secret upstream token");
    },
  });
  const reply = await handler.handle(peer, encodeSignerRequest(request));
  assert.equal(JSON.parse(reply.body).error.code, "SIGNING_REFUSED");
  assert.doesNotMatch(reply.body, /secret upstream token/);
});

test("rejects malformed requests before replay reservation or signing", async () => {
  const { handler, reserveCalls, finalityCalls } = fixture();
  const reply = await handler.handle(peer, "{broken");
  assert.equal(reply.status, 400);
  assert.equal(JSON.parse(reply.body).error.code, "INVALID_REQUEST");
  assert.deepEqual(reserveCalls, []);
  assert.deepEqual(finalityCalls, []);
});
