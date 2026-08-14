/**
 * npm extra-args must not ride on `npm run build:*` (Windows npm eats `--url` / `--iso`).
 * Builds, then forwards argv intact to runCli.
 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.join(__dirname, '..');
const extra = process.argv.slice(2);

function runNode(args) {
  const r = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  if (r.status) process.exit(r.status);
}

function runNpm(script) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const r = spawnSync(npm, ['run', script], { cwd: root, stdio: 'inherit', shell: true });
  if (r.status) process.exit(r.status);
}

runNpm('build:virtual');
runNpm('build:snapshot');
runNode([require.resolve('typescript/bin/tsc')]);
runNode([path.join(root, 'dist', 'browser', 'mirror', 'projection', 'lab', 'runCli.js'), ...extra]);
