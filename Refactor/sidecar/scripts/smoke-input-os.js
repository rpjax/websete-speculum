/**
 * Smoke: D-UI-20 spike + input-click blueprint inside Docker lab image.
 * Fail-closed if compose/uinput unavailable.
 *
 * Usage (from Refactor/sidecar): npm run smoke:input-os
 * Or (from Refactor/): docker compose -f sidecar/docker-compose.lab.yml run --rm lab node scripts/smoke-input-os.js
 */
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const composeFile = path.join(root, 'docker-compose.lab.yml');

function run(cmd, args, opts = {}) {
  console.log(`\n>>> ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd ?? root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...(opts.env || {}) },
  });
  return r.status ?? 1;
}

function main() {
  // Prefer in-container path when already inside the lab image.
  let uinput = false;
  try {
    uinput = require('../dist/browser/input/os/uinput').uinputAvailable() === true;
  } catch {
    uinput = false;
  }

  if (uinput) {
    console.log('[smoke-input-os] running in-process (uinput present)');
    let code = run(process.execPath, [path.join(root, 'scripts', 'spike-abs-pointer.js')]);
    if (code !== 0) process.exit(code);

    const cli = path.join(root, 'dist', 'browser', 'mirror', 'projection', 'lab', 'runner', 'cli.js');
    const out = path.join(root, 'lab-runs', 'smoke-input-os-click');
    fs.mkdirSync(out, { recursive: true });
    code = run(process.execPath, [cli, '--blueprint', 'input-click', '--out', out, '--headed'], {
      env: { SPECULUM_LAB_HEADED: '1', SPECULUM_INPUT_BACKEND: 'os' },
    });
    if (code !== 0) process.exit(code);

    let pipeline = null;
    try {
      pipeline = JSON.parse(fs.readFileSync(path.join(out, 'probes', 'input-pipeline.json'), 'utf8'));
    } catch {
      /* dossier layout may nest */
    }
    if (pipeline && pipeline.backend !== 'os') {
      console.error('FAIL: expected input-pipeline.backend=os');
      process.exit(1);
    }
    console.log('PASS smoke-input-os (spike + input-click)');
    process.exit(0);
  }

  // Host without uinput → docker compose run
  if (!fs.existsSync(composeFile)) {
    console.error('FAIL: no uinput and missing docker-compose.lab.yml');
    process.exit(2);
  }
  console.log('[smoke-input-os] no local uinput — docker compose run');
  let code = run('docker', [
    'compose',
    '-f',
    'docker-compose.lab.yml',
    'run',
    '--rm',
    'lab',
    'node',
    'scripts/spike-abs-pointer.js',
  ]);
  if (code !== 0) process.exit(code);

  code = run('docker', [
    'compose',
    '-f',
    'docker-compose.lab.yml',
    'run',
    '--rm',
    'lab',
    'node',
    'scripts/lab-input-suite.js',
    '--out',
    'lab-runs/smoke-input-suite',
  ]);
  process.exit(code);
}

main();
