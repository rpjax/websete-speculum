import assert from 'assert';
import fs from 'node:fs';
import path from 'node:path';
import { buildChromeArgs } from './ChromeRuntime';

function sidecarRoot(): string {
  const candidates = [
    path.join(__dirname, '..', '..'),
    path.join(__dirname, '..', '..', '..'),
  ];
  for (const root of candidates) {
    if (fs.existsSync(path.join(root, 'chrome-policies', 'managed', 'speculum-lna.json'))) {
      return root;
    }
  }
  throw new Error('sidecar root not found for LNA policy unit');
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
  const disableFeatures = args.find((a) => a.startsWith('--disable-features=')) ?? '';
  assert.ok(
    !disableFeatures.includes('LocalNetworkAccessChecks'),
    'buildChromeArgs must not disable LocalNetworkAccessChecks (policy-only LNA)',
  );

  const entrypoint = path.join(root, 'docker-entrypoint.sh');
  assert.ok(fs.existsSync(entrypoint), `missing docker-entrypoint ${entrypoint}`);
  const entrySrc = fs.readFileSync(entrypoint, 'utf8');
  assert.ok(
    entrySrc.includes('ensure_chrome_lna_policies'),
    'docker-entrypoint must install chrome LNA policies',
  );

  console.log('[unit] chrome LNA policy ok');
}
