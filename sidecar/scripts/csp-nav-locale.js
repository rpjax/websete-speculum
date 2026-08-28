/**
 * Sugar: csp-nav-locale blueprint via lab:run entrypoint.
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

process.exit(
  runNode([
    path.join(root, 'dist', 'browser', 'mirror', 'projection', 'lab', 'runner', 'cli.js'),
    '--blueprint',
    'csp-nav-locale',
  ]),
);
