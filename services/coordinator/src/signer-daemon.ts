import type { IncomingMessage, ServerResponse } from "node:http";
import {
  createServer,
  type Server as HttpsServer,
} from "node:https";
import type { Socket } from "node:net";
import type { TLSSocket } from "node:tls";
import { TextDecoder } from "node:util";
import type { SignerProtocolHandler } from "./signer-protocol-handler.js";
import { certificateSpkiSha256 } from "./tls-peer.js";

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

const MAX_REQUEST_BYTES = 32_768;
const MAX_RESPONSE_BYTES = 16_384;
const MAX_HEADERS_COUNT = 32;
const TRANSPORT_REFUSED =
  '{"version":"sentinel-signer/v2","error":{"code":"TRANSPORT_REFUSED","message":"request refused"}}';
const CLIENT_ERROR_RESPONSE = parserResponse(400, "Bad Request");
const CLIENT_INCOMPLETE_RESPONSE = parserResponse(503, "Service Unavailable");

function parserResponse(status: number, reason: string): string {
  return (
    `HTTP/1.1 ${status} ${reason}\r\n` +
    `Content-Type: application/json\r\n` +
    `Content-Encoding: identity\r\n` +
    `Content-Length: ${Buffer.byteLength(TRANSPORT_REFUSED)}\r\n` +
    `Cache-Control: no-store\r\n` +
    `Connection: close\r\n\r\n` +
    TRANSPORT_REFUSED
  );
}

type DaemonState = "new" | "starting" | "running" | "stopping" | "stopped";
type BodyResult =
  | { kind: "ok"; body: string }
  | { kind: "overflow" }
  | { kind: "unavailable" };

export class MutualTlsSignerDaemon {
  private state: DaemonState = "new";
  private server?: HttpsServer;
  private readonly sockets = new Set<Socket>();
  private readonly activeRequests = new Set<Promise<void>>();
  private startPromise?: Promise<SignerDaemonAddress>;
  private stopPromise?: Promise<void>;
  private drainCheck?: () => void;

  constructor(
    private readonly handler: SignerProtocolHandler,
    private readonly options: MutualTlsSignerDaemonOptions,
  ) {
    validateOptions(options);
  }

