import test from "node:test";
import assert from "node:assert/strict";
import { createHash, X509Certificate } from "node:crypto";
import { request as httpsRequest } from "node:https";
import { connect as tlsConnect } from "node:tls";
import { Wallet, getBytes } from "ethers";
import {
  IsolatedSignerService,
} from "../../../dist/services/coordinator/src/signing.js";
import {
  decodeSignerResponse,
  encodeSignerRequest,
} from "../../../dist/services/coordinator/src/signer-protocol.js";
import {
  SignerProtocolHandler,
} from "../../../dist/services/coordinator/src/signer-protocol-handler.js";
import {
  MutualTlsSignerDaemon,
} from "../../../dist/services/coordinator/src/signer-daemon.js";
import {
  createMutualTlsCertificateFixture,
} from "./mtls-test-certificates.js";

const h = (n) => `0x${n.repeat(64)}`;
const a = (n) => `0x${n.repeat(40)}`;
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
const signerRequest = {
  version: "sentinel-signer/v2",
  requestId: h("a"),
  coordinatorId: "coordinator-west",
  issuedAt: 100,
  expiresAt: 130,
  envelope,
  authorization,
};
const TRANSPORT_REFUSED =
  '{"version":"sentinel-signer/v2","error":{"code":"TRANSPORT_REFUSED","message":"request refused"}}';

function spkiFingerprint(certificate) {
  const publicKey = new X509Certificate(certificate).publicKey.export({
    type: "spki",
    format: "der",
  });
  return `0x${createHash("sha256").update(publicKey).digest("hex")}`;
}

function handlerFixture(coordinatorSpkiSha256, options = {}) {
  const wallet = Wallet.createRandom();
  const finalityCalls = [];
  const keyCalls = [];
  const service = new IsolatedSignerService(
    {
      address: wallet.address,
      signMessageDigest: async (digest) => {
        keyCalls.push(digest);
        return wallet.signMessage(getBytes(digest));
      },
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
  const replayCalls = [];
  let closeCalls = 0;
  const handler = new SignerProtocolHandler(
    service,
    {
      reserve: async (...args) => {
        replayCalls.push(args);
        return "RESERVED";
      },
      close: () => {
        closeCalls++;
      },
    },
    {
      coordinatorId: "coordinator-west",
      coordinatorSpkiSha256,
      maxRequestTtlSeconds: 60,
    },
    () => 100,
  );
  const handlerCalls = [];
  const handle = handler.handle.bind(handler);
  handler.handle = async (...args) => {
    handlerCalls.push(args);
    return handle(...args);
  };
  return {
    wallet,
    handler,
    handlerCalls,
    replayCalls,
    finalityCalls,
    keyCalls,
    realHandle: handle,
    get closeCalls() {
      return closeCalls;
    },
  };
}

function daemonOptions(certificates, changes = {}) {
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
    ...changes,
  };
}

function request(address, certificates, body, changes = {}) {
  return new Promise((resolve, reject) => {
    const clientRequest = httpsRequest(
      {
        host: address.host,
        port: address.port,
        method: "POST",
        path: "/v2/sign",
        key: certificates.coordinatorKey,
        cert: certificates.coordinatorCert,
        ca: certificates.caCert,
        minVersion: "TLSv1.3",
        maxVersion: "TLSv1.3",
        servername: "signer.example",
        rejectUnauthorized: true,
        headers: {
          "Content-Type": "application/json",
          "Content-Encoding": "identity",
          "Content-Length": Buffer.byteLength(body),
        },
        ...changes,
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    clientRequest.setTimeout(2_000, () => {
      clientRequest.destroy(new Error("client request timed out"));
    });
    clientRequest.on("error", reject);
    clientRequest.end(body);
  });
}

function post(address, certificates, body) {
  return request(address, certificates, body);
}

function connectTls(address, certificates, changes = {}) {
  return new Promise((resolve, reject) => {
    const socket = tlsConnect({
      host: address.host,
      port: address.port,
      key: certificates.coordinatorKey,
      cert: certificates.coordinatorCert,
      ca: certificates.caCert,
      minVersion: "TLSv1.3",
      maxVersion: "TLSv1.3",
      servername: "signer.example",
      rejectUnauthorized: true,
      ...changes,
    });
    socket.once("secureConnect", () => resolve(socket));
    socket.once("error", reject);
  });
}

async function rawExchange(address, certificates, wire, changes = {}) {
  const {
    keepOpen = false,
    endAfterMs,
    clientTimeoutMs = 2_000,
    ...tlsChanges
  } = changes;
  const socket = await connectTls(address, certificates, tlsChanges);
  return new Promise((resolve, reject) => {
    const chunks = [];
    let delayedEnd;
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error("raw exchange timed out"));
    }, clientTimeoutMs);
    socket.on("data", (chunk) => chunks.push(chunk));
    socket.once("error", (error) => {
      clearTimeout(timeout);
      if (delayedEnd) clearTimeout(delayedEnd);
      reject(error);
    });
    socket.once("close", () => {
      clearTimeout(timeout);
      if (delayedEnd) clearTimeout(delayedEnd);
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    if (keepOpen) {
      socket.write(wire);
      if (endAfterMs !== undefined) {
        delayedEnd = setTimeout(() => socket.end(), endAfterMs);
      }
    } else {
      socket.end(wire);
    }
  });
}

function parseRawResponse(wire) {
  const [head = "", body = ""] = wire.split("\r\n\r\n", 2);
  const status = Number(/^HTTP\/1\.1 ([0-9]{3})/.exec(head)?.[1]);
  return { status, body };
}

function assertTransportRefusal(response, status) {
  assert.equal(response.status, status);
  assert.equal(response.body, TRANSPORT_REFUSED);
}

function waitFor(predicate, timeoutMs = 2_000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        reject(new Error("condition not reached"));
        return;
      }
      setTimeout(check, 10);
    };
    check();
  });
}

