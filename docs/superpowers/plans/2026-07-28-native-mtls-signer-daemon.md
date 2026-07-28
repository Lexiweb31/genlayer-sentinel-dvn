# Native Mutual-TLS Signer Daemon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the existing `sentinel-signer/v2` handler behind a real TLS 1.3 mutual-authentication boundary and give the coordinator a native authenticated HTTPS transport that reports identities derived from live peer certificates.

**Architecture:** A small shared X.509 helper hashes DER SPKI bytes and performs constant-time pin comparison. `MutualTlsSignerDaemon` owns only TLS/HTTP framing and lifecycle, then supplies the actual client-certificate pin to the existing handler. `NodeMutualTlsSignerTransport` verifies the server CA, logical hostname and SPKI pin, presents the coordinator certificate, and returns the actual server-certificate pin to `RemoteSignerClient`. Real loopback E2E tests connect that boundary to durable replay state, independent finality attestation and an ephemeral DVN signing key.

**Tech Stack:** Node.js 22.13+, TypeScript 5.8.3, native `node:https`, `node:tls`, `node:crypto`, Node test runner, Node SQLite, ethers 6.17.0, and the local `openssl` executable for runtime-only test certificates.

## Global Constraints

- Preserve the clean-room GenLayer Sentinel boundary and do not access Merit or `genlayer-escrow`.
- Work only on branch `codex/isolated-signer-daemon` in the existing linked worktree.
- Use test-driven development: write one failing behavior at a time, run it and observe the expected failure before adding production behavior.
- Use TLS 1.3 and mutual certificate authentication on real sockets; a mocked transport does not satisfy this milestone.
- Keep TLS identity and application authorization as separate gates. A CA-trusted coordinator certificate must not bypass the handler's coordinator ID and SPKI allowlist.
- Accept only `POST /v2/sign`, exact unparameterized `application/json`, absent or `identity` content encoding, at most 32,768 request bytes and at most 16,384 response bytes.
- Preserve `sentinel-signer/v2`, `SentinelDVNAdapter.executionDigest`, the GenLayer `FINALIZED/7` requirement and permanent execution-plus-authorization replay binding.
- Inject certificate, TLS key and CA bytes directly. Production code must not read certificate paths, environment variables, command-line secrets, wallets, mnemonics or raw DVN keys.
- Keep the TLS service key separate from the DVN signing key behind `DigestSigner`.
- Generate every test certificate under an operating-system temporary directory at test runtime. Commit no PEM, key, certificate, passphrase or generated serial file.
- Do not add a production dependency or expose the test-only TCP dial override through a manifest or CLI.
- Do not construct or close replay, finality or signing providers inside the daemon.
- Do not add retries, redirects, decompression, HTTP/2, hot certificate reload, reverse-proxy headers, rate-limit claims or production deployment claims.
- Do not deploy, fund, contact Studio/Bradbury, create cloud resources, publish or push.
- Keep Sentinel additional/optional beside independent LayerZero DVNs.
- Direct-mode, EDR, loopback TLS, fixture finality and ephemeral-key evidence must remain clearly labeled local.
- Leave the root repository's unrelated `.DS_Store` untouched.

---

## File Structure

### New production files

- `services/coordinator/src/tls-peer.ts` — strict DER-certificate SPKI hashing and constant-time fingerprint comparison.
- `services/coordinator/src/signer-daemon.ts` — bounded TLS 1.3 mutual-authentication server and graceful lifecycle.
- `services/coordinator/src/mutual-tls-signer-transport.ts` — native HTTPS implementation of `AuthenticatedSignerTransport`.

### New test files

- `services/coordinator/test/mtls-test-certificates.js` — runtime-only CA, leaf certificate and independent OpenSSL fingerprint fixture.
- `services/coordinator/test/tls-peer.test.js` — SPKI vector, malformed DER and comparison tests.
- `services/coordinator/test/signer-daemon.test.js` — real-socket server authentication, framing, bounds and lifecycle tests.
- `services/coordinator/test/mutual-tls-signer-transport.test.js` — real-socket client trust, pin, timeout and response-bound tests.
- `services/coordinator/test/mutual-tls-signer-e2e.test.js` — complete coordinator-client-to-isolated-key path with durable replay.

### Modified files

