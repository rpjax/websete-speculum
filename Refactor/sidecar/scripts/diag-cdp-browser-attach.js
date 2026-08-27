'use strict';
/**
 * Browser-level autoAttach + receivedMessageFromTarget observability.
 */
const http = require('node:http');
const { chromium } = require('patchright');

function listen(handler) {
  return new Promise((resolve) => {
    const s = http.createServer(handler);
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
}

async function main() {
  let iframeSrc = '';
  const child = await listen((req, res) => {
    if (String(req.url).includes('__speculum')) {
      console.log('CHILD_HIT', req.url);
      res.writeHead(404, { 'Content-Type': '' });
      res.end('');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(
      '<html><head></head><body><h1>child</h1><script src="/__speculum/virtual.js"></script><script>document.title="child-ok"</script></body></html>',
    );
  });
  const childPort = child.address().port;

  const mainSrv = await listen((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<html><body><iframe src="${iframeSrc}"></iframe></body></html>`);
  });
  const mainPort = mainSrv.address().port;
  iframeSrc = `http://cf.test:${childPort}/`;

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--host-resolver-rules=MAP site.test 127.0.0.1,MAP cf.test 127.0.0.1',
      '--disable-features=LocalNetworkAccessChecks',
      '--site-per-process',
    ],
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  const pageCdp = await context.newCDPSession(page);
  const browserCdp = await browser.newBrowserCDPSession();

  const log = [];
  const onAttach = (via) => async (ev) => {
    log.push({
      via,
      tag: 'attached',
      type: ev.targetInfo?.type,
      url: ev.targetInfo?.url,
      sid: ev.sessionId,
      wait: !!ev.waitingForDebugger,
    });
    const sid = ev.sessionId;
    if (!sid) return;
    const type = ev.targetInfo?.type;
    if (type === 'iframe' || type === 'page') {
      const enableMsg = JSON.stringify({
        id: Date.now() % 100000,
        method: 'Fetch.enable',
        params: {
          patterns: [
            { requestStage: 'Response', resourceType: 'Document' },
            { requestStage: 'Request', urlPattern: '*/__speculum/virtual.js*' },
          ],
        },
      });
      await browserCdp.send('Target.sendMessageToTarget', { sessionId: sid, message: enableMsg }).catch(() => {});
      // also try via page
      await pageCdp.send('Target.sendMessageToTarget', { sessionId: sid, message: enableMsg }).catch(() => {});
    }
    if (ev.waitingForDebugger) {
      const resumeMsg = JSON.stringify({
        id: (Date.now() % 100000) + 1,
        method: 'Runtime.runIfWaitingForDebugger',
        params: {},
      });
      await browserCdp.send('Target.sendMessageToTarget', { sessionId: sid, message: resumeMsg }).catch(() => {});
      await pageCdp.send('Target.sendMessageToTarget', { sessionId: sid, message: resumeMsg }).catch(() => {});
    }
  };

  pageCdp.on('Target.attachedToTarget', onAttach('page'));
  browserCdp.on('Target.attachedToTarget', onAttach('browser'));
  pageCdp.on('Target.receivedMessageFromTarget', (ev) => {
    log.push({ via: 'page', tag: 'fromTarget', sid: ev.sessionId, raw: String(ev.message).slice(0, 160) });
  });
  browserCdp.on('Target.receivedMessageFromTarget', (ev) => {
    log.push({ via: 'browser', tag: 'fromTarget', sid: ev.sessionId, raw: String(ev.message).slice(0, 160) });
  });

  for (const cdp of [pageCdp, browserCdp]) {
    await cdp.send('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: false,
    });
    await cdp.send('Target.getTargets').catch(() => {});
  }

  await page.goto(`http://site.test:${mainPort}/`, { waitUntil: 'networkidle', timeout: 20000 }).catch((e) => {
    log.push({ tag: 'navErr', err: String(e).slice(0, 150) });
  });
  await new Promise((r) => setTimeout(r, 2000));

  const frames = page.frames().map((f) => f.url());
  console.log(JSON.stringify({ frames, log }, null, 2));
  await browser.close();
  mainSrv.close();
  child.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
