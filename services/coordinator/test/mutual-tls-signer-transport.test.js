import test from "node:test";
import assert from "node:assert/strict";
import { createHash, X509Certificate } from "node:crypto";
import { createServer as createTlsServer } from "node:tls";
import {
  MutualTlsSignerDaemon,
} from "../../../dist/services/coordinator/src/signer-daemon.js";
import {
  NodeMutualTlsSignerTransport,
} from "../../../dist/services/coordinator/src/mutual-tls-signer-transport.js";
import {
  createMutualTlsCertificateFixture,
} from "./mtls-test-certificates.js";

const canonicalBody = '{"version":"sentinel-signer/v2","requestId":"test"}';
const canonicalResponse =
  '{"version":"sentinel-signer/v2","requestId":"test","accepted":true}';
const fixtureToken = "server-fixture-secret-token";
const unavailable = /^Error: mutual TLS signer unavailable$/;

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

function transportOptions(certificates, port, changes = {}) {
  return {
    identity: {
      key: certificates.coordinatorKey,
      cert: certificates.coordinatorCert,
      ca: certificates.caCert,
    },
    timeoutMs: 1_000,
    dial: { host: "127.0.0.1", port },
    ...changes,
  };
}

async function assertSanitizedFailure(operation) {
  await assert.rejects(operation, (error) => {
    assert.match(String(error), unavailable);
    assert.doesNotMatch(error.message, new RegExp(fixtureToken));
    return true;
  });
}

