import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import {
  checkServerIdentity,
  type PeerCertificate,
  type TLSSocket,
} from "node:tls";
import { TextDecoder } from "node:util";
import type { Hex } from "../../../packages/core/src/types.js";
import type {
  AuthenticatedSignerTransport,
  AuthenticatedTransportResponse,
} from "./remote-signer.js";
import {
  certificateSpkiSha256,
  sameSpkiFingerprint,
} from "./tls-peer.js";

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

const MAX_REQUEST_BYTES = 32_768;
const DEFAULT_MAX_RESPONSE_BYTES = 16_384;
const MAX_HEADERS_COUNT = 32;
const UNAVAILABLE = "mutual TLS signer unavailable";

export class NodeMutualTlsSignerTransport
  implements AuthenticatedSignerTransport
{
  private readonly options: Required<
    Pick<MutualTlsTransportOptions, "identity" | "timeoutMs" | "maxResponseBytes">
  > & Pick<MutualTlsTransportOptions, "dial">;

  constructor(options: MutualTlsTransportOptions) {
    validateOptions(options);
    this.options = snapshotOptions(options);
  }

  async post(
    url: string,
    body: string,
    expectedPeerSpkiSha256: Hex,
  ): Promise<AuthenticatedTransportResponse> {
    if (
      !sameSpkiFingerprint(
        expectedPeerSpkiSha256,
        expectedPeerSpkiSha256,
      )
    ) {
      throw new Error("invalid signer SPKI fingerprint");
    }
    const logical = signerUrl(url);
    if (
      typeof body !== "string" ||
      Buffer.byteLength(body, "utf8") > MAX_REQUEST_BYTES
    ) {
      throw new Error("invalid signer request body");
    }
    try {
      return await this.request(logical, body, expectedPeerSpkiSha256);
    } catch {
      throw new Error(UNAVAILABLE);
    }
  }

  private request(
    logical: URL,
    body: string,
    expectedPeerSpkiSha256: Hex,
  ): Promise<AuthenticatedTransportResponse> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let clientRequest: ReturnType<typeof httpsRequest> | undefined;
      const finish = (
        error?: Error,
        result?: AuthenticatedTransportResponse,
      ) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) {
          clientRequest?.destroy();
          reject(error);
          return;
        }
        resolve(result!);
      };
      const timer = setTimeout(() => {
        clientRequest?.destroy();
        finish(new Error(UNAVAILABLE));
      }, this.options.timeoutMs);

      try {
        const alpnOptions = { ALPNProtocols: ["http/1.1"] };
        clientRequest = httpsRequest(
          {
            host: this.options.dial?.host ?? logical.hostname,
            port: this.options.dial?.port ?? 443,
            servername: logical.hostname,
            method: "POST",
            path: `${logical.pathname}${logical.search}`,
            agent: false,
            key: this.options.identity.key,
            cert: this.options.identity.cert,
            ca: this.options.identity.ca,
            rejectUnauthorized: true,
            minVersion: "TLSv1.3",
            maxVersion: "TLSv1.3",
            ...alpnOptions,
            checkServerIdentity: (
              hostname: string,
              certificate: PeerCertificate,
            ) => {
              const hostnameError = checkServerIdentity(
                logical.hostname,
                certificate,
              );
              if (hostnameError) return hostnameError;
              if (!certificate.raw) {
                return new Error("signer identity mismatch");
              }
              try {
                const actual = certificateSpkiSha256(certificate.raw);
                if (
                  !sameSpkiFingerprint(
                    actual,
                    expectedPeerSpkiSha256,
                  )
                ) {
                  return new Error("signer identity mismatch");
                }
              } catch {
                return new Error("signer identity mismatch");
              }
              return undefined;
            },
            headers: {
              Host: logical.host,
              "Content-Type": "application/json",
              "Content-Encoding": "identity",
              "Content-Length": Buffer.byteLength(body, "utf8"),
              Accept: "application/json",
              Connection: "close",
            },
          },
          (response) => {
            if (settled) {
              response.destroy();
              return;
            }
            try {
              const socket = response.socket as TLSSocket;
              if (
                socket.authorized !== true ||
                socket.getProtocol() !== "TLSv1.3" ||
                socket.alpnProtocol !== "http/1.1"
              ) {
                throw new Error(UNAVAILABLE);
              }
              const certificate = socket.getPeerCertificate();
              if (!certificate.raw) throw new Error(UNAVAILABLE);
              const actualPeerSpkiSha256 = certificateSpkiSha256(
                certificate.raw,
              );
              const status = response.statusCode;
              if (!Number.isInteger(status)) throw new Error(UNAVAILABLE);
              if (response.rawHeaders.length / 2 > MAX_HEADERS_COUNT) {
                throw new Error(UNAVAILABLE);
              }
              const contentType = singleRawHeader(
                response.rawHeaders,
                "content-type",
              );
              if (
                contentType.kind !== "value" ||
                contentType.value !== "application/json"
              ) {
                throw new Error(UNAVAILABLE);
              }
              const contentEncoding = singleRawHeader(
                response.rawHeaders,
                "content-encoding",
              );
              if (
                contentEncoding.kind === "multiple" ||
                (contentEncoding.kind === "value" &&
                  contentEncoding.value !== "identity")
              ) {
                throw new Error(UNAVAILABLE);
              }
              const contentLength = singleRawHeader(
                response.rawHeaders,
                "content-length",
              );
              if (contentLength.kind === "multiple") {
                throw new Error(UNAVAILABLE);
              }
              let declaredLength: number | undefined;
              if (contentLength.kind === "value") {
                if (!/^[0-9]+$/.test(contentLength.value)) {
                  throw new Error(UNAVAILABLE);
                }
                const parsed = BigInt(contentLength.value);
                if (parsed > BigInt(this.options.maxResponseBytes)) {
                  throw new Error(UNAVAILABLE);
                }
                declaredLength = Number(parsed);
              }

              const chunks: Buffer[] = [];
              let received = 0;
              let ended = false;
              const fail = () => {
                response.destroy();
                finish(new Error(UNAVAILABLE));
              };
              response.on("data", (chunk: Buffer | string) => {
                if (settled) return;
                const bytes = Buffer.isBuffer(chunk)
                  ? chunk
                  : Buffer.from(chunk);
                received += bytes.length;
                if (received > this.options.maxResponseBytes) {
                  fail();
                  return;
                }
                chunks.push(bytes);
              });
              response.once("aborted", fail);
              response.once("error", fail);
              response.once("end", () => {
                if (settled) return;
                ended = true;
                if (
                  response.complete !== true ||
                  (declaredLength !== undefined &&
                    received !== declaredLength)
                ) {
                  fail();
                  return;
                }
                let decoded: string;
                try {
                  decoded = new TextDecoder("utf-8", {
                    fatal: true,
                  }).decode(Buffer.concat(chunks, received));
                } catch {
                  fail();
                  return;
                }
                finish(undefined, {
                  status: status!,
                  body: decoded,
                  authenticatedPeerSpkiSha256: actualPeerSpkiSha256,
                });
              });
              response.once("close", () => {
                if (!ended && !settled) fail();
              });
            } catch {
              response.destroy();
              finish(new Error(UNAVAILABLE));
            }
          },
        );
        clientRequest.maxHeadersCount = MAX_HEADERS_COUNT + 1;
        clientRequest.once("socket", (socket) => {
          const tlsSocket = socket as TLSSocket;
          tlsSocket.once("secureConnect", () => {
            if (
              tlsSocket.authorized !== true ||
              tlsSocket.getProtocol() !== "TLSv1.3" ||
              tlsSocket.alpnProtocol !== "http/1.1"
            ) {
              clientRequest?.destroy();
              finish(new Error(UNAVAILABLE));
            }
          });
        });
        clientRequest.once("error", () => finish(new Error(UNAVAILABLE)));
        clientRequest.end(body);
      } catch {
        clientRequest?.destroy();
        finish(new Error(UNAVAILABLE));
      }
    });
  }
}