- `services/coordinator/src/remote-signer.ts` — consume the shared pin comparator instead of maintaining a duplicate implementation.
- `README.md` — report the working local mTLS boundary and retain all deployment/custody limitations.
- `docs/SIGNER_ARCHITECTURE.md` — document TLS identity, application authorization, replay and finality as distinct gates.
- `docs/SECURITY_STATUS.md` — record exact release evidence and residual risks.
- `docs/MILESTONES.md` — close only the local listening-daemon submilestone.
- `docs/THREAT_MODEL.md` — describe the controls and remaining CA, endpoint, availability and host-compromise risks.
- `docs/UNKNOWNS.md` — preserve unresolved production PKI, revocation, HSM, operator and live GenLayer questions.
- `package.json`, `package-lock.json` — release `0.28.0` without changing dependencies.

---

## Task 1: Runtime Certificate Fixture and Shared SPKI Identity

**Files:**

- Create: `services/coordinator/test/mtls-test-certificates.js`
- Create: `services/coordinator/test/tls-peer.test.js`
- Create: `services/coordinator/src/tls-peer.ts`
- Modify: `services/coordinator/src/remote-signer.ts`
- Test: `services/coordinator/test/remote-signer.test.js`

**Interfaces:**

- Produces: `certificateSpkiSha256(rawCertificate: Buffer): Hex`
- Produces: `sameSpkiFingerprint(left: string, right: string): boolean`
- Produces test-only: `createMutualTlsCertificateFixture()`
- Preserves: `RemoteSignerClient` constructor and `AuthenticatedSignerTransport`

- [ ] **Step 1: Add the runtime-only certificate fixture**

Create `mtls-test-certificates.js` using only Node built-ins:

```js
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const openssl = (...args) =>
  execFileSync("openssl", args, {
    stdio: ["pipe", "pipe", "pipe"],
  });
```

The fixture must:

1. create one temporary root;
2. create a one-day RSA-2048 CA using `req -x509 -newkey rsa:2048 -nodes -sha256`;
3. create a signer CSR/key with subject `CN=signer.example`;
4. sign it with an extension file containing `subjectAltName=DNS:signer.example`, `basicConstraints=critical,CA:FALSE`, `keyUsage=critical,digitalSignature,keyEncipherment` and `extendedKeyUsage=serverAuth`;
5. create a coordinator CSR/key with subject `CN=coordinator-west`;
6. sign it with `basicConstraints=critical,CA:FALSE`, `keyUsage=critical,digitalSignature,keyEncipherment` and `extendedKeyUsage=clientAuth`;
7. create a second coordinator leaf signed by the trusted CA for the CA-trusted/wrong-application-pin test;
8. create a second rogue CA and rogue coordinator client certificate;
9. return all keys/certificates/CA certificates as `Buffer` values plus the signer and coordinator certificate paths for the independent vector; and
10. expose an idempotent `cleanup()` that recursively deletes only the created temporary root.

Every `openssl` invocation must use `execFileSync` argument arrays and no shell. Write extension files only inside the fixture root. Let missing or failing OpenSSL terminate the test; do not skip.

- [ ] **Step 2: Add three failing shared-identity tests**

Create exactly three top-level tests in `tls-peer.test.js`:

1. **SPKI vector:** derive the signer public key independently with:

   ```js
   const pem = execFileSync("openssl", [
     "x509", "-in", fixture.signerCertPath, "-pubkey", "-noout",
   ]);
   const der = execFileSync("openssl", [
     "pkey", "-pubin", "-outform", "DER",
   ], { input: pem });
   const digest = execFileSync("openssl", [
     "dgst", "-sha256", "-binary",
   ], { input: der });
   const expected = `0x${digest.toString("hex")}`;
   ```

   Convert the leaf PEM to raw DER independently with `new X509Certificate(cert).raw` in the test and require `certificateSpkiSha256(raw) === expected`.

2. **Malformed certificates:** require absent-at-runtime (`undefined` passed from JavaScript), zero-length and non-certificate DER inputs to throw the same sanitized `invalid peer certificate` error.
3. **Constant-time pin comparison:** require exact lowercase pins to match while uppercase, truncated, non-hex and different valid pins return `false` without throwing.

- [ ] **Step 3: Run the tests and observe the missing module**

Run:

```bash
npm run build
node --test services/coordinator/test/tls-peer.test.js
```

Expected RED: the test fails because `dist/services/coordinator/src/tls-peer.js` does not exist.

- [ ] **Step 4: Implement strict SPKI hashing**

Create `tls-peer.ts` with:

