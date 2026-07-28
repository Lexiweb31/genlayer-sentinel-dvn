# Native Mutual-TLS Signer Daemon Design

**Date:** 2026-07-28  
**Target release:** 0.28.0  
**Status:** Approved design, pending implementation plan

## Purpose

Wrap the existing `sentinel-signer/v2` protocol handler in a real listening mutual-TLS service and provide a native Node authenticated client transport. This closes the current gap between the tested application protocol and a live encrypted, mutually authenticated socket without claiming deployed operator independence, live GenLayer finality, or HSM custody.

This milestone remains local/test infrastructure. It creates no cloud resource, deploys nothing, spends no funds, publishes nothing, and introduces no reusable credential.

## Decision

Use Node’s native `node:https`, `node:tls`, and `node:crypto` APIs for direct end-to-end TLS termination in the signer process.

Two alternatives were rejected:

1. **Reverse-proxy TLS termination.** This would require a separately secured and audited proxy-to-daemon identity channel. Forwarding a client-certificate fingerprint in an ordinary HTTP header creates another spoofing boundary and does not produce a self-contained signer service.
2. **Custom raw-TLS framing.** A bespoke length-prefixed protocol would duplicate mature HTTP request parsing, timeouts and lifecycle behavior without improving the authorization model.

The native HTTPS design reuses the strict v2 JSON protocol, lets the TLS stack verify certificate chains, and derives both peer SPKI fingerprints from live TLS sockets.

## Security boundary

The server and client receive certificate, private-key and CA material as in-memory constructor capabilities. Production code accepts no certificate path, secret-bearing JSON, process environment variable, command-line secret, wallet mnemonic, or raw DVN private key.

The daemon:

- requires TLS 1.3;
- sets `requestCert: true` and `rejectUnauthorized: true`;
- replaces default trust roots with the explicitly injected coordinator CA bundle;
- derives the authenticated coordinator SPKI SHA-256 fingerprint from the live client certificate;
- passes that actual fingerprint to `SignerProtocolHandler`;
- exposes only `POST /v2/sign`;
- accepts only uncompressed `application/json`;
- reads no more than 32,768 request bytes, including chunked bodies;
- applies bounded header, request and keep-alive timeouts;
- returns fixed allowlisted JSON failures without exception, certificate or request-body detail; and
- invokes neither finality nor key providers when TLS or HTTP framing is refused.

The client transport:

- replaces default trust roots with the explicitly injected signer CA bundle;
- presents its injected coordinator certificate and key;
- requires TLS 1.3 and `http/1.1`;
- preserves the logical URL hostname for SNI and certificate verification;
- first calls Node’s standard `tls.checkServerIdentity` and then compares the live server SPKI SHA-256 fingerprint in constant time;
- supplies the actual live fingerprint to `RemoteSignerClient` instead of echoing the expected pin;
- limits the response to 16,384 bytes;
- enforces one bounded end-to-end timeout; and
- disables automatic redirects, decompression and unbounded connection pooling.

Node documents that `tls.checkServerIdentity` is called only after the certificate passes CA checks and may be augmented with additional verification. Node also exposes the peer certificate while the TLS connection is open, and `X509Certificate.publicKey` can be exported as DER SPKI for hashing. These are the exact primitives used here:

