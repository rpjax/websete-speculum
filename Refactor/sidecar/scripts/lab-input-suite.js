/**
 * OS input lab suite — blueprints against EventApplier + ABS uinput.
 * Fail-closed without /dev/uinput (use Docker).
 *
 * Usage:
 *   npm run lab:input-suite          # requires uinput (Linux / Docker)
 *   npm run lab:input-suite:docker   # canonical on Windows hosts
 *
 * Options: --out lab-runs/input-suite-os
 */
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const cli = path.join(root, 'dist', 'browser', 'mirror', 'projection', 'lab', 'runner', 'cli.js');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const BLUEPRINTS = [
  'input-click',
  'input-forms',
  'input-scroll',
  'input-scroll-components',
  'input-iframe-scroll',
  'input-iframe-click',
  'input-stress',
];

const outArgIdx = process.argv.indexOf('--out');
const outBase =
  outArgIdx >= 0 && process.argv[outArgIdx + 1]
    ? path.resolve(root, process.argv[outArgIdx + 1])
    : path.join(root, 'lab-runs', 'input-suite-os');

function requireOsInput() {
  let ok = false;
  try {
    ok = require('../dist/browser/patchright/input/uinput').uinputAvailable() === true;
  } catch {
    ok = false;
  }
  if (!ok) {
    console.error(
      [
        'FAIL: /dev/uinput unavailable — OS input suite is fail-closed.',
        'Canonical: npm run lab:input-suite:docker',
        'See Refactor/sidecar/LAB-DOCKER.md',
      ].join('\n'),
    );
    process.exit(2);
  }
}

function run(cmd, args, label) {
  process.stdout.write(`\n>>> ${label}\n`);
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if ((r.status ?? 1) !== 0) {
    console.error(`FAILED: ${label}`);
    process.exit(r.status ?? 1);
  }
}

requireOsInput();
fs.mkdirSync(outBase, { recursive: true });

run(npm, ['run', 'build:virtual'], 'build:virtual');
run(npm, ['run', 'build:snapshot'], 'build:snapshot');
run(npm, ['exec', '--', 'tsc'], 'tsc');

const summary = [];
let failed = 0;

for (const id of BLUEPRINTS) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.join(outBase, `${stamp}-${id}`);
  process.stdout.write(`\n=== lab:run --blueprint ${id} (OS) ===\n`);
  const r = spawnSync(process.execPath, [cli, '--blueprint', id, '--out', outDir, '--headed'], {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      SPECULUM_LAB_HEADED: '1',
      SPECULUM_INPUT_BACKEND: 'os',
    },
  });
  const ok = (r.status ?? 1) === 0;
  if (!ok) failed += 1;

  let verdicts = [];
  let inputPipeline = null;
  try {
    verdicts = JSON.parse(fs.readFileSync(path.join(outDir, 'verdicts.json'), 'utf8'));
  } catch {
    /* */
  }
  try {
    inputPipeline = JSON.parse(fs.readFileSync(path.join(outDir, 'probes', 'input-pipeline.json'), 'utf8'));
  } catch {
    /* */
  }

  const backend = inputPipeline?.backend ?? null;
  const pathLabel = inputPipeline?.path ?? null;
  if (ok && backend !== 'os') {
    console.error(`FAIL ${id}: expected input-pipeline.backend=os, got ${JSON.stringify(backend)}`);
    failed += 1;
  }

  summary.push({
    id,
    ok: ok && backend === 'os',
    outDir,
    backend,
    path: pathLabel,
    verdicts,
    drops: inputPipeline?.journal?.dropped ?? null,
  });
}

const reportPath = path.join(outBase, 'suite-report.json');
fs.writeFileSync(
  reportPath,
  JSON.stringify(
    {
      at: new Date().toISOString(),
      backendRequired: 'os',
      failed,
      blueprints: BLUEPRINTS.length,
      summary,
    },
    null,
    2,
  ),
);
console.log(`\nOS suite report: ${reportPath}`);
console.log(`Failed: ${failed}/${BLUEPRINTS.length}`);
process.exit(failed > 0 ? 1 : 0);
