'use strict';
const { chromium } = require('patchright');

async function main() {
  const b = await chromium.launch({
    headless: true,
    args: ['--site-per-process'],
  });
  const cdp = await b.newBrowserCDPSession();
  const log = [];
  cdp.on('Target.attachedToTarget', async (e) => {
    log.push({
      tag: 'att',
      type: e.targetInfo?.type,
      url: e.targetInfo?.url,
      sid: e.sessionId,
      wait: e.waitingForDebugger,
    });
    const sid = e.sessionId;
    if (!sid) return;
    try {
      await cdp.send('Target.sendMessageToTarget', {
        sessionId: sid,
        message: JSON.stringify({
          id: 1,
          method: 'Fetch.enable',
          params: {
            patterns: [{ requestStage: 'Request', urlPattern: '*example.com*' }],
          },
        }),
      });
      log.push({ tag: 'sendMessageOk', sid });
    } catch (err) {
      log.push({ tag: 'sendMessageFail', err: String(err).slice(0, 200) });
    }
  });
  cdp.on('Target.receivedMessageFromTarget', (e) => {
    log.push({ tag: 'fromTarget', sid: e.sessionId, raw: String(e.message).slice(0, 150) });
  });
  cdp.on('Fetch.requestPaused', (e) => {
    log.push({ tag: 'fetchFlat', url: e.request?.url, sid: e.sessionId });
  });

  await cdp.send('Target.setAutoAttach', {
    autoAttach: true,
    waitForDebuggerOnStart: true,
    flatten: true,
  });

  const ctx = await b.newContext();
  const page = await ctx.newPage();
  await page.setContent('<iframe src="https://example.com"></iframe>');
  await new Promise((r) => setTimeout(r, 3000));
  console.log(JSON.stringify(log, null, 2));
  await b.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
