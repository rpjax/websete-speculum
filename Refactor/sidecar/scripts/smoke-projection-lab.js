/**
 * Smoke the projection lab (protocol v1): health, browse.start, frames apply via UI client.
 * Run: node scripts/smoke-projection-lab.js
 */
const { spawn } = require('node:child_process');
const path = require('node:path');
const WebSocket = require('ws');
const { chromium } = require('patchright');

const PORT = 4099;
const HOST = '127.0.0.1';

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitHealth(timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://${HOST}:${PORT}/health`);
      if (res.ok) {
        const j = await res.json();
        if (j.protocolVersion !== 1) throw new Error(`expected protocolVersion 1 got ${j.protocolVersion}`);
        return;
      }
    } catch {
      // retry
    }
    await wait(200);
  }
  throw new Error('lab health timeout');
}

async function smokeBrowseFirstFrame() {
  const frames = [];
  const controls = [];
  const ws = new WebSocket(`ws://${HOST}:${PORT}/lab/session`);
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  ws.binaryType = 'arraybuffer';
  ws.on('message', (data, isBinary) => {
    if (isBinary) frames.push(Buffer.from(data));
    else {
      try {
        controls.push(JSON.parse(String(data)));
      } catch {
        /* ignore */
      }
    }
  });

  ws.send(JSON.stringify({ type: 'hello', protocolVersion: 1 }));
  await wait(100);
  const hello = controls.find((c) => c.type === 'session.hello');
  if (!hello) throw new Error('missing session.hello');

  ws.send(
    JSON.stringify({
      type: 'browse.start',
      url: `http://${HOST}:${PORT}/fixtures/demo.html`,
      frameRateHz: 30,
    }),
  );

  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (controls.some((c) => c.type === 'session.booted') && frames.length >= 1) break;
    if (controls.some((c) => c.type === 'session.fault')) {
      throw new Error(`session.fault ${JSON.stringify(controls.find((c) => c.type === 'session.fault'))}`);
    }
    await wait(100);
  }
  if (!controls.some((c) => c.type === 'session.booted')) throw new Error('browse.start did not boot');
  if (frames.length < 1) throw new Error('no binary frames received');

  ws.send(JSON.stringify({ type: 'browse.stop', exportDossier: false }));
  await wait(500);
  ws.close();
  console.log(`[smoke] browse first-frame ok frames=${frames.length}`);
}

async function smokeUiApply() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`http://${HOST}:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.click('#connect');
  await wait(500);
  await page.selectOption('#fixture', { label: 'demo' }).catch(() => undefined);
  await page.fill('#url', `http://${HOST}:${PORT}/fixtures/demo.html`);
  await page.click('#browseStart');
  const deadline = Date.now() + 60_000;
  let ok = false;
  while (Date.now() < deadline) {
    const frames = await page.textContent('#streamFrames');
    if (frames && Number(frames) > 0) {
      ok = true;
      break;
    }
    const status = await page.textContent('#statusStrip').catch(() => null);
    if (status && /fault/i.test(status)) throw new Error(`UI fault: ${status}`);
    await wait(200);
  }
  await browser.close();
  if (!ok) throw new Error('UI did not show frames');
  console.log('[smoke] UI browse apply ok');
}

async function main() {
  const root = path.join(__dirname, '..');
  const lab = spawn(
    process.execPath,
    [path.join(root, 'dist', 'browser', 'mirror', 'projection', 'lab', 'host', 'index.js')],
    {
      cwd: root,
      env: { ...process.env, SPECULUM_LAB_HOST: HOST, SPECULUM_LAB_PORT: String(PORT) },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let stderr = '';
  lab.stderr.on('data', (d) => {
    stderr += String(d);
  });
  lab.stdout.on('data', (d) => {
    process.stdout.write(d);
  });

  try {
    await waitHealth(60_000);
    const fixtures = await fetch(`http://${HOST}:${PORT}/lab/fixtures`);
    if (!fixtures.ok) throw new Error('GET /lab/fixtures failed');
    const blueprints = await fetch(`http://${HOST}:${PORT}/lab/blueprints`);
    if (!blueprints.ok) throw new Error('GET /lab/blueprints failed');
    const bp = await blueprints.json();
    const ids = Array.isArray(bp.blueprints)
      ? bp.blueprints.map((b) => (typeof b === 'string' ? b : b?.id)).filter(Boolean)
      : [];
    if (!ids.includes('soak')) throw new Error('soak blueprint missing from catalog');

    await smokeBrowseFirstFrame();
    await smokeUiApply();
    console.log('[smoke] projection-lab ok');
  } catch (err) {
    console.error('[smoke] failed', err);
    console.error(stderr);
    process.exitCode = 1;
  } finally {
    lab.kill('SIGTERM');
    await wait(500);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
