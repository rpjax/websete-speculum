'use strict';
/**
 * Prove whether Patchright page CDPSession delivers Target.receivedMessageFromTarget
 * and whether child Fetch.requestPaused is observable.
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
      res.writeHead(404, { 'Content-Type': '' });
      res.end('');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html><head></head><body><h1>child</h1><script src="/__speculum/virtual.js"></script></body></html>');
  });
  const childPort = child.address().port;

  const mainSrv = await listen((req, res) => {
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
    ],
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);

  const log = [];
  cdp.on('Target.attachedToTarget', (ev) => {
    log.push({ tag: 'attached', type: ev.targetInfo?.type, url: ev.targetInfo?.url, sid: ev.sessionId, wait: ev.waitingForDebugger });
  });
  cdp.on('Target.receivedMessageFromTarget', (ev) => {
    let method = '?';
    try {
      method = JSON.parse(ev.message).method || JSON.parse(ev.message).id || 'resp';
    } catch {
      /* */
    }
    log.push({ tag: 'fromTarget', sid: ev.sessionId, method, raw: String(ev.message).slice(0, 120) });
  });

  await cdp.send('Target.setAutoAttach', {
    autoAttach: true,
    waitForDebuggerOnStart: true,
    flatten: false,
  });
  await cdp.send('Target.getTargets').catch(() => {});

  // Also enable Fetch on page for comparison.
  await cdp.send('Fetch.enable', {
    patterns: [
      { requestStage: 'Response', resourceType: 'Document' },
      { requestStage: 'Request', urlPattern: '*/__speculum/virtual.js*' },
    ],
  });
  cdp.on('Fetch.requestPaused', (ev) => {
    log.push({
      tag: 'pageFetch',
      stage: ev.responseStatusCode === undefined ? 'Req' : 'Res',
      url: ev.request?.url,
      type: ev.resourceType,
    });
    // continue everything on page session so we don't hang main
    const id = ev.requestId;
    if (ev.responseStatusCode === undefined) {
      void cdp.send('Fetch.continueRequest', { requestId: id }).catch(() => {});
    } else {
      void cdp.send('Fetch.continueResponse', { requestId: id }).catch(() => {});
    }
  });

  const nav = page.goto(`http://site.test:${mainPort}/`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  // Wait a bit for attach, then send Fetch.enable to child and resume.
  await new Promise((r) => setTimeout(r, 500));
  const iframeAttach = log.find((l) => l.tag === 'attached' && l.type === 'iframe');
  if (iframeAttach) {
    const sid = iframeAttach.sid;
    const enableMsg = JSON.stringify({
      id: 1,
      method: 'Fetch.enable',
      params: {
        patterns: [
          { requestStage: 'Response', resourceType: 'Document' },
          { requestStage: 'Request', urlPattern: '*/__speculum/virtual.js*' },
        ],
      },
    });
    await cdp.send('Target.sendMessageToTarget', { sessionId: sid, message: enableMsg });
    const resumeMsg = JSON.stringify({ id: 2, method: 'Runtime.runIfWaitingForDebugger', params: {} });
    await cdp.send('Target.sendMessageToTarget', { sessionId: sid, message: resumeMsg });
    log.push({ tag: 'sentEnableResume', sid });
  } else {
    log.push({ tag: 'NO_IFRAME_ATTACH' });
  }

  await nav.catch((e) => log.push({ tag: 'navErr', err: String(e).slice(0, 120) }));
  await new Promise((r) => setTimeout(r, 3000));

  console.log(JSON.stringify(log, null, 2));
  await browser.close();
  mainSrv.close();
  child.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
