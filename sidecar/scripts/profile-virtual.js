/**
 * Wrapper → `npm run lab:run` (V4 BrowserSession). Extra args forwarded.
 * Usage: node scripts/profile-virtual.js [fixture|url] [durationMs]
 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const fixture = process.argv[2] || 'stress-churn.html';
const durationMs = process.argv[3] || '8000';
const url = /^https?:\/\//i.test(fixture) ? fixture : `fixtures/${fixture.replace(/^fixtures\//, '')}`;

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
