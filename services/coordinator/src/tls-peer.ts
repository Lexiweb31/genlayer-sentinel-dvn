import {
  createHash,
  timingSafeEqual,
  X509Certificate,
} from "node:crypto";
import type { Hex } from "../../../packages/core/src/types.js";

const SPKI_FINGERPRINT = /^0x[0-9a-f]{64}$/;

function isDerSequence(value: Buffer): boolean {
  if (value.length < 2 || value[0] !== 0x30) return false;

  const firstLengthByte = value[1]!;
  if (firstLengthByte < 0x80) return value.length === firstLengthByte + 2;

  const lengthBytes = firstLengthByte & 0x7f;
  if (
    lengthBytes === 0 ||
    lengthBytes > 4 ||
    value.length < lengthBytes + 2 ||
    value[2] === 0
  ) {
    return false;
  }

  let length = 0;
  for (let index = 0; index < lengthBytes; index += 1) {
    length = (length << 8) | value[index + 2]!;
  }
  return value.length === length + lengthBytes + 2;
}

export function certificateSpkiSha256(rawCertificate: Buffer): Hex {
  if (!Buffer.isBuffer(rawCertificate) || !isDerSequence(rawCertificate)) {
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

export function sameSpkiFingerprint(
  left: string,
  right: string,
): boolean {
  if (!SPKI_FINGERPRINT.test(left) || !SPKI_FINGERPRINT.test(right)) {
    return false;
  }
  return timingSafeEqual(
    Buffer.from(left.slice(2), "hex"),
    Buffer.from(right.slice(2), "hex"),
  );
}
