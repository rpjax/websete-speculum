'use strict';
/**
 * Diagnose Eneba geo "Sim" → projected white screen.
 * Run inside lab container: node scripts/diag-eneba-sim-white.js
 */
process.env.SPECULUM_INPUT_BACKEND = process.env.SPECULUM_INPUT_BACKEND || 'os';
process.env.CHROME_EXECUTABLE = process.env.CHROME_EXECUTABLE || '/usr/bin/google-chrome';

const {
  createPageProjectionBrowserSessionFactory,
} = require('../dist/browser/mirror/projection/session/PageProjectionBrowserSession');
const { labLaunchOptions } = require('../dist/browser/mirror/projection/session/labLaunch');

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function mainEval(cdp, expression) {
  const ev = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (ev.exceptionDetails) {
    return { ok: false, error: JSON.stringify(ev.exceptionDetails) };
  }
  return { ok: true, value: ev.result?.value ?? null };
}

async function probeVirtual(cdp, label) {
  const r = await mainEval(
    cdp,
    `(() => {
      const rt = globalThis.__speculumProjection;
      const doc = document;
      const body = doc.body;
      const buttons = [...doc.querySelectorAll('button,a,[role="button"]')]
        .slice(0, 40)
        .map((el) => ({
          tag: el.tagName,
          text: (el.textContent || '').trim().slice(0, 80),
          cls: (el.className || '').toString().slice(0, 120),
          id: el.id || null,
        }));
      return {
        url: location.href,
        title: doc.title,
        ready: doc.readyState,
        bodyLen: body ? body.innerHTML.length : 0,
        bodyTextLen: body ? (body.innerText || '').length : 0,
        childCount: body ? body.childElementCount : 0,
        tableSize: rt && rt.table ? rt.table.size : null,
        identitySize: rt && rt.domNodes ? rt.domNodes.size : null,
        seq: rt && rt.frameEmitter ? rt.frameEmitter.currentSequence : null,
        gen: rt && rt.domNodes ? rt.domNodes.generation : null,
        buttons,
      };
    })()`,
  );
  console.log('VIRTUAL', label, JSON.stringify(r.ok ? r.value : r, null, 0));
  return r.ok ? r.value : null;
}

async function findSimSelector(cdp) {
  const r = await mainEval(
    cdp,
    `(() => {
      const candidates = [];
      for (const el of document.querySelectorAll('button,a,[role="button"],div,span')) {
        const t = (el.textContent || '').trim();
        if (!/^sim$/i.test(t)) continue;
        if (el.offsetWidth < 4 || el.offsetHeight < 4) continue;
        let sel = el.tagName.toLowerCase();
        if (el.id) sel = '#' + CSS.escape(el.id);
        else if (el.classList && el.classList.length) {
          sel = el.tagName.toLowerCase() + '.' + [...el.classList].slice(0, 3).map((c) => CSS.escape(c)).join('.');
        }
        candidates.push({
          sel,
          tag: el.tagName,
          rect: { w: el.offsetWidth, h: el.offsetHeight },
          text: t,
        });
      }
      return candidates;
    })()`,
  );
  return r.ok ? r.value : [];
}

async function probeProjected(session, label) {
  const snap = await session.getStateSnapshot(1, { tree: true, table: 'full', cssom: 'scan' });
  const tree = snap.ok && snap.tree ? snap.tree : null;
  let nodeCount = 0;
  let textLen = 0;
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    nodeCount += 1;
    if (typeof n.text === 'string') textLen += n.text.length;
    const ch = n.children;
    if (Array.isArray(ch)) for (const c of ch) walk(c);
  };
  walk(tree);
  const o2 = snap.ok && snap.table && snap.table.rows ? snap.table.rows : null;
  console.log(
    'PROJECTED',
    label,
    JSON.stringify(
      {
        ok: snap.ok,
        reason: snap.reason,
        generation: snap.generation,
        sequence: snap.sequence,
        rowCount: snap.table?.digest?.rowCount ?? null,
        tableHash: snap.table?.digest?.tableHash ?? null,
        o2Ok: o2?.ok ?? null,
        o2Mismatch: o2 && !o2.ok ? o2 : null,
        treeNodes: nodeCount,
        treeTextLen: textLen,
        cssomLive: snap.cssom?.live ?? null,
      },
      null,
      0,
    ),
  );
  return snap;
}

async function main() {
  const factory = createPageProjectionBrowserSessionFactory({ headless: false });
  const session = factory.create('eneba-diag-' + Date.now(), {
    onCrash: (e) => console.log('CRASH', e),
    onConsole: (m) => console.log('CONSOLE', typeof m === 'string' ? m : JSON.stringify(m)),
    onPageProjectionFrame: () => {},
    onLocationChanged: (u) => console.log('NAV', u),
    onTitleChanged: (t) => console.log('TITLE', t),
  });

  let frames = 0;
  session.onPageProjectionFrame = () => {
    frames += 1;
  };

  try {
    await session.launch(
      labLaunchOptions({ width: 1280, height: 720, cpuProfiling: false, projectionDataPlane: 'loopback' }),
    );
    await session.navigate('https://www.eneba.com');
    await wait(12_000);

    const cdp = session.cdpSession;
    if (!cdp) throw new Error('no cdpSession');

    console.log('FRAMES_BEFORE', frames);
    await probeVirtual(cdp, 'before_click');
    await probeProjected(session, 'before_click');

    const simCandidates = await findSimSelector(cdp);
    console.log('SIM_CANDIDATES', JSON.stringify(simCandidates));

    let selector = null;
    for (const c of simCandidates) {
      if (c.sel && c.sel.startsWith('#')) {
        selector = c.sel;
        break;
      }
    }
    if (!selector && simCandidates[0]) selector = simCandidates[0].sel;

    if (!selector) {
      // Fallback: yellow button in geo modal — often last visible button with Sim text
      selector = 'button';
      console.log('WARN using fallback selector', selector);
    }

    const click = await session.resolveAndClickDomInput(selector, 1);
    console.log('CLICK', JSON.stringify(click));
    await wait(10_000);

    console.log('FRAMES_AFTER', frames);
    await probeVirtual(cdp, 'after_click');
    await probeProjected(session, 'after_click');

    const loc = await mainEval(cdp, 'location.href');
    console.log('FINAL_URL', loc.value);
  } finally {
    await session.dispose().catch(() => undefined);
  }
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