test("serves a canonical signer response over authenticated TLS using the live peer pin", async () => {
  const certificates = createMutualTlsCertificateFixture();
  const expectedPeerPin = spkiFingerprint(certificates.coordinatorCert);
  const fixture = handlerFixture(expectedPeerPin);
  const daemon = new MutualTlsSignerDaemon(
    fixture.handler,
    daemonOptions(certificates),
  );
  const body = encodeSignerRequest(signerRequest);
  assert.doesNotMatch(body, new RegExp(expectedPeerPin));

  try {
    const address = await daemon.start();
    const response = await post(address, certificates, body);
    const decoded = decodeSignerResponse(response.body);
    assert.equal(response.status, 200);
    assert.equal(decoded.version, "sentinel-signer/v2");
    assert.equal(decoded.requestId, signerRequest.requestId);
    assert.equal(decoded.signer, fixture.wallet.address.toLowerCase());
    assert.equal(fixture.handlerCalls.length, 1);
    assert.equal(fixture.handlerCalls[0][0], expectedPeerPin);
    assert.equal(response.headers["content-type"], "application/json");
    assert.equal(response.headers["content-encoding"], "identity");
    assert.equal(
      response.headers["content-length"],
      String(Buffer.byteLength(response.body)),
    );
    assert.equal(response.headers["cache-control"], "no-store");
    assert.equal(response.headers.connection, "close");
  } finally {
    await daemon.stop();
    certificates.cleanup();
  }
});

