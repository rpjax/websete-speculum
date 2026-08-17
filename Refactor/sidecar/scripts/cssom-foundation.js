/**
 * Sugar: cssom-foundation blueprint, then small cssom-scale soak --iso runs.
 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.join(__dirname, '..');

function runNode(args) {
  const r = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  return r.status ?? 1;
}

function runNpm(script) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const r = spawnSync(npm, ['run', script], { cwd: root, stdio: 'inherit', shell: true });
  return r.status ?? 1;
}

const b1 = runNpm('build:virtual');
if (b1) process.exit(b1);
const b2 = runNpm('build:snapshot');
if (b2) process.exit(b2);
const tsc = runNode([require.resolve('typescript/bin/tsc')]);
if (tsc) process.exit(tsc);

const cli = path.join(root, 'dist', 'browser', 'mirror', 'projection', 'lab', 'runner', 'cli.js');
let failed = 0;
failed += runNode([cli, '--blueprint', 'cssom-foundation']) ? 1 : 0;

const scale = [
  ['fixtures/cssom-scale.html?n=400&sheets=4&mode=static', '10s'],
  ['fixtures/cssom-scale.html?n=200&sheets=2&mode=styleSet', '12s'],
  ['fixtures/cssom-scale.html?n=200&mode=insertRule', '12s'],
];
for (const [url, dur] of scale) {
  failed += runNode([cli, '--blueprint', 'soak', url, dur, 'iso']) ? 1 : 0;
}
process.exit(failed > 0 ? 1 : 0);
