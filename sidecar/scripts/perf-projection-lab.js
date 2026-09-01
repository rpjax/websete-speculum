/**
 * Wrapper → lab:run with invariants + duration. Usage: node scripts/perf-projection-lab.js [fixture] [durationMs]
 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const fixture = process.argv[2] || 'demo.html';
const durationMs = process.argv[3] || '15000';

const r = spawnSync(
  process.execPath,
  [
    path.join(__dirname, '..', 'dist', 'browser', 'mirror', 'projection', 'lab', 'runCli.js'),
    '--url',
    `fixtures/${fixture.replace(/^fixtures\//, '')}`,
    '--duration',
    `${durationMs}ms`,
  ],
  { cwd: path.join(__dirname, '..'), stdio: 'inherit' },
);
process.exit(r.status ?? 1);