- [Node 22 TLS documentation](https://nodejs.org/download/release/latest-v22.x/docs/api/tls.html)
- [Node 22 HTTPS documentation](https://nodejs.org/download/release/latest-v22.x/docs/api/https.html)
- [Node 22 X.509 documentation](https://nodejs.org/download/release/v22.17.0/docs/api/crypto.html)

## Components

### `tls-peer.ts`

One shared helper computes a lowercase `0x`-prefixed SHA-256 digest over the certificate public key’s DER SPKI bytes:

```ts
export function certificateSpkiSha256(rawCertificate:Buffer):Hex;
export function sameSpkiFingerprint(left:Hex,right:Hex):boolean;
```

It rejects absent, empty or malformed DER certificates. Both server and client use this helper, preventing drift between two fingerprint implementations.

### `mutual-tls-signer-transport.ts`

`NodeMutualTlsSignerTransport` implements the existing `AuthenticatedSignerTransport`:

```ts
export interface MutualTlsClientIdentity {
  key:Buffer|string;
  cert:Buffer|string;
  ca:Buffer|string|Array<Buffer|string>;
}

export interface MutualTlsTransportOptions {
  identity:MutualTlsClientIdentity;
  timeoutMs:number;
  maxResponseBytes?:number;
  dial?:{
    host:string;
    port:number;
  };
}

export class NodeMutualTlsSignerTransport
  implements AuthenticatedSignerTransport {
  post(
    url:string,
    body:string,
    expectedPeerSpkiSha256:Hex
  ):Promise<AuthenticatedTransportResponse>;
}
```

`dial` is an injected network capability for local tests or a reviewed sidecar topology. It changes only the TCP destination; the URL hostname still controls SNI, the HTTP `Host` value and hostname verification. The checked-in production composition does not expose this override through its public manifest.

`timeoutMs` must be a safe integer from 100 through 30,000. `maxResponseBytes` defaults to 16,384 and may only reduce that limit to a safe integer of at least 1,024. An injected dial host must be nonempty and its port must be an integer from 1 through 65,535.

The transport performs no retry. A failed or ambiguous call is reported as unavailable to `RemoteSignerClient`; the coordinator may issue a fresh request ID while the signer replay database continues to bind the same execution and authorization digests.

### `signer-daemon.ts`

`MutualTlsSignerDaemon` owns only HTTPS lifecycle and HTTP framing:

```ts
export interface MutualTlsServerIdentity {
  key:Buffer|string;
  cert:Buffer|string;
  ca:Buffer|string|Array<Buffer|string>;
}

export interface MutualTlsSignerDaemonOptions {
  identity:MutualTlsServerIdentity;
  host:string;
  port:number;
  requestTimeoutMs:number;
  headersTimeoutMs:number;
  keepAliveTimeoutMs:number;
}

export interface SignerDaemonAddress {
  host:string;
  port:number;
}

export class MutualTlsSignerDaemon {
  constructor(
    handler:SignerProtocolHandler,
    options:MutualTlsSignerDaemonOptions
  );
  start():Promise<SignerDaemonAddress>;
  stop():Promise<void>;
}
```

The bind host must be nonempty and the port must be an integer from `0` through `65,535`; port `0` is reserved for isolated tests. `requestTimeoutMs` and `headersTimeoutMs` must be safe integers from 100 through 30,000, and the header timeout may not exceed the request timeout. `keepAliveTimeoutMs` must be a safe integer from 100 through 5,000. `start()` refuses a second start. `stop()` is idempotent, stops accepting new connections, waits for active requests, and destroys remaining sockets after the configured request-timeout bound.

The daemon does not construct `DigestSigner`, `GenLayerSignerFinalityAttestor`, `GenLayerSignerWitnessReader`, or `SqliteSignerReplayStore`. Those remain injected capabilities with separate custody and lifecycle. This prevents a network listener from becoming a secret-loading service.

## Request flow

1. The coordinator builds a canonical v2 authorization from durable request state.
2. `RemoteSignerClient` asks `NodeMutualTlsSignerTransport` to post it.
3. The TLS client verifies the signer CA chain, logical hostname and configured signer SPKI pin while presenting its coordinator certificate.
4. The daemon TLS stack verifies the coordinator CA chain before HTTP parsing.
5. The daemon derives the actual coordinator SPKI fingerprint from the live socket.
6. The daemon validates method, path, media type, encoding, byte limit and timeouts.
7. `SignerProtocolHandler` compares the application coordinator identity and SPKI pin, decodes v2, reserves replay state and invokes the isolated signer.
8. The isolated signer independently verifies GenLayer status, transaction call and immutable record before key invocation.
9. The daemon returns the canonical v2 response.
10. The client derives and returns the actual signer fingerprint; `RemoteSignerClient` checks response binding and recovers the signature.

TLS authentication and GenLayer authorization remain separate gates. Possession of a trusted coordinator certificate cannot bypass the v2 request binding, signer finality attestor, signing-domain allowlist or replay database.

## HTTP behavior

Accepted request:

```text
POST /v2/sign HTTP/1.1
Content-Type: application/json
Content-Encoding: identity
```

The media type comparison is ASCII case-insensitive after trimming outer whitespace but accepts no parameters; `application/json; charset=utf-8` is rejected. `Content-Encoding` is treated the same way and must be absent or exactly `identity`. The client transport emits these canonical values.

The daemon rejects:

- any other method or path;
- missing or non-JSON media type;
- any content encoding other than absent or `identity`;
- declared or streamed bodies over 32,768 bytes;
- aborted, incomplete or timed-out bodies;
- unauthorized or certificate-less TLS peers; and
- requests received while stopping.

Application replies preserve the status and body returned by `SignerProtocolHandler` when the body is at most 16,384 UTF-8 bytes. An oversized or invalid handler reply becomes a generic internal transport refusal. Transport rejections use one generic body:

```json
{"version":"sentinel-signer/v2","error":{"code":"TRANSPORT_REFUSED","message":"request refused"}}
```

The daemon never returns a stack trace, certificate subject, fingerprint, TLS error, request body, upstream provider message, database path or key-provider detail.

## Certificate and key handling

No PEM, PFX, certificate, CA, key, passphrase or generated credential is committed. Tests generate a short-lived CA, signer certificate and coordinator certificate in an operating-system temporary directory, load them into memory, and delete the directory during cleanup. The test helper may invoke the local `openssl` executable; absence of that required test tool fails the mTLS test instead of skipping it.

Production certificate issuance, hardware-backed key use, passphrase delivery, rotation, revocation, OCSP policy and trust-store ownership remain external deployment responsibilities. Certificate rotation requires a controlled daemon restart in this milestone; hot reload is deliberately excluded.

The TLS private key is only the service-identity key. The DVN signing key remains behind `DigestSigner`; using the same key for TLS and DVN signatures is forbidden.

## Failure and lifecycle behavior

- TLS verification failure terminates the handshake and produces no application response.
- HTTP framing failure produces only `TRANSPORT_REFUSED`.
- Handler refusal preserves its existing allowlisted status/code.
- Client TLS, timeout, framing or oversized-response failures are sanitized by `RemoteSignerClient` as remote signer unavailability or invalid response.
- Server errors do not terminate the daemon.
- A process crash after replay reservation may consume a request ID, as already documented. Retrying with a new request ID and unchanged execution/authorization digests remains valid.
- Graceful stop does not accept new work and does not close the replay store or key/finality providers; their owner closes them after the daemon is drained.

## Test strategy

Tests use real loopback TLS sockets and runtime-generated certificates. The full authenticated E2E is:

```text
RemoteSignerClient
  → NodeMutualTlsSignerTransport
  → MutualTlsSignerDaemon
  → SignerProtocolHandler
  → SqliteSignerReplayStore
  → IsolatedSignerService
  → fixture finality + ephemeral ECDSA key
```

Required cases:

- valid CA chains, hostname, both SPKI pins and v2 request produce one valid share;
- certificate-less and untrusted coordinator clients fail before handler/key contact;
- wrong signer CA, hostname or SPKI pin fails before response acceptance;
- a CA-trusted coordinator certificate with the wrong application SPKI pin receives authentication refusal without key contact;
- wrong method, path, media type, content encoding and oversized declared/chunked bodies never reach the handler;
- timeout and aborted-body paths release sockets and keep the daemon usable;
- handler refusal stays sanitized;
- response-size overflow and malformed response fail closed;
- concurrent stop drains an active request, refuses new connections and is idempotent;
- no generated credential remains in the repository or tracked file list; and
- the complete release suite continues to pass with zero skips or todos.

## Operational truth

Completing this milestone will prove a real local mutual-TLS transport and listening signer process boundary. It will not prove:

- a deployed public signer endpoint;
- five independent operators or failure domains;
- a production CA, revocation or rotation ceremony;
- HSM/KMS custody;
- rate limiting or DDoS resistance;
- an official live GenLayer transaction-witness adapter;
- Bradbury finality behavior;
- independent validators or RPC operators;
- LayerZero DVN onboarding; or
- testnet/mainnet readiness.

Sentinel remains an additional/optional verifier beside independent LayerZero DVNs.
