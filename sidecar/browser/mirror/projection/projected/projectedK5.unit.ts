/**
 * K5 — no page JS on Projected. CSP meta (not iframe.sandbox).
 * String/CSP asserts always run. Chromium probe fails closed unless
 * SPECULUM_SKIP_K5_CHROME=1 (explicit lab escape — never silent PASS).
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'patchright';
import { labAssetRoots } from '../lab/assetRoots';
import {
  PROJECTED_K5_CSP,
  PROJECTED_STANDARDS_SRCDOC,
  ensureProjectedK5Csp,
} from '@speculum/page-projection/projected/projectedBlankIframe';

const K5_PROBE_ATTR = 'data-k5-probe';
const K5_PROBE_SCRIPT = `document.body.setAttribute('${K5_PROBE_ATTR}', '1');`;

type MirrorProbeArgs = {
  srcdoc: string;
  /** When true, after skeleton strip call the same CSP install as apply (package path). */
  installPackageCsp: boolean;
  csp: string;
  scriptBody: string;
  probeAttr: string;
};

export async function runProjectedK5UnitTests(): Promise<void> {
  assert.match(PROJECTED_STANDARDS_SRCDOC, /Content-Security-Policy/);
  assert.match(PROJECTED_STANDARDS_SRCDOC, /script-src 'none'/);
  assert.match(PROJECTED_STANDARDS_SRCDOC, /object-src 'none'/);
  assert.strictEqual(PROJECTED_K5_CSP, "script-src 'none'; object-src 'none'");

  assertNoSandboxOnProjectedSurface();
  assertEnsureProjectedK5CspInstallsMeta();

  const { fixturesDir } = labAssetRoots();
  const fixture = path.join(fixturesDir, 'k5-script-block.html');
  assert.ok(fs.existsSync(fixture), `missing fixture ${fixture}`);
  const fixtureHtml = fs.readFileSync(fixture, 'utf8');
  const fixtureScript = fixtureHtml.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
  assert.ok(fixtureScript?.[1]?.includes(K5_PROBE_ATTR), 'fixture must set K5 probe attr');

  if (process.env.SPECULUM_SKIP_K5_CHROME === '1') {
    console.log('[unit] projected K5 Chromium probe skipped (SPECULUM_SKIP_K5_CHROME=1)');
    return;
  }

  const chromeExe = process.env['CHROME_EXECUTABLE']?.trim();
  assert.ok(
    chromeExe,
    'CHROME_EXECUTABLE required for K5 Chromium probe (set path, or SPECULUM_SKIP_K5_CHROME=1 to skip explicitly)',
  );

  const browser = await chromium.launch({
    headless: true,
    executablePath: chromeExe,
    // CI (setup-chrome / rootless) — without these, launch can hang indefinitely.
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><body></body>');

    const probe = async (args: MirrorProbeArgs): Promise<boolean> =>
      page.evaluate(mirrorScriptProbe, args);

    const inlineRan = await probe({
      srcdoc: PROJECTED_STANDARDS_SRCDOC,
      installPackageCsp: true,
      csp: PROJECTED_K5_CSP,
      scriptBody: K5_PROBE_SCRIPT,
      probeAttr: K5_PROBE_ATTR,
    });
    assert.strictEqual(inlineRan, false, 'inline mirrored script must not run on Projected surface');

    const fixtureRan = await probe({
      srcdoc: PROJECTED_STANDARDS_SRCDOC,
      installPackageCsp: true,
      csp: PROJECTED_K5_CSP,
      scriptBody: fixtureScript![1]!.trim(),
      probeAttr: K5_PROBE_ATTR,
    });
    assert.strictEqual(fixtureRan, false, 'fixture script must not run on Projected surface');

    const virtualRan = await probe({
      srcdoc: '<!doctype html><html><head></head><body></body></html>',
      installPackageCsp: false,
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

/** Static: Projected birth must never reintroduce iframe.sandbox (WebKit touch block). */
function assertNoSandboxOnProjectedSurface(): void {
  const roots = [
    path.resolve(__dirname, '../../../../../../packages/page-projection/src/projected'),
    path.resolve(__dirname, '../../../../../../web/src/features/sessions/live'),
  ];
  const bad: string[] = [];
  const re = /\.sandbox\s*=|setAttribute\(\s*['"]sandbox['"]/;
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    walkTs(root, (file, text) => {
      if (re.test(text)) bad.push(path.relative(process.cwd(), file));
    });
  }
  assert.deepStrictEqual(bad, [], `Projected surface must not set iframe.sandbox: ${bad.join(', ')}`);
}

function walkTs(dir: string, visit: (file: string, text: string) => void): void {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      walkTs(full, visit);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(ent.name)) continue;
    visit(full, fs.readFileSync(full, 'utf8'));
  }
}

/** Node: ensureProjectedK5Csp is the apply-path install (not a one-off in the probe). */
function assertEnsureProjectedK5CspInstallsMeta(): void {
  type MetaEl = {
    httpEquiv: string;
    content: string;
    getAttribute(name: string): string | null;
  };
  const children: MetaEl[] = [];
  const makeMeta = (): MetaEl => {
    const el = {
      httpEquiv: '',
      content: '',
      getAttribute(name: string) {
        if (name === 'content') return el.content;
        if (name === 'http-equiv') return el.httpEquiv;
        return null;
      },
    };
    return el;
  };
  const head = {
    querySelectorAll(sel: string) {
      if (sel !== 'meta[http-equiv="Content-Security-Policy"]') return [] as MetaEl[];
      return children.filter((n) => n.httpEquiv === 'Content-Security-Policy');
    },
    insertBefore(node: MetaEl, _ref: unknown) {
      children.unshift(node);
      return node;
    },
  };
  const html = {
    firstChild: null as unknown,
    insertBefore(node: unknown) {
      return node;
    },
  };
  const doc = {
    documentElement: html as unknown as HTMLElement,
    head: head as unknown as HTMLHeadElement,
    createElement(tag: string) {
      if (tag === 'meta') return makeMeta() as unknown as HTMLElement;
      return { tagName: tag.toUpperCase() } as unknown as HTMLElement;
    },
    appendChild() {
      return null;
    },
  } as unknown as Document;

  ensureProjectedK5Csp(doc);
  assert.strictEqual(children.length, 1, 'ensureProjectedK5Csp must insert one CSP meta');
  assert.strictEqual(children[0]!.httpEquiv, 'Content-Security-Policy');
  assert.strictEqual(children[0]!.content, PROJECTED_K5_CSP);

  ensureProjectedK5Csp(doc);
  assert.strictEqual(children.length, 1, 'ensureProjectedK5Csp must be idempotent');
}

/**
 * Browser-only — flat body so esbuild does not inject `__name` into page.evaluate serialization.
 * When installPackageCsp: mirrors {@link ensureProjectedK5Csp} after strip (apply path).
 */
async function mirrorScriptProbe(args: MirrorProbeArgs): Promise<boolean> {
  const iframe = document.createElement('iframe');
  // K5: never sandbox — WebKit would drop touch.
  if (iframe.hasAttribute('sandbox') || iframe.sandbox.length > 0) {
    throw new Error('probe iframe must not carry sandbox');
  }
  iframe.srcdoc = args.srcdoc;
  document.body!.appendChild(iframe);
  await new Promise<void>((resolve, reject) => {
    iframe.addEventListener('load', () => resolve(), { once: true });
    iframe.addEventListener('error', () => reject(new Error('iframe load failed')), { once: true });
  });
  const doc = iframe.contentDocument!;
  while (doc.firstChild) doc.removeChild(doc.firstChild);

  if (args.installPackageCsp && args.csp) {
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
    const existing = head.querySelectorAll('meta[http-equiv="Content-Security-Policy"]');
    let has = false;
    for (let i = 0; i < existing.length; i++) {
      if (existing[i]!.getAttribute('content') === args.csp) has = true;
    }
    if (!has) {
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
  body.appendChild(script);
  await new Promise((r) => setTimeout(r, 50));
  return body.getAttribute(args.probeAttr) === '1';
}