```ts
import {
  createHash,
  timingSafeEqual,
  X509Certificate,
} from "node:crypto";
import type { Hex } from "../../../packages/core/src/types.js";

const PIN = /^0x[0-9a-f]{64}$/;

export function certificateSpkiSha256(rawCertificate: Buffer): Hex {
  if (!Buffer.isBuffer(rawCertificate) || rawCertificate.length === 0) {
    throw new Error("invalid peer certificate");
  }
  try {
    const certificate = new X509Certificate(rawCertificate);
    const spki = certificate.publicKey.export({
      type: "spki",
      format: "der",
    });
    return `0x${createHash("sha256").update(spki).digest("hex")}` as Hex;
  } catch {
    throw new Error("invalid peer certificate");
  }
}

export function sameSpkiFingerprint(left: string, right: string): boolean {
  if (!PIN.test(left) || !PIN.test(right)) return false;
  return timingSafeEqual(
    Buffer.from(left.slice(2), "hex"),
    Buffer.from(right.slice(2), "hex"),
  );
}
```

Do not accept a PEM string in this helper. Callers must pass the live peer certificate's raw DER bytes.

- [ ] **Step 5: Remove the duplicate remote-client comparator**

In `remote-signer.ts`:

- remove the `node:crypto` import;
- import `sameSpkiFingerprint` from `./tls-peer.js`;
- validate the configured pin with:

  ```ts
  if (!sameSpkiFingerprint(config.peerSpkiSha256, config.peerSpkiSha256)) {
    throw new Error("invalid signer SPKI fingerprint");
  }
  ```

- replace the local `sameFingerprint` call with `sameSpkiFingerprint`; and
- delete the local `fingerprint` and `sameFingerprint` functions.

Do not change endpoint policy, request construction, response binding or error sanitization.

- [ ] **Step 6: Run focused identity and regression tests**

Run:

```bash
npm run build
node --test services/coordinator/test/tls-peer.test.js services/coordinator/test/remote-signer.test.js
```

Expected GREEN: the three new tests and all existing remote-signer tests pass.

- [ ] **Step 7: Commit**

```bash
git add services/coordinator/src/tls-peer.ts services/coordinator/src/remote-signer.ts services/coordinator/test/mtls-test-certificates.js services/coordinator/test/tls-peer.test.js
git commit -m "feat: centralize signer TLS SPKI identity"
```

---

## Task 2: Bounded Mutual-TLS Signer Daemon

**Files:**

- Create: `services/coordinator/src/signer-daemon.ts`
- Create: `services/coordinator/test/signer-daemon.test.js`
- Reuse: `services/coordinator/src/tls-peer.ts`
- Reuse: `services/coordinator/src/signer-protocol-handler.ts`
- Reuse: `services/coordinator/test/mtls-test-certificates.js`

**Interfaces:**

- Produces: `MutualTlsServerIdentity`
- Produces: `MutualTlsSignerDaemonOptions`
- Produces: `SignerDaemonAddress`
- Produces: `MutualTlsSignerDaemon.start(): Promise<SignerDaemonAddress>`
- Produces: `MutualTlsSignerDaemon.stop(): Promise<void>`
- Preserves: `SignerProtocolHandler.handle(actualPeerSpki, body)`

- [ ] **Step 1: Add the valid live-socket daemon test**

Create a fixture `SignerProtocolHandler` whose signer, replay store, clock and configured coordinator SPKI are controlled in memory. Create the daemon with:

```js
{
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
}
```

Use `node:https.request` with the trusted coordinator certificate, coordinator key, fixture CA, TLS 1.3, `servername: "signer.example"`, `rejectUnauthorized: true` and `POST /v2/sign`. Require:

- HTTP 200;
- a canonical v2 signer response;
- one handler call;
- the handler's received pin equals the independently derived coordinator SPKI fingerprint; and
- no configured expected fingerprint was copied into the request.

Run:

```bash
npm run build
node --test services/coordinator/test/signer-daemon.test.js
```

Expected RED: the daemon module does not exist.

- [ ] **Step 2: Implement constructor validation and TLS-only start**

Create:

```ts
export interface MutualTlsServerIdentity {
  key: Buffer | string;
  cert: Buffer | string;
  ca: Buffer | string | Array<Buffer | string>;
}

export interface MutualTlsSignerDaemonOptions {
  identity: MutualTlsServerIdentity;
  host: string;
  port: number;
  requestTimeoutMs: number;
  headersTimeoutMs: number;
  keepAliveTimeoutMs: number;
}

export interface SignerDaemonAddress {
  host: string;
  port: number;
}
```

The constructor must reject:

- an empty host;
- a port outside integer `0..65535`;
- request/header timeouts outside safe-integer `100..30000`;
- a header timeout greater than the request timeout;
- a keep-alive timeout outside safe-integer `100..5000`; and
- empty key, certificate or CA capabilities.