function validateOptions(options: MutualTlsTransportOptions): void {
  if (
    !options ||
    !options.identity ||
    emptyCapability(options.identity.key) ||
    emptyCapability(options.identity.cert) ||
    emptyCa(options.identity.ca)
  ) {
    throw new Error("invalid mutual TLS client identity");
  }
  boundedInteger(options.timeoutMs, 100, 30_000, "timeout");
  if (options.maxResponseBytes !== undefined) {
    boundedInteger(
      options.maxResponseBytes,
      1_024,
      DEFAULT_MAX_RESPONSE_BYTES,
      "response maximum",
    );
  }
  if (options.dial !== undefined) {
    if (
      !options.dial ||
      typeof options.dial.host !== "string" ||
      options.dial.host.length === 0
    ) {
      throw new Error("invalid mutual TLS dial host");
    }
    boundedInteger(options.dial.port, 1, 65_535, "dial port");
  }
}

function snapshotOptions(
  options: MutualTlsTransportOptions,
): Required<
  Pick<MutualTlsTransportOptions, "identity" | "timeoutMs" | "maxResponseBytes">
> & Pick<MutualTlsTransportOptions, "dial"> {
  return {
    identity: {
      key: snapshotCapability(options.identity.key),
      cert: snapshotCapability(options.identity.cert),
      ca: Array.isArray(options.identity.ca)
        ? options.identity.ca.map(snapshotCapability)
        : snapshotCapability(options.identity.ca),
    },
    timeoutMs: options.timeoutMs,
    maxResponseBytes:
      options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
    dial: options.dial
      ? { host: options.dial.host, port: options.dial.port }
      : undefined,
  };
}