test("refuses wrong methods, paths, media types, encodings, and duplicate headers before signing", async () => {
  const certificates = createMutualTlsCertificateFixture();
  const fixture = handlerFixture(spkiFingerprint(certificates.coordinatorCert));
  const daemon = new MutualTlsSignerDaemon(
    fixture.handler,
    daemonOptions(certificates),
  );
  const body = encodeSignerRequest(signerRequest);
  try {
    const address = await daemon.start();
    const cases = [
      ["method", 405, { method: "GET" }],
      ["path", 404, { path: "/wrong" }],
      ["missing type", 415, {
        headers: {
          "Content-Encoding": "identity",
          "Content-Length": Buffer.byteLength(body),
        },
      }],
      ["plain type", 415, {
        headers: {
          "Content-Type": "text/plain",
          "Content-Length": Buffer.byteLength(body),
        },
      }],
      ["parameterized type", 415, {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Length": Buffer.byteLength(body),
        },
      }],
      ["gzip encoding", 415, {
        headers: {
          "Content-Type": "application/json",
          "Content-Encoding": "gzip",
          "Content-Length": Buffer.byteLength(body),
        },
      }],
    ];
    for (const [name, status, changes] of cases) {
      const response = await request(address, certificates, body, changes);
      assertTransportRefusal(response, status, name);
    }
    const duplicate = parseRawResponse(
      await rawExchange(
        address,
        certificates,
        `POST /v2/sign HTTP/1.1\r\n` +
          `Host: signer.example\r\n` +
          `Content-Type: application/json\r\n` +
          `Content-Type: application/json\r\n` +
          `Content-Length: ${Buffer.byteLength(body)}\r\n` +
          `Connection: close\r\n\r\n${body}`,
      ),
    );
    assertTransportRefusal(duplicate, 415);
    assert.equal(fixture.handlerCalls.length, 0);
    assert.equal(fixture.replayCalls.length, 0);
    assert.equal(fixture.finalityCalls.length, 0);
    assert.equal(fixture.keyCalls.length, 0);
  } finally {
    await daemon.stop();
    certificates.cleanup();
  }
});

test("refuses declared and streamed request bodies above the byte limit before signing", async () => {
  const certificates = createMutualTlsCertificateFixture();
  const fixture = handlerFixture(spkiFingerprint(certificates.coordinatorCert));
  const daemon = new MutualTlsSignerDaemon(
    fixture.handler,
    daemonOptions(certificates),
  );
  try {
    const address = await daemon.start();
    const declared = await request(address, certificates, "", {
      headers: {
        "Content-Type": "application/json",
        "Content-Length": "32769",
      },
    });
    assertTransportRefusal(declared, 413);

    const chunk = "a".repeat(32_769);
    const streamed = parseRawResponse(
      await rawExchange(
        address,
        certificates,
        `POST /v2/sign HTTP/1.1\r\n` +
          `Host: signer.example\r\n` +
          `Content-Type: application/json\r\n` +
          `Transfer-Encoding: chunked\r\n` +
          `Connection: close\r\n\r\n` +
          `8001\r\n${chunk}\r\n0\r\n\r\n`,
      ),
    );
    assertTransportRefusal(streamed, 413);
    assert.equal(fixture.handlerCalls.length, 0);
    assert.equal(fixture.replayCalls.length, 0);
    assert.equal(fixture.finalityCalls.length, 0);
    assert.equal(fixture.keyCalls.length, 0);
  } finally {
    await daemon.stop();
    certificates.cleanup();
  }
});

test("rejects certificate-less and rogue-CA clients during the TLS handshake", async () => {
  const certificates = createMutualTlsCertificateFixture();
  const fixture = handlerFixture(spkiFingerprint(certificates.coordinatorCert));
  const daemon = new MutualTlsSignerDaemon(
    fixture.handler,
    daemonOptions(certificates),
  );
  const body = encodeSignerRequest(signerRequest);
  try {
    const address = await daemon.start();
    await assert.rejects(
      request(address, certificates, body, {
        key: undefined,
        cert: undefined,
      }),
    );
    await assert.rejects(
      request(address, certificates, body, {
        key: certificates.rogueCoordinatorKey,
        cert: certificates.rogueCoordinatorCert,
      }),
    );
    assert.equal(fixture.handlerCalls.length, 0);
    assert.equal(fixture.replayCalls.length, 0);
    assert.equal(fixture.finalityCalls.length, 0);
    assert.equal(fixture.keyCalls.length, 0);
  } finally {
    await daemon.stop();
    certificates.cleanup();
  }
});

