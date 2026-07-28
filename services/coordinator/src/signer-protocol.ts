import { keccak256, toUtf8Bytes } from "ethers";
import type { Hex, PolicyResult } from "../../../packages/core/src/types.js";
import type {
  SignatureShare,
  SigningAuthorization,
  SigningEnvelope,
} from "./signing.js";

export const SIGNER_PROTOCOL_VERSION = "sentinel-signer/v2" as const;
const MAX_REQUEST_BYTES = 32_768;
const MAX_EVIDENCE_URI_BYTES = 2_048;
const MAX_SEMANTIC_TEXT_BYTES = 8_192;

export interface SignerRequest {
  version: typeof SIGNER_PROTOCOL_VERSION;
  requestId: Hex;
  coordinatorId: string;
  issuedAt: number;
  expiresAt: number;
  envelope: SigningEnvelope;
  authorization: SigningAuthorization;
}

export interface SignerResponse {
  version: typeof SIGNER_PROTOCOL_VERSION;
  requestId: Hex;
  signer: Hex;
  digest: Hex;
  signature: Hex;
}

export function encodeSignerRequest(request: SignerRequest): string {
  validateRequest(request);
  const body = JSON.stringify({
    version: request.version,
    requestId: request.requestId,
    coordinatorId: request.coordinatorId,
    issuedAt: request.issuedAt,
    expiresAt: request.expiresAt,
    envelope: canonicalEnvelope(request.envelope),
    authorization: canonicalAuthorization(request.authorization),
  });
  requestSize(body);
  return body;
}

export function decodeSignerRequest(body: string): SignerRequest {
  requestSize(body);
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new Error("invalid signer request JSON");
  }
  const root = object(value, "request");
  keys(root, [
    "version",
    "requestId",
    "coordinatorId",
    "issuedAt",
    "expiresAt",
    "envelope",
    "authorization",
  ]);
  const wireEnvelope = object(root.envelope, "envelope");
  const wireAuthorization = object(root.authorization, "authorization");
  const wireWitness = object(wireAuthorization.witness, "authorization.witness");
  const wireResult = object(wireAuthorization.result, "authorization.result");
  keys(wireEnvelope, [
    "chainId",
    "adapter",
    "verificationTarget",
    "guid",
    "packetDigest",
    "evidenceDigest",
    "callData",
    "expiry",
  ]);
  keys(wireAuthorization, ["witness", "result"]);
  keys(wireWitness, ["transactionId", "evidenceUri", "decodedAction", "policy"]);
  keys(wireResult, [
    "guid",
    "packetDigest",
    "evidenceDigest",
    "decision",
    "reasonCode",
    "finalizedAt",
    "policyVersion",
  ]);
  const request: SignerRequest = {
    version: version(root.version),
    requestId: hash(root.requestId, "requestId"),
    coordinatorId: id(root.coordinatorId, "coordinatorId"),
    issuedAt: uint(root.issuedAt, "issuedAt"),
    expiresAt: uint(root.expiresAt, "expiresAt"),
    envelope: {
      chainId: decimal(wireEnvelope.chainId, "chainId"),
      adapter: address(wireEnvelope.adapter, "adapter"),
      verificationTarget: address(
        wireEnvelope.verificationTarget,
        "verificationTarget",
      ),
      guid: hash(wireEnvelope.guid, "guid"),
      packetDigest: hash(wireEnvelope.packetDigest, "packetDigest"),
      evidenceDigest: hash(wireEnvelope.evidenceDigest, "evidenceDigest"),
      callData: bytes(wireEnvelope.callData, "callData"),
      expiry: decimal(wireEnvelope.expiry, "expiry"),
    },
    authorization: {
      witness: {
        transactionId: hash(wireWitness.transactionId, "transactionId"),
        evidenceUri: evidenceUri(wireWitness.evidenceUri),
        decodedAction: semanticText(wireWitness.decodedAction, "decodedAction"),
        policy: semanticText(wireWitness.policy, "policy"),
      },
      result: decodeResult(wireResult),
    },
  };
  validateRequest(request);
  return request;
}

