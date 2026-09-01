/**
 * Focused Mode A click repro — Virtual evaluate after CDP coords from E2E.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
spawnSync(npm, ['run', 'build:virtual'], { cwd: root, stdio: 'inherit', shell: true });
spawnSync(npm, ['exec', '--', 'tsc'], { cwd: root, stdio: 'inherit', shell: true });

const { labAssetRoots } = require('../dist/browser/mirror/projection/lab/assetRoots');
const { LabChassis } = require('../dist/browser/mirror/projection/lab/host/chassis');

async function main() {
  const { fixturesDir } = labAssetRoots();
  const server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    if (!url.startsWith('/fixtures/')) {
      res.writeHead(404).end();
      return;
    }
    const file = path.join(fixturesDir, decodeURIComponent(url.split('?')[0].slice('/fixtures/'.length)));
    if (!fs.existsSync(file)) {
      res.writeHead(404).end('missing');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/fixtures/input-click.html`;

  const chassis = new LabChassis({ headless: true });
  try {
    await chassis.boot({ mode: 'browse', url, width: 940, height: 624 });
    await new Promise((r) => setTimeout(r, 2000));
    const session = chassis.browser;

    const before = await session.evaluate(
      `(() => ({ status: document.getElementById('status')?.getAttribute('data-state'), btn: (() => { const b=document.getElementById('click-me'); if(!b) return null; const r=b.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2,w:r.width,h:r.height}; })() }))()`,
    );
    console.log('before', before.value);

    // Same coords as E2E capture (~48, 220)
    const payload = JSON.stringify({
      x: 48.14,
      y: 220.68,
      button: 0,
      buttons: 0,
      modifiers: {},
    });
    for (const type of ['mousemove', 'mousedown', 'mouseup']) {
      const out = await session.pushInput({
        type,
        targetId: null,
        contextId: 1,
        generation: 1,
        payloadJson: payload,
        timestampClient: Date.now(),
        wallClientMs: Date.now(),
      });
      console.log(type, out);
    }
    await new Promise((r) => setTimeout(r, 500));
    const afterCoords = await session.evaluate(
      `(() => document.getElementById('status')?.getAttribute('data-state'))()`,
    );
    console.log('afterCoords', afterCoords.value);

    // Ground truth: resolveAndClick
    const click = await session.resolveAndClickDomInput('#click-me', 1);
    console.log('resolveAndClick', click);
    await new Promise((r) => setTimeout(r, 300));
    const afterResolve = await session.evaluate(
      `(() => document.getElementById('status')?.getAttribute('data-state'))()`,
    );
    console.log('afterResolve', afterResolve.value);

    // ElementFromPoint at E2E coords
    const hit = await session.evaluate(
      `(() => { const el = document.elementFromPoint(48.14, 220.68); return el ? { id: el.id, tag: el.tagName, text: el.textContent?.slice(0,40) } : null; })()`,
    );
    console.log('elementFromPoint', hit.value);
  } finally {
    await chassis.dispose();
    await new Promise((r) => server.close(r));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