test("bounds partial and aborted requests without poisoning subsequent work", async () => {
  const certificates = createMutualTlsCertificateFixture();
  const fixture = handlerFixture(spkiFingerprint(certificates.coordinatorCert));
  const daemon = new MutualTlsSignerDaemon(
    fixture.handler,
    daemonOptions(certificates, {
      requestTimeoutMs: 100,
      headersTimeoutMs: 100,
      keepAliveTimeoutMs: 100,
    }),
  );
  try {
    const address = await daemon.start();
    let partialHeaders = "";
    try {
      partialHeaders = await rawExchange(
        address,
        certificates,
        "POST /v2/sign HTTP/1.1\r\nHost: signer.example\r\nContent-Ty",
        { keepOpen: true, endAfterMs: 200, clientTimeoutMs: 1_000 },
      );
    } catch (error) {
      assert.notEqual(error.message, "raw exchange timed out");
      partialHeaders = "";
    }
    if (partialHeaders.length > 0) {
      const parsed = parseRawResponse(partialHeaders);
      assert.ok(
        (parsed.status === 503 && parsed.body === TRANSPORT_REFUSED) ||
          parsed.status === 408,
      );
    }

    const partialBody = parseRawResponse(
      await rawExchange(
        address,
        certificates,
        `POST /v2/sign HTTP/1.1\r\n` +
          `Host: signer.example\r\n` +
          `Content-Type: application/json\r\n` +
          `Content-Length: 10\r\n` +
          `Connection: close\r\n\r\n{`,
        { keepOpen: true, clientTimeoutMs: 500 },
      ),
    );
    assertTransportRefusal(partialBody, 503);

    const prematureBody = parseRawResponse(
      await rawExchange(
        address,
        certificates,
        `POST /v2/sign HTTP/1.1\r\n` +
          `Host: signer.example\r\n` +
          `Content-Type: application/json\r\n` +
          `Content-Length: 10\r\n` +
          `Connection: close\r\n\r\n{`,
      ),
    );
    assertTransportRefusal(prematureBody, 503);

    const aborted = await connectTls(address, certificates);
    aborted.write(
      `POST /v2/sign HTTP/1.1\r\n` +
        `Host: signer.example\r\n` +
        `Content-Type: application/json\r\n` +
        `Content-Length: 10\r\n` +
        `Connection: close\r\n\r\n{`,
    );
    aborted.destroy();
    await new Promise((resolve) => aborted.once("close", resolve));
    await waitFor(() => daemon.sockets.size === 0);

    assert.equal(fixture.handlerCalls.length, 0);
    const valid = await post(
      address,
      certificates,
      encodeSignerRequest(signerRequest),
    );
    assert.equal(valid.status, 200);
    assert.equal(fixture.handlerCalls.length, 1);
  } finally {
    await daemon.stop();
    certificates.cleanup();
  }
});

