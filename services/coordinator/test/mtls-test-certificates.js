import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function openssl(args, options = {}) {
  return execFileSync("openssl", args, {
    stdio: ["pipe", "pipe", "pipe"],
    ...options,
  });
}

function createCa(root, name, commonName) {
  const keyPath = join(root, `${name}-key.pem`);
  const certPath = join(root, `${name}-cert.pem`);
  openssl([
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-sha256",
    "-days",
    "1",
    "-keyout",
    keyPath,
    "-out",
    certPath,
    "-subj",
    `/CN=${commonName}`,
  ]);
  return { keyPath, certPath, serialPath: join(root, `${name}.srl`) };
}

function createLeaf(root, name, commonName, ca, extensions, firstForCa) {
  const keyPath = join(root, `${name}-key.pem`);
  const requestPath = join(root, `${name}.csr`);
  const certPath = join(root, `${name}-cert.pem`);
  const extensionPath = join(root, `${name}.ext`);
  writeFileSync(extensionPath, `${extensions.join("\n")}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  openssl([
    "req",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-sha256",
    "-keyout",
    keyPath,
    "-out",
    requestPath,
    "-subj",
    `/CN=${commonName}`,
  ]);
  openssl([
    "x509",
    "-req",
    "-in",
    requestPath,
    "-CA",
    ca.certPath,
    "-CAkey",
    ca.keyPath,
    "-CAserial",
    ca.serialPath,
    ...(firstForCa ? ["-CAcreateserial"] : []),
    "-days",
    "1",
    "-sha256",
    "-extfile",
    extensionPath,
    "-out",
    certPath,
  ]);
  return {
    keyPath,
    certPath,
    key: readFileSync(keyPath),
    cert: readFileSync(certPath),
  };
}

export function createMutualTlsCertificateFixture() {
  const root = mkdtempSync(join(tmpdir(), "sentinel-mtls-"));
  let cleaned = false;
  try {
    const trustedCa = createCa(root, "trusted-ca", "Sentinel Test CA");
    const signer = createLeaf(
      root,
      "signer",
      "signer.example",
      trustedCa,
      [
        "basicConstraints=critical,CA:FALSE",
        "keyUsage=critical,digitalSignature,keyEncipherment",
        "extendedKeyUsage=serverAuth",
        "subjectAltName=DNS:signer.example",
      ],
      true,
    );
    const coordinator = createLeaf(
      root,
      "coordinator",
      "coordinator-west",
      trustedCa,
      [
        "basicConstraints=critical,CA:FALSE",
        "keyUsage=critical,digitalSignature,keyEncipherment",
        "extendedKeyUsage=clientAuth",
      ],
      false,
    );
    const alternateCoordinator = createLeaf(
      root,
      "alternate-coordinator",
      "coordinator-east",
      trustedCa,
      [
        "basicConstraints=critical,CA:FALSE",
        "keyUsage=critical,digitalSignature,keyEncipherment",
        "extendedKeyUsage=clientAuth",
      ],
      false,
    );
    const rogueCa = createCa(root, "rogue-ca", "Sentinel Rogue Test CA");
    const rogueCoordinator = createLeaf(
      root,
      "rogue-coordinator",
      "coordinator-rogue",
      rogueCa,
      [
        "basicConstraints=critical,CA:FALSE",
        "keyUsage=critical,digitalSignature,keyEncipherment",
        "extendedKeyUsage=clientAuth",
      ],
      true,
    );
    return {
      root,
      caCert: readFileSync(trustedCa.certPath),
      signerKey: signer.key,
      signerCert: signer.cert,
      signerCertPath: signer.certPath,
      coordinatorKey: coordinator.key,
      coordinatorCert: coordinator.cert,
      coordinatorCertPath: coordinator.certPath,
      alternateCoordinatorKey: alternateCoordinator.key,
      alternateCoordinatorCert: alternateCoordinator.cert,
      rogueCaCert: readFileSync(rogueCa.certPath),
      rogueCoordinatorKey: rogueCoordinator.key,
      rogueCoordinatorCert: rogueCoordinator.cert,
      cleanup() {
        if (cleaned) return;
        cleaned = true;
        rmSync(root, { recursive: true, force: true });
      },
    };
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}
