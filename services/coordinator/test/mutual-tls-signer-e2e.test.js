import test from "node:test";
import assert from "node:assert/strict";
import { createHash, X509Certificate } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Wallet, getBytes, verifyMessage } from "ethers";
import {
  executionDigest,
  IsolatedSignerService,
} from "../../../dist/services/coordinator/src/signing.js";
import {
  MutualTlsSignerDaemon,
} from "../../../dist/services/coordinator/src/signer-daemon.js";
import {
  NodeMutualTlsSignerTransport,
} from "../../../dist/services/coordinator/src/mutual-tls-signer-transport.js";
import {
  RemoteSignerClient,
} from "../../../dist/services/coordinator/src/remote-signer.js";
import {
  SignerProtocolHandler,
} from "../../../dist/services/coordinator/src/signer-protocol-handler.js";
import {
  SqliteSignerReplayStore,
} from "../../../dist/services/coordinator/src/signer-replay-store.js";
import {
  createMutualTlsCertificateFixture,
} from "./mtls-test-certificates.js";

const h = (n) => `0x${n.repeat(64)}`;
const a = (n) => `0x${n.repeat(40)}`;
const adapter = a("1");
const verificationTarget = a("2");
const envelope = {
  chainId: 421614n,
  adapter,
  verificationTarget,
  guid: h("3"),
  packetDigest: h("4"),
  evidenceDigest: h("5"),
  callData: "0x1234",
  expiry: 200n,
};
const authorization = {
  witness: {
    transactionId: h("9"),
    evidenceUri: "https://governance.example/proposal/7",
    decodedAction: "transfer 1 token",
    policy: "authorization required",
  },
  result: {
    guid: envelope.guid,
    packetDigest: envelope.packetDigest,
    evidenceDigest: envelope.evidenceDigest,
    decision: "ALLOW",
    reasonCode: "GENLAYER_FINALIZED_ALLOW",
    finalizedAt: 90,
    policyVersion: "v1",
  },
};
const endpoint = "https://signer.example/v2/sign";
const coordinatorId = "coordinator-west";
const now = 100;

function spkiFingerprint(certificate) {
  const publicKey = new X509Certificate(certificate).publicKey.export({
    type: "spki",
    format: "der",
  });
  return `0x${createHash("sha256").update(publicKey).digest("hex")}`;
}

function daemonOptions(certificates) {
  return {
    identity: {
      key: certificates.signerKey,
      cert: certificates.signerCert,
      ca: certificates.caCert,
    },
    host: "127.0.0.1",
    port: 0,
    requestTimeoutMs: 1_000,
    headersTimeoutMs: 1_000,
    keepAliveTimeoutMs: 500,
  };
}

function signerFixture(wallet, events, finalityCalls, keyCalls) {
  return new IsolatedSignerService(
    {
      address: wallet.address,
      signMessageDigest: async (digest) => {
        events.push("key");
        keyCalls.push(digest);
        return wallet.signMessage(getBytes(digest));
      },
    },
    {
      assertFinalized: async (...args) => {
        events.push("finality");
        finalityCalls.push(args);
      },
    },
    {
      chainId: 421614n,
      adapter,
      verificationTarget,
      maxTtlSeconds: 120n,
    },
    () => BigInt(now),
  );
}

function replayFixture(path, events, reserveCalls) {
  const store = new SqliteSignerReplayStore(path);
  return {
    reserve: async (...args) => {
      events.push("replay");
      reserveCalls.push(args);
      return store.reserve(...args);
    },
    close: () => store.close(),
  };
}

function handlerFixture(signer, replay, coordinatorSpki, handlerCalls) {
  const handler = new SignerProtocolHandler(
    signer,
    replay,
    {
      coordinatorId,
      coordinatorSpkiSha256: coordinatorSpki,
      maxRequestTtlSeconds: 60,
    },
    () => now,
  );
  return {
    handle: async (authenticatedPeerSpki, body) => {
      handlerCalls.push({ authenticatedPeerSpki, body });
      return handler.handle(authenticatedPeerSpki, body);
    },
  };
}

function transportFixture(certificates, port, identity, transportReplies) {
  const transport = new NodeMutualTlsSignerTransport({
    identity: {
      key: identity.key,
      cert: identity.cert,
      ca: certificates.caCert,
    },
    timeoutMs: 1_000,
    dial: { host: "127.0.0.1", port },
  });
  return {
    post: async (...args) => {
      const reply = await transport.post(...args);
      transportReplies.push(reply);
      return reply;
    },
  };
}

