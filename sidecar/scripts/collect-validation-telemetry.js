/**
 * Wrapper → sequential lab:run over synthetic fixtures. Usage: node scripts/collect-validation-telemetry.js
 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const SYNTHETIC = [
  { fixture: 'static-dom.html', durationMs: 8000 },
  { fixture: 'insert-before-remove.html', durationMs: 10000 },
  { fixture: 'demo.html', durationMs: 12000 },
];

let failed = 0;
for (const item of SYNTHETIC) {
  const r = spawnSync(
    process.execPath,
    [
      path.join(__dirname, '..', 'dist', 'browser', 'mirror', 'projection', 'lab', 'runCli.js'),
      '--url',
      `fixtures/${item.fixture}`,
      '--duration',
      `${item.durationMs}ms`,
      '--iso',
    ],
    { cwd: path.join(__dirname, '..'), stdio: 'inherit' },
  );
  if ((r.status ?? 1) !== 0) failed += 1;
}
process.exit(failed > 0 ? 1 : 0);