`start()` must:

- reject if it has already started or is currently starting/stopping;
- call `createServer` with `key`, `cert`, `ca`, `requestCert: true`, `rejectUnauthorized: true`, `minVersion: "TLSv1.3"`, `maxVersion: "TLSv1.3"` and `ALPNProtocols: ["http/1.1"]`;
- set `requestTimeout`, `headersTimeout`, `keepAliveTimeout` and a bounded `maxHeadersCount`;
- bind only the configured host/port;
- track every accepted socket in a `Set<Socket>`;
- resolve only after `listening`;
- inspect `server.address()` and return the actual numeric port; and
- reject start with a sanitized `signer daemon unavailable` error after closing any partially created server.

For this first RED/GREEN step, a valid authenticated request may call a private request method that is completed in the next step.

- [ ] **Step 3: Implement the accepted request path**

For each request:

1. require `req.socket.authorized === true`;
2. read `req.socket.getPeerCertificate().raw` while the socket is live;
3. derive the coordinator pin with `certificateSpkiSha256`;
4. require method `POST`;
5. require URL exactly `/v2/sign`;
6. require `Content-Type` after ASCII lowercase and outer trimming to equal exactly `application/json`;
7. require `Content-Encoding` to be absent or after the same normalization equal `identity`;
8. reject multiple header values or non-string values;
9. parse a present `Content-Length` as only decimal ASCII digits and reject it above 32,768 before reading;
10. read buffers while counting raw bytes and stop at 32,768;
11. reject abort, premature close, timeout, invalid UTF-8 replacement or mismatch with a declared content length;
12. call `handler.handle(actualPeerPin, body)` exactly once;
13. require an integer status `200..599`, a string body and UTF-8 size at most 16,384; and
14. return it with `Content-Type: application/json`, `Content-Encoding: identity`, exact `Content-Length`, `Cache-Control: no-store` and `Connection: close`.

Use `new TextDecoder("utf-8", { fatal: true })` for body decoding. Never log or return the certificate, fingerprint, body, handler exception, provider detail or stack.

Use the exact generic transport body:

```ts
const TRANSPORT_REFUSED =
  '{"version":"sentinel-signer/v2","error":{"code":"TRANSPORT_REFUSED","message":"request refused"}}';
```

Transport status mapping:

| Failure | Status |
|---|---:|
| method | 405 |
| path | 404 |
| content type or encoding | 415 |
| declared or streamed body overflow | 413 |
| stopping, timeout, abort or incomplete body | 503 |
| invalid/oversized handler response or internal failure | 500 |

Every transport failure uses `TRANSPORT_REFUSED`; handler replies retain their existing body and status.

- [ ] **Step 4: Add framing and TLS refusal tests**

Add three more top-level tests:

2. **Method/path/media/encoding:** table-loop `GET`, `/wrong`, missing type, `text/plain`, `application/json; charset=utf-8`, duplicate type and `gzip`; require the status table, exact generic body, and zero handler/finality/key calls.
3. **Declared and streamed overflow:** send `Content-Length: 32769`, then a chunked request whose cumulative raw bytes reach 32,769; require 413 and zero handler/finality/key calls.
4. **TLS peer authentication:** a certificate-less client and a rogue-CA client must fail the TLS handshake with no HTTP response and zero handler/finality/key calls.

Run:

```bash
npm run build
node --test services/coordinator/test/signer-daemon.test.js
```

Expected GREEN: valid mTLS works, HTTP framing fails closed, and untrusted clients never enter the handler.

- [ ] **Step 5: Add timeout, failure-sanitization and lifecycle tests**

Add exactly three more top-level tests:

5. **Timeout/abort resilience:** open one authenticated socket, send partial headers/body past the configured timeout, and separately abort a body. Require generic refusal or connection termination, zero handler calls for both, released sockets, and a subsequent valid request to succeed.
6. **Lifecycle:** reject every unsafe constructor value, reject a second `start()`, begin `stop()` during a deliberately blocked handler call, require new work to be refused/not accepted, release the handler, require the active response to complete, and require repeated `stop()` calls to resolve.
7. **Handler boundary:** make the handler return an existing 401 application refusal and require it unchanged; then return an oversized body, invalid status and non-string body in a table loop and require generic 500 without exposing a fixture token. Throw once from the handler and prove the next valid request still succeeds.

Keep these as seven total top-level daemon tests. Table-driven cases stay inside their owning top-level test so the release count is deterministic.

- [ ] **Step 6: Implement bounded stop semantics**

Track:

