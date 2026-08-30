/**
 * Kill anything on the lab port, rebuild, start host in foreground.
 * Run: npm run lab:restart
 * Background (agent): npm run lab:host
 */
const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
const { LAB_HOST, LAB_PORT } = require('./lab-ports');

const root = path.join(__dirname, '..');

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function killPort(port) {
  if (process.platform === 'win32') {
    spawnSync('powershell', [
      '-NoProfile',
      '-Command',
      `$c = Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue; ` +
        'if ($c) { $c | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } }',
    ]);
    return;
  }
  spawnSync('sh', ['-c', `fuser -k ${port}/tcp 2>/dev/null || lsof -ti:${port} | xargs -r kill -9`]);
}

function npmRun(script) {
  const r = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', script], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

async function main() {
  const foreground = process.argv.includes('--foreground') || process.argv.includes('-f');
  console.log(`[lab-restart] killing port ${LAB_PORT}…`);
  killPort(LAB_PORT);
  await wait(800);

  console.log('[lab-restart] build virtual + lab-client + snapshot + tsc…');
  npmRun('build:virtual');
  npmRun('build:lab-client');
  npmRun('build:snapshot');
  const tsc = spawnSync('npx', ['tsc'], { cwd: root, stdio: 'inherit', shell: true });
  if (tsc.status !== 0) process.exit(tsc.status ?? 1);

  const labEnv = {
    ...process.env,
    SPECULUM_LAB_HOST: LAB_HOST,
    SPECULUM_LAB_PORT: LAB_PORT,
    SPECULUM_LAB_HEADED: process.env.SPECULUM_LAB_HEADED ?? '1',
  };

  console.log(`[lab-restart] starting host http://${LAB_HOST}:${LAB_PORT}/ …`);
  const host = spawn(
    process.execPath,
    [path.join(root, 'dist', 'browser', 'mirror', 'projection', 'lab', 'host', 'index.js')],
    { cwd: root, env: labEnv, stdio: 'inherit' },
  );
  host.on('exit', (code) => process.exit(code ?? 0));
  if (!foreground) {
    // When invoked from npm run lab:restart, stay attached (same as lab:projection tail).
  }
}

main().catch((err) => {
  console.error('[lab-restart] failed', err);
  process.exit(1);
});