  start(): Promise<SignerDaemonAddress> {
    if (this.state !== "new") {
      return Promise.reject(new Error("signer daemon unavailable"));
    }
    this.state = "starting";
    try {
      const server = createServer(
        {
          key: this.options.identity.key,
          cert: this.options.identity.cert,
          ca: this.options.identity.ca,
          requestCert: true,
          rejectUnauthorized: true,
          minVersion: "TLSv1.3",
          maxVersion: "TLSv1.3",
          ALPNProtocols: ["http/1.1"],
        },
        (request, response) => {
          const active = this.handleRequest(request, response);
          this.activeRequests.add(active);
          void active.finally(() => {
            this.activeRequests.delete(active);
            this.drainCheck?.();
          });
        },
      );
      this.server = server;
      server.requestTimeout = this.options.requestTimeoutMs;
      server.headersTimeout = this.options.headersTimeoutMs;
      server.keepAliveTimeout = this.options.keepAliveTimeoutMs;
      server.maxHeadersCount = MAX_HEADERS_COUNT;
      server.on("connection", (socket) => {
        const acceptedSocket = socket as Socket;
        this.sockets.add(acceptedSocket);
        acceptedSocket.once("close", () => this.sockets.delete(acceptedSocket));
      });
      server.on("clientError", (error, socket) => {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ERR_HTTP_REQUEST_TIMEOUT") {
          socket.destroy();
          return;
        }
        if (!socket.writable) {
          socket.destroy();
          return;
        }
        socket.end(
          code === "HPE_INVALID_EOF_STATE"
            ? CLIENT_INCOMPLETE_RESPONSE
            : CLIENT_ERROR_RESPONSE,
        );
      });
      this.startPromise = new Promise<SignerDaemonAddress>((resolve, reject) => {
        const failed = () => reject(new Error("signer daemon unavailable"));
        server.once("error", failed);
        server.listen(
          {
            host: this.options.host,
            port: this.options.port,
          },
          () => {
            server.off("error", failed);
            const address = server.address();
            if (!address || typeof address === "string") {
              reject(new Error("signer daemon unavailable"));
              return;
            }
            resolve({ host: this.options.host, port: address.port });
          },
        );
      }).then(
        (address) => {
          if (this.state === "starting") this.state = "running";
          return address;
        },
        async () => {
          await this.closeFailedStart(server);
          this.state = "stopped";
          throw new Error("signer daemon unavailable");
        },
      );
      return this.startPromise;
    } catch {
      this.state = "stopped";
      this.server = undefined;
      return Promise.reject(new Error("signer daemon unavailable"));
    }
  }

  stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    if (this.state === "stopped") {
      this.stopPromise = Promise.resolve();
      return this.stopPromise;
    }
    if (this.state === "new") {
      this.state = "stopped";
      this.stopPromise = Promise.resolve();
      return this.stopPromise;
    }
    if (this.state === "starting") {
      this.stopPromise = (async () => {
        try {
          await this.startPromise;
        } catch {
          return;
        }
        await this.closeRunningServer();
      })();
      return this.stopPromise;
    }
    this.stopPromise = this.closeRunningServer();
    return this.stopPromise;
  }

  private async handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    try {
      if (this.state !== "running") {
        this.transportFailure(response, 503);
        return;
      }
      if (
        !("authorized" in request.socket) ||
        request.socket.authorized !== true
      ) {
        this.transportFailure(response, 503);
        return;
      }
      const socket = request.socket as TLSSocket;
      const rawCertificate = socket.getPeerCertificate().raw;
      if (!rawCertificate) {
        this.transportFailure(response, 503);
        return;
      }
      let peerSpkiSha256: string;
      try {
        peerSpkiSha256 = certificateSpkiSha256(rawCertificate);
      } catch {
        this.transportFailure(response, 503);
        return;
      }
      if (request.method !== "POST") {
        this.transportFailure(response, 405);
        return;
      }
      if (request.url !== "/v2/sign") {
        this.transportFailure(response, 404);
        return;
      }
      const contentType = singleHeader(request, "content-type");
      if (
        contentType.kind !== "value" ||
        normalizeHeader(contentType.value) !== "application/json"
      ) {
        this.transportFailure(response, 415);
        return;
      }
      const contentEncoding = singleHeader(request, "content-encoding");
      if (
        contentEncoding.kind === "multiple" ||
        (contentEncoding.kind === "value" &&
          normalizeHeader(contentEncoding.value) !== "identity")
      ) {
        this.transportFailure(response, 415);
        return;
      }
      const contentLength = singleHeader(request, "content-length");
      let declaredLength: number | undefined;
      if (contentLength.kind === "multiple") {
        this.transportFailure(response, 413);
        return;
      }
      if (contentLength.kind === "value") {
        if (!/^[0-9]+$/.test(contentLength.value)) {
          this.transportFailure(response, 503);
          return;
        }
        const parsed = BigInt(contentLength.value);
        if (parsed > BigInt(MAX_REQUEST_BYTES)) {
          this.transportFailure(response, 413);
          return;
        }
        declaredLength = Number(parsed);
      }
      const body = await readBody(
        request,
        declaredLength,
        this.options.requestTimeoutMs,
      );
      if (body.kind === "overflow") {
        this.transportFailure(response, 413);
        return;
      }
      if (body.kind === "unavailable" || this.currentState() === "stopped") {
        this.transportFailure(response, 503);
        return;
      }
      let reply: unknown;
      try {
        reply = await this.handler.handle(peerSpkiSha256, body.body);
      } catch {
        this.transportFailure(response, 500);
        return;
      }
      if (!validReply(reply)) {
        this.transportFailure(response, 500);
        return;
      }
      this.send(response, reply.status, reply.body);
    } catch {
      this.transportFailure(response, 500);
    }
  }

  private transportFailure(response: ServerResponse, status: number): void {
    this.send(response, status, TRANSPORT_REFUSED);
  }

  private currentState(): DaemonState {
    return this.state;
  }

  private send(response: ServerResponse, status: number, body: string): void {
    if (response.destroyed || response.writableEnded) return;
    const length = Buffer.byteLength(body, "utf8");
    response.statusCode = status;
    response.setHeader("Content-Type", "application/json");
    response.setHeader("Content-Encoding", "identity");
    response.setHeader("Content-Length", length);
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Connection", "close");
    response.end(body);
  }

  private async closeRunningServer(): Promise<void> {
    if (this.state === "stopped") return;
    this.state = "stopping";
    const server = this.server;
    if (!server) {
      this.state = "stopped";
      return;
    }
    await new Promise<void>((resolve) => {
      let timer: NodeJS.Timeout | undefined;
      let settled = false;
      let serverClosed = false;
      let drainExpired = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        this.drainCheck = undefined;
        this.sockets.clear();
        this.server = undefined;
        this.state = "stopped";
        resolve();
      };
      const finishIfDrained = () => {
        if (
          serverClosed &&
          (drainExpired || this.activeRequests.size === 0)
        ) {
          finish();
        }
      };
      this.drainCheck = finishIfDrained;
      timer = setTimeout(() => {
        drainExpired = true;
        for (const socket of this.sockets) socket.destroy();
        finishIfDrained();
      }, this.options.requestTimeoutMs);
      try {
        server.close(() => {
          serverClosed = true;
          finishIfDrained();
        });
      } catch {
        serverClosed = true;
        finishIfDrained();
      }
    });
  }

  private async closeFailedStart(server: HttpsServer): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    this.server = undefined;
    if (!server.listening) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function validateOptions(options: MutualTlsSignerDaemonOptions): void {
  if (!options || typeof options.host !== "string" || options.host.length === 0) {
    throw new Error("invalid signer daemon host");
  }
  if (
    !Number.isInteger(options.port) ||
    options.port < 0 ||
    options.port > 65_535
  ) {
    throw new Error("invalid signer daemon port");
  }
  boundedInteger(options.requestTimeoutMs, 100, 30_000, "request timeout");
  boundedInteger(options.headersTimeoutMs, 100, 30_000, "headers timeout");
  if (options.headersTimeoutMs > options.requestTimeoutMs) {
    throw new Error("invalid signer daemon headers timeout");
  }
  boundedInteger(options.keepAliveTimeoutMs, 100, 5_000, "keep-alive timeout");
  if (
    !options.identity ||
    emptyCapability(options.identity.key) ||
    emptyCapability(options.identity.cert) ||
    emptyCa(options.identity.ca)
  ) {
    throw new Error("invalid signer daemon identity");
  }
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
    throw new Error(`invalid signer daemon ${name}`);
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
    return value.length === 0 || value.some((item) => emptyCapability(item));
  }
  return emptyCapability(value);
}