- `state: "new" | "starting" | "running" | "stopping" | "stopped"`;
- the server instance;
- accepted sockets;
- the number or set of active request promises; and
- one shared stop promise.

`stop()` must:

1. resolve immediately in `new` or `stopped`;
2. return the existing promise in `stopping`;
3. if called during `starting`, wait for the start promise to settle and then perform the same bounded close;
4. transition `running` to `stopping` before calling `server.close()`;
5. make the request handler return generic 503 for any request observed after that transition;
6. stop accepting new connections;
7. let already active handler calls finish;
8. start a timer bounded by `requestTimeoutMs`;
9. destroy remaining sockets only when the timer expires;
10. clear the timer and socket set after `close`; and
11. transition permanently to `stopped` without closing the injected handler's replay, finality or key dependencies.

If a blocked active request exceeds the drain bound, destroy its socket and resolve `stop()` after server close. Do not use an unbounded wait. A daemon instance cannot be restarted after `stopped`; certificate rotation or restart constructs a new instance with new injected capabilities.

- [ ] **Step 7: Run daemon tests twice**

Run:

```bash
npm run build
node --test services/coordinator/test/signer-daemon.test.js
node --test services/coordinator/test/signer-daemon.test.js
```

Expected GREEN twice: seven tests pass with no leaked handle, skip or todo.

- [ ] **Step 8: Commit**

```bash
git add services/coordinator/src/signer-daemon.ts services/coordinator/test/signer-daemon.test.js
git commit -m "feat: add mutual TLS signer daemon"
```

---

## Task 3: Native Mutual-TLS Coordinator Transport

**Files:**

- Create: `services/coordinator/src/mutual-tls-signer-transport.ts`
- Create: `services/coordinator/test/mutual-tls-signer-transport.test.js`
- Reuse: `services/coordinator/src/remote-signer.ts`
- Reuse: `services/coordinator/src/tls-peer.ts`
- Reuse: `services/coordinator/src/signer-daemon.ts`
- Reuse: `services/coordinator/test/mtls-test-certificates.js`

**Interfaces:**

- Produces: `MutualTlsClientIdentity`
- Produces: `MutualTlsTransportOptions`
- Produces: `NodeMutualTlsSignerTransport`
- Implements: `AuthenticatedSignerTransport.post(url, body, expectedPeerSpkiSha256)`

- [ ] **Step 1: Add the valid real-transport test**

Create a real daemon and call:

```js
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
```

Require:

- exact handler status/body;
- `authenticatedPeerSpkiSha256` equals the independently derived signer pin;
- the daemon receives the actual coordinator pin;
- SNI and the HTTP `Host` header remain `signer.example`; and
- the TCP destination is only the injected loopback dial address.

Run:

```bash
npm run build
node --test services/coordinator/test/mutual-tls-signer-transport.test.js
```

Expected RED: the transport module does not exist.

- [ ] **Step 2: Implement strict option and URL validation**

Define:

```ts
export interface MutualTlsClientIdentity {
  key: Buffer | string;
  cert: Buffer | string;
  ca: Buffer | string | Array<Buffer | string>;
}

export interface MutualTlsTransportOptions {
  identity: MutualTlsClientIdentity;
  timeoutMs: number;
  maxResponseBytes?: number;
  dial?: {
    host: string;
    port: number;
  };
}
```

The constructor must reject:

- empty key, certificate or CA capabilities;
- timeout outside safe-integer `100..30000`;
- response maximum outside safe-integer `1024..16384`;
- empty dial host; and
- dial port outside integer `1..65535`.

`post()` must reject an invalid expected pin and require:

- HTTPS;
- no username/password/hash;
- no explicit URL port;
- a nonempty DNS hostname;
- path exactly `/v2/sign`;
- no query string;
- no IP literal or `localhost`/`.localhost`; and
- a string request body whose UTF-8 length is at most 32,768.

The test-only `dial` value changes only the TCP host/port. URL hostname controls SNI, certificate hostname verification and HTTP `Host`.

- [ ] **Step 3: Implement one-shot authenticated HTTPS**

Use one `https.request` with:

```ts
{
  host: options.dial?.host ?? logical.hostname,
  port: options.dial?.port ?? 443,
  servername: logical.hostname,
  method: "POST",
  path: `${logical.pathname}${logical.search}`,
  agent: false,
  key: options.identity.key,
  cert: options.identity.cert,
  ca: options.identity.ca,
  rejectUnauthorized: true,
  minVersion: "TLSv1.3",
  maxVersion: "TLSv1.3",
  ALPNProtocols: ["http/1.1"],
  headers: {
    Host: logical.host,
    "Content-Type": "application/json",
    "Content-Encoding": "identity",
    "Content-Length": Buffer.byteLength(body, "utf8"),
    Accept: "application/json",
    Connection: "close",
  },
}
```

