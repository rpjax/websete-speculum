/**
 * Sugar: cssom-matrix-nested blueprint (8-class CSSOM regression + pixel diff).
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
const b2 = runNpm('build:lab-client');
if (b2) process.exit(b2);
const b3 = runNpm('build:snapshot');
if (b3) process.exit(b3);
const tsc = runNode([require.resolve('typescript/bin/tsc')]);
if (tsc) process.exit(tsc);

const cli = path.join(root, 'dist', 'browser', 'mirror', 'projection', 'lab', 'runner', 'cli.js');
process.exit(runNode([cli, '--blueprint', 'cssom-matrix-nested']));
