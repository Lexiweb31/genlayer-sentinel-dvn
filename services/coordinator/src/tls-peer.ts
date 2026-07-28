import {
  createHash,
  timingSafeEqual,
  X509Certificate,
} from "node:crypto";
import type { Hex } from "../../../packages/core/src/types.js";

const SPKI_FINGERPRINT = /^0x[0-9a-f]{64}$/;

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
