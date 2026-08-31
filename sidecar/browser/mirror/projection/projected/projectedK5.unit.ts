import assert from 'node:assert';
import fs from 'node:fs';
import { chromium } from 'patchright';
import { labAssetRoots } from '../lab/assetRoots';
import {
  PROJECTED_K5_CSP,
  PROJECTED_STANDARDS_SRCDOC,
} from '@speculum/page-projection/projected/projectedBlankIframe';

const K5_PROBE_ATTR = 'data-k5-probe';
const K5_PROBE_SCRIPT = `document.body.setAttribute('${K5_PROBE_ATTR}', '1');`;

type MirrorProbeArgs = {
  srcdoc: string;
  csp: string;
  scriptBody: string;
  probeAttr: string;
};

export async function runProjectedK5UnitTests(): Promise<void> {
  assert.match(PROJECTED_STANDARDS_SRCDOC, /Content-Security-Policy/);
  assert.match(PROJECTED_STANDARDS_SRCDOC, /script-src 'none'/);
  assert.match(PROJECTED_STANDARDS_SRCDOC, /object-src 'none'/);

  if (process.env.SPECULUM_SKIP_PP_SESSION === '1') {
    console.log('[unit] projected K5 skipped (SPECULUM_SKIP_PP_SESSION=1)');
    return;
  }
  const chromeExe = process.env['CHROME_EXECUTABLE']?.trim();
  if (!chromeExe) {
    console.log('[unit] projected K5 skipped (no CHROME_EXECUTABLE)');
    return;
  }

  const { fixturesDir } = labAssetRoots();
  const fixture = `${fixturesDir}/k5-script-block.html`;
  assert.ok(fs.existsSync(fixture), `missing fixture ${fixture}`);
  const fixtureScript = fs.readFileSync(fixture, 'utf8').match(/<script[^>]*>([\s\S]*?)<\/script>/i);
  assert.ok(fixtureScript?.[1]?.includes(K5_PROBE_ATTR), 'fixture must set K5 probe attr');

  const browser = await chromium.launch({ headless: true, executablePath: chromeExe });
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><body></body>');

    const probe = async (args: MirrorProbeArgs): Promise<boolean> =>
      page.evaluate(mirrorScriptProbe, args);

    const inlineRan = await probe({
      srcdoc: PROJECTED_STANDARDS_SRCDOC,
      csp: PROJECTED_K5_CSP,
      scriptBody: K5_PROBE_SCRIPT,
      probeAttr: K5_PROBE_ATTR,
    });
    assert.strictEqual(inlineRan, false, 'inline mirrored script must not run on Projected surface');

    const fixtureRan = await probe({
      srcdoc:
        '<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="' +
        PROJECTED_K5_CSP +
        '"></head><body></body></html>',
      csp: PROJECTED_K5_CSP,
      scriptBody: fixtureScript![1]!.trim(),
      probeAttr: K5_PROBE_ATTR,
    });
    assert.strictEqual(fixtureRan, false, 'fixture script must not run on Projected surface');

    const virtualRan = await probe({
      srcdoc: '<!doctype html><html><head></head><body></body></html>',
      csp: '',
      scriptBody: fixtureScript![1]!.trim(),
      probeAttr: K5_PROBE_ATTR,
    });
    assert.strictEqual(virtualRan, true, 'fixture script must run without K5 CSP (control)');
  } finally {
    await browser.close();
  }

  console.log('[unit] projected K5 CSP ok');
}

/** Browser-only — flat body so esbuild does not inject `__name` into page.evaluate serialization. */
async function mirrorScriptProbe(args: MirrorProbeArgs): Promise<boolean> {
  const iframe = document.createElement('iframe');
  iframe.srcdoc = args.srcdoc;
  document.body!.appendChild(iframe);
  await new Promise<void>((resolve, reject) => {
    iframe.addEventListener('load', () => resolve(), { once: true });
    iframe.addEventListener('error', () => reject(new Error('iframe load failed')), { once: true });
  });
  const doc = iframe.contentDocument!;
  while (doc.firstChild) doc.removeChild(doc.firstChild);

  if (args.csp) {
    let html = doc.documentElement;
    if (!html) {
      html = doc.createElement('html');
      doc.appendChild(html);
    }
    let head = doc.head;
    if (!head) {
      head = doc.createElement('head');
      html.insertBefore(head, html.firstChild);
    }
    let hasCsp = false;
    const metas = head.querySelectorAll('meta[http-equiv="Content-Security-Policy"]');
    for (let i = 0; i < metas.length; i++) {
      if (metas[i]!.getAttribute('content') === args.csp) hasCsp = true;
    }
    if (!hasCsp) {
      const meta = doc.createElement('meta');
      meta.httpEquiv = 'Content-Security-Policy';
      meta.content = args.csp;
      head.insertBefore(meta, head.firstChild);
    }
  }

  let html = doc.documentElement;
  if (!html) {
    html = doc.createElement('html');
    doc.appendChild(html);
  }
  let body = doc.body;
  if (!body) {
    body = doc.createElement('body');
    html.appendChild(body);
  }
  const script = doc.createElement('script');
  script.textContent = args.scriptBody;
  if (args.csp) {
    let head = doc.head;
    if (!head) {
      head = doc.createElement('head');
      html.insertBefore(head, html.firstChild);
    }
    let hasCsp = false;
    const metas = head.querySelectorAll('meta[http-equiv="Content-Security-Policy"]');
    for (let i = 0; i < metas.length; i++) {
      if (metas[i]!.getAttribute('content') === args.csp) hasCsp = true;
    }
    if (!hasCsp) {
      const meta = doc.createElement('meta');
      meta.httpEquiv = 'Content-Security-Policy';
      meta.content = args.csp;
      head.insertBefore(meta, head.firstChild);
    }
  }
  body.appendChild(script);
  await new Promise((r) => setTimeout(r, 50));
  return body.getAttribute(args.probeAttr) === '1';
}