function normalizeHeader(value: string): string {
  return value
    .replace(/^[\t ]+|[\t ]+$/g, "")
    .replace(/[A-Z]/g, (character) =>
      String.fromCharCode(character.charCodeAt(0) + 32),
    );
}

function singleHeader(
  request: IncomingMessage,
  name: string,
):
  | { kind: "absent" }
  | { kind: "multiple" }
  | { kind: "value"; value: string } {
  const distinct = request.headersDistinct[name];
  if (distinct) {
    if (distinct.length !== 1 || typeof distinct[0] !== "string") {
      return { kind: "multiple" };
    }
    return { kind: "value", value: distinct[0] };
  }
  const values: string[] = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() !== name) continue;
    const value = request.rawHeaders[index + 1];
    if (typeof value !== "string") return { kind: "multiple" };
    values.push(value);
  }
  if (values.length === 0) return { kind: "absent" };
  if (values.length !== 1) return { kind: "multiple" };
  return { kind: "value", value: values[0]! };
}

function readBody(
  request: IncomingMessage,
  declaredLength: number | undefined,
  timeoutMs: number,
): Promise<BodyResult> {
  return new Promise((resolve) => {
    let settled = false;
    let bytes = 0;
    const chunks: Buffer[] = [];
    const settle = (result: BodyResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      request.pause();
      settle({ kind: "unavailable" });
    }, timeoutMs);
    request.once("end", () => {
      if (declaredLength !== undefined && bytes !== declaredLength) {
        settle({ kind: "unavailable" });
        return;
      }
      try {
        const body = new TextDecoder("utf-8", { fatal: true }).decode(
          Buffer.concat(chunks, bytes),
        );
        settle({ kind: "ok", body });
      } catch {
        settle({ kind: "unavailable" });
      }
    });
    request.once("aborted", () => settle({ kind: "unavailable" }));
    request.once("close", () => {
      if (!request.complete) settle({ kind: "unavailable" });
    });
    request.once("timeout", () => settle({ kind: "unavailable" }));
    request.once("error", () => settle({ kind: "unavailable" }));
    request.on("data", (chunk: Buffer) => {
      if (settled) return;
      bytes += chunk.length;
      if (bytes > MAX_REQUEST_BYTES) {
        request.pause();
        settle({ kind: "overflow" });
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
  });
}

function validReply(
  value: unknown,
): value is { status: number; body: string } {
  if (!value || typeof value !== "object") return false;
  const reply = value as { status?: unknown; body?: unknown };
  return (
    Number.isInteger(reply.status) &&
    Number(reply.status) >= 200 &&
    Number(reply.status) <= 599 &&
    typeof reply.body === "string" &&
    Buffer.byteLength(reply.body, "utf8") <= MAX_RESPONSE_BYTES
  );
}
