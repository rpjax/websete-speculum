'use strict';
/**
 * Dual-boot / sequence diagnostics repro (eneba).
 * Requires SPECULUM_DIAG_BOOT=1 (lab compose sets it).
 *
 * Inside lab container:
 *   node scripts/scratch/diag/diag-boot-seq.js
 */
const path = require('node:path');
const fs = require('node:fs');

const root = path.join(__dirname, '..', '..', '..');
const OUT = path.join(root, 'lab-runs', 'diag-boot-seq');
const URL = process.env.SPECULUM_BROWSE_URL || 'https://www.eneba.com';

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseBootDiagLine(text) {
  const marker = '[speculum-boot-diag]';
  const i = text.indexOf(marker);
  if (i < 0) return null;
  const jsonStart = text.indexOf('{', i);
  if (jsonStart < 0) return null;
  try {
    return JSON.parse(text.slice(jsonStart));
  } catch {
    return null;
  }
}

async function main() {
  process.env.SPECULUM_LAB_HEADED = process.env.SPECULUM_LAB_HEADED || '1';
  process.env.CHROME_EXECUTABLE = process.env.CHROME_EXECUTABLE || '/usr/bin/google-chrome';
  process.env.SPECULUM_DIAG_BOOT = process.env.SPECULUM_DIAG_BOOT || '1';
  fs.mkdirSync(OUT, { recursive: true });

  const sidecarLines = [];
  const virtualPayloads = [];
  const origWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk, encoding, cb) => {
    const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    if (text.includes('[speculum-boot-diag]')) {
      for (const line of text.split(/\r?\n/)) {
        if (!line.includes('[speculum-boot-diag]')) continue;
        sidecarLines.push(line);
        const payload = parseBootDiagLine(line);
        if (payload && payload.side === 'sidecar') {
          /* already in sidecarLines */
        }
      }
    }
    return origWrite(chunk, encoding, cb);
  };

  const { LabChassis } = require(path.join(root, 'dist/browser/mirror/projection/lab/host/chassis'));
  const chassis = new LabChassis({ headless: false, outDir: OUT });
  chassis.setConsoleRelay((ev) => {
    if (!ev?.text || !String(ev.text).includes('[speculum-boot-diag]')) return;
    const payload = parseBootDiagLine(String(ev.text));
    if (payload) virtualPayloads.push(payload);
    origWrite(`[virtual-console] ${String(ev.text).slice(0, 1500)}\n`);
  });

  let dossierDir = null;
  try {
    await chassis.boot({
      mode: 'browse',
      url: URL,
      frameRateHz: 30,
      blueprintId: 'diag-boot-seq',
      slug: 'diag-boot-seq',
      width: 1280,
      height: 720,
      cpuProfiling: false,
    });

    console.log('[diag-boot-seq] booted', URL, 'diagBoot=', process.env.SPECULUM_DIAG_BOOT);
    await wait(12000);
  } catch (err) {
    console.error('[diag-boot-seq] boot/wait error', err instanceof Error ? err.message : String(err));
  }

  try {
    dossierDir = chassis.dossierHandle?.dir ?? null;

    // Prefer Virtual lines captured via sidecar lateBoot_evaluate_done (main-world drain).
    // page.evaluate default is isolated and cannot see main-world __speculumBootDiagLines.
    for (const line of sidecarLines) {
      const payload = parseBootDiagLine(line);
      if (!payload) continue;
      if (payload.event === 'lateBoot_evaluate_done' || payload.event === 'lateBoot_error_main_lines') {
        for (const key of ['mainBootDiagLines', 'isolateBootDiagLines', 'lines']) {
          const lines = Array.isArray(payload[key]) ? payload[key] : [];
          for (const l of lines) {
            const p = parseBootDiagLine(String(l));
            if (p) virtualPayloads.push({ ...p, _drainFrom: `${payload.event}:${key}` });
          }
        }
      }
    }

    try {
      const session = chassis.browser;
      const page = session && session.page ? session.page : null;
      let drained = null;
      if (page && typeof page.evaluate === 'function') {
        drained = await page.evaluate(
          `() => ({
            lines: Array.isArray(globalThis.__speculumBootDiagLines) ? globalThis.__speculumBootDiagLines.slice() : [],
            bootId: globalThis.__speculumBootDiag && globalThis.__speculumBootDiag.bootId || null,
            hasProjection: !!globalThis.__speculumProjection,
            hasBootPromise: !!globalThis.__speculumProjectionBoot,
            diagBoot: !!(globalThis.__SPECULUM_PROJECTION__ && globalThis.__SPECULUM_PROJECTION__.diagBoot),
            cfgKeys: globalThis.__SPECULUM_PROJECTION__ ? Object.keys(globalThis.__SPECULUM_PROJECTION__) : [],
            href: location.href,
            seq: globalThis.__speculumProjection && globalThis.__speculumProjection.frameEmitter
              ? globalThis.__speculumProjection.frameEmitter.currentSequence : null,
          })`,
          undefined,
          false,
        ).catch(async () =>
          page.evaluate(
            `() => ({
              lines: Array.isArray(globalThis.__speculumBootDiagLines) ? globalThis.__speculumBootDiagLines.slice() : [],
              bootId: globalThis.__speculumBootDiag && globalThis.__speculumBootDiag.bootId || null,
              hasProjection: !!globalThis.__speculumProjection,
              hasBootPromise: !!globalThis.__speculumProjectionBoot,
              diagBoot: !!(globalThis.__SPECULUM_PROJECTION__ && globalThis.__SPECULUM_PROJECTION__.diagBoot),
              cfgKeys: globalThis.__SPECULUM_PROJECTION__ ? Object.keys(globalThis.__SPECULUM_PROJECTION__) : [],
              href: location.href,
            })`,
            false,
          ),
        );
      } else {
        const ev = await session?.evaluate?.(
          `() => ({
            lines: Array.isArray(globalThis.__speculumBootDiagLines) ? globalThis.__speculumBootDiagLines.slice() : [],
            bootId: globalThis.__speculumBootDiag && globalThis.__speculumBootDiag.bootId || null,
            hasProjection: !!globalThis.__speculumProjection,
            hasBootPromise: !!globalThis.__speculumProjectionBoot,
            diagBoot: !!(globalThis.__SPECULUM_PROJECTION__ && globalThis.__SPECULUM_PROJECTION__.diagBoot),
            cfgKeys: globalThis.__SPECULUM_PROJECTION__ ? Object.keys(globalThis.__SPECULUM_PROJECTION__) : [],
            href: location.href,
          })`,
        );
        drained = ev?.ok ? JSON.parse(ev.value || 'null') : { evalError: ev?.errorMessage || 'no page' };
      }
      console.log('[diag-boot-seq] pageDrain', JSON.stringify(drained));
      if (drained && Array.isArray(drained.lines)) {
        for (const line of drained.lines) {
          const payload = parseBootDiagLine(String(line));
          if (payload) virtualPayloads.push(payload);
        }
      }
      fs.writeFileSync(path.join(OUT, 'page-drain.json'), JSON.stringify(drained, null, 2));
    } catch (err) {
      console.log('[diag-boot-seq] pageDrain failed', err instanceof Error ? err.message : String(err));
    }

    let consoleNdjson = [];
    if (dossierDir) {
      const consolePath = path.join(dossierDir, 'telemetry', 'console.ndjson');
      if (fs.existsSync(consolePath)) {
        consoleNdjson = fs
          .readFileSync(consolePath, 'utf8')
          .split(/\r?\n/)
          .filter(Boolean)
          .map((line) => {
            try {
              return JSON.parse(line);
            } catch {
              return null;
            }
          })
          .filter(Boolean);
        for (const row of consoleNdjson) {
          if (!row.text || !String(row.text).includes('[speculum-boot-diag]')) continue;
          const payload = parseBootDiagLine(String(row.text));
          if (
            payload &&
            !virtualPayloads.some(
              (p) =>
                p.t === payload.t &&
                p.event === payload.event &&
                p.bootId === payload.bootId &&
                p.sequence === payload.sequence,
            )
          ) {
            virtualPayloads.push(payload);
          }
        }
      }
    }

    const bootIds = new Set();
    const bootTimeline = [];
    const sequences = [];
    for (const p of virtualPayloads) {
      if (p.bootId) bootIds.add(p.bootId);
      if (
        p.event === 'boot_start' ||
        p.event === 'boot_established' ||
        p.event === 'boot_entry' ||
        p.event === 'boot_initial_sent'
      ) {
        bootTimeline.push({
          event: p.event,
          bootId: p.bootId ?? null,
          action: p.action ?? null,
          reason: p.reason ?? null,
          t: p.t,
          href: p.href,
          contextId: p.contextId ?? null,
          sequence: p.sequence ?? null,
          drainFrom: p._drainFrom ?? null,
        });
      }
      if (p.event === 'frame_emitted') {
        sequences.push({
          bootId: p.bootId,
          sequence: p.sequence,
          resync: p.resync,
          emitPath: p.emitPath,
          contextId: p.contextId,
          framesEmittedBefore: p.framesEmittedBefore,
          t: p.t,
          drainFrom: p._drainFrom ?? null,
        });
      }
    }

    const sidecarPayloads = sidecarLines.map(parseBootDiagLine).filter(Boolean);
    const lateBootEval = sidecarPayloads.filter((p) => p.event === 'lateBoot_evaluate');
    const lateBootSkip = sidecarPayloads.filter((p) => p.event === 'lateBoot_skip');
    const lateBootProbe = sidecarPayloads.filter((p) => p.event === 'lateBoot_probe');
    const lateBootDone = sidecarPayloads.filter((p) => p.event === 'lateBoot_evaluate_done');

    const bySeq = new Map();
    for (const s of sequences) {
      const key = `${s.contextId}:${s.sequence}`;
      if (!bySeq.has(key)) bySeq.set(key, []);
      bySeq.get(key).push(s);
    }
    const dupSeqs = [...bySeq.entries()]
      .filter(([, rows]) => rows.length > 1)
      .map(([key, rows]) => ({
        key,
        count: rows.length,
        bootIds: [...new Set(rows.map((r) => r.bootId))],
        paths: rows.map((r) => r.emitPath),
        drains: rows.map((r) => r.drainFrom),
      }));

    const report = {
      url: URL,
      dossierDir,
      distinctBootIds: [...bootIds],
      distinctBootIdCount: bootIds.size,
      bootTimeline,
      firstSequences: sequences.slice(0, 30),
      seq2Emitted: sequences.some((s) => s.sequence === 2),
      seq2Lines: sequences.filter((s) => s.sequence === 2).slice(0, 10),
      duplicateSequenceEmits: dupSeqs.slice(0, 20),
      lateBootEvaluateCount: lateBootEval.length,
      lateBootSkipCount: lateBootSkip.length,
      lateBootProbeCount: lateBootProbe.length,
      lateBootEvaluate: lateBootEval.slice(0, 20),
      lateBootProbe: lateBootProbe.slice(0, 40),
      lateBootSkip: lateBootSkip.slice(0, 40),
      lateBootEvaluateDone: lateBootDone.slice(0, 10),
      virtualPayloadCount: virtualPayloads.length,
      sidecarLineCount: sidecarLines.length,
      consoleNdjsonBootDiag: consoleNdjson.filter((r) =>
        String(r.text || '').includes('[speculum-boot-diag]'),
      ).length,
      sidecarRawHead: sidecarLines.slice(0, 40),
    };

    const outPath = path.join(OUT, 'boot-seq-report.json');
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
    if (dossierDir) {
      fs.writeFileSync(path.join(dossierDir, 'boot-seq-report.json'), JSON.stringify(report, null, 2));
    }
    console.log('[diag-boot-seq] report →', outPath);
    console.log(
      JSON.stringify(
        {
          distinctBootIdCount: report.distinctBootIdCount,
          distinctBootIds: report.distinctBootIds,
          seq2Emitted: report.seq2Emitted,
          lateBootEvaluateCount: report.lateBootEvaluateCount,
          bootTimeline: report.bootTimeline,
          firstSequences: report.firstSequences.slice(0, 20),
          duplicateSequenceEmits: report.duplicateSequenceEmits,
          lateBootProbe: report.lateBootProbe.slice(0, 5),
          dossierDir,
        },
        null,
        2,
      ),
    );
  } finally {
    try {
      await chassis.dispose();
    } catch {
      /* */
    }
    process.stderr.write = origWrite;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
