#!/usr/bin/env node
/**
 * Speculum motor fixture — deterministic pages for Act→Assert CI.
 * Serves HTTPS (self-signed) on PORT (default 443) and HTTP health on HEALTH_PORT (default 8090).
 */
import http from 'node:http';
import https from 'node:https';
import selfsigned from './selfsigned.mjs';

const ROLE = process.env.FIXTURE_ROLE || 'good';
const PORT = Number(process.env.PORT || (ROLE === 'evil' ? 8443 : 443));
const HEALTH_PORT = Number(process.env.HEALTH_PORT || (ROLE === 'evil' ? 8091 : 8090));
const HOSTNAME = process.env.FIXTURE_HOSTNAME || (ROLE === 'evil' ? 'evil-fixture.test' : 'fixture.test');

const { cert, key } = selfsigned(HOSTNAME);

function html(title, body) {
  return `<!DOCTYPE html>
<html lang="en">
HEAD_REPLACED
<body>
${body}
</body>
</html>`.replace(
    'HEAD_REPLACED',
    `<head><meta charset="utf-8"><title>${title}</title></head>`,
  );
}

function route(req, res) {
  const url = new URL(req.url || '/', `https://${HOSTNAME}`);
  const path = url.pathname;

  if (path === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, role: ROLE, host: HOSTNAME }));
    return;
  }

  if (ROLE === 'evil') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html('Evil fixture', `<h1 id="evil-probe">evil</h1><p>Off-allowlist host for navigate reject / redirect tests.</p>`));
    return;
  }

  switch (path) {
    case '/':
    case '/home': {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Set-Cookie': 'sf_marker=home-cookie; Path=/; SameSite=Lax',
      });
      res.end(html('Fixture home', `
<div id="speculum-probe" data-page="home">home</div>
<script>
  localStorage.setItem('sf_ls', 'home-ls');
  window.__SPECULUM_FIXTURE__ = { page: 'home', ts: Date.now() };
  try {
    const req = indexedDB.open('sf_idb', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => {
      const tx = req.result.transaction('kv', 'readwrite');
      tx.objectStore('kv').put('home-idb', 'v');
    };
  } catch (_) {}
</script>`));
      return;
    }

    case '/set-state': {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Set-Cookie': 'sf_marker=state-cookie; Path=/; SameSite=Lax',
      });
      res.end(html('Set state', `
<div id="speculum-probe" data-page="set-state">set-state</div>
<script>
  localStorage.setItem('sf_ls', 'state-ls');
  window.__SPECULUM_FIXTURE__ = { page: 'set-state', ready: true };
</script>`));
      return;
    }

    case '/click-target': {
      // Button fixed at (100,100)-(300,180) so Act can click (200,140) deterministically.
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html('Click target', `
<button id="btn" type="button"
  style="position:fixed;left:100px;top:100px;width:200px;height:80px;z-index:9">Click</button>
<input id="inp" type="text"
  style="position:fixed;left:100px;top:200px;width:200px;height:32px" />
<div id="out" data-clicks="0">0</div>
<script>
  const out = document.getElementById('out');
  document.getElementById('btn').addEventListener('click', () => {
    const n = Number(out.getAttribute('data-clicks') || '0') + 1;
    out.setAttribute('data-clicks', String(n));
    out.textContent = String(n);
  });
  document.getElementById('inp').addEventListener('input', (e) => {
    window.__SPECULUM_INPUT__ = e.target.value;
  });
  document.getElementById('inp').addEventListener('keydown', (e) => {
    window.__SPECULUM_LAST_KEY__ = e.key;
  });
  window.addEventListener('wheel', () => { window.__SPECULUM_WHEEL__ = true; }, { once: true });
</script>`));
      return;
    }

    case '/nav/a': {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html('Nav A', `
<div id="speculum-probe" data-page="nav-a">nav-a</div>
<a id="to-b" href="/nav/b">to B</a>
<a id="to-home" href="/">home</a>`));
      return;
    }

    case '/nav/b': {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html('Nav B', `
<div id="speculum-probe" data-page="nav-b">nav-b</div>
<a id="to-a" href="/nav/a">to A</a>`));
      return;
    }

    case '/external-link': {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html('External link', `
<div id="speculum-probe" data-page="external-link">external</div>
<a id="evil" href="https://evil-fixture.test/">leave allowlist</a>
<script>
  // Also expose programmatic navigation helper for probes.
  window.goEvil = () => { location.href = 'https://evil-fixture.test/'; };
</script>`));
      return;
    }

    case '/asset-escape': {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html('Asset escape', `
<div id="speculum-probe" data-page="asset-escape">assets</div>
<img id="off" src="https://evil-fixture.test/pixel.png" width="1" height="1" alt="" />
<script>
  fetch('https://evil-fixture.test/health').then(r => r.json()).then(j => {
    window.__SPECULUM_OFF_ASSET__ = j.ok === true;
  }).catch(e => { window.__SPECULUM_OFF_ASSET__ = false; });
</script>`));
      return;
    }

    case '/popup': {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html('Popup', `
<div id="speculum-probe" data-page="popup">popup</div>
<button id="open" type="button">open</button>
<a id="blank" href="/nav/b" target="_blank">blank</a>
<form id="f" action="/nav/a" target="_blank"><button type="submit">form</button></form>
<script>
  document.getElementById('open').onclick = () => window.open('/nav/b', '_blank');
</script>`));
      return;
    }

    case '/inject-probe': {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html('Inject probe', `
<div id="speculum-probe" data-page="inject-probe">inject</div>
<div id="inject-slot"></div>
<!-- Admin ScriptInjection tests set window.__SPECULUM_INJECTED__ -->
`));
      return;
    }

    case '/console-noise': {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html('Console noise', `
<div id="speculum-probe" data-page="console-noise">console</div>
<script>
  console.log('SPECULUM_FIXTURE_CONSOLE', ${JSON.stringify({ marker: 'fixture-console' })});
</script>`));
      return;
    }

    case '/fat-dom': {
      const blob = 'x'.repeat(200_000);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html('Fat DOM', `<div id="speculum-probe" data-page="fat-dom">${blob}</div>`));
      return;
    }

    case '/redirect': {
      res.writeHead(302, { Location: '/redirect/end' });
      res.end();
      return;
    }

    case '/redirect/end': {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html('Redirect end', `<div id="speculum-probe" data-page="redirect-end">end</div>`));
      return;
    }

    case '/spa': {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html('SPA', `
<div id="speculum-probe" data-page="spa">spa</div>
<button id="push" type="button">push</button>
<script>
  document.getElementById('push').onclick = () => {
    history.pushState({}, '', '/spa/step-2');
    document.getElementById('speculum-probe').setAttribute('data-page', 'spa-2');
  };
</script>`));
      return;
    }

    case '/pixel.png': {
      // 1x1 transparent PNG
      const buf = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      );
      res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': buf.length });
      res.end(buf);
      return;
    }

    default: {
      if (path.startsWith('/spa/')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html('SPA deep', `<div id="speculum-probe" data-page="spa-deep">${path}</div>`));
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
    }
  }
}

https.createServer({ key, cert }, route).listen(PORT, '0.0.0.0', () => {
  console.log(`[motor-fixture:${ROLE}] https://${HOSTNAME}:${PORT}`);
});

http.createServer((req, res) => {
  if ((req.url || '').startsWith('/health')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, role: ROLE, host: HOSTNAME, httpsPort: PORT }));
    return;
  }
  res.writeHead(404);
  res.end();
}).listen(HEALTH_PORT, '0.0.0.0', () => {
  console.log(`[motor-fixture:${ROLE}] health http://0.0.0.0:${HEALTH_PORT}/health`);
});