async function startRawTlsServer(certificates, responders) {
  const sockets = new Set();
  let requestCount = 0;
  const server = createTlsServer(
    {
      key: certificates.signerKey,
      cert: certificates.signerCert,
      ca: certificates.caCert,
      requestCert: true,
      rejectUnauthorized: true,
      minVersion: "TLSv1.3",
      maxVersion: "TLSv1.3",
      ALPNProtocols: ["http/1.1"],
    },
    (socket) => {
      sockets.add(socket);
      socket.on("error", () => {});
      socket.once("close", () => sockets.delete(socket));
      const chunks = [];
      let dispatched = false;
      socket.on("data", (chunk) => {
        if (dispatched) return;
        chunks.push(chunk);
        const request = Buffer.concat(chunks);
        const headerEnd = request.indexOf("\r\n\r\n");
        if (headerEnd < 0) return;
        const head = request.subarray(0, headerEnd).toString("latin1");
        const length = Number(
          /^Content-Length:\s*([0-9]+)\s*$/im.exec(head)?.[1] ?? 0,
        );
        if (request.length < headerEnd + 4 + length) return;
        dispatched = true;
        const responder = responders[requestCount++];
        if (!responder) {
          socket.destroy();
          return;
        }
        responder(socket, request);
      });
    },
  );
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    port: address.port,
    get requestCount() {
      return requestCount;
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function rawResponse({
  status = 200,
  headers = [],
  body = Buffer.alloc(0),
}) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
  return Buffer.concat([
    Buffer.from(
      `HTTP/1.1 ${status} Test\r\n${headers.join("\r\n")}\r\n\r\n`,
      "latin1",
    ),
    bytes,
  ]);
}

test("posts once over real mutual TLS while preserving the logical signer authority", async () => {
  const certificates = createMutualTlsCertificateFixture();
  const coordinatorSpki = spkiFingerprint(certificates.coordinatorCert);
  const signerSpki = spkiFingerprint(certificates.signerCert);
  const calls = [];
  const daemon = new MutualTlsSignerDaemon(
    {
      async handle(...args) {
        calls.push(args);
        return { status: 202, body: canonicalResponse };
      },
    },
    daemonOptions(certificates),
  );

  try {
    const daemonAddress = await daemon.start();
    const observedServerNames = [];
    const observedHosts = [];
    daemon.server.on("secureConnection", (socket) => {
      observedServerNames.push(socket.servername);
    });
    daemon.server.on("request", (request) => {
      observedHosts.push(request.headers.host);
    });
    const transport = new NodeMutualTlsSignerTransport({
      identity: {
        key: certificates.coordinatorKey,
        cert: certificates.coordinatorCert,
        ca: certificates.caCert,
      },
      timeoutMs: 1_000,
      dial: { host: "127.0.0.1", port: daemonAddress.port },
    });

    const response = await transport.post(
      "https://signer.example/v2/sign",
      canonicalBody,
      signerSpki,
    );

    assert.deepEqual(response, {
      status: 202,
      body: canonicalResponse,
      authenticatedPeerSpkiSha256: signerSpki,
    });
    assert.deepEqual(calls, [[coordinatorSpki, canonicalBody]]);
    assert.deepEqual(observedServerNames, ["signer.example"]);
    assert.deepEqual(observedHosts, ["signer.example"]);
  } finally {
    await daemon.stop();
    certificates.cleanup();
  }
});

test("rejects untrusted, wrongly named, or incorrectly pinned signer identities", async () => {
  const certificates = createMutualTlsCertificateFixture();
  const signerSpki = spkiFingerprint(certificates.signerCert);
  const differentValidSpki = spkiFingerprint(
    certificates.alternateCoordinatorCert,
  );
  const calls = [];
  const daemon = new MutualTlsSignerDaemon(
    {
      async handle(...args) {
        calls.push(args);
        return { status: 200, body: canonicalResponse };
      },
    },
    daemonOptions(certificates),
  );

  try {
    const address = await daemon.start();
    const cases = [
      {
        name: "wrong CA",
        options: {
          ...transportOptions(certificates, address.port),
          identity: {
            key: certificates.coordinatorKey,
            cert: certificates.coordinatorCert,
            ca: certificates.rogueCaCert,
          },
        },
        url: "https://signer.example/v2/sign",
        pin: signerSpki,
      },
      {
        name: "wrong hostname",
        options: transportOptions(certificates, address.port),
        url: "https://wrong.example/v2/sign",
        pin: signerSpki,
      },
      {
        name: "different valid pin",
        options: transportOptions(certificates, address.port),
        url: "https://signer.example/v2/sign",
        pin: differentValidSpki,
      },
    ];
    for (const entry of cases) {
      const transport = new NodeMutualTlsSignerTransport(entry.options);
      await assertSanitizedFailure(
        transport.post(entry.url, canonicalBody, entry.pin),
        entry.name,
      );
    }
    assert.equal(calls.length, 0);
  } finally {
    await daemon.stop();
    certificates.cleanup();
  }
});

test("rejects unsafe response framing and returns redirects without following them", async () => {
  const certificates = createMutualTlsCertificateFixture();
  const signerSpki = spkiFingerprint(certificates.signerCert);
  const oversized = "x".repeat(16_385);
  const afterCapHeaders = [
    "Content-Type: application/json",
    `Content-Length: ${Buffer.byteLength(fixtureToken)}`,
    "Connection: close",
    ...Array.from({ length: 29 }, (_, index) => `X-Fill-${index}: filler`),
    "Content-Type: application/json",
  ];
  const invalidResponders = [
    (socket) =>
      socket.end(
        rawResponse({
          headers: [
            "Content-Type: application/json; charset=utf-8",
            `Content-Length: ${Buffer.byteLength(fixtureToken)}`,
            "Connection: close",
          ],
          body: fixtureToken,
        }),
      ),
    (socket) =>
      socket.end(
        rawResponse({
          headers: [
            `Content-Length: ${Buffer.byteLength(fixtureToken)}`,
            "Connection: close",
          ],
          body: fixtureToken,
        }),
      ),
    (socket) =>
      socket.end(
        rawResponse({
          headers: [
            "Content-Type: application/json",
            "Content-Encoding: gzip",
            `Content-Length: ${Buffer.byteLength(fixtureToken)}`,
            "Connection: close",
          ],
          body: fixtureToken,
        }),
      ),
    (socket) =>
      socket.end(
        rawResponse({
          headers: [
            "Content-Type: application/json",
            "Content-Length: 16385",
            "Connection: close",
          ],
        }),
      ),
    (socket) =>
      socket.end(
        `HTTP/1.1 200 Test\r\n` +
          `Content-Type: application/json\r\n` +
          `Transfer-Encoding: chunked\r\n` +
          `Connection: close\r\n\r\n` +
          `${oversized.length.toString(16)}\r\n${oversized}\r\n0\r\n\r\n`,
      ),
    (socket) =>
      socket.end(
        rawResponse({
          headers: [
            "Content-Type: application/json",
            "Content-Length: 1",
            "Connection: close",
          ],
          body: Buffer.from([0xff]),
        }),
      ),
    (socket) =>
      socket.end(
        rawResponse({
          headers: [
            "Content-Type: application/json",
            "Content-Type: application/json",
            `Content-Length: ${Buffer.byteLength(fixtureToken)}`,
            "Connection: close",
          ],
          body: fixtureToken,
        }),
      ),
    (socket) =>
      socket.end(
        rawResponse({
          headers: afterCapHeaders,
          body: fixtureToken,
        }),
      ),
  ];
  const redirectBody = '{"redirect":"not-followed"}';
  const server = await startRawTlsServer(certificates, [
    ...invalidResponders,
    (socket) =>
      socket.end(
        rawResponse({
          status: 302,
          headers: [
            "Content-Type: application/json",
            `Content-Length: ${Buffer.byteLength(redirectBody)}`,
            "Location: https://redirect.example/v2/sign",
            "Connection: close",
          ],
          body: redirectBody,
        }),
      ),
  ]);
  const transport = new NodeMutualTlsSignerTransport(
    transportOptions(certificates, server.port),
  );

  try {
    for (let index = 0; index < invalidResponders.length; index++) {
      await assertSanitizedFailure(
        transport.post(
          "https://signer.example/v2/sign",
          canonicalBody,
          signerSpki,
        ),
      );
    }
    const redirect = await transport.post(
      "https://signer.example/v2/sign",
      canonicalBody,
      signerSpki,
    );
    assert.deepEqual(redirect, {
      status: 302,
      body: redirectBody,
      authenticatedPeerSpkiSha256: signerSpki,
    });
    assert.equal(server.requestCount, invalidResponders.length + 1);
  } finally {
    await server.close();
    certificates.cleanup();
  }
});

test("bounds the whole exchange, rejects body aborts, and remains usable", async () => {
  const certificates = createMutualTlsCertificateFixture();
  const signerSpki = spkiFingerprint(certificates.signerCert);
  const server = await startRawTlsServer(certificates, [
    () => {},
    (socket) => {
      socket.write(
        `HTTP/1.1 200 Test\r\n` +
          `Content-Type: application/json\r\n` +
          `Content-Length: 100\r\n` +
          `Connection: close\r\n\r\n` +
          fixtureToken,
      );
      socket.destroy();
    },
    (socket) =>
      socket.end(
        rawResponse({
          headers: [
            "Content-Type: application/json",
            `Content-Length: ${Buffer.byteLength(canonicalResponse)}`,
            "Connection: close",
          ],
          body: canonicalResponse,
        }),
      ),
  ]);
  const transport = new NodeMutualTlsSignerTransport(
    transportOptions(certificates, server.port, { timeoutMs: 150 }),
  );

  try {
    const started = Date.now();
    await assertSanitizedFailure(
      transport.post(
        "https://signer.example/v2/sign",
        canonicalBody,
        signerSpki,
      ),
    );
    const elapsed = Date.now() - started;
    assert.ok(elapsed >= 100 && elapsed < 1_000, `elapsed ${elapsed}ms`);
    await assertSanitizedFailure(
      transport.post(
        "https://signer.example/v2/sign",
        canonicalBody,
        signerSpki,
      ),
    );
    const response = await transport.post(
      "https://signer.example/v2/sign",
      canonicalBody,
      signerSpki,
    );
    assert.deepEqual(response, {
      status: 200,
      body: canonicalResponse,
      authenticatedPeerSpkiSha256: signerSpki,
    });
    assert.equal(server.requestCount, 3);
  } finally {
    await server.close();
    certificates.cleanup();
  }
});

test("rejects unsafe configuration and endpoints and snapshots caller-owned options", async () => {
  const certificates = createMutualTlsCertificateFixture();
  const valid = {
    identity: {
      key: certificates.coordinatorKey,
      cert: certificates.coordinatorCert,
      ca: certificates.caCert,
    },
    timeoutMs: 1_000,
  };
  const invalidOptions = [
    { ...valid, identity: undefined },
    { ...valid, identity: { ...valid.identity, key: "" } },
    { ...valid, identity: { ...valid.identity, key: Buffer.alloc(0) } },
    { ...valid, identity: { ...valid.identity, cert: "" } },
    { ...valid, identity: { ...valid.identity, cert: Buffer.alloc(0) } },
    { ...valid, identity: { ...valid.identity, ca: "" } },
    { ...valid, identity: { ...valid.identity, ca: Buffer.alloc(0) } },
    { ...valid, identity: { ...valid.identity, ca: [] } },
    { ...valid, identity: { ...valid.identity, ca: [Buffer.alloc(0)] } },
    { ...valid, timeoutMs: 99 },
    { ...valid, timeoutMs: 30_001 },
    { ...valid, timeoutMs: 100.5 },
    { ...valid, timeoutMs: Number.NaN },
    { ...valid, timeoutMs: Number.MAX_SAFE_INTEGER + 1 },
    { ...valid, maxResponseBytes: 1_023 },
    { ...valid, maxResponseBytes: 16_385 },
    { ...valid, maxResponseBytes: 1_024.5 },
    { ...valid, maxResponseBytes: Number.NaN },
    { ...valid, dial: { host: "", port: 443 } },
    { ...valid, dial: { host: "127.0.0.1", port: 0 } },
    { ...valid, dial: { host: "127.0.0.1", port: 65_536 } },
    { ...valid, dial: { host: "127.0.0.1", port: 1.5 } },
  ];
  for (const options of invalidOptions) {
    assert.throws(() => new NodeMutualTlsSignerTransport(options), Error);
  }

  const transport = new NodeMutualTlsSignerTransport(valid);
  const signerSpki = spkiFingerprint(certificates.signerCert);
  const invalidEndpoints = [
    "http://signer.example/v2/sign",
    "https://user@signer.example/v2/sign",
    "https://user:pass@signer.example/v2/sign",
    "https://@signer.example/v2/sign",
    "https://:@signer.example/v2/sign",
    "https://signer.example/v2/sign#fragment",
    "https://signer.example/v2/sign#",
    "https://signer.example:443/v2/sign",
    "https://127.0.0.1/v2/sign",
    "https://localhost/v2/sign",
    "https://signer.localhost/v2/sign",
    "https://signer.example/wrong",
    "https://signer.example/wrong/../v2/sign",
    "https://signer.example/v2/sign?retry=true",
    "https://signer.example/v2/sign?",
    "https://signer_example/v2/sign",
  ];
  for (const url of invalidEndpoints) {
    await assert.rejects(
      transport.post(url, canonicalBody, signerSpki),
      /^Error: invalid signer endpoint$/,
    );
  }
  await assert.rejects(
    transport.post(
      "https://signer.example/v2/sign",
      "é".repeat(16_385),
      signerSpki,
    ),
    /^Error: invalid signer request body$/,
  );
  await assert.rejects(
    transport.post(
      "https://signer.example/v2/sign",
      canonicalBody,
      `0x${"A".repeat(64)}`,
    ),
    /^Error: invalid signer SPKI fingerprint$/,
  );

  const daemon = new MutualTlsSignerDaemon(
    {
      async handle() {
        return { status: 200, body: canonicalResponse };
      },
    },
    daemonOptions(certificates),
  );
  try {
    const address = await daemon.start();
    const key = Buffer.from(certificates.coordinatorKey);
    const cert = Buffer.from(certificates.coordinatorCert);
    const ca = Buffer.from(certificates.caCert);
    const caList = [ca];
    const options = {
      identity: { key, cert, ca: caList },
      timeoutMs: 1_000,
      maxResponseBytes: 16_384,
      dial: { host: "127.0.0.1", port: address.port },
    };
    const snapshotted = new NodeMutualTlsSignerTransport(options);
    key.fill(0);
    cert.fill(0);
    ca.fill(0);
    caList[0] = Buffer.from("mutated");
    options.identity.key = "";
    options.identity.cert = "";
    options.identity.ca = [];
    options.timeoutMs = 100;
    options.maxResponseBytes = 1_024;
    options.dial.host = "invalid.invalid";
    options.dial.port = 1;

    const response = await snapshotted.post(
      "https://signer.example/v2/sign",
      canonicalBody,
      signerSpki,
    );
    assert.equal(response.status, 200);
    assert.equal(response.body, canonicalResponse);
    assert.equal(response.authenticatedPeerSpkiSha256, signerSpki);
  } finally {
    await daemon.stop();
    certificates.cleanup();
  }
});
