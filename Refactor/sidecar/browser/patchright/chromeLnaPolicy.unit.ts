import assert from 'assert';
import fs from 'node:fs';
import path from 'node:path';
import { buildChromeArgs, speculumPlaneExtensionPath, webglSpoofExtensionPath } from './ChromeRuntime';

function sidecarRoot(): string {
  // dist/browser/patchright → ../../.. = package root (host + /app in lab image)
  const candidates = [
    path.join(__dirname, '..', '..', '..'),
    path.join(__dirname, '..', '..'),
    path.join(__dirname, '..', '..', '..', '..'),
  ];
  for (const root of candidates) {
    if (fs.existsSync(path.join(root, 'chrome-policies', 'managed', 'speculum-lna.json'))) {
      return root;
    }
  }
  throw new Error('sidecar root not found for LNA policy unit');
}

/** Host tree keeps the file next to package root; lab image installs it at `/docker-entrypoint.sh`. */
function resolveDockerEntrypoint(root: string): string {
  const candidates = [
    path.join(root, 'docker-entrypoint.sh'),
    '/docker-entrypoint.sh',
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(`missing docker-entrypoint (tried ${candidates.join(', ')})`);
}

export function runChromeLnaPolicyUnitTests(): void {
  const root = sidecarRoot();
  const policyPath = path.join(root, 'chrome-policies', 'managed', 'speculum-lna.json');
  assert.ok(fs.existsSync(policyPath), `missing LNA policy ${policyPath}`);
  const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8')) as {
    LoopbackNetworkAllowedForUrls?: unknown;
    LocalNetworkAccessAllowedForUrls?: unknown;
  };
  assert.deepStrictEqual(policy.LoopbackNetworkAllowedForUrls, ['*']);
  assert.deepStrictEqual(policy.LocalNetworkAccessAllowedForUrls, ['*']);

  const args = buildChromeArgs(1280, 720);
  assert.ok(
    args.includes('--enable-unsafe-extension-debugging'),
    'branded Chrome requires --enable-unsafe-extension-debugging for CDP Extensions.loadUnpacked',
  );
  assert.ok(fs.existsSync(webglSpoofExtensionPath()), 'webgl-spoof extension dir must exist');
  assert.ok(fs.existsSync(speculumPlaneExtensionPath()), 'speculum-plane extension dir must exist');
  const disableFeatures = args.find((a) => a.startsWith('--disable-features=')) ?? '';
  assert.ok(
    !disableFeatures.includes('LocalNetworkAccessChecks'),
    'buildChromeArgs must not disable LocalNetworkAccessChecks (policy-only LNA)',
  );

  const entrySrc = fs.readFileSync(resolveDockerEntrypoint(root), 'utf8');
  assert.ok(
    entrySrc.includes('ensure_chrome_lna_policies'),
    'docker-entrypoint must install chrome LNA policies',
  );

  console.log('[unit] chrome LNA policy ok');
}
