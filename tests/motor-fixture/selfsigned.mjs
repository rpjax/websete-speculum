import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CERT_DIR = process.env.FIXTURE_CERT_DIR || join(__dirname, '.certs');

/** Return {cert, key} PEM — prefer openssl in container, else bundled generation via openssl once. */
export default function selfsigned(commonName) {
  mkdirSync(CERT_DIR, { recursive: true });
  const keyPath = join(CERT_DIR, 'key.pem');
  const certPath = join(CERT_DIR, 'cert.pem');

  if (!existsSync(keyPath) || !existsSync(certPath)) {
    try {
      execFileSync('openssl', [
        'req', '-x509', '-newkey', 'rsa:2048',
        '-keyout', keyPath, '-out', certPath,
        '-days', '3650', '-nodes',
        '-subj', `/CN=${commonName}`,
      ], { stdio: 'pipe' });
    } catch (err) {
      throw new Error(
        `Fixture TLS requires openssl to mint a self-signed cert (CI image). ${err.message}`,
      );
    }
  }

  return {
    key: readFileSync(keyPath, 'utf8'),
    cert: readFileSync(certPath, 'utf8'),
  };
}
