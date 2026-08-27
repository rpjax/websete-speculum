'use strict';
/**
 * Live Eneba/CF: patch Fetch hook logging before session load, then browse.
 * Run inside lab container (needs Chrome + display).
 */
const hook = require('../dist/browser/mirror/projection/session/csp/documentResponseHook.js');
const origInstall = hook.installDocumentResponseHook;

hook.installDocumentResponseHook = async function patchedInstall(cdp, opts) {
  const files = (opts?.storedScripts ?? []).map((s) => s.file);
  console.log('[diag] installDocumentResponseHook storedScripts=', files);
  const scriptMap = new Map((opts?.storedScripts ?? []).map((s) => [s.file, s]));
  const byId = new Map();

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
          pathname: meta.pathname,
          responseCode: params.responseCode,
          ct: (params.responseHeaders || []).find(
            (h) => String(h.name).toLowerCase() === 'content-type',
          )?.value,
        }),
      );
    }
    try {
      return await rawSend(method, params);
    } catch (err) {
      if (params?.requestId && byId.has(params.requestId)) {
        console.log(
          JSON.stringify({
            tag: 'send_err',
            method,
            url: byId.get(params.requestId).url,
            err: String(err),
          }),
        );
      }
      throw err;
    }
  };

  cdp.on('Fetch.requestPaused', (ev) => {
    const url = ev?.request?.url ?? '';
    if (!/__speculum|challenges\.cloudflare/i.test(url)) return;
    let pathname = '';
    try {
      pathname = new URL(url).pathname;
    } catch {
      /* */
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
        requestId: ev.requestId,
      }),
    );
  });

  return origInstall(cdp, opts);
};

const {
  createPageProjectionBrowserSessionFactory,
} = require('../dist/browser/mirror/projection/session/PageProjectionBrowserSession');
const { labLaunchOptions } = require('../dist/browser/mirror/projection/session/labLaunch');

const URL = process.env.SPECULUM_BROWSE_URL || 'https://www.eneba.com';

async function main() {
  const factory = createPageProjectionBrowserSessionFactory({ headless: false });
  const consoles = [];
  const session = factory.create('diag-fulfill-live', {
    onCrash: (c) => console.error('crash', JSON.stringify(c)),
    onConsole: (level, msg) => {
      const t = String(msg);
      consoles.push({ level, t: t.slice(0, 400) });
      if (/virtual\.js|MIME|challenges\.cloudflare|Refused/i.test(t)) {
        console.log('[console]', level, t.slice(0, 300));
      }
    },
    onVideoFrame: () => {},
    onAudioFrame: () => {},
    onPageProjectionFrame: () => {},
    onLocationChanged: (u) => console.log('[loc]', u),
    onTitleChanged: () => {},
  });

  console.log('[diag] launch…');
  await session.launch(labLaunchOptions({ width: 1280, height: 720, cpuProfiling: false }));
  console.log('[diag] navigate', URL);
  await session.navigate(URL);
  await new Promise((r) => setTimeout(r, 15000));

  let probe = null;
  try {
    probe = await session.evaluate(`(() => ({
      href: location.href,
      title: document.title,
      virtualScripts: [...document.scripts]
        .map((s) => s.src)
        .filter((s) => s && s.includes('__speculum')),
      iframeSrcs: [...document.querySelectorAll('iframe')].map((f) => f.src).slice(0, 15),
    }))()`);
  } catch (e) {
    probe = { err: String(e) };
  }

  console.log(
    JSON.stringify(
      {
        probe,
        relevantConsoles: consoles.filter((c) =>
          /virtual|MIME|challenge|Refused|CSP/i.test(c.t),
        ),
      },
      null,
      2,
    ),
  );

  await session.dispose();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
