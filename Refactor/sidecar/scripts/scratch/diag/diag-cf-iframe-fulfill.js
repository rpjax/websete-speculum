'use strict';
/**
 * Force challenges.cloudflare.com iframe under the same Fetch hook as PP session.
 * Logs whether /__speculum/virtual.js is paused+fulfilled on that origin.
 */
const http = require('node:http');
const hook = require('../dist/browser/mirror/projection/session/csp/documentResponseHook.js');
const origInstall = hook.installDocumentResponseHook;

hook.installDocumentResponseHook = async function patchedInstall(cdp, opts) {
  const scriptMap = new Map((opts?.storedScripts ?? []).map((s) => [s.file, s]));
  const byId = new Map();
  console.log('[diag] storedScripts', [...scriptMap.keys()]);

  const rawSend = cdp.send.bind(cdp);
  cdp.send = async function (method, params) {
    if (
      (method === 'Fetch.fulfillRequest' ||
        method === 'Fetch.continueRequest' ||
        method === 'Fetch.continueResponse') &&
      params?.requestId &&
      byId.has(params.requestId)
    ) {
      const meta = byId.get(params.requestId);
      console.log(
        JSON.stringify({
          tag: 'send',
          method,
          url: meta.url,
          responseCode: params.responseCode,
          errHint: method === 'Fetch.continueRequest' ? 'ESCAPED_TO_NETWORK' : undefined,
        }),
      );
    }
    try {
      return await rawSend(method, params);
    } catch (err) {
      if (params?.requestId && byId.has(params.requestId)) {
        console.log(JSON.stringify({ tag: 'send_err', method, url: byId.get(params.requestId).url, err: String(err) }));
      }
      throw err;
    }
  };

  // Also list targets (OOPIF detection).
  try {
    await cdp.send('Target.setDiscoverTargets', { discover: true });
    cdp.on('Target.targetCreated', (ev) => {
      const t = ev.targetInfo;
      if (t && /cloudflare|eneba|__speculum/i.test(t.url || t.title || '')) {
        console.log(JSON.stringify({ tag: 'target', type: t.type, url: t.url, attached: t.attached }));
      }
    });
  } catch (e) {
    console.log('[diag] Target.discover failed', String(e));
  }

  cdp.on('Fetch.requestPaused', (ev) => {
    const url = ev?.request?.url ?? '';
    if (!/__speculum|challenges\.cloudflare/i.test(url)) return;
    let pathname = '';
    try {
      pathname = new URL(url).pathname;
    } catch (e) {
      pathname = `ERR:${e}`;
    }
    byId.set(ev.requestId, { url, pathname });
    console.log(
      JSON.stringify({
        tag: 'pause',
        stage: ev.responseStatusCode === undefined ? 'Request' : 'Response',
        type: ev.resourceType,
        status: ev.responseStatusCode,
        url,
        pathname,
        inMap: scriptMap.has(pathname),
      }),
    );
  });

  return origInstall(cdp, opts);
};

const {
  createPageProjectionBrowserSessionFactory,
} = require('../dist/browser/mirror/projection/session/PageProjectionBrowserSession');
const { labLaunchOptions } = require('../dist/browser/mirror/projection/session/labLaunch');

async function main() {
  const srv = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    // CF challenge widget host — real cross-origin iframe like Eneba.
    res.end(`<!doctype html><html><body>
      <h1>host</h1>
      <iframe id="cf" src="https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/f/ov2/av0/rcv/1x00000000000000000000AA/light/fbE/new/normal?lang=auto" style="width:300px;height:65px"></iframe>
      <iframe id="cf2" src="https://challenges.cloudflare.com/" style="width:400px;height:200px"></iframe>
    </body></html>`);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const hostUrl = `http://127.0.0.1:${port}/`;

  const factory = createPageProjectionBrowserSessionFactory({ headless: false });
  const session = factory.create('diag-cf-iframe', {
    onCrash: (c) => console.error('crash', JSON.stringify(c)),
    onConsole: (level, msg) => {
      const t = String(msg);
      if (/virtual\.js|MIME|challenges\.cloudflare|Refused/i.test(t)) {
        console.log('[console]', level, t.slice(0, 350));
      }
    },
    onVideoFrame: () => {},
    onAudioFrame: () => {},
    onPageProjectionFrame: () => {},
    onLocationChanged: (u) => console.log('[loc]', u),
    onTitleChanged: () => {},
  });

  await session.launch(labLaunchOptions({ width: 1280, height: 720, cpuProfiling: false }));
  await session.navigate(hostUrl);
  await new Promise((r) => setTimeout(r, 12000));

  let probe = null;
  try {
    probe = await session.evaluate(`(() => ({
      href: location.href,
      iframes: [...document.querySelectorAll('iframe')].map((f) => ({ src: f.src, w: f.clientWidth })),
    }))()`);
  } catch (e) {
    probe = { err: String(e) };
  }
  console.log('probe', JSON.stringify(probe));

  await session.dispose();
  srv.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
