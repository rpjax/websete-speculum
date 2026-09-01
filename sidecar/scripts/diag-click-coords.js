/**
 * Assertive click-coord diagnosis: Projected-like point vs Virtual live rect.
 * Usage (from sidecar/): node scripts/diag-click-coords.js
 */
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function main() {
  process.env.CHROME_EXECUTABLE =
    process.env.CHROME_EXECUTABLE ||
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

  const {
    createPageProjectionBrowserSessionFactory,
  } = require('../dist/browser/mirror/projection/session/PageProjectionBrowserSession');
  const { loadInpageScript } = require('../dist/browser/mirror/projection/inject/loadInpageScript');

  const bundle = loadInpageScript();
  console.log('[diag] virtual.js has click-diag:', bundle.includes('speculum-click-diag'), 'len', bundle.length);

  const consoles = [];
  const factory = createPageProjectionBrowserSessionFactory({ headless: false });
  const session = factory.create('diag-click-coords', {
    onConsole: (_level, text) => {
      consoles.push(String(text));
      if (/click-diag|point_outside|input_reject|resolveNodeHit/.test(String(text))) {
        console.log(`[console] ${String(text).slice(0, 800)}`);
      }
    },
    onCrash: (f) => console.error('[crash]', f),
    onLocationChanged: () => undefined,
    onPageProjectionFrame: () => undefined,
    onPageProjectionTelemetry: () => undefined,
  });

  const fixture = pathToFileURL(
    path.join(__dirname, '../browser/mirror/projection/lab/fixtures/input-click.html'),
  ).href;

  // Match Cursor lab repro surface (638×315).
  const W = 638;
  const H = 315;

  await session.launch({
    mirrorMode: 'pageProjection',
    projectionDataPlane: 'loopback',
    width: W,
    height: H,
    viewportPolicy: {
      minWidth: 320,
      minHeight: 240,
      maxWidth: Math.max(W, 1280),
      maxHeight: Math.max(H, 720),
    },
    locale: 'en-US',
    language: 'en-US',
    timeZoneId: 'UTC',
    colorScheme: 'light',
    device: null,
  });

  await session.navigate(fixture);
  await new Promise((r) => setTimeout(r, 1500));

  const status = session.getStatus?.() ?? null;
  console.log('[diag] session status viewport:', JSON.stringify({
    width: session.getViewportSize?.() ?? null,
    status,
  }));

  const virtEv = await session.evaluate(`(() => {
    const btn = document.getElementById('click-me');
    const h1 = document.querySelector('h1');
    if (!btn) return { ok: false, reason: 'no_btn' };
    const r = btn.getBoundingClientRect();
    const hr = h1.getBoundingClientRect();
    const csBtn = getComputedStyle(btn);
    const csH1 = getComputedStyle(h1);
    const csBody = getComputedStyle(document.body);
    return {
      ok: true,
      ua: navigator.userAgent.slice(0, 120),
      inner: { w: window.innerWidth, h: window.innerHeight, dpr: devicePixelRatio },
      outer: { w: window.outerWidth, h: window.outerHeight },
      visual: window.visualViewport
        ? { w: visualViewport.width, h: visualViewport.height, scale: visualViewport.scale }
        : null,
      btn: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: r.width, h: r.height },
      center: { x: r.left + r.width / 2, y: r.top + r.height / 2 },
      h1: { left: hr.left, top: hr.top, bottom: hr.bottom, h: hr.height },
      statusTop: document.getElementById('status').getBoundingClientRect().top,
      fonts: {
        bodyFamily: csBody.fontFamily,
        bodySize: csBody.fontSize,
        bodyMargin: { t: csBody.marginTop, l: csBody.marginLeft, b: csBody.marginBottom },
        h1Size: csH1.fontSize,
        h1LineHeight: csH1.lineHeight,
        h1Margin: { t: csH1.marginTop, b: csH1.marginBottom },
        btnFamily: csBtn.fontFamily,
        btnSize: csBtn.fontSize,
        btnPadding: { t: csBtn.paddingTop, b: csBtn.paddingBottom },
        btnBorder: { t: csBtn.borderTopWidth, b: csBtn.borderBottomWidth },
        btnHeight: csBtn.height,
      },
    };
  })()`);
  const virt = JSON.parse(virtEv.value);
  console.log('[diag] VIRTUAL LIVE:', JSON.stringify(virt, null, 2));

  // Pre-fix Projected quirks center (must stay outside Virtual — regression probe).
  const staleQuirksPoint = { x: 65.55078125, y: 96.125, viewportW: W, viewportH: H };
  // Post-fix CSS1Compat center (must match Virtual).
  const projectedPoint = virt.ok
    ? { x: virt.center.x, y: virt.center.y, viewportW: W, viewportH: H }
    : { x: 65.55078125, y: 109.1875, viewportW: W, viewportH: H };

  const keyed = await session.loopbackInvoke('keyOfSelector', { selector: '#click-me', contextId: 1 });
  console.log('[diag] keyOfSelector:', keyed);

  const hitCenter = await session.loopbackInvoke('resolveNodeHit', {
    contextId: 1,
    nodeId: keyed.nodeId,
  });
  console.log('[diag] resolveNodeHit CENTER (no xy):', hitCenter);

  const hitProjected = await session.loopbackInvoke('resolveNodeHit', {
    contextId: 1,
    nodeId: keyed.nodeId,
    x: projectedPoint.x,
    y: projectedPoint.y,
  });
  console.log('[diag] resolveNodeHit MATCHED CENTER:', hitProjected);

  const hitStaleQuirks = await session.loopbackInvoke('resolveNodeHit', {
    contextId: 1,
    nodeId: keyed.nodeId,
    x: staleQuirksPoint.x,
    y: staleQuirksPoint.y,
  });
  console.log('[diag] resolveNodeHit STALE QUIRKS POINT (expect outside):', hitStaleQuirks);

  // Also try Virtual's own center as control
  if (virt.ok) {
    const hitVirtCenter = await session.loopbackInvoke('resolveNodeHit', {
      contextId: 1,
      nodeId: keyed.nodeId,
      x: virt.center.x,
      y: virt.center.y,
    });
    console.log('[diag] resolveNodeHit VIRTUAL CENTER POINT:', hitVirtCenter);
  }

  // Compare geometrically without resolve
  if (virt.ok) {
    const r = virt.btn;
    const inside =
      projectedPoint.x >= r.left &&
      projectedPoint.x <= r.right &&
      projectedPoint.y >= r.top &&
      projectedPoint.y <= r.bottom;
    console.log(
      '[diag] GEOMETRY:',
      JSON.stringify(
        {
          projectedPoint,
          virtBtn: r,
          virtCenter: virt.center,
          inside,
          deltaCenter: {
            dx: projectedPoint.x - virt.center.x,
            dy: projectedPoint.y - virt.center.y,
          },
        },
        null,
        2,
      ),
    );
  }

  // Default launch size control (1280×720) — if lab forgets resize, this is the misshape.
  console.log('[diag] --- resize probe: stay at launch W×H already ---');

  await session.stop();
  const diagLines = consoles.filter((t) => /click-diag|point_outside/.test(t));
  console.log('[diag] console diag lines:', diagLines.length);
  for (const t of diagLines.slice(-6)) console.log('  ', t.slice(0, 500));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
