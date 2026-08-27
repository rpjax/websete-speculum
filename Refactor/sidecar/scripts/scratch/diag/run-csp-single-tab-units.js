'use strict';
const path = require('node:path');
const root = path.join(__dirname, '..', '..', '..');

async function main() {
  // Pull the private test via re-running full module entry that only does single-tab after CSP —
  // pageProjectionSession.unit exports one runner; call it with retry for Target.createTarget flake.
  const { runPageProjectionSessionUnitTests } = require(path.join(
    root,
    'dist/browser/mirror/projection/session/pageProjectionSession.unit',
  ));
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      await runPageProjectionSessionUnitTests();
      console.log('ALL_OK');
      return;
    } catch (e) {
      lastErr = e;
      const msg = e && e.message ? e.message : String(e);
      if (!/Failed to open a new tab|Target\.createTarget/i.test(msg)) throw e;
      console.warn(`retry ${i + 1} after boot flake:`, msg.slice(0, 120));
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw lastErr;
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