Supply a `checkServerIdentity` callback that:

1. calls Node's imported `tls.checkServerIdentity(logical.hostname, certificate)`;
2. returns that error unchanged if hostname verification fails;
3. requires `certificate.raw`;
4. derives its actual SPKI fingerprint; and
5. returns a sanitized `Error("signer identity mismatch")` unless it equals the expected pin.

On `secureConnect`, require `socket.authorized`, negotiated protocol `TLSv1.3` and ALPN `http/1.1`. While the response socket remains live, derive the certificate pin again and use that actual value in `AuthenticatedTransportResponse`.

Read the raw response with these gates:

- status must be an integer;
- `Content-Type` must be exact unparameterized `application/json`;
- `Content-Encoding` must be absent or `identity`;
- declared and streamed bytes must not exceed `maxResponseBytes`;
- body must decode as fatal UTF-8;
- premature close/abort fails;
- redirect statuses are returned as ordinary statuses, never followed;
- no decompression occurs; and
- a single timer covers DNS/TCP/TLS/write/response/body and destroys the request at `timeoutMs`.

Reject every network, TLS, timeout, framing or body failure with one sanitized `Error("mutual TLS signer unavailable")`. Do not include host, certificate, body, socket code or provider detail.

- [ ] **Step 4: Add four adversarial client tests**

Add exactly four more top-level tests:

2. **Trust and identity:** table-loop wrong CA, wrong hostname and a different valid signer SPKI pin; each must reject before returning a response.
3. **Response framing:** use a minimal real TLS server to return parameterized/missing media type, gzip encoding, a declared oversized body, a chunked streamed oversized body and invalid UTF-8; each must reject without exposing the server's fixture token.
4. **End-to-end timeout and abort:** stall once before response, abort once during the body, require bounded sanitized failures, then prove a valid call still succeeds.
5. **Configuration and URL policy:** table-loop every unsafe timeout/limit/dial/identity constructor value and require a synchronous constructor error. Separately table-loop HTTP, credential-bearing, hash-bearing, explicit-port, IP, localhost, wrong-path, query-bearing and oversized-body inputs and require `post()` to reject.

Keep exactly five top-level transport tests.

- [ ] **Step 5: Run client, daemon and existing remote-client tests**

Run:

```bash
npm run build
node --test services/coordinator/test/mutual-tls-signer-transport.test.js services/coordinator/test/signer-daemon.test.js services/coordinator/test/remote-signer.test.js
```

Expected GREEN: five transport tests, seven daemon tests and all existing remote-client tests pass.

- [ ] **Step 6: Commit**

```bash
git add services/coordinator/src/mutual-tls-signer-transport.ts services/coordinator/test/mutual-tls-signer-transport.test.js
git commit -m "feat: add native mutual TLS signer transport"
```

---

## Task 4: Full Authenticated Socket-to-Key E2E

**Files:**

- Create: `services/coordinator/test/mutual-tls-signer-e2e.test.js`
- Reuse: `services/coordinator/src/mutual-tls-signer-transport.ts`
- Reuse: `services/coordinator/src/signer-daemon.ts`
- Reuse: `services/coordinator/src/remote-signer.ts`
- Reuse: `services/coordinator/src/signer-protocol-handler.ts`
- Reuse: `services/coordinator/src/signer-replay-store.ts`
- Reuse: `services/coordinator/src/signing.ts`
- Reuse: `services/coordinator/test/mtls-test-certificates.js`

**Proves:**

- Real coordinator mTLS client to signer mTLS server.
- Actual pins derived from both live TLS peer certificates.
- Canonical v2 authorization through the network boundary.
- Durable replay reservation before independent finality and key invocation.
- Signature recovery against the configured isolated signer.
- Wrong application identity and changed durable authorization fail before a second key use.

- [ ] **Step 1: Add the successful complete E2E**

Build this exact local stack:

```text
RemoteSignerClient
  -> NodeMutualTlsSignerTransport
  -> MutualTlsSignerDaemon
  -> SignerProtocolHandler
  -> SqliteSignerReplayStore
  -> IsolatedSignerService
  -> fixture FinalityAttestor
  -> ephemeral ethers Wallet DigestSigner
```

Use:

