'use strict';
const { chromium } = require('patchright');

async function main() {
  const b = await chromium.launch({ headless: true });
  const cdp = await b.newBrowserCDPSession();
  cdp.on('Target.attachedToTarget', (e) => {
    console.log('keys', Object.keys(e));
    console.log(
      'session?',
      e.session ? typeof e.session.send : null,
      e.sessionId,
      e.targetInfo?.type,
      e.targetInfo?.url,
    );
  });
  cdp.on('Fetch.requestPaused', (e) => {
    console.log('fetchPaused', e.request?.url, 'sessionId' in e ? e.sessionId : 'no-sid');
  });
  await cdp.send('Target.setAutoAttach', {
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: true,
  });
  const ctx = await b.newContext();
  const page = await ctx.newPage();
  await page.setContent('<iframe src="https://example.com"></iframe>');
  await new Promise((r) => setTimeout(r, 2500));
  await b.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
