/**
 * Wrapper → lab:run --cpu for a real URL.
 * Usage: node scripts/profile-real-site-full.js <url> [totalDurationMs]
 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const url = process.argv[2];
if (!url) {
  console.error('usage: node scripts/profile-real-site-full.js <url> [durationMs]');
  process.exit(1);
}
const durationMs = process.argv[3] || '20000';
const r = spawnSync(
  process.execPath,
  [
    path.join(__dirname, '..', 'dist', 'browser', 'mirror', 'projection', 'lab', 'runCli.js'),
    '--url',
    url,
    '--duration',
    `${durationMs}ms`,
    '--cpu',
    '--no-invariants',
  ],
  { cwd: path.join(__dirname, '..'), stdio: 'inherit' },
);
process.exit(r.status ?? 1);
