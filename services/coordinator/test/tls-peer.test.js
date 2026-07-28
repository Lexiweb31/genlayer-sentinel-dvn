import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import {
  certificateSpkiSha256,
  sameSpkiFingerprint,
} from "../../../dist/services/coordinator/src/tls-peer.js";
import { createMutualTlsCertificateFixture } from "./mtls-test-certificates.js";

test("hashes the certificate SPKI to the independent OpenSSL vector", () => {
  const fixture = createMutualTlsCertificateFixture();
  try {
    const publicKey = execFileSync(
      "openssl",
      ["x509", "-in", fixture.signerCertPath, "-pubkey", "-noout"],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    const spki = execFileSync(
      "openssl",
      ["pkey", "-pubin", "-outform", "DER"],
      { input: publicKey, stdio: ["pipe", "pipe", "pipe"] },
    );
    const digest = execFileSync(
      "openssl",
      ["dgst", "-sha256", "-binary"],
      { input: spki, stdio: ["pipe", "pipe", "pipe"] },
    );
    const expected = `0x${digest.toString("hex")}`;
    const raw = new X509Certificate(fixture.signerCert).raw;

    assert.equal(certificateSpkiSha256(raw), expected);
  } finally {
    fixture.cleanup();
  }
});

test("rejects absent, empty, or malformed DER certificates", () => {
  for (const value of [undefined, Buffer.alloc(0), Buffer.from("not DER")]) {
    assert.throws(
      () => certificateSpkiSha256(value),
      /^Error: invalid peer certificate$/,
    );
  }
});

test("compares only exact lowercase SPKI fingerprints without throwing", () => {
  const pin = `0x${"a".repeat(64)}`;
  assert.equal(sameSpkiFingerprint(pin, pin), true);
  assert.equal(
    sameSpkiFingerprint(pin, `0x${"b".repeat(64)}`),
    false,
  );
  assert.equal(sameSpkiFingerprint(pin, `0x${"A".repeat(64)}`), false);
  assert.equal(sameSpkiFingerprint(pin, `0x${"a".repeat(62)}`), false);
  assert.equal(sameSpkiFingerprint(pin, `0x${"g".repeat(64)}`), false);
});