test("validates lifecycle configuration and drains active work through one permanent stop", async () => {
  const certificates = createMutualTlsCertificateFixture();
  const expectedPeerPin = spkiFingerprint(certificates.coordinatorCert);
  let entered;
  const enteredPromise = new Promise((resolve) => {
    entered = resolve;
  });
  let release;
  const releasePromise = new Promise((resolve) => {
    release = resolve;
  });
  const fixture = handlerFixture(expectedPeerPin, {
    assertFinalized: async () => {
      entered();
      await releasePromise;
    },
  });
  const valid = daemonOptions(certificates);
  const unsafe = [
    { host: "" },
    { port: -1 },
    { port: 65_536 },
    { port: 1.5 },
    { requestTimeoutMs: 99 },
    { requestTimeoutMs: 30_001 },
    { requestTimeoutMs: Number.MAX_SAFE_INTEGER + 1 },
    { headersTimeoutMs: 99 },
    { headersTimeoutMs: 30_001 },
    { requestTimeoutMs: 500, headersTimeoutMs: 501 },
    { keepAliveTimeoutMs: 99 },
    { keepAliveTimeoutMs: 5_001 },
    { identity: { ...valid.identity, key: "" } },
    { identity: { ...valid.identity, key: Buffer.alloc(0) } },
    { identity: { ...valid.identity, cert: "" } },
    { identity: { ...valid.identity, ca: "" } },
    { identity: { ...valid.identity, ca: [] } },
    { identity: { ...valid.identity, ca: [Buffer.alloc(0)] } },
  ];
  for (const changes of unsafe) {
    assert.throws(
      () => new MutualTlsSignerDaemon(fixture.handler, { ...valid, ...changes }),
    );
  }

  const daemon = new MutualTlsSignerDaemon(fixture.handler, valid);
  try {
    const address = await daemon.start();
    await assert.rejects(
      daemon.start(),
      /signer daemon unavailable/,
    );
    const activeResponse = post(
      address,
      certificates,
      encodeSignerRequest(signerRequest),
    );
    await enteredPromise;
    const stopping = daemon.stop();
    const sameStopping = daemon.stop();
    assert.strictEqual(stopping, sameStopping);
    await assert.rejects(
      post(address, certificates, encodeSignerRequest(signerRequest)),
    );
    release();
    assert.equal((await activeResponse).status, 200);
    await stopping;
    await daemon.stop();
    assert.equal(fixture.closeCalls, 0);
    await assert.rejects(daemon.start(), /signer daemon unavailable/);
  } finally {
    release();
    await daemon.stop();
  }

  const duringStart = new MutualTlsSignerDaemon(
    handlerFixture(expectedPeerPin).handler,
    valid,
  );
  const starting = duringStart.start();
  const stopping = duringStart.stop();
  assert.strictEqual(stopping, duringStart.stop());
  await starting;
  await stopping;
  await assert.rejects(duringStart.start(), /signer daemon unavailable/);

  let abortedEntered;
  const abortedEnteredPromise = new Promise((resolve) => {
    abortedEntered = resolve;
  });
  let releaseAborted;
  const releaseAbortedPromise = new Promise((resolve) => {
    releaseAborted = resolve;
  });
  const abortedFixture = handlerFixture(expectedPeerPin);
  abortedFixture.handler.handle = async () => {
    abortedEntered();
    await releaseAbortedPromise;
    return { status: 200, body: "{}" };
  };
  const abortedDaemon = new MutualTlsSignerDaemon(
    abortedFixture.handler,
    valid,
  );
  const abortedAddress = await abortedDaemon.start();
  const droppedResponse = post(
    abortedAddress,
    certificates,
    encodeSignerRequest(signerRequest),
  ).catch(() => undefined);
  await abortedEnteredPromise;
  for (const socket of abortedDaemon.sockets) socket.destroy();
  await waitFor(() => abortedDaemon.sockets.size === 0);
  let abortedStopResolved = false;
  const abortedStop = abortedDaemon.stop().then(() => {
    abortedStopResolved = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(abortedStopResolved, false);
  releaseAborted();
  await abortedStop;
  await droppedResponse;

  const neverStarted = new MutualTlsSignerDaemon(
    handlerFixture(expectedPeerPin).handler,
    valid,
  );
  await neverStarted.stop();
  await assert.rejects(neverStarted.start(), /signer daemon unavailable/);
  certificates.cleanup();
});

test("preserves valid handler refusals and sanitizes invalid replies and exceptions", async () => {
  const certificates = createMutualTlsCertificateFixture();
  const fixture = handlerFixture(spkiFingerprint(certificates.coordinatorCert));
  const daemon = new MutualTlsSignerDaemon(
    fixture.handler,
    daemonOptions(certificates),
  );
  const body = encodeSignerRequest(signerRequest);
  const applicationRefusal =
    '{"version":"sentinel-signer/v2","error":{"code":"AUTHENTICATION_FAILED","message":"request refused"}}';
  try {
    const address = await daemon.start();
    fixture.handler.handle = async () => ({
      status: 401,
      body: applicationRefusal,
    });
    const refused = await post(address, certificates, body);
    assert.equal(refused.status, 401);
    assert.equal(refused.body, applicationRefusal);

    for (const reply of [
      { status: 500, body: `FIXTURE_TOKEN${"x".repeat(16_385)}` },
      { status: 199, body: "FIXTURE_TOKEN" },
      { status: 500, body: 123 },
    ]) {
      fixture.handler.handle = async () => reply;
      const invalid = await post(address, certificates, body);
      assertTransportRefusal(invalid, 500);
      assert.doesNotMatch(invalid.body, /FIXTURE_TOKEN/);
    }

    fixture.handler.handle = async () => {
      throw new Error("FIXTURE_TOKEN");
    };
    const thrown = await post(address, certificates, body);
    assertTransportRefusal(thrown, 500);
    assert.doesNotMatch(thrown.body, /FIXTURE_TOKEN/);

    fixture.handler.handle = fixture.realHandle;
    const recovered = await post(address, certificates, body);
    assert.equal(recovered.status, 200);
  } finally {
    await daemon.stop();
    certificates.cleanup();
  }
});
