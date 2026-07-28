import test from "node:test";
import assert from "node:assert/strict";
import { Wallet, getBytes } from "ethers";
import {
  executionDigest,
  IsolatedSignerService,
} from "../../../dist/services/coordinator/src/signing.js";
import {
  SignerProtocolHandler,
} from "../../../dist/services/coordinator/src/signer-protocol-handler.js";
import {
  RemoteSignerClient,
} from "../../../dist/services/coordinator/src/remote-signer.js";

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

function fixture(transform = (value) => value) {
  const wallet = Wallet.createRandom();
  const service = new IsolatedSignerService(
    {
      address: wallet.address,
      signMessageDigest: async (digest) => wallet.signMessage(getBytes(digest)),
    },
    { assertFinalized: async () => {} },
    {
      chainId: 421614n,
      adapter,
      verificationTarget: target,
      maxTtlSeconds: 120n,
    },
    () => 100n,
  );
  const handler = new SignerProtocolHandler(
    service,
    { reserve: async () => "RESERVED", close: () => {} },
    {
      coordinatorId: "coordinator-west",
      coordinatorSpkiSha256: peer,
      maxRequestTtlSeconds: 60,
    },
    () => 100,
  );
  const calls = [];
  const transport = {
    post: async (url, body, expected) => {
      calls.push({ url, body, expected });
      const reply = await handler.handle(peer, body);
      return transform({ ...reply, authenticatedPeerSpkiSha256: peer });
    },
  };
  const client = new RemoteSignerClient(
    {
      url: "https://signer-one.example/v2/sign",
      address: wallet.address.toLowerCase(),
      peerSpkiSha256: peer,
      coordinatorId: "coordinator-west",
      requestTtlSeconds: 30,
    },
    transport,
    () => h("a"),
    () => 100,
  );
  return { wallet, client, calls };
}

test("sends the complete v2 authorization through pinned authenticated transport", async () => {
  const { wallet, client, calls } = fixture();
  const share = await client.sign(envelope, authorization);
  assert.equal(share.address, wallet.address.toLowerCase());
  assert.equal(share.digest, executionDigest(envelope));
  assert.equal(calls[0].url, "https://signer-one.example/v2/sign");
  assert.equal(calls[0].expected, peer);
  assert.deepEqual(JSON.parse(calls[0].body).authorization, authorization);
  assert.match(calls[0].body, /sentinel-signer\/v2/);
  assert.match(calls[0].body, new RegExp(authorization.witness.transactionId));
  assert.match(calls[0].body, /governance\.example\/proposal\/7/);
  assert.match(calls[0].body, /transfer 1 token/);
  assert.match(calls[0].body, /authorization required/);
});

test("rejects v1 or altered authenticated responses", async () => {
  const mutations = [
    (value) => ({ ...value, authenticatedPeerSpkiSha256: h("e") }),
    (value) => ({ ...value, body: value.body.replace(h("a"), h("b")) }),
    (value) => ({
      ...value,
      body: value.body.replace(
        /"signer":"0x[0-9a-f]{40}"/,
        `"signer":"${a("9")}"`,
      ),
    }),
    (value) => ({
      ...value,
      body: value.body.replace(executionDigest(envelope), h("9")),
    }),
    (value) => ({
      ...value,
      body: value.body.replace(
        /"signature":"0x[0-9a-f]{130}"/,
        `"signature":"0x${"1".repeat(130)}"`,
      ),
    }),
    (value) => ({
      ...value,
      body: value.body.replace("sentinel-signer/v2", "sentinel-signer/v1"),
    }),
  ];
  for (const mutate of mutations) {
    const { client } = fixture(mutate);
    await assert.rejects(client.sign(envelope, authorization));
  }
});

test("requires safe endpoint and identity configuration", () => {
  const transport = {
    post: async () => ({
      status: 500,
      body: "",
      authenticatedPeerSpkiSha256: peer,
    }),
  };
  for (const change of [
    { url: "http://signer.example" },
    { url: "https://user:secret@signer.example" },
    { url: "https://localhost" },
    { url: "https://127.0.0.1" },
    { url: "https://signer.example:8443" },
    { address: a("F") },
    { peerSpkiSha256: h("F") },
    { requestTtlSeconds: 0 },
  ]) {
    assert.throws(
      () =>
        new RemoteSignerClient(
          {
            url: "https://signer.example/sign",
            address: a("1"),
            peerSpkiSha256: peer,
            coordinatorId: "coordinator-west",
            requestTtlSeconds: 30,
            ...change,
          },
          transport,
          () => h("a"),
          () => 100,
        ),
    );
  }
});

test("does not leak transport response details", async () => {
  const transport = {
    post: async () => ({
      status: 503,
      body: '{"secret":"provider token"}',
      authenticatedPeerSpkiSha256: peer,
    }),
  };
  const client = new RemoteSignerClient(
    {
      url: "https://signer.example/sign",
      address: a("1"),
      peerSpkiSha256: peer,
      coordinatorId: "coordinator-west",
      requestTtlSeconds: 30,
    },
    transport,
    () => h("a"),
    () => 100,
  );
  await assert.rejects(
    client.sign(envelope, authorization),
    (error) => !error.message.includes("provider token"),
  );
});