function snapshotCapability(value: Buffer | string): Buffer | string {
  return Buffer.isBuffer(value) ? Buffer.from(value) : value;
}

function boundedInteger(
  value: number,
  minimum: number,
  maximum: number,
  name: string,
): void {
  if (
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error(`invalid mutual TLS ${name}`);
  }
}

function emptyCapability(value: unknown): boolean {
  return !(
    (typeof value === "string" && value.length > 0) ||
    (Buffer.isBuffer(value) && value.length > 0)
  );
}

function emptyCa(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.length === 0 || value.some(emptyCapability);
  }
  return emptyCapability(value);
}

function signerUrl(value: string): URL {
  if (typeof value !== "string") {
    throw new Error("invalid signer endpoint");
  }
  let logical: URL;
  try {
    logical = new URL(value);
  } catch {
    throw new Error("invalid signer endpoint");
  }
  const hostname = logical.hostname.replace(/^\[|\]$/g, "");
  if (
    logical.protocol !== "https:" ||
    logical.username.length > 0 ||
    logical.password.length > 0 ||
    logical.hash.length > 0 ||
    hasRawUserinfo(value) ||
    hasExplicitPort(value) ||
    !hasExactRawPath(value) ||
    logical.hostname.length === 0 ||
    !validDnsHostname(logical.hostname) ||
    isIP(hostname) !== 0 ||
    logical.hostname === "localhost" ||
    logical.hostname.endsWith(".localhost") ||
    logical.pathname !== "/v2/sign" ||
    logical.search.length > 0
  ) {
    throw new Error("invalid signer endpoint");
  }
  return logical;
}

function hasRawUserinfo(value: string): boolean {
  const scheme = value.indexOf("://");
  if (scheme < 0) return false;
  const authorityStart = scheme + 3;
  let authorityEnd = value.length;
  for (const delimiter of ["/", "?", "#"]) {
    const found = value.indexOf(delimiter, authorityStart);
    if (found >= 0 && found < authorityEnd) authorityEnd = found;
  }
  return value.slice(authorityStart, authorityEnd).includes("@");
}

function hasExplicitPort(value: string): boolean {
  const scheme = value.indexOf("://");
  if (scheme < 0) return false;
  const authorityStart = scheme + 3;
  let authorityEnd = value.length;
  for (const delimiter of ["/", "?", "#"]) {
    const found = value.indexOf(delimiter, authorityStart);
    if (found >= 0 && found < authorityEnd) authorityEnd = found;
  }
  const authority = value.slice(authorityStart, authorityEnd);
  const host = authority.slice(authority.lastIndexOf("@") + 1);
  if (host.startsWith("[")) return host.includes("]:");
  return host.includes(":");
}

function hasExactRawPath(value: string): boolean {
  const scheme = value.indexOf("://");
  if (scheme < 0) return false;
  const pathStart = value.indexOf("/", scheme + 3);
  return pathStart >= 0 && value.slice(pathStart) === "/v2/sign";
}

function validDnsHostname(hostname: string): boolean {
  if (hostname.length > 253 || hostname.endsWith(".")) return false;
  return hostname.split(".").every(
    (label) =>
      label.length > 0 &&
      label.length <= 63 &&
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
  );
}

function singleRawHeader(
  rawHeaders: string[],
  name: string,
):
  | { kind: "absent" }
  | { kind: "multiple" }
  | { kind: "value"; value: string } {
  const values: string[] = [];
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (rawHeaders[index]?.toLowerCase() !== name) continue;
    const value = rawHeaders[index + 1];
    if (typeof value !== "string") return { kind: "multiple" };
    values.push(value);
  }
  if (values.length === 0) return { kind: "absent" };
  if (values.length !== 1) return { kind: "multiple" };
  return { kind: "value", value: values[0]! };
}
