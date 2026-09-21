/**
 * Check de 30s: a extensao carrega via Extensions.loadUnpacked, e injeta?
 * Sem eneba, sem challenge. Uma janela, tres leituras.
 * Run: node scripts/cf-extcheck.js
 */
const { randomUUID } = require('node:crypto');
const { launchChrome, speculumPpExtensionPath, installManagedExtensions } = require('../dist/browser/patchright/ChromeRuntime.js');
const { readMainWorld, extensionPresent } = require('./cf-detect.js');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const sessionId = `extcheck-${randomUUID()}`;
  const extPath = speculumPpExtensionPath();
  console.log('extensao (template):', extPath);

  const handle = await launchChrome({
    sessionId,
    headless: false,
    width: 1280,
    height: 800,
    locale: 'pt-BR',
    language: 'pt-BR',
    timeZoneId: 'America/Sao_Paulo',
    colorScheme: 'light',
    extensionPaths: [extPath],
  });

  try {
    const { context, page } = handle;

    let ids = null;
    let installError = null;
    try {
      ids = await installManagedExtensions(context, [extPath]);
    } catch (e) {
      installError = e instanceof Error ? `${e.message} | ${e.errorCode ?? ''}` : String(e);
    }
    console.log('loadUnpacked ids:', ids, installError ? `ERRO: ${installError}` : '');

    await page.goto('https://example.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await wait(1500);
    const a = await readMainWorld(page);
    console.log('\n[A] aba pre-existente, navegada apos install:');
    console.log(JSON.stringify(a, null, 1));

    const fresh = await context.newPage();
    await fresh.goto('https://example.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await wait(1500);
    const b = await readMainWorld(fresh);
    console.log('\n[B] aba nova, criada apos install:');
    console.log(JSON.stringify(b, null, 1));

    const bcdp = await context.browser().newBrowserCDPSession();
    const { targetInfos } = await bcdp.send('Target.getTargets');
    console.log('\n[C] targets chrome-extension://:');
    console.log(targetInfos.filter((t) => String(t.url).startsWith('chrome-extension://')).map((t) => `${t.type} ${t.url}`).join('\n') || '(nenhum)');
    await bcdp.detach().catch(() => undefined);

    console.log('\nVEREDITO:');
    const okA = extensionPresent(a);
    const okB = extensionPresent(b);
    if (!ids && installError) console.log('  loadUnpacked FALHOU ->', installError);
    else if (okA === null && okB === null) console.log('  SEM LEITURA do mundo MAIN (CSP barrou o script inline) — inconclusivo, nao e "sem extensao"');
    else if (okB || okA) console.log(`  EXTENSAO INJETA. aba pre-existente=${okA} aba nova=${okB}`);
    else console.log('  loadUnpacked devolveu id mas NAO injeta — agora sim isso e um achado real');
  } finally {
    await handle.context.close().catch(() => undefined);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
