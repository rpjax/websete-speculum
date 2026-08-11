/**
 * Diagnose a PREFIX smoke run: journal + front hops → T8 / SoftNav / stall verdict.
 * Usage: node diagnose-smoke.cjs [prefix]
 */
const fs = require("fs");
const path = require("path");
const { buildStory, checkParityDebugComplete } = require("./build-page-epoch-story.cjs");

const OUT = process.env.OUT_DIR || __dirname;
const PREFIX = process.argv[2] || process.env.PREFIX || "fullsmoke3";

function loadJson(name) {
  const p = path.join(OUT, name);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function loadFront(label) {
  const p = path.join(OUT, `${PREFIX}-${label}-front-activity.jsonl`);
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, "utf8")
    .trim()
    .split(/\n+/)
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function payload(f) {
  const p = f.payload ?? f.Payload;
  if (p == null) return {};
  if (typeof p === "object") return p;
  try {
    return JSON.parse(p);
  } catch {
    return {};
  }
}

function journalDiag(label) {
  const j = loadJson(`${PREFIX}-${label}-journal-export.json`);
  if (!j) return { missing: true };
  const facts = j.facts || [];
  const by = (suf) => facts.filter((f) => String(f.type || "").endsWith(suf));
  const count = (suf) => by(suf).length;
  const maxSeq = (suf) =>
    by(suf).reduce((m, f) => Math.max(m, Number(payload(f).sequence ?? payload(f).seq ?? 0) || 0), 0);
  const qd = by("PageProjection.Diff.QueueDropped");
  const stages = {};
  for (const f of qd) {
    const st = String(payload(f).stage || "?");
    stages[st] = (stages[st] || 0) + 1;
  }
  const fr = count("PageProjection.Diff.FrameReceived");
  const wd = count("PageProjection.Diff.WireDelivered");
  const frMax = maxSeq("PageProjection.Diff.FrameReceived");
  const wdMax = maxSeq("PageProjection.Diff.WireDelivered");
  const resyncReq = count("PageProjection.Diff.ResyncRequested");
  const resyncServed = count("PageProjection.Diff.ResyncServed");
  const softNav = count("PageProjection.Diff.SoftNavObserved");
  const genBump = count("PageProjection.Diff.GenerationBumped");
  const qdN = qd.length;
  const silentStall = frMax > wdMax + 256 && qdN === 0 && wdMax > 0;
  const cutAtFanOut = wdMax > 0 && wdMax <= 256 && frMax > wdMax + 64;
  // After QD: ResyncServed is required — WD>256 alone masks stuck-desync (Beleza fullsmoke3).
  const recovered = !silentStall && (qdN === 0 || resyncServed > 0);
  return {
    facts: facts.length,
    FrameReceived: fr,
    WireDelivered: wd,
    FrameReceivedMaxSeq: frMax,
    WireDeliveredMaxSeq: wdMax,
    FrMinusWd: fr - wd,
    QueueDropped: qdN,
    QueueDroppedStages: stages,
    SoftNavObserved: softNav,
    ResyncRequested: resyncReq,
    ResyncServed: resyncServed,
    GenerationBumped: genBump,
    silentStall,
    cutAtFanOut,
    recovered,
  };
}

function frontDiag(label) {
  const rows = loadFront(label);
  const hops = {};
  const desyncs = [];
  const resyncFails = [];
  let sessionId = null;
  for (const r of rows) {
    const hop = r.fields?.hop || r.hop || "?";
    hops[hop] = (hops[hop] || 0) + 1;
    const sid = r.fields?.sessionId || r.sessionId;
    if (sid) sessionId = sid;
    if (hop === "client_desync") {
      desyncs.push({
        reason: r.fields?.reason || r.fields?.errorCode,
        seq: r.fields?.sequence,
        expected: r.fields?.expectedSequence,
      });
    }
    if (hop === "client_resync_failed") {
      resyncFails.push({
        httpStatus: r.fields?.extra?.httpStatus ?? r.fields?.httpStatus,
        errorCode: r.fields?.extra?.errorCode,
        expected: r.fields?.expectedSequence,
      });
    }
  }
  const measure = loadJson(`${PREFIX}-${label}-measure.json`) || {};
  return {
    sessionId: measure.sessionId || sessionId,
    rowCount: rows.length,
    hops,
    desyncs,
    resyncFails,
    addressMiss: desyncs.filter((d) => d.reason === "address_miss").length,
    queueDroppedDesync: desyncs.filter((d) => d.reason === "queue_dropped").length,
    wireStallDesync: desyncs.filter((d) => d.reason === "wire_stall").length,
    ownedRules: measure.ownedRules ?? null,
    htmlLen: measure.htmlLen ?? null,
    textLen: measure.textLen ?? null,
    brokenImgs: measure.brokenImgs ?? null,
    virtualData1x1: measure.virtualData1x1 ?? null,
    accessDenied: measure.accessDenied ?? null,
    textSample: (measure.text || "").slice(0, 160),
  };
}

function pageEpochStoryFor(label) {
  const j = loadJson(`${PREFIX}-${label}-journal-export.json`);
  const facts = j?.facts || [];
  const frontRows = loadFront(label);
  const story = buildStory({ facts, frontRows });
  const gate = checkParityDebugComplete(story, facts);
  return { story, gate };
}

function siteVerdict(label, j, f, pageEpochGate) {
  const issues = [];
  const ok = [];
  if (j.missing) issues.push("journal_missing");
  if (pageEpochGate?.gated && !pageEpochGate.ok) {
    issues.push(`PARITY_DEBUG_STORY_INCOMPLETE×${pageEpochGate.incomplete.length}`);
  }
  if (j.silentStall) issues.push("SILENT_STALL_FR_GT_WD_QD0");
  if (j.cutAtFanOut && !j.recovered) issues.push("CUT_AT_256_NO_RECOVERY");
  if (j.QueueDropped > 0 && (j.ResyncServed || 0) === 0) {
    issues.push("QD_WITHOUT_RESYNC_SERVED");
  }
  if (f.resyncFails.length > 0 && (f.hops.client_resync_apply || 0) === 0) {
    issues.push("RESYNC_FAILED_WITHOUT_APPLY");
  }
  if ((f.ownedRules || 0) < 20 || (f.htmlLen || 0) < 20000) issues.push("SURFACE_THIN_OR_EMPTY");
  if (f.accessDenied) issues.push("ACCESS_DENIED");
  if (f.addressMiss > 0) issues.push("ADDRESS_MISS_DESYNC");
  if ((j.GenerationBumped || 0) > 0 && label === "eneba") issues.push("UNEXPECTED_GENERATION_BUMP");
  if (f.resyncFails.length > 0) issues.push(`RESYNC_FAILED×${f.resyncFails.length}`);
  if ((f.hops.sequence_jump_after_oob || 0) > 0 || (f.hops.client_drop && String(JSON.stringify(f)).includes("sequence_jump"))) {
    issues.push("SEQUENCE_JUMP_ADHOC");
  }
  if ((j.ResyncServed || 0) > 2) issues.push(`RESYNC_CASCADE×${j.ResyncServed}`);
  if ((f.brokenImgs || 0) > 0 && (f.htmlLen || 0) > 20000) {
    // First-viewport broken chrome is a parity fail; lazy below-fold alone is softer —
    // still fail when brokenImgs is a large share of visible surface.
    const imgShare = f.brokenImgs;
    if (imgShare >= 5) issues.push(`BROKEN_IMGS×${imgShare}`);
  }
  const armed = (f.hops.client_arm || 0) > 0 && (f.hops.client_disarm || 0) <= (f.hops.client_arm || 0);
  if ((f.htmlLen || 0) > 20000 && !armed && (f.hops.client_disarm || 0) > (f.hops.client_arm || 0)) {
    issues.push("ARMED_FALSE_AT_SETTLE");
  }
  if ((f.hops.client_apply || 0) > 0 && (f.hops.client_recv || 0) > (f.hops.client_apply || 0) * 3) {
    issues.push("APPLY_FAR_BEHIND_RECV");
  }

  if (!j.silentStall) ok.push("no_silent_stall");
  if (j.recovered) ok.push("t8_recovered_or_no_cut");
  if ((j.GenerationBumped || 0) === 0) ok.push("generation_bumped_0");
  if (f.addressMiss === 0) ok.push("no_address_miss");
  if ((f.ownedRules || 0) >= 20 && (f.htmlLen || 0) >= 20000) ok.push("surface_populated");
  if (label === "eneba" && (j.SoftNavObserved || 0) >= 1) ok.push("softnav_observed");
  if ((j.QueueDropped || 0) > 0 && (j.ResyncServed || 0) > 0) {
    ok.push("qd_then_resync_served");
  }
  if ((f.hops.client_resync_apply || 0) > 0) ok.push("client_resync_apply");
  if (pageEpochGate?.gated && pageEpochGate.ok) ok.push("parity_debug_story_complete");

  return {
    pass: issues.length === 0,
    issues,
    ok,
  };
}

const summary = loadJson(`${PREFIX}-summary.json`);
const sites = ["beleza", "eneba"];
const report = {
  prefix: PREFIX,
  since: summary?.since || null,
  acceptScript: summary?.accept || null,
  sites: {},
};

for (const label of sites) {
  const j = journalDiag(label);
  const f = frontDiag(label);
  const { story, gate } = pageEpochStoryFor(label);
  fs.writeFileSync(
    path.join(OUT, `${PREFIX}-${label}-page-epoch-story.json`),
    JSON.stringify(story, null, 2),
  );
  report.sites[label] = {
    journal: j,
    front: f,
    pageEpochGate: gate,
    verdict: siteVerdict(label, j, f, gate),
  };
}

const allPass = sites.every((s) => report.sites[s].verdict.pass);
report.overall = {
  pass: allPass,
  headline: allPass
    ? "PASS — T8 recovery holds; SoftNav without mid-wipe void; no silent FR≫WD"
    : "FAIL — see per-site issues",
};

const outPath = path.join(OUT, `${PREFIX}-diagnosis.json`);
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

const md = [];
md.push(`# Diagnosis — ${PREFIX}`);
md.push("");
md.push(`**Overall:** ${report.overall.headline}`);
md.push("");
if (summary?.accept) {
  md.push("## Script accept");
  md.push("```");
  md.push(JSON.stringify(summary.accept, null, 2));
  md.push("```");
  md.push("");
}
for (const label of sites) {
  const s = report.sites[label];
  md.push(`## ${label}`);
  md.push("");
  md.push(`- sessionId: \`${s.front.sessionId || "?"}\``);
  md.push(`- verdict: **${s.verdict.pass ? "PASS" : "FAIL"}**`);
  if (s.verdict.issues.length) md.push(`- issues: ${s.verdict.issues.join(", ")}`);
  if (s.verdict.ok.length) md.push(`- ok: ${s.verdict.ok.join(", ")}`);
  md.push("");
  md.push("| Metric | Value |");
  md.push("|--------|-------|");
  const j = s.journal;
  if (!j.missing) {
    md.push(`| FR / WD | ${j.FrameReceived} / ${j.WireDelivered} |`);
    md.push(`| FR maxSeq / WD maxSeq | ${j.FrameReceivedMaxSeq} / ${j.WireDeliveredMaxSeq} |`);
    md.push(`| QueueDropped | ${j.QueueDropped} \`${JSON.stringify(j.QueueDroppedStages)}\` |`);
    md.push(`| ResyncReq / Served | ${j.ResyncRequested} / ${j.ResyncServed} |`);
    md.push(`| SoftNav / GenBump | ${j.SoftNavObserved} / ${j.GenerationBumped} |`);
  } else {
    md.push(`| journal | missing |`);
  }
  md.push(`| ownedRules / htmlLen | ${s.front.ownedRules} / ${s.front.htmlLen} |`);
  md.push(`| desyncs | qd=${s.front.queueDroppedDesync} stall=${s.front.wireStallDesync} miss=${s.front.addressMiss} |`);
  md.push(
    `| hops resync | req=${s.front.hops.client_resync_request || 0} apply=${s.front.hops.client_resync_apply || 0} fail=${s.front.hops.client_resync_failed || 0} |`,
  );
  if (s.front.resyncFails.length) {
    md.push(`| resync fails | ${JSON.stringify(s.front.resyncFails)} |`);
  }
  md.push("");
  if (s.front.textSample) {
    md.push(`Text sample: \`${s.front.textSample.replace(/\n/g, " ").slice(0, 120)}\``);
    md.push("");
  }
}

md.push("## Reading");
md.push("");
md.push("- **T8 OK** when QD>0 implies **ResyncServed≥1** (and ideally client_resync_apply), with populated surface.");
md.push("- **Silent stall** when FR≫WD, WD>0, QD=0 (forbidden).");
md.push("- **SoftNav void** when SoftNavObserved≥1 but ownedRules/htmlLen collapse after cut without resync.");
md.push("- WD>256 alone is **not** recovery if ResyncServed=0 (stuck desync / buffered_while_desynced).");
md.push("");

const mdPath = path.join(OUT, `${PREFIX}-diagnosis.md`);
fs.writeFileSync(mdPath, md.join("\n"));
console.log(JSON.stringify(report.overall, null, 2));
console.log(md.join("\n"));
console.log("WROTE", outPath);
console.log("WROTE", mdPath);
if (!report.overall.pass) process.exit(1);