function remoteClient(wallet, peerSpkiSha256, transport, requestIds) {
  return new RemoteSignerClient(
    {
      url: endpoint,
      address: wallet.address.toLowerCase(),
      peerSpkiSha256,
      coordinatorId,
      requestTtlSeconds: 30,
    },
    transport,
    () => {
      const requestId = requestIds.shift();
      assert.ok(requestId, "unexpected signer request");
      return requestId;
    },
    () => now,
  );
}

function registerCleanup(t, state, certificates, root) {
  t.after(async () => {
    try {
      if (state.daemon) await state.daemon.stop();
    } finally {
      try {
        state.store?.close();
      } finally {
        certificates.cleanup();
        rmSync(root, { recursive: true, force: true });
      }
    }
  });
}

test("signs a complete authorization through the authenticated socket-to-key boundary", async (t) => {
  const certificates = createMutualTlsCertificateFixture();
  const root = mkdtempSync(join(tmpdir(), "sentinel-mtls-e2e-"));
  const databasePath = join(root, "replay.db");
  const state = { daemon: undefined, store: undefined };
  registerCleanup(t, state, certificates, root);

  const coordinatorSpki = spkiFingerprint(certificates.coordinatorCert);
  const signerSpki = spkiFingerprint(certificates.signerCert);
  const wallet = Wallet.createRandom();
  const events = [];
  const reserveCalls = [];
  const finalityCalls = [];
  const keyCalls = [];
  const handlerCalls = [];
  const transportReplies = [];
  state.store = replayFixture(databasePath, events, reserveCalls);
  const signer = signerFixture(wallet, events, finalityCalls, keyCalls);
  const handler = handlerFixture(
    signer,
    state.store,
    coordinatorSpki,
    handlerCalls,
  );
  state.daemon = new MutualTlsSignerDaemon(
    handler,
    daemonOptions(certificates),
  );
  const address = await state.daemon.start();
  const transport = transportFixture(
    certificates,
    address.port,
    {
      key: certificates.coordinatorKey,
      cert: certificates.coordinatorCert,
    },
    transportReplies,
  );
  const client = remoteClient(wallet, signerSpki, transport, [h("a")]);

  const share = await client.sign(envelope, authorization);
  const digest = executionDigest(envelope);

  assert.deepEqual(share, {
    address: wallet.address.toLowerCase(),
    digest,
    signature: share.signature,
  });
  assert.equal(
    verifyMessage(getBytes(digest), share.signature).toLowerCase(),
    wallet.address.toLowerCase(),
  );
  assert.deepEqual(events, ["replay", "finality", "key"]);
  assert.equal(reserveCalls.length, 1);
  assert.deepEqual(finalityCalls, [[envelope, authorization]]);
  assert.deepEqual(keyCalls, [digest]);
  assert.equal(handlerCalls.length, 1);
  assert.equal(handlerCalls[0].authenticatedPeerSpki, coordinatorSpki);
  assert.deepEqual(
    JSON.parse(handlerCalls[0].body).authorization,
    authorization,
  );
  assert.equal(transportReplies.length, 1);
  assert.equal(
    transportReplies[0].authenticatedPeerSpkiSha256,
    signerSpki,
  );
});

test("separates trusted TLS membership from coordinator application identity", async (t) => {
  const certificates = createMutualTlsCertificateFixture();
  const root = mkdtempSync(join(tmpdir(), "sentinel-mtls-identity-e2e-"));
  const databasePath = join(root, "replay.db");
  const state = { daemon: undefined, store: undefined };
  registerCleanup(t, state, certificates, root);

  const allowedCoordinatorSpki = spkiFingerprint(
    certificates.coordinatorCert,
  );
  const alternateCoordinatorSpki = spkiFingerprint(
    certificates.alternateCoordinatorCert,
  );
  const signerSpki = spkiFingerprint(certificates.signerCert);
  const wallet = Wallet.createRandom();
  const events = [];
  const reserveCalls = [];
  const finalityCalls = [];
  const keyCalls = [];
  const handlerCalls = [];
  const transportReplies = [];
  state.store = replayFixture(databasePath, events, reserveCalls);
  const signer = signerFixture(wallet, events, finalityCalls, keyCalls);
  const handler = handlerFixture(
    signer,
    state.store,
    allowedCoordinatorSpki,
    handlerCalls,
  );
  state.daemon = new MutualTlsSignerDaemon(
    handler,
    daemonOptions(certificates),
  );
  const address = await state.daemon.start();
  const transport = transportFixture(
    certificates,
    address.port,
    {
      key: certificates.alternateCoordinatorKey,
      cert: certificates.alternateCoordinatorCert,
    },
    transportReplies,
  );
  const client = remoteClient(wallet, signerSpki, transport, [h("a")]);

  await assert.rejects(
    client.sign(envelope, authorization),
    /^Error: remote signer refused request$/,
  );

  assert.equal(handlerCalls.length, 1);
  assert.equal(
    handlerCalls[0].authenticatedPeerSpki,
    alternateCoordinatorSpki,
  );
  assert.equal(transportReplies.length, 1);
  assert.equal(transportReplies[0].status, 401);
  assert.equal(
    JSON.parse(transportReplies[0].body).error.code,
    "AUTHENTICATION_FAILED",
  );
  assert.equal(
    transportReplies[0].authenticatedPeerSpkiSha256,
    signerSpki,
  );
  assert.deepEqual(events, []);
  assert.equal(reserveCalls.length, 0);
  assert.equal(finalityCalls.length, 0);
  assert.equal(keyCalls.length, 0);
});

