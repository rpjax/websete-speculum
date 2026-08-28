'use strict';
/**
 * Live Binance CSP + data-plane verdict (headless LabChassis).
 * Stress only — functional gate = unit + E2E churn (loopback.md §14).
 */
const path = require('node:path');
const fs = require('node:fs');

const root = path.join(__dirname, '..', '..', '..');
const OUT = path.join(root, 'lab-runs', 'diag-binance-live-plane');
const BINANCE_URL = process.env.BINANCE_URL || 'https://www.binance.com/pt-BR';

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function classifyConsole(text) {
  if (/speculum-csp-diag|speculum-loopback-diag/i.test(text)) return 'diag';
  if (/ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS/i.test(text)) return 'lna';
  if (/ws:\/\/127\.0\.0\.1|connect-src/i.test(text)) return 'csp-ws';
  if (/script-src|nonce|virtual\.js|Content Security Policy/i.test(text)) return 'csp-script';
  if (/about:blank.*sandbox/i.test(text)) return 'sandbox-noise';
  if (/data plane/i.test(text)) return 'plane';
  return 'other';
}

async function main() {
  process.env.CHROME_EXECUTABLE = process.env.CHROME_EXECUTABLE || '/usr/bin/google-chrome';
  process.env.SPECULUM_DIAG_CSP = process.env.SPECULUM_DIAG_CSP || '1';
  process.env.SPECULUM_LAB_HEADED = process.env.SPECULUM_LAB_HEADED || '1';
  fs.mkdirSync(OUT, { recursive: true });

  const { LabChassis } = require(path.join(root, 'dist/browser/mirror/projection/lab/host/chassis'));
  const consoleLines = [];
  const chassis = new LabChassis({ headless: false, outDir: OUT });
  chassis.setConsoleRelay((ev) => {
    consoleLines.push({ t: ev.t, level: ev.level, text: ev.text, kind: classifyConsole(ev.text) });
  });

  const report = { url: BINANCE_URL, phases: [] };

  try {
    await chassis.boot({
      mode: 'browse',
      url: BINANCE_URL,
      frameRateHz: 10,
      blueprintId: 'diag-binance-live',
      slug: 'diag-binance-live',
      width: 1280,
      height: 720,
      cpuProfiling: false,
    });

    const session = chassis.browser;
    if (!session) throw new Error('no session');

    async function phase(label, dwellMs) {
      await wait(dwellMs);
      const loopback =
        typeof session.probeLoopbackStatus === 'function'
          ? await session.probeLoopbackStatus()
          : null;

      const cdp = session.cdpSession;
      if (!cdp) throw new Error('no cdpSession');
      const ev = await cdp.send('Runtime.evaluate', {
        expression: `(() => {
        const cfg = globalThis.__SPECULUM_PROJECTION__;
        const rt = globalThis.__speculumProjection;
        const ft = rt && rt.frameTransport;
        const meta = document.querySelector('meta[http-equiv="Content-Security-Policy" i]');
        return {
          href: location.href,
          title: document.title,
          hasConfig: !!(cfg && cfg.dataPlaneUrl && cfg.sessionId),
          sessionId: cfg?.sessionId ?? null,
          dataPlaneUrl: cfg?.dataPlaneUrl ?? null,
          hasRuntime: !!rt,
          virtualEstablished: ft ? ft.isEstablished === true : null,
          metaCspLen: meta?.content?.length ?? 0,
          htmlLen: document.documentElement?.outerHTML?.length ?? 0,
        };
      })()`,
        returnByValue: true,
        awaitPromise: true,
      });
      const evalProbe = ev.result?.value ?? ev.result;

      const plane = await session.measureApplyScrollSet({
        contextId: 1,
        nodeId: null,
        scrollX: 0,
        scrollY: 8,
      });

      const recent = consoleLines.slice(-80);
      const buckets = { diag: [], lna: [], 'csp-ws': [], 'csp-script': [], plane: [], 'sandbox-noise': 0 };
      for (const l of recent) {
        if (l.kind === 'sandbox-noise') {
          buckets['sandbox-noise'] += 1;
          continue;
        }
        if (buckets[l.kind]) buckets[l.kind].push(l.text.slice(0, 220));
      }

      return {
        label,
        probe: evalProbe,
        loopback,
        plane,
        consoleBuckets: buckets,
      };
    }

    report.phases.push(await phase('t+8s', 8000));
    report.phases.push(await phase('t+20s', 12000));

    const last = report.phases[report.phases.length - 1];
    const lnaErrors = (last?.consoleBuckets?.lna ?? []).length;
    const cspWsErrors = (last?.consoleBuckets?.['csp-ws'] ?? []).length;
    const nodeEst = last?.loopback?.nodeEstablished === true;
    const virtualEst = last?.loopback?.virtualEstablished === true;
    const desync = last?.loopback && nodeEst !== virtualEst;
    const planeOk = last?.plane?.ok === true;

    report.verdict =
      !desync && nodeEst && virtualEst && planeOk && lnaErrors === 0 ? 'PASS' : 'FAIL';
    report.summary = {
      nodeEstablished: nodeEst,
      virtualEstablished: virtualEst,
      loopbackDesync: desync === true,
      planeOk,
      lnaErrors,
      cspWsErrors,
      hasConfig: last?.probe?.hasConfig === true,
      hasRuntime: last?.probe?.hasRuntime === true,
      metaCspLen: last?.probe?.metaCspLen ?? 0,
      sandboxNoise: last?.consoleBuckets?.['sandbox-noise'] ?? 0,
    };
  } catch (err) {
    report.error = err instanceof Error ? err.message : String(err);
    report.verdict = 'ERROR';
  } finally {
    try {
      await chassis.dispose();
    } catch {
      /* */
    }
  }

  report.consoleSample = consoleLines
    .filter((l) => l.kind !== 'sandbox-noise')
    .slice(-40)
    .map((l) => ({ kind: l.kind, text: l.text.slice(0, 240) }));

  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.summary ?? report, null, 2));
  console.log('full report:', path.join(OUT, 'report.json'));
  process.exit(report.verdict === 'PASS' ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
