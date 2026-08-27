'use strict';
/**
 * Retry Eneba until CF virtual.js MIME error; log Fetch pause/fulfill + targets.
 */
const hook = require('../dist/browser/mirror/projection/session/csp/documentResponseHook.js');
const origInstall = hook.installDocumentResponseHook;

hook.installDocumentResponseHook = async function patchedInstall(cdp, opts) {
  const scriptMap = new Map((opts?.storedScripts ?? []).map((s) => [s.file, s]));
  const byId = new Map();
  console.log('[diag] storedScripts', [...scriptMap.keys()]);

  try {
    await cdp.send('Target.setDiscoverTargets', { discover: true });
    const { targetInfos } = await cdp.send('Target.getTargets');
    for (const t of targetInfos || []) {
      if (/cloudflare|eneba/i.test(t.url || '')) {
        console.log(JSON.stringify({ tag: 'target0', type: t.type, url: t.url, attached: t.attached }));
      }
    }
    cdp.on('Target.targetCreated', (ev) => {
      const t = ev.targetInfo;
      if (t && /cloudflare|eneba|speculum/i.test(`${t.url}|${t.title}`)) {
        console.log(JSON.stringify({ tag: 'target+', type: t.type, url: t.url, attached: t.attached }));
      }
    });
  } catch (e) {
    console.log('[diag] target discover', String(e));
  }

  const rawSend = cdp.send.bind(cdp);
  cdp.send = async function (method, params) {
    if (
      (method === 'Fetch.fulfillRequest' ||
        method === 'Fetch.continueRequest' ||
        method === 'Fetch.continueResponse') &&
      params?.requestId &&
      byId.has(params.requestId)
    ) {
      console.log(JSON.stringify({ tag: 'send', method, url: byId.get(params.requestId).url, code: params.responseCode }));
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

async function oneAttempt(i) {
  const factory = createPageProjectionBrowserSessionFactory({ headless: false });
  let hitMime = false;
  const session = factory.create(`diag-cf-retry-${i}`, {
    onCrash: (c) => console.error('crash', JSON.stringify(c)),
    onConsole: (level, msg) => {
      const t = String(msg);
      if (/challenges\.cloudflare\.com\/__speculum\/virtual\.js/i.test(t)) {
        hitMime = true;
        console.log('[HIT]', level, t.slice(0, 400));
      } else if (/virtual\.js|MIME|challenges\.cloudflare/i.test(t)) {
        console.log('[console]', level, t.slice(0, 250));
      }
    },
    onVideoFrame: () => {},
    onAudioFrame: () => {},
    onPageProjectionFrame: () => {},
    onLocationChanged: (u) => console.log('[loc]', u),
    onTitleChanged: () => {},
  });

  await session.launch(labLaunchOptions({ width: 1280, height: 720, cpuProfiling: false }));
  await session.navigate('https://www.eneba.com');
  await new Promise((r) => setTimeout(r, 10000));
  await session.dispose();
  return hitMime;
}

async function main() {
  const max = Number(process.env.DIAG_TRIES || 5);
  for (let i = 1; i <= max; i++) {
    console.log(`\n==== attempt ${i}/${max} ====`);
    try {
      const hit = await oneAttempt(i);
      if (hit) {
        console.log('REPRODUCED MIME error');
        return;
      }
    } catch (e) {
      console.error('attempt failed', e);
    }
  }
  console.log('No CF MIME error in tries');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
