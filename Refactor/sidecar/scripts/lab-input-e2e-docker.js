/**
 * Bring up Docker lab then run OS input E2E against http://127.0.0.1:4103/
 */
'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.join(__dirname, '..');

function run(args) {
  console.log(`\n>>> docker ${args.join(' ')}`);
  const r = spawnSync('docker', args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  return r.status ?? 1;
}

let code = run(['compose', '-f', 'docker-compose.lab.yml', 'up', '-d', '--build']);
if (code !== 0) process.exit(code);

// Wait for published port
const deadline = Date.now() + 120_000;
const { setTimeout: sleep } = require('node:timers/promises');
(async () => {
  while (Date.now() < deadline) {
    try {
      const res = await fetch('http://127.0.0.1:4103/health');
      if (res.ok) break;
    } catch {
      /* */
    }
    await sleep(1000);
  }
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'lab-input-e2e-qa.js')], {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      SPECULUM_LAB_EXTERNAL: '1',
      SPECULUM_LAB_HOST: '127.0.0.1',
      SPECULUM_LAB_PORT: '4103',
    },
  });
  process.exit(r.status ?? 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
