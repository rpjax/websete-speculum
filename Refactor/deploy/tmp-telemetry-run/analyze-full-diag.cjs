/**
 * Deep front↔back correlation for full Live diagnosis artifacts.
 * Usage: node analyze-full-diag.cjs
 */
const fs = require("fs");
const path = require("path");

const OUT = process.env.OUT_DIR || __dirname;
const PREFIX = "full";

function loadJson(name) {
  const p = path.join(OUT, name);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function parsePayload(f) {
  const p = f.payload ?? f.Payload;
  if (p == null) return {};
  if (typeof p === "object") return p;
  try {
    return JSON.parse(p);
  } catch {
    return {};
  }
}

function ofFacts(facts, suffix) {
  return facts
    .filter((f) => (f.type || "").endsWith(suffix) || (f.type || "").includes(suffix))
    .map((f) => ({ at: f.publishedAt, type: f.type, ...parsePayload(f) }));
}

function main() {
  const summary = loadJson(`${PREFIX}-summary.json`);
  const journal = loadJson(`${PREFIX}-journal-export.json`);
  const frontDoc = loadJson(`${PREFIX}-front-activity.json`);
  const facts = journal?.facts || [];
  const front = frontDoc?.activity || [];

  const fr = ofFacts(facts, "PageProjection.Diff.FrameReceived");
  const wd = ofFacts(facts, "PageProjection.Diff.WireDelivered");
  const rr = ofFacts(facts, "PageProjection.Diff.ResyncRequested");
  const rs = ofFacts(facts, "PageProjection.Diff.ResyncServed");
  const gb = ofFacts(facts, "PageProjection.Diff.GenerationBumped");
  const softNav = ofFacts(facts, "PageProjection.Diff.SoftNavObserved");
  const qd = ofFacts(facts, "PageProjection.Diff.QueueDropped");
  const applied = ofFacts(facts, "PageProjection.Input.Applied");
  const rejected = ofFacts(facts, "PageProjection.Input.Rejected");
  const dp = ofFacts(facts, "PageProjection.Input.DataPlaneReceived");
  const echoHit = ofFacts(facts, "PageProjection.Input.ScrollEchoHit");

  const queueDropsByStage = {};
  const queueDropSamples = [];
  for (const e of qd) {
    const stage = e.stage || e.Stage || "?";
    queueDropsByStage[stage] = (queueDropsByStage[stage] || 0) + 1;
    if (queueDropSamples.length < 12) {
      queueDropSamples.push({
        at: e.at,
        stage,
        droppedCount: e.droppedCount ?? e.DroppedCount,
        capacity: e.capacity ?? e.Capacity,
        keptSequence: e.sequence ?? e.Sequence,
        generation: e.generation ?? e.Generation,
        plane: e.plane ?? e.Plane,
        operation: e.operation ?? e.Operation,
        lowest: e.lowestDroppedSequence ?? e.LowestDroppedSequence,
        highest: e.highestDroppedSequence ?? e.HighestDroppedSequence,
        reason: e.reason ?? e.Reason,
      });
    }
  }

  const t0 = Date.parse(fr[0]?.at || facts[0]?.publishedAt || new Date().toISOString());
  const rel = (at) => {
    const ms = typeof at === "number" ? at - (front[0]?.at || at) : Date.parse(at) - t0;
    return `${(ms / 1000).toFixed(3)}s`;
  };
  const relFront = (at) => `${((at - (front[0]?.at || at)) / 1000).toFixed(3)}s`;

  const frontByHop = {};
  const frontByLabel = {};
  for (const e of front) {
    const hop = e.fields?.hop || "?";
    const label = e.label || "?";
    frontByHop[hop] = (frontByHop[hop] || 0) + 1;
    frontByLabel[label] = (frontByLabel[label] || 0) + 1;
  }

  const desyncs = front.filter((e) => e.fields?.hop === "client_desync");
  const resyncReqFront = front.filter((e) => e.fields?.hop === "client_resync_request");
  const resyncApplyFront = front.filter((e) => e.fields?.hop === "client_resync_apply");
  const drops = front.filter((e) => e.fields?.hop === "client_drop");
  const arms = front.filter((e) => e.fields?.hop === "client_arm");
  const disarms = front.filter((e) => e.fields?.hop === "client_disarm");
  const applies = front.filter((e) => e.fields?.hop === "client_apply");

  function desyncLocus(d) {
    const f = d.fields || {};
    const extra = f.extra || {};
    const detail = (() => {
      try {
        return typeof d.detail === "string" ? JSON.parse(d.detail) : d.detail || {};
      } catch {
        return {};
      }
    })();
    const reason = f.errorCode || extra.reason || detail.reason || null;
    const phase = f.phase || extra.phase || detail.phase || null;
    const selectorQuery =
      extra.selectorQuery || detail.selectorQuery || f.selectorQuery || null;
    const selectorKind =
      extra.selectorKind || detail.selectorKind || f.selectorKind || null;
    const matchCount =
      extra.matchCount ?? detail.matchCount ?? f.matchCount ?? null;
    const generation = f.generation ?? detail.generation ?? null;
    return { reason, phase, selectorQuery, selectorKind, matchCount, generation };
  }

  // Boot order (journal)
  const firstOps = fr.slice(0, 5).map((e) => `${e.plane}/${e.operation}@seq${e.sequence}/gen${e.generation}`);
  const firstWd = wd.slice(0, 5).map((e) => `${e.plane}/${e.operation}@seq${e.sequence}/gen${e.generation}`);
  const liveBeforeDoc = (() => {
    const idx = fr.findIndex((e) => e.operation === "document");
    if (idx < 0) return -1;
    return fr.slice(0, idx).filter((e) => e.operation !== "install").length;
  })();

  // FR without WD
  const wdKey = new Set(wd.map((e) => `${e.generation}:${e.sequence}:${e.operation}`));
  const frMissingWd = fr.filter(
    (e) => !wdKey.has(`${e.generation}:${e.sequence}:${e.operation}`),
  );

  // Sequence gaps on FR + nearest QueueDropped covering the hole
  // Classify TELEMETRY_HOLE when missing seqs still appear on WireDelivered.
  const wdSeqByGen = new Map();
  for (const e of wd) {
    const g = e.generation;
    if (!wdSeqByGen.has(g)) wdSeqByGen.set(g, new Set());
    wdSeqByGen.get(g).add(Number(e.sequence));
  }
  const gaps = [];
  const telemetryHoles = [];
  let last = null;
  for (const e of fr) {
    if (last && e.generation === last.generation && e.sequence != null && last.sequence != null) {
      if (e.sequence > last.sequence + 1) {
        const from = last.sequence;
        const to = e.sequence;
        const missingSeqs = [];
        for (let s = from + 1; s < to; s++) missingSeqs.push(s);
        const wdSet = wdSeqByGen.get(e.generation) || new Set();
        const wdPresentCount = missingSeqs.filter((s) => wdSet.has(s)).length;
        const covering = qd.filter((d) => {
          const low = Number(d.lowestDroppedSequence ?? d.LowestDroppedSequence ?? NaN);
          const high = Number(d.highestDroppedSequence ?? d.HighestDroppedSequence ?? NaN);
          const kept = Number(d.sequence ?? d.Sequence ?? NaN);
          if (Number.isFinite(low) && Number.isFinite(high)) {
            return high >= from + 1 && low <= to - 1;
          }
          if (Number.isFinite(kept)) {
            return kept > from && kept <= to;
          }
          return false;
        });
        const gap = {
          from,
          to,
          missing: to - from - 1,
          gen: e.generation,
          at: e.at,
          wdPresentCount,
          coveringDrops: covering.map((d) => ({
            stage: d.stage || d.Stage,
            droppedCount: d.droppedCount ?? d.DroppedCount,
            low: d.lowestDroppedSequence ?? d.LowestDroppedSequence,
            high: d.highestDroppedSequence ?? d.HighestDroppedSequence,
            kept: d.sequence ?? d.Sequence,
            reason: d.reason ?? d.Reason,
          })),
        };
        if (wdPresentCount > 0) {
          telemetryHoles.push(gap);
        } else {
          gaps.push(gap);
        }
      }
    }
    last = e;
  }

  // frMissingWd: contiguous tail after last WD → SESSION_DRAIN (informational)
  const lastWdSeq = wd.length
    ? Math.max(...wd.map((e) => Number(e.sequence)).filter((n) => Number.isFinite(n)))
    : null;
  const frMissingWdMid = frMissingWd.filter(
    (e) => lastWdSeq == null || Number(e.sequence) <= lastWdSeq,
  );
  const frMissingWdDrain = frMissingWd.filter(
    (e) => lastWdSeq != null && Number(e.sequence) > lastWdSeq,
  );
  const sessionDrain =
    lastWdSeq != null &&
    frMissingWdDrain.length > 0 &&
    frMissingWdMid.length === 0
      ? {
          lastWdSequence: lastWdSeq,
          frOnlyTailCount: frMissingWdDrain.length,
          firstMiss: frMissingWdDrain[0]?.sequence,
          lastMiss: frMissingWdDrain[frMissingWdDrain.length - 1]?.sequence,
        }
      : null;

  // Correlate each ResyncRequested with nearest front desync/resync
  const resyncTimeline = rr.map((r, i) => {
    const rt = Date.parse(r.at);
    const nearDesync = desyncs
      .map((d) => ({ d, dt: Math.abs(d.at - rt) }))
      .sort((a, b) => a.dt - b.dt)[0];
    const nearReq = resyncReqFront
      .map((d) => ({ d, dt: Math.abs(d.at - rt) }))
      .sort((a, b) => a.dt - b.dt)[0];
    const served = rs[i] || rs.find((s) => Math.abs(Date.parse(s.at) - rt) < 5000);
    return {
      journal: {
        at: r.at,
        rel: rel(r.at),
        hintGeneration: r.hintGeneration,
        hintSequence: r.hintSequence,
      },
      nearestFrontDesync: nearDesync
        ? {
            rel: relFront(nearDesync.d.at),
            dtMs: nearDesync.dt,
            ...desyncLocus(nearDesync.d),
            sequence: nearDesync.d.fields?.sequence,
            expectedSequence: nearDesync.d.fields?.expectedSequence,
            detail: nearDesync.d.detail?.slice?.(0, 240),
          }
        : null,
      nearestFrontResyncReq: nearReq
        ? {
            rel: relFront(nearReq.d.at),
            dtMs: nearReq.dt,
            generation: nearReq.d.fields?.generation,
            sequence: nearReq.d.fields?.sequence,
            detail: nearReq.d.detail?.slice?.(0, 240),
          }
        : null,
      served: served
        ? {
            at: served.at,
            covers: served.coversThroughSequence,
            generation: served.generation,
            sheets: served.sheetCount,
            rules: served.ruleCount,
            seeded: served.seededSheetCount,
          }
        : null,
    };
  });

  // First front recv ops
  const frontRecv = front.filter(
    (e) => e.fields?.hop === "client_recv" && /page_projection/i.test(e.label || ""),
  );
  const firstFrontRecv = frontRecv.slice(0, 8).map((e) => ({
    rel: relFront(e.at),
    label: e.label,
    kind: e.fields?.kind,
    gen: e.fields?.generation,
    seq: e.fields?.sequence,
    lagMs: e.fields?.lagMs,
  }));

  const dropReasons = {};
  for (const d of drops) {
    const r = d.fields?.errorCode || d.fields?.extra?.reason || d.fields?.phase || d.fields?.kind || d.label || "?";
    dropReasons[r] = (dropReasons[r] || 0) + 1;
  }
  const desyncReasons = {};
  const desyncSamples = [];
  let addressMiss = 0;
  let desyncMissingLocus = 0;
  let desyncMissingGeneration = 0;
  for (const d of desyncs) {
    const loc = desyncLocus(d);
    const r = loc.reason || loc.phase || (d.detail || "").slice(0, 80) || d.label || "?";
    desyncReasons[r] = (desyncReasons[r] || 0) + 1;
    if (loc.reason === "address_miss") addressMiss += 1;
    if (loc.generation == null) desyncMissingGeneration += 1;
    if (loc.reason === "address_miss") {
      if (!loc.phase) {
        desyncMissingLocus += 1;
      } else if (
        (loc.phase === "parent" || loc.phase === "removed" || loc.phase === "childAt") &&
        !loc.selectorQuery
      ) {
        desyncMissingLocus += 1;
      }
    } else if ((loc.reason === "install_failed" || loc.reason === "unknown_op") && !loc.phase) {
      desyncMissingLocus += 1;
    }
    if (desyncSamples.length < 8) {
      desyncSamples.push({
        rel: relFront(d.at),
        ...loc,
        seq: d.fields?.sequence,
        expected: d.fields?.expectedSequence,
      });
    }
  }

  const lagSamples = [...applies, ...frontRecv]
    .map((e) => e.fields?.lagMs)
    .filter((v) => typeof v === "number" && Number.isFinite(v));
  const lagAbsurd = lagSamples.filter((v) => Math.abs(v) > 60_000).length;
  const lagMedian =
    lagSamples.length === 0
      ? null
      : (() => {
          const s = [...lagSamples].sort((a, b) => a - b);
          return s[Math.floor(s.length / 2)];
        })();

  const installs = fr.filter((e) => e.operation === "install");
  const ops = {};
  for (const e of fr) {
    const k = `${e.plane}/${e.operation}`;
    ops[k] = (ops[k] || 0) + 1;
  }

  const report = {
    sessionId: summary?.sessionId || frontDoc?.sessionId,
    coldPaint: summary?.surface,
    idlePaint: summary?.surfaceIdle,
    afterInteract: summary?.surfaceAfter,
    journalCounts: {
      facts: facts.length,
      FrameReceived: fr.length,
      WireDelivered: wd.length,
      ResyncRequested: rr.length,
      ResyncServed: rs.length,
      GenerationBumped: gb.length,
      SoftNavObserved: softNav.length,
      QueueDropped: qd.length,
      queueDropsByStage,
      queueDropSamples,
      InputApplied: applied.length,
      InputRejected: rejected.length,
      InputDataPlane: dp.length,
      ScrollEchoHit: echoHit.length,
      frMissingWd: frMissingWd.length,
      frMissingWdMid: frMissingWdMid.length,
      frMissingWdDrain: frMissingWdDrain.length,
      sessionDrain,
      sequenceGaps: gaps.length,
      telemetryHoles: telemetryHoles.length,
    },
    frontCounts: {
      entries: front.length,
      byHop: frontByHop,
      desync: desyncs.length,
      resyncRequest: resyncReqFront.length,
      resyncApply: resyncApplyFront.length,
      drop: drops.length,
      arm: arms.length,
      disarm: disarms.length,
      apply: applies.length,
      dropReasons,
      desyncReasons,
      addressMiss,
      desyncMissingLocus,
      desyncMissingGeneration,
      lagMedianMs: lagMedian,
      lagAbsurd,
      desyncSamples,
    },
    boot: {
      firstFrameOps: firstOps,
      firstWireOps: firstWd,
      liveOpsBeforeDocument: liveBeforeDoc,
      firstFrontRecv,
      installTelemetry: installs.map((e) => ({
        seq: e.sequence,
        gen: e.generation,
        sheets: e.sheetCount,
        rules: e.ruleCount,
        seeded: e.seededSheetCount,
      })),
      gen0Resync:
        rr.filter((e) => Number(e.hintGeneration) === 0 && Number(e.hintSequence) === 0).length,
      covers0:
        rs.filter((e) => Number(e.coversThroughSequence) === 0).length,
    },
    frOps: ops,
    sequenceGaps: gaps.slice(0, 20),
    telemetryHoles: telemetryHoles.slice(0, 20),
    sessionDrain,
    resyncTimeline,
    inputKinds: {
      applied: applied.map((e) => e.kind || e.Kind),
      dataPlane: dp.map((e) => e.kind || e.Kind),
      rejected: rejected.map((e) => ({ kind: e.kind, code: e.errorCode, phase: e.phase })),
      scrollEchoHit: echoHit.length,
      scrollEchoKinds: echoHit.map((e) => e.kind || e.Kind),
      scrollIntentSent: front.filter(
        (e) =>
          e.fields?.hop === "client_sent"
          && /scrollViewport|scrollElement|wheel/i.test(String(e.fields?.kind || "")),
      ).length,
      scrollDiffApply: fr.filter(
        (e) =>
          e.plane === "dom"
          && /scrollViewport|scrollElement/i.test(String(e.operation || "")),
      ).length,
      programmaticSuppress: front.filter((e) => e.fields?.hop === "programmaticSuppress").length,
    },
    softNav: {
      observed: softNav.length,
      samples: softNav.slice(0, 8).map((e) => ({
        at: e.at,
        url: e.url || e.Url,
        generation: e.generation ?? e.Generation,
        documentEpoch: e.documentEpoch || e.DocumentEpoch,
        liveArmed: e.liveArmed ?? e.LiveArmed,
      })),
    },
    cssom: {
      installFrames: installs.length,
      installTelemetry: installs.map((e) => ({
        seq: e.sequence,
        gen: e.generation,
        sheets: e.sheetCount,
        rules: e.ruleCount,
        seeded: e.seededSheetCount,
      })),
      frontCssomApply: applies.filter(
        (e) =>
          String(e.fields?.kind || "").startsWith("cssom:")
          || String(e.fields?.hop || "").startsWith("cssom/"),
      ).length,
      frontCssomHops: Object.fromEntries(
        Object.entries(frontByHop).filter(([k]) => String(k).startsWith("cssom/")),
      ),
    },
    verdict: null,
  };

  const syncUrlFront = front.filter((e) => String(e.label || "").includes("syncUrl"));
  const urlAheadSamples = syncUrlFront
    .filter((e) => e.detail?.pageProjectionDesynced === true || e.fields?.pageProjectionDesynced === true)
    .slice(0, 5);
  report.urlAheadOfDom = {
    syncUrlEntries: syncUrlFront.length,
    desyncedAtSyncUrl: urlAheadSamples.length,
    softNavWithoutGenBump: softNav.length > 0 && gb.length === 0,
    samples: urlAheadSamples,
  };

  // Verdict construction
  const bugs = [];
  if (liveBeforeDoc > 0) bugs.push({ id: "T10_BOOT", severity: "P0", detail: "live ops before document" });
  if (report.boot.gen0Resync > 0) bugs.push({ id: "GEN0_RESYNC", severity: "P0", detail: "hintGeneration=0/hintSequence=0" });
  if (gb.length > 0) bugs.push({ id: "SPURIOUS_GEN_BUMP", severity: "P1", detail: `${gb.length} GenerationBumped` });
  if (rr.length >= 3) bugs.push({ id: "RESYNC_STORM", severity: "P1", detail: `${rr.length} ResyncRequested / ${rs.length} Served under short smoke` });
  if (frMissingWdMid.length > fr.length * 0.2) {
    bugs.push({
      id: "WIRE_GAP",
      severity: "P1",
      detail: `${frMissingWdMid.length}/${fr.length} FrameReceived without matching WireDelivered (mid-session)`,
    });
  }
  if (sessionDrain) {
    // Informational — stop mid-churn; not a mid-session gap.
    report.sessionDrainNote = `SESSION_DRAIN lastWd=${sessionDrain.lastWdSequence} frTail=${sessionDrain.frOnlyTailCount}`;
  }
  if (telemetryHoles.length > 0) {
    bugs.push({
      id: "TELEMETRY_HOLE",
      severity: "P0",
      detail: `${telemetryHoles.length} FR gaps where missing seqs exist on WireDelivered (instrumentation loss); samples=${JSON.stringify(telemetryHoles.slice(0, 3))}`,
    });
  }
  if (gaps.length > 0) {
    const unexplained = gaps.filter((g) => !g.coveringDrops || g.coveringDrops.length === 0);
    bugs.push({
      id: "SEQ_GAPS",
      severity: "P1",
      detail: `${gaps.length} real sequence gaps on FR (no WD for hole); unexplained=${unexplained.length}; samples=${JSON.stringify(gaps.slice(0, 3))}`,
    });
    if (unexplained.length > 0) {
      bugs.push({
        id: "SEQ_GAP_NO_DROP_TEL",
        severity: "P0",
        detail: "Real FR∖WD sequence gaps with no covering QueueDropped — instrumentation still blind",
      });
    }
  }
  if ((summary?.surface?.ownedRules || 0) < 10) {
    bugs.push({ id: "COLD_CSSOM", severity: "P0", detail: "cold paint ownedRules too low" });
  }
  if (desyncMissingLocus > 0 || desyncMissingGeneration > 0) {
    bugs.push({
      id: "TEL_INCOMPLETE",
      severity: "P0",
      detail: `desync missing locus=${desyncMissingLocus} generation=${desyncMissingGeneration}`,
    });
  }
  if (lagAbsurd > 0) {
    bugs.push({
      id: "LAG_ABSURD",
      severity: "P0",
      detail: `${lagAbsurd} lagMs samples |value|>60s (performance.now vs wall clock?) median=${lagMedian}`,
    });
  }
  if (addressMiss > 0) {
    bugs.push({
      id: "ADDRESS_MISS",
      severity: "P1",
      detail: `${addressMiss} address_miss desyncs; samples=${JSON.stringify(desyncSamples.filter((s) => s.reason === "address_miss").slice(0, 3))}`,
    });
  } else if (desyncs.length > 0) {
    bugs.push({
      id: "CLIENT_DESYNC",
      severity: "P1",
      detail: `${desyncs.length} client_desync; top=${JSON.stringify(desyncReasons)}`,
    });
  }
  if (rejected.length > 0) bugs.push({ id: "INPUT_REJECTED", severity: "P2", detail: `${rejected.length} rejected` });

  // Primary desync reason hypothesis from first desync detail
  const firstDesync = desyncs[0];
  report.primaryDesyncHypothesis = firstDesync
    ? {
        label: firstDesync.label,
        detail: firstDesync.detail,
        fields: firstDesync.fields,
        locus: desyncLocus(firstDesync),
        sample: desyncSamples,
      }
    : null;

  report.bugs = bugs;
  report.verdict =
    bugs.length === 0
      ? "CLEAN"
      : bugs.some((b) => b.severity === "P0")
        ? "P0_BUGS_REMAIN"
        : "P1_BUGS_REMAIN";

  fs.writeFileSync(path.join(OUT, `${PREFIX}-deep-analysis.json`), JSON.stringify(report, null, 2));

  // Human markdown report
  const md = [];
  md.push(`# Full Live diagnosis — ${report.sessionId || "?"}`);
  md.push("");
  md.push(`**Verdict:** ${report.verdict}`);
  md.push("");
  md.push("## Cold paint");
  md.push("```json");
  md.push(JSON.stringify(summary?.surface, null, 2));
  md.push("```");
  md.push("");
  md.push("## Journal vs Front");
  md.push(`| Metric | Journal | Front |`);
  md.push(`|--------|---------|-------|`);
  md.push(`| Diff FR / recv | ${fr.length} | ${frontRecv.length} |`);
  md.push(`| WireDelivered | ${wd.length} | — |`);
  md.push(`| Resync req | ${rr.length} | ${resyncReqFront.length} |`);
  md.push(`| Resync apply/served | ${rs.length} | ${resyncApplyFront.length} |`);
  md.push(`| SoftNavObserved | ${softNav.length} | — |`);
  md.push(`| ScrollEchoHit | ${echoHit.length} | — |`);
  md.push(`| Desync | — | ${desyncs.length} |`);
  md.push(`| Drop | — | ${drops.length} |`);
  md.push(`| Input Applied | ${applied.length} | — |`);
  md.push(`| GenerationBumped | ${gb.length} | — |`);
  md.push(`| QueueDropped | ${qd.length} | — |`);
  md.push("");
  if (Object.keys(queueDropsByStage).length) {
    md.push("## QueueDropped by stage");
    md.push("```json");
    md.push(JSON.stringify({ byStage: queueDropsByStage, samples: queueDropSamples }, null, 2));
    md.push("```");
    md.push("");
  }
  md.push("## Boot");
  md.push(`- First FR: \`${firstOps.join(" → ")}\``);
  md.push(`- First WD: \`${firstWd.join(" → ")}\``);
  md.push(`- Live before document: **${liveBeforeDoc}**`);
  md.push(`- Gen0 resync: **${report.boot.gen0Resync}**`);
  md.push("");
  md.push("## Bugs");
  for (const b of bugs) {
    md.push(`- **${b.severity} ${b.id}**: ${b.detail}`);
  }
  if (!bugs.length) md.push("- (none)");
  md.push("");
  md.push("## Resync timeline (correlated)");
  for (const [i, row] of resyncTimeline.entries()) {
    md.push(`### #${i + 1} @ ${row.journal.rel}`);
    md.push(
      `- Journal hint gen=${row.journal.hintGeneration} seq=${row.journal.hintSequence}`,
    );
    md.push(
      `- Front desync: ${row.nearestFrontDesync ? `${row.nearestFrontDesync.rel} dt=${row.nearestFrontDesync.dtMs}ms gen=${row.nearestFrontDesync.generation} seq=${row.nearestFrontDesync.sequence} expected=${row.nearestFrontDesync.expectedSequence} reason=${row.nearestFrontDesync.reason}` : "NONE"}`,
    );
    md.push(
      `- Served: ${row.served ? `covers=${row.served.covers} sheets=${row.served.sheets} rules=${row.served.rules}` : "NONE"}`,
    );
    if (row.nearestFrontDesync?.detail) md.push(`- Detail: \`${row.nearestFrontDesync.detail}\``);
  }
  md.push("");
  md.push("## Soft-nav / urlAheadOfDom (observe-only)");
  md.push("```json");
  md.push(JSON.stringify({ softNav: report.softNav, urlAheadOfDom: report.urlAheadOfDom }, null, 2));
  md.push("```");
  md.push("");
  md.push("## CSSOM");
  md.push("```json");
  md.push(JSON.stringify(report.cssom, null, 2));
  md.push("```");
  md.push("");
  md.push("## Input / scroll echo");
  md.push("```json");
  md.push(JSON.stringify(report.inputKinds, null, 2));
  md.push("```");
  md.push("");
  md.push("## Front hop histogram");
  md.push("```json");
  md.push(JSON.stringify(frontByHop, null, 2));
  md.push("```");
  md.push("");
  md.push("## Primary desync hypothesis");
  md.push("```json");
  md.push(JSON.stringify(report.primaryDesyncHypothesis, null, 2));
  md.push("```");

  fs.writeFileSync(path.join(OUT, `${PREFIX}-deep-analysis.md`), md.join("\n"));
  console.log(md.join("\n"));
}

main();
