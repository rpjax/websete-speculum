/**
 * Diagnose nested iframe bootstrap hang.
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
  const url = `http://127.0.0.1:${port}/fixtures/input-scroll-matrix.html`;

  const chassis = new LabChassis({ headless: true });
  const lines = [];
  try {
    await chassis.boot({ mode: 'run', url, blueprintId: 'debug' });
    const page = chassis.browser.page;
    page.on('console', (m) => lines.push(`[${m.type()}] ${m.text()}`));
    page.on('pageerror', (e) => lines.push(`[pageerror] ${e.message}`));
    page.on('framenavigated', (f) => {
      if (f !== page.mainFrame()) lines.push(`[frame] ${f.url()}`);
    });

    await new Promise((r) => setTimeout(r, 6000));

    const child = page.frames().find((f) => f.name() === 'child' || f.url().includes('iframe-inner'));
    if (!child) {
      console.log('NO_CHILD', page.frames().map((f) => f.url()));
      return;
    }

    const diag = await child.evaluate(() => {
      const g = globalThis;
      let parentAccess = null;
      try {
        parentAccess = {
          sameOrigin: true,
          hasParentProj: !!window.parent.__speculumProjection,
          parentCtx: window.parent.__speculumProjection?.contextId ?? null,
        };
      } catch (e) {
        parentAccess = { sameOrigin: false, err: String(e) };
      }
      return {
        href: location.href,
        hasProj: !!g.__speculumProjection,
        hasBoot: !!g.__speculumProjectionBoot,
        hasConfig: !!g.__SPECULUM_PROJECTION__,
        configTransport: g.__SPECULUM_PROJECTION__?.transport ?? null,
        isRoot: window.parent === window,
        parentAccess,
        scripts: [...document.scripts].map((s) => ({
          src: s.src || null,
          inlineLen: s.src ? 0 : (s.textContent || '').length,
        })),
      };
    });
    console.log('diag', JSON.stringify(diag, null, 2));

    // Try getScopeId from child the same way VirtualDomainBus does
    const scope = await child.evaluate(() => {
      const RUNTIME = 0xffff_ffff;
      const CHANNEL = 'speculum.context.bus';
      return new Promise((resolve) => {
        const t = setTimeout(() => resolve({ status: 'timeout' }), 3000);
        const onMsg = (ev) => {
          const d = ev.data;
          if (!d || d.channel !== CHANNEL) return;
          if (d.type === 'invocation-response' && d.event?.invocationId === 7) {
            clearTimeout(t);
            window.removeEventListener('message', onMsg);
            resolve({ status: 'ok', event: d.event });
          }
        };
        window.addEventListener('message', onMsg);
        window.parent.postMessage(
          {
            channel: CHANNEL,
            source: 0,
            destination: RUNTIME,
            type: 'request-invocation',
            event: { name: 'getScopeId', invocationId: 7, args: {} },
          },
          '*',
        );
      });
    });
    console.log('scope', JSON.stringify(scope));

    // Root: does childScopes map the iframe?
    const rootMap = await page.evaluate(() => {
      const p = globalThis.__speculumProjection;
      const iframe = document.getElementById('child');
      if (!p || !iframe) return { missing: true };
      // walk childScopes via private? expose via admit check
      const id = p.domNodes.keyOf(iframe);
      return {
        iframeId: id,
        hasProj: true,
        childWinEq: iframe.contentWindow != null,
      };
    });
    console.log('rootMap', JSON.stringify(rootMap));

    if (lines.length) console.log('console\n' + lines.slice(0, 40).join('\n'));
  } finally {
    await chassis.dispose();
    await new Promise((r) => server.close(r));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