- an operating-system temporary replay database;
- the runtime certificate fixture;
- a fresh wallet;
- the established Arbitrum Sepolia local envelope fixture;
- the complete v2 authorization witness;
- deterministic clock and request ID;
- logical endpoint `https://signer.example/v2/sign`; and
- loopback only through the transport's injected dial capability.

Require one valid `SignatureShare`, exact `executionDigest`, successful `verifyMessage`, one replay reservation, one finality call, one key call, the actual coordinator pin at the handler and the actual signer pin at the remote client.

Run:

```bash
npm run build
node --test services/coordinator/test/mutual-tls-signer-e2e.test.js
```

Expected GREEN if Tasks 1–3 compose correctly. This task adds integration evidence rather than new production behavior; if it fails, diagnose and fix the narrowest violated boundary before adding the remaining E2E cases.

- [ ] **Step 2: Add application-identity separation**

Add a second top-level E2E test using a coordinator leaf certificate signed by the trusted CA but whose SPKI is not the handler's configured application pin.

Require:

- TLS handshake succeeds;
- handler returns existing 401 `AUTHENTICATION_FAILED`;
- `RemoteSignerClient` returns only `remote signer refused request`;
- replay reservation count is zero;
- finality call count is zero; and
- key call count is zero.

This proves CA membership and handler authorization are independent.

- [ ] **Step 3: Add restart/replay and wrong-server-pin fail closure**

Add a third top-level E2E test:

1. sign one authorization successfully;
2. stop the daemon and close the replay store;
3. reopen the same database;
4. start a new daemon using the same injected TLS identity and signer dependencies;
5. send the same GUID/envelope with a fresh request ID but changed policy text;
6. require 409 conflict and no second finality/key invocation; and
7. use a client configured with a different valid server SPKI pin and require TLS refusal before any additional handler/finality/key call.

Close the daemon before closing the store. Register cleanup before starting network activity so every failure path removes the database and certificate roots.

- [ ] **Step 4: Run all mTLS tests together**

Run:

```bash
npm run build
node --test services/coordinator/test/tls-peer.test.js services/coordinator/test/signer-daemon.test.js services/coordinator/test/mutual-tls-signer-transport.test.js services/coordinator/test/mutual-tls-signer-e2e.test.js services/coordinator/test/remote-signer.test.js services/coordinator/test/signer-protocol-handler.test.js services/coordinator/test/signer-replay-store.test.js
```

Expected GREEN: 18 new top-level mTLS tests plus every selected existing signer/replay test pass with zero skips or todos.

- [ ] **Step 5: Run the complete Node suite**

Because this suite binds real loopback sockets, run with the workspace's required local-network permission:

```bash
npm test
```

Expected GREEN: the build passes and Node reports 235 tests, zero failures, zero skipped and zero todo.

- [ ] **Step 6: Commit**

```bash
git add services/coordinator/test/mutual-tls-signer-e2e.test.js
git commit -m "test: prove mutual TLS signer boundary"
```

---

## Task 5: Operationally Honest 0.28.0 Release

**Files:**

- Modify: `README.md`
- Modify: `docs/SIGNER_ARCHITECTURE.md`
- Modify: `docs/SECURITY_STATUS.md`
- Modify: `docs/MILESTONES.md`
- Modify: `docs/THREAT_MODEL.md`
- Modify: `docs/UNKNOWNS.md`
- Modify: `package.json`
- Modify: `package-lock.json`

**Produces:**

- Release metadata `0.28.0`
- Exact local mTLS evidence
- Explicit deployment and custody limitations
- Secret/credential hygiene evidence
- Full TypeScript, GenVM, contract, dashboard and Node regression evidence

- [ ] **Step 1: Update the signer architecture**

Document the ordered server gates:

1. TLS 1.3 handshake;
2. coordinator CA-chain verification;
3. actual live coordinator SPKI derivation;
4. strict HTTP framing and byte limits;
5. application coordinator ID/SPKI authorization;
6. permanent replay reservation;
7. independent `FINALIZED/7` transaction/record verification; and
8. isolated DVN key invocation.

Document the ordered client gates:

1. signer CA-chain verification;
2. logical hostname/SNI verification;
3. actual live signer SPKI pin verification;
4. strict HTTP response framing and byte limits;
5. v2 request/response binding; and
6. recovered signer-address verification.

State that TLS keys are service identity only and may never be reused as DVN signing keys.

- [ ] **Step 2: Update status, threat model, unknowns and milestones**

Write only claims proven by the tests:

