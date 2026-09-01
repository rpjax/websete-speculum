/**

 * Diagnose iframe-anim nested producer via per-frame CDP (OOPIF-safe).

 * Run: node scripts/debug-iframe-anim.js

 */

const http = require('node:http');

const fs = require('node:fs');

const path = require('node:path');



const { labAssetRoots } = require('../dist/browser/mirror/projection/lab/assetRoots');

const { LabChassis } = require('../dist/browser/mirror/projection/lab/host/chassis');



function contentType(file) {

  if (file.endsWith('.js')) return 'text/javascript; charset=utf-8';

  if (file.endsWith('.css')) return 'text/css; charset=utf-8';

  return 'text/html; charset=utf-8';

}



const PROBE = `(() => {

  const lines = globalThis.__speculumBootDiagLines || [];

  return {

    href: location.href,

    isRoot: window.parent === window,

    hasProj: !!globalThis.__speculumProjection,

    hasReady: globalThis.__SPECULUM_PROJECTION_READY__ !== undefined,

    hasConfig: !!globalThis.__SPECULUM_PROJECTION__,

    hasUpward: !!globalThis.__speculumProjectionUpward,

    ctx: globalThis.__speculumProjection?.contextId ?? null,

    readyState: (() => {

      const r = globalThis.__SPECULUM_PROJECTION_READY__;

      if (!r || typeof r.then !== 'function') return 'absent';

      // sync peek via then already settled?

      let status = 'pending';

      try {

        r.then(

          (v) => { status = v ? 'ok' : 'null'; },

          (e) => { status = 'err:' + (e && e.message ? e.message : String(e)); },

        );

      } catch (e) {

        status = 'throw';

      }

      return status;

    })(),

    bootLines: lines.slice(-8),

  };

})()`;



async function main() {

  if (!process.env.CHROME_EXECUTABLE) {

    process.env.CHROME_EXECUTABLE =

      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

  }

  process.env.SPECULUM_DIAG_BOOT = '1';



  const { fixturesDir } = labAssetRoots();

  const server = http.createServer((req, res) => {

    const raw = req.url ?? '/';

    if (!raw.startsWith('/fixtures/')) {

      res.writeHead(404).end();

      return;

    }

    const rel = decodeURIComponent(raw.split('?')[0].slice('/fixtures/'.length));

    const file = path.join(fixturesDir, rel);

    if (!fs.existsSync(file) || !file.startsWith(fixturesDir)) {

      res.writeHead(404).end('missing');

      return;

    }

    res.writeHead(200, { 'Content-Type': contentType(file) });

    fs.createReadStream(file).pipe(res);

  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));

  const port = server.address().port;

  const url = `http://127.0.0.1:${port}/fixtures/iframe-anim.html`;

  console.log('url', url);



  const chassis = new LabChassis({ headless: true });

  try {

    await chassis.boot({

      mode: 'browse',

      url,

      frameRateHz: 60,

      telemetry: {

        enabled: true,

        frameEmitted: true,

        applyResult: true,

        aggregate: true,

        cssomPoll: false,

        diagBoot: true,

      },

    });

    await new Promise((r) => setTimeout(r, 5000));



    const session = chassis.session;

    if (!session) throw new Error('no session');

    console.log('loopback', await session.probeLoopbackStatus());



    const page = session.page;

    const context = page.context();

    const frames = page.frames();

    console.log(

      'playwrightFrames',

      frames.map((f) => ({ url: f.url(), name: f.name() })),

    );



    const probed = [];

    for (const frame of frames) {

      let cdp;

      try {

        cdp = await context.newCDPSession(frame);

      } catch (e) {

        probed.push({

          url: frame.url(),

          name: frame.name(),

          via: 'cdp-fail',

          err: e.message ?? String(e),

        });

        continue;

      }

      try {

        await cdp.send('Runtime.enable');

        const r = await cdp.send('Runtime.evaluate', {

          expression: PROBE,

          returnByValue: true,

          awaitPromise: false,

        });

        probed.push({

          url: frame.url(),

          name: frame.name(),

          via: 'frame-cdp',

          result: r.result?.value,

          err: r.exceptionDetails,

        });

      } finally {

        try {

          await cdp.detach();

        } catch (_) {}

      }

    }

    console.log('probed', JSON.stringify(probed, null, 2));



    // Microtask flush so readyState then-handlers ran

    await new Promise((r) => setTimeout(r, 50));

    const probed2 = [];

    for (const frame of frames) {

      let cdp;

      try {

        cdp = await context.newCDPSession(frame);

      } catch (e) {

        continue;

      }

      try {

        const r = await cdp.send('Runtime.evaluate', {

          expression: `(() => {

            const bag = { hasConfig: !!globalThis.__SPECULUM_PROJECTION__, hasProj: !!globalThis.__speculumProjection, ctx: globalThis.__speculumProjection?.contextId ?? null };

            const ready = globalThis.__SPECULUM_PROJECTION_READY__;

            return ready ? ready.then((v) => Object.assign(bag, { readyResolved: v ? 'config' : 'null' })) : Object.assign(bag, { readyResolved: 'no-promise' });

          })()`,

          returnByValue: true,

          awaitPromise: true,

        });

        probed2.push({ url: frame.url(), name: frame.name(), result: r.result?.value, err: r.exceptionDetails });

      } finally {

        try {

          await cdp.detach();

        } catch (_) {}

      }

    }

    console.log('probedReady', JSON.stringify(probed2, null, 2));



    try {

      console.log('keyOf left', await session.dataPlane.invoke('keyOfSelector', { selector: '#left', contextId: 1 }));

      console.log('keyOf right', await session.dataPlane.invoke('keyOfSelector', { selector: '#right', contextId: 1 }));

    } catch (e) {

      console.log('keyOf err', e.message ?? e);

    }

  } finally {

    try {

      await chassis.disposeVirtual();

    } catch (_) {}

    try {

      await chassis.dispose();

    } catch (_) {}

    await new Promise((r) => server.close(r));

  }

}



main().catch((e) => {

  console.error(e);

  process.exit(1);

});