test("keeps authorization durable across restart and refuses a wrong signer pin before dispatch", async (t) => {
  const certificates = createMutualTlsCertificateFixture();
  const root = mkdtempSync(join(tmpdir(), "sentinel-mtls-restart-e2e-"));
  const databasePath = join(root, "replay.db");
  const state = { daemon: undefined, store: undefined };
  registerCleanup(t, state, certificates, root);

  const coordinatorSpki = spkiFingerprint(certificates.coordinatorCert);
  const signerSpki = spkiFingerprint(certificates.signerCert);
  const differentValidSpki = spkiFingerprint(
    certificates.alternateCoordinatorCert,
  );
  const wallet = Wallet.createRandom();
  const events = [];
  const reserveCalls = [];
  const finalityCalls = [];
  const keyCalls = [];
  const handlerCalls = [];
  const transportReplies = [];
  const signer = signerFixture(wallet, events, finalityCalls, keyCalls);

  state.store = replayFixture(databasePath, events, reserveCalls);
  let handler = handlerFixture(
    signer,
    state.store,
    coordinatorSpki,
    handlerCalls,
  );
  state.daemon = new MutualTlsSignerDaemon(
    handler,
    daemonOptions(certificates),
  );
  let address = await state.daemon.start();
  let transport = transportFixture(
    certificates,
    address.port,
    {
      key: certificates.coordinatorKey,
      cert: certificates.coordinatorCert,
    },
    transportReplies,
  );
  let client = remoteClient(wallet, signerSpki, transport, [h("a")]);

  const share = await client.sign(envelope, authorization);
  assert.equal(share.digest, executionDigest(envelope));
  await state.daemon.stop();
  state.daemon = undefined;
  state.store.close();
  state.store = undefined;

  state.store = replayFixture(databasePath, events, reserveCalls);
  handler = handlerFixture(
    signer,
    state.store,
    coordinatorSpki,
    handlerCalls,
  );
  state.daemon = new MutualTlsSignerDaemon(
    handler,
    daemonOptions(certificates),
  );
  address = await state.daemon.start();
  transport = transportFixture(
    certificates,
    address.port,
    {
      key: certificates.coordinatorKey,
      cert: certificates.coordinatorCert,
    },
    transportReplies,
  );
  client = remoteClient(wallet, signerSpki, transport, [h("b")]);
  const changedAuthorization = {
    ...authorization,
    witness: {
      ...authorization.witness,
      policy: "changed authorization policy",
    },
  };

  await assert.rejects(
    client.sign(envelope, changedAuthorization),
    /^Error: remote signer refused request$/,
  );

  assert.equal(transportReplies.at(-1).status, 409);
  assert.equal(
    JSON.parse(transportReplies.at(-1).body).error.code,
    "CONFLICTING_REQUEST",
  );
  assert.deepEqual(events, ["replay", "finality", "key", "replay"]);
  assert.equal(reserveCalls.length, 2);
  assert.equal(finalityCalls.length, 1);
  assert.equal(keyCalls.length, 1);
  assert.equal(handlerCalls.length, 2);

  const wrongPinTransport = transportFixture(
    certificates,
    address.port,
    {
      key: certificates.coordinatorKey,
      cert: certificates.coordinatorCert,
    },
    transportReplies,
  );
  const wrongPinClient = remoteClient(
    wallet,
    differentValidSpki,
    wrongPinTransport,
    [h("c")],
  );
  await assert.rejects(
    wrongPinClient.sign(envelope, authorization),
    /^Error: remote signer unavailable$/,
  );

  assert.equal(handlerCalls.length, 2);
  assert.equal(reserveCalls.length, 2);
  assert.equal(finalityCalls.length, 1);
  assert.equal(keyCalls.length, 1);
  assert.equal(transportReplies.length, 2);
});
