/**
 * document-churn launch regression (+ optional x10 classifier via --x10).
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const x10 = process.argv.includes('--x10');
const runs = x10 ? 10 : 1;

function runNode(args) {
  const r = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  return r.status ?? 1;
}

function runNpm(script) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const r = spawnSync(npm, ['run', script], { cwd: root, stdio: 'inherit', shell: true });
  return r.status ?? 1;
}

function runCliCapture() {
  const cli = path.join(root, 'dist', 'browser', 'mirror', 'projection', 'lab', 'runner', 'cli.js');
  const r = spawnSync(process.execPath, [cli, '--blueprint', 'document-churn'], {
    cwd: root,
    encoding: 'utf8',
  });
  const stdout = r.stdout ?? '';
  const stderr = r.stderr ?? '';
  const combined = `${stdout}\n${stderr}`;
  const lines = stdout.trim().split(/\r?\n/);
  const dossierDir = lines.length > 0 ? lines[lines.length - 1].trim() : '';
  let bootError = null;
  if (/data plane not established/i.test(combined)) bootError = 'establish_timeout';
  else if (/establish_timeout/i.test(combined)) bootError = 'establish_timeout';
  else if (/config_gate_timeout/i.test(combined)) bootError = 'config_gate_timeout';
  return { code: r.status ?? 1, dossierDir, stdout, bootError };
}

function readLaunchTelemetry(dossierDir) {
  const p = path.join(dossierDir, 'probes', 'launch-telemetry.json');
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function readVerdicts(dossierDir) {
  const p = path.join(dossierDir, 'verdicts.json');
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

const b1 = runNpm('build:virtual');
if (b1) process.exit(b1);
const b2 = runNpm('build:lab-client');
if (b2) process.exit(b2);
const b3 = runNpm('build:snapshot');
if (b3) process.exit(b3);
const tsc = runNode([require.resolve('typescript/bin/tsc')]);
if (tsc) process.exit(tsc);

const hist = {};
const errorCode = {};
const installCounts = [];
const maxSpacingMs = [];
const failures = [];
let failed = 0;

for (let i = 0; i < runs; i++) {
  const { code, dossierDir, bootError } = runCliCapture();
  const pass = code === 0;
  if (!pass) failed += 1;
  hist[`run_${i + 1}`] = pass ? 'pass' : 'fail';

  const tel = dossierDir ? readLaunchTelemetry(dossierDir) : null;
  const installTel = tel?.installTelemetry;
  installCounts.push(installTel?.installCount ?? null);
  maxSpacingMs.push(installTel?.maxSpacingMs ?? null);

  if (!pass) {
    const verdicts = dossierDir ? readVerdicts(dossierDir) : null;
    const bootReason = tel?.bootOutcome?.reason ?? bootError ?? 'unknown';
    const ec = bootReason === 'established' ? 'establish_failed' : bootReason;
    errorCode[ec] = (errorCode[ec] ?? 0) + 1;
    failures.push({
      run: i + 1,
      dossierDir,
      errorCode: ec,
      installCount: installTel?.installCount ?? null,
      verdicts: verdicts?.verdicts?.filter((v) => v.status === 'fail').map((v) => v.id) ?? [],
    });
  }
}

if (x10) {
  const summary = {
    runs,
    failed,
    hist,
    errorCode,
    installCounts,
    maxSpacingMs,
    failures,
  };
  const outDir = path.join(root, 'lab-runs');
  fs.mkdirSync(outDir, { recursive: true });
  const summaryPath = path.join(outDir, 'churn-x10-summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  console.log('[document-churn-x10]', JSON.stringify(summary, null, 2));
  console.log(`[document-churn-x10] wrote ${summaryPath}`);
}

process.exit(failed > 0 ? 1 : 0);
