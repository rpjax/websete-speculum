const { chromium } = require('patchright');

async function run(label, fn) {
  const browser = await chromium.launch({ headless: true });
  try {
    await fn(browser);
  } catch (e) {
    console.log(label, 'ERROR', e.message);
  } finally {
    await browser.close();
  }
}

(async () => {
  await run('with-Page.enable + real nav', async (browser) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Page.enable');
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: 'globalThis.__x = 5;' });
    await page.goto('http://example.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log('value=', await page.evaluate(() => globalThis.__x));
  });
})().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