export function signerRequestHash(request: SignerRequest): Hex {
  return keccak256(toUtf8Bytes(encodeSignerRequest(request))) as Hex;
}

export function signerAuthorizationHash(
  authorization: SigningAuthorization,
): Hex {
  validateAuthorization(authorization);
  return keccak256(
    toUtf8Bytes(JSON.stringify(canonicalAuthorization(authorization))),
  ) as Hex;
}

export function encodeSignerResponse(response: SignerResponse): string {
  validateResponse(response);
  return JSON.stringify({
    version: response.version,
    requestId: response.requestId,
    signer: response.signer,
    digest: response.digest,
    signature: response.signature,
  });
}

export function decodeSignerResponse(body: string): SignerResponse {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new Error("invalid signer response JSON");
  }
  const root = object(value, "response");
  keys(root, ["version", "requestId", "signer", "digest", "signature"]);
  const response: SignerResponse = {
    version: version(root.version),
    requestId: hash(root.requestId, "requestId"),
    signer: address(root.signer, "signer"),
    digest: hash(root.digest, "digest"),
    signature: signature(root.signature),
  };
  validateResponse(response);
  return response;
}

export function responseFromShare(
  requestId: Hex,
  share: SignatureShare,
): SignerResponse {
  return {
    version: SIGNER_PROTOCOL_VERSION,
    requestId,
    signer: share.address.toLowerCase() as Hex,
    digest: share.digest.toLowerCase() as Hex,
    signature: share.signature.toLowerCase() as Hex,
  };
}

function canonicalEnvelope(envelope: SigningEnvelope) {
  return {
    chainId: envelope.chainId.toString(),
    adapter: envelope.adapter,
    verificationTarget: envelope.verificationTarget,
    guid: envelope.guid,
    packetDigest: envelope.packetDigest,
    evidenceDigest: envelope.evidenceDigest,
    callData: envelope.callData,
    expiry: envelope.expiry.toString(),
  };
}

function canonicalAuthorization(authorization: SigningAuthorization) {
  return {
    witness: {
      transactionId: authorization.witness.transactionId,
      evidenceUri: authorization.witness.evidenceUri,
      decodedAction: authorization.witness.decodedAction,
      policy: authorization.witness.policy,
    },
    result: {
      guid: authorization.result.guid,
      packetDigest: authorization.result.packetDigest,
      evidenceDigest: authorization.result.evidenceDigest,
      decision: authorization.result.decision,
      reasonCode: authorization.result.reasonCode,
      finalizedAt: authorization.result.finalizedAt,
      policyVersion: authorization.result.policyVersion,
    },
  };
}

function decodeResult(value: Record<string, unknown>): PolicyResult {
  return {
    guid: hash(value.guid, "result.guid"),
    packetDigest: hash(value.packetDigest, "result.packetDigest"),
    evidenceDigest: hash(value.evidenceDigest, "result.evidenceDigest"),
    decision: decision(value.decision),
    reasonCode: id(value.reasonCode, "reasonCode"),
    finalizedAt: uint(value.finalizedAt, "finalizedAt"),
    policyVersion: id(value.policyVersion, "policyVersion"),
  };
}

function validateRequest(value: SignerRequest): void {
  version(value.version);
  hash(value.requestId, "requestId");
  id(value.coordinatorId, "coordinatorId");
  uint(value.issuedAt, "issuedAt");
  uint(value.expiresAt, "expiresAt");
  if (value.expiresAt <= value.issuedAt) throw new Error("invalid request lifetime");
  decimal(value.envelope.chainId.toString(), "chainId");
  address(value.envelope.adapter, "adapter");
  address(value.envelope.verificationTarget, "verificationTarget");
  hash(value.envelope.guid, "guid");
  hash(value.envelope.packetDigest, "packetDigest");
  hash(value.envelope.evidenceDigest, "evidenceDigest");
  bytes(value.envelope.callData, "callData");
  decimal(value.envelope.expiry.toString(), "expiry");
  validateAuthorization(value.authorization);
  const result = value.authorization.result;
  if (
    value.envelope.guid !== result.guid ||
    value.envelope.packetDigest !== result.packetDigest ||
    value.envelope.evidenceDigest !== result.evidenceDigest
  ) {
    throw new Error("request binding mismatch");
  }
}

