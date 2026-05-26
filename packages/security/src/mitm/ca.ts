/**
 * Persistent MITM CA for security-mode.
 *
 * The CA is generated once per project (under <devRoot>/.hover/ca/) and reused
 * across service restarts. Keeping the SPKI fingerprint stable matters: when
 * the widget toggles security-mode on, the debug Chrome is launched with
 * --ignore-certificate-errors-spki-list=<spki>. If the CA churned every boot,
 * users would have to relaunch Chrome on every toggle.
 *
 * The CA private key never leaves <devRoot>/.hover/ca/. Add the dir to
 * .gitignore — see the README section on security-mode.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, X509Certificate } from 'node:crypto';
import * as mockttp from 'mockttp';

export interface CaMaterial {
  /** Absolute path to the CA private key (PEM). */
  keyPath: string;
  /** Absolute path to the CA certificate (PEM). */
  certPath: string;
  /** Base64-encoded SHA-256 of the SubjectPublicKeyInfo — the value Chrome
   *  expects in --ignore-certificate-errors-spki-list. */
  spki: string;
}

function spkiFromCertPem(pem: string): string {
  const cert = new X509Certificate(pem);
  // cert.publicKey is already a KeyObject; export as DER SPKI directly.
  const pubKeyDer = cert.publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
  return createHash('sha256').update(pubKeyDer).digest('base64');
}

/**
 * Load the CA if it exists, generating it on first call. Idempotent across
 * concurrent service instances within the same project — last writer wins,
 * but every writer produces a valid PEM pair.
 */
export async function loadOrCreateCa(devRoot: string): Promise<CaMaterial> {
  const caDir = join(devRoot, '.hover', 'ca');
  const keyPath = join(caDir, 'ca.key');
  const certPath = join(caDir, 'ca.pem');

  if (existsSync(keyPath) && existsSync(certPath)) {
    const certPem = readFileSync(certPath, 'utf-8');
    return { keyPath, certPath, spki: spkiFromCertPem(certPem) };
  }

  mkdirSync(caDir, { recursive: true });
  const { key, cert } = await mockttp.generateCACertificate({
    subject: {
      commonName: 'Hover Security-Mode CA',
      organizationName: 'Hover (local dev only)',
    },
  });
  writeFileSync(keyPath, key, { mode: 0o600 });
  writeFileSync(certPath, cert, { mode: 0o644 });

  return { keyPath, certPath, spki: spkiFromCertPem(cert) };
}