- a native Node TLS 1.3 mutual-authentication client/server exists;
- live socket certificates supply both pins;
- loopback E2E reaches durable replay, fixture finality and an ephemeral signing key;
- certificate-less, untrusted, wrong-host, wrong-pin, malformed, oversized, timed-out, aborted and replay-conflicting paths fail closed;
- generated credentials are temporary and untracked; and
- the daemon has bounded graceful stop behavior.

Retain these explicit limitations:

- no deployed public signer;
- no five independent operators or failure domains;
- no production CA ownership, rotation, revocation or OCSP policy;
- no HSM/KMS custody;
- no production rate limiting, ingress protection or DDoS claim;
- no official live GenLayer transaction-witness reader;
- no Studio/Bradbury finality or independent validator proof;
- no live LayerZero pathway or DVN onboarding;
- no cloud monitoring/runbook drill; and
- no testnet or mainnet readiness claim.

Change M3 from “build a listening mTLS daemon” to the remaining productionization work: five deployed isolated daemons, production PKI lifecycle, HSM/KMS custody, official live GenLayer reader, monitoring and adversarial drills.

- [ ] **Step 3: Set version `0.28.0`**

Run:

```bash
npm version 0.28.0 --no-git-tag-version
```

Inspect the diff and confirm only the root package version and the two root lockfile version fields changed. Confirm dependencies are byte-for-byte unchanged.

- [ ] **Step 4: Run type and focused security checks**

Run:

```bash
npm run typecheck
npm run build
node --test services/coordinator/test/tls-peer.test.js services/coordinator/test/signer-daemon.test.js services/coordinator/test/mutual-tls-signer-transport.test.js services/coordinator/test/mutual-tls-signer-e2e.test.js
```

Expected GREEN: TypeScript, Solidity compilation, Intelligent Contract safety checks, dashboard checks and all 18 new mTLS tests pass.

- [ ] **Step 5: Audit credential and dependency hygiene**

Run:

```bash
git ls-files | rg '\.(pem|key|p12|pfx|crt|cer|srl)$'
git grep -n -- '-----BEGIN '
git diff -- package.json package-lock.json
git diff --check
```

Expected:

- the credential-extension search prints nothing;
- the PEM-marker search prints nothing;
- the package diff contains version-only metadata and no dependency changes; and
- `git diff --check` exits zero.

If any generated credential or serial exists, stop and remove only that test-created artifact before continuing. Do not commit it.

- [ ] **Step 6: Run the complete release gate**

Run with permission for the real loopback TLS and local EDR sockets:

```bash
npm run check
```

Expected GREEN:

- strict TypeScript passes;
- official pinned GenVM lint passes;
- 24 direct-runner Intelligent Contract tests pass;
- five Solidity sources compile with solc 0.8.30;
- dashboard validation passes;
- 235 Node tests pass;
- combined direct and Node count is 259;
- zero failures, skips or todos.

- [ ] **Step 7: Inspect the final release diff**

Run:

```bash
git status --short
git diff --stat
git diff -- README.md docs/SIGNER_ARCHITECTURE.md docs/SECURITY_STATUS.md docs/MILESTONES.md docs/THREAT_MODEL.md docs/UNKNOWNS.md package.json package-lock.json
git log -5 --oneline
```

Require:

- only planned source, test, documentation and version files are changed;
- no compiled `dist`, database, WAL, SHM, certificate, key or log artifact is tracked;
- the docs say “local” for the actual socket proof and do not say “deployed”;
- the exact test counts match fresh output; and
- no unrelated user change is staged.

- [ ] **Step 8: Commit the release**

```bash
git add README.md docs/SIGNER_ARCHITECTURE.md docs/SECURITY_STATUS.md docs/MILESTONES.md docs/THREAT_MODEL.md docs/UNKNOWNS.md package.json package-lock.json
git commit -m "chore: release native mTLS signer milestone"
```

- [ ] **Step 9: Verify the committed state**

Run:

```bash
git status --short
git log -6 --oneline
git show --stat --oneline HEAD
```

Expected: the worktree is clean and HEAD is the `0.28.0` release commit.

- [ ] **Step 10: Report the milestone without overclaiming**

Report:

- the five new commit hashes and subjects;
- the exact 235 Node, 24 direct and 259 combined test counts;
- the actual TLS 1.3 mutual-authentication and live SPKI-pin path;
- the exact request/response size and timeout limits;
- the durable replay/finality/key E2E evidence;
- that certificates were runtime-only and untracked;
- that no deployment, funds, cloud, GitHub push, publication or reusable secret occurred; and
- that production PKI, five independent operators, HSM/KMS, official live GenLayer reader, Studio/Bradbury and LayerZero onboarding remain unresolved.