function validateAuthorization(value: SigningAuthorization): void {
  hash(value.witness.transactionId, "transactionId");
  evidenceUri(value.witness.evidenceUri);
  semanticText(value.witness.decodedAction, "decodedAction");
  semanticText(value.witness.policy, "policy");
  hash(value.result.guid, "result.guid");
  hash(value.result.packetDigest, "result.packetDigest");
  hash(value.result.evidenceDigest, "result.evidenceDigest");
  decision(value.result.decision);
  id(value.result.reasonCode, "reasonCode");
  uint(value.result.finalizedAt, "finalizedAt");
  id(value.result.policyVersion, "policyVersion");
}

function validateResponse(value: SignerResponse): void {
  version(value.version);
  hash(value.requestId, "requestId");
  address(value.signer, "signer");
  hash(value.digest, "digest");
  signature(value.signature);
}

function requestSize(body: string): void {
  if (Buffer.byteLength(body, "utf8") > MAX_REQUEST_BYTES) {
    throw new Error("signer request exceeds byte limit");
  }
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function keys(value: Record<string, unknown>, expected: string[]): void {
  const actual = Object.keys(value);
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error("unexpected protocol fields");
  }
}

function version(value: unknown): typeof SIGNER_PROTOCOL_VERSION {
  if (value !== SIGNER_PROTOCOL_VERSION) {
    throw new Error("unsupported signer protocol version");
  }
  return value;
}

function id(value: unknown, name: string): string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)
  ) {
    throw new Error(`invalid ${name}`);
  }
  return value;
}

function uint(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`invalid ${name}`);
  }
  return Number(value);
}

function decimal(value: unknown, name: string): bigint {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`invalid ${name}`);
  }
  return BigInt(value);
}

function hash(value: unknown, name: string): Hex {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/.test(value)) {
    throw new Error(`invalid ${name}`);
  }
  return value as Hex;
}

function address(value: unknown, name: string): Hex {
  if (
    typeof value !== "string" ||
    !/^0x[0-9a-f]{40}$/.test(value) ||
    /^0x0{40}$/.test(value)
  ) {
    throw new Error(`invalid ${name}`);
  }
  return value as Hex;
}

function bytes(value: unknown, name: string): Hex {
  if (typeof value !== "string" || !/^0x(?:[0-9a-f]{2})*$/.test(value)) {
    throw new Error(`invalid ${name}`);
  }
  return value as Hex;
}

function signature(value: unknown): Hex {
  if (typeof value !== "string" || !/^0x[0-9a-f]{130}$/.test(value)) {
    throw new Error("invalid signature");
  }
  return value as Hex;
}

function decision(value: unknown): PolicyResult["decision"] {
  if (value !== "ALLOW" && value !== "DENY" && value !== "UNDETERMINED") {
    throw new Error("invalid decision");
  }
  return value;
}

function evidenceUri(value: unknown): string {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value, "utf8") > MAX_EVIDENCE_URI_BYTES
  ) {
    throw new Error("invalid evidenceUri");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("invalid evidenceUri");
  }
  if (
    url.protocol !== "https:" ||
    !url.hostname ||
    Boolean(url.username) ||
    Boolean(url.password)
  ) {
    throw new Error("invalid evidenceUri");
  }
  return value;
}

function semanticText(value: unknown, name: string): string {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value, "utf8") < 1 ||
    Buffer.byteLength(value, "utf8") > MAX_SEMANTIC_TEXT_BYTES
  ) {
    throw new Error(`invalid ${name}`);
  }
  return value;
}
