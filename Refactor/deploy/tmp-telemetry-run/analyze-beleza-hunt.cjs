/**
 * Analyze beleza-* artifacts → telemetry digests for bug notes.
 * Usage: node analyze-beleza-hunt.cjs
 */
const fs = require("fs");
const path = require("path");

const OUT = process.env.OUT_DIR || __dirname;
const PREFIX = "beleza";

function loadJson(name, fallback) {
  const p = path.join(OUT, name);
  if (!fs.existsSync(p)) return fallback;
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

const summary = loadJson(`${PREFIX}-summary.json`, {});
const cold = loadJson(`${PREFIX}-cold.json`, {});
const settled = loadJson(`${PREFIX}-settled.json`, {});
const final = loadJson(`${PREFIX}-final.json`, {});
const early = loadJson(`${PREFIX}-early.json`, {});
const acts = loadJson(`${PREFIX}-acts.json`, []);
const journal = loadJson(`${PREFIX}-journal-export.json`, { facts: [] });
const facts = journal.facts || [];
const netFails = loadJson(`${PREFIX}-net-fails.json`, []);
const consoleTxt = fs.existsSync(path.join(OUT, `${PREFIX}-browser-console.txt`))
  ? fs.readFileSync(path.join(OUT, `${PREFIX}-browser-console.txt`), "utf8")
  : "";

const frontPath = path.join(OUT, `${PREFIX}-front-activity.jsonl`);
const front = fs.existsSync(frontPath)
  ? fs
      .readFileSync(frontPath, "utf8")
      .split(/\n/)
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
  : [];

const typeCounts = {};
for (const f of facts) {
  const t = f.type || "?";
  typeCounts[t] = (typeCounts[t] || 0) + 1;
}

function ofSuffix(suffix) {
  return facts
    .filter((f) => String(f.type || "").endsWith(suffix))
    .map((f) => ({ at: f.publishedAt, ...parsePayload(f) }));
}

const cdpDropped = ofSuffix("PageProjection.Input.CdpDropped");
const rejected = ofSuffix("PageProjection.Input.Rejected");
const admissionDropped = ofSuffix("PageProjection.Input.AdmissionDropped");
const applied = ofSuffix("PageProjection.Input.Applied");
const scrollEcho = ofSuffix("PageProjection.Input.ScrollEchoHit");
const softNav = ofSuffix("PageProjection.Diff.SoftNavObserved");
const genBump = ofSuffix("PageProjection.Diff.GenerationBumped");
const queueDrop = ofSuffix("PageProjection.Diff.QueueDropped");
const resyncReq = ofSuffix("PageProjection.Diff.ResyncRequested");
const resyncServed = ofSuffix("PageProjection.Diff.ResyncServed");
const frameRecv = ofSuffix("PageProjection.Diff.FrameReceived");
const wireDel = ofSuffix("PageProjection.Diff.WireDelivered");

const cdpByReason = {};
for (const x of cdpDropped) {
  const k = `${x.kind || "?"}:${x.reason || "?"}`;
  cdpByReason[k] = (cdpByReason[k] || 0) + 1;
}

const appliedByKind = {};
for (const x of applied) {
  appliedByKind[x.kind || "?"] = (appliedByKind[x.kind || "?"] || 0) + 1;
}

const frameByOp = {};
for (const x of frameRecv) {
  const k = `${x.plane || "?"}/${x.operation || "?"}`;
  frameByOp[k] = (frameByOp[k] || 0) + 1;
}

const hopCounts = {};
const desyncFront = [];
const framedFront = [];
const buffered = [];
for (const r of front) {
  const h = r.fields?.hop || "?";
  hopCounts[h] = (hopCounts[h] || 0) + 1;
  if (h === "client_desync") {
    desyncFront.push({
      reason: r.fields?.errorCode || r.fields?.reason,
      seq: r.fields?.sequence,
      phase: r.fields?.phase,
      matchCount: r.fields?.matchCount,
      detail: String(r.detail || "").slice(0, 400),
    });
  }
  if (/Invalid framed length/i.test(String(r.detail || ""))) {
    framedFront.push(String(r.detail || "").slice(0, 200));
  }
  if (r.fields?.errorCode === "buffered_while_desynced") {
    buffered.push(r.fields?.sequence);
  }
}

const netByStatus = {};
for (const n of netFails) {
  netByStatus[n.status] = (netByStatus[n.status] || 0) + 1;
}

const digest = {
  sessionId: summary.sessionId,
  early,
  coldPhase: cold.phase,
  cold: {
    phase: cold.phase,
    waitedMs: cold.waitedMs,
    sawDenied: cold.sawDenied,
    deniedClearedAt: cold.deniedClearedAt,
    accessDenied: cold.accessDenied,
    htmlLen: cold.htmlLen,
    textLen: cold.textLen,
    ownedRules: cold.ownedRules,
    desync: cold.desync,
    framedErr: cold.framedErr,
    dups: cold.duplicateAnchors,
    brokenImgs: cold.brokenImgs,
    virtualData1x1: cold.virtualData1x1,
    text: (cold.text || "").slice(0, 240),
  },
  settled: {
    htmlLen: settled.htmlLen,
    textLen: settled.textLen,
    ownedRules: settled.ownedRules,
    accessDenied: settled.accessDenied,
    desync: settled.desync,
    dups: settled.duplicateAnchors,
    brokenImgs: settled.brokenImgs,
    virtualData1x1: settled.virtualData1x1,
    scrollHeight: settled.scrollHeight,
    clientHeight: settled.clientHeight,
    text: (settled.text || "").slice(0, 240),
  },
  final: {
    htmlLen: final.htmlLen,
    textLen: final.textLen,
    desync: final.desync,
    desyncs: final.desyncs,
    dups: final.duplicateAnchors,
    accessDenied: final.accessDenied,
    brokenImgs: final.brokenImgs,
    virtualData1x1: final.virtualData1x1,
    text: (final.text || "").slice(0, 240),
  },
  acts: acts.map((a) => ({
    name: a.name,
    delta: a.delta,
    err: a.err ? a.err.slice(0, 200) : null,
    desyncAfter: a.after?.desync || null,
  })),
  telemetry: {
    factCount: facts.length,
    typeCounts: Object.fromEntries(
      Object.entries(typeCounts).sort((a, b) => b[1] - a[1]),
    ),
    frameRecv: frameRecv.length,
    wireDel: wireDel.length,
    frameByOp,
    softNav: softNav.map((x) => ({
      url: x.url,
      gen: x.generation,
      liveArmed: x.liveArmed,
      epoch: x.documentEpoch,
    })),
    generationBumped: genBump,
    queueDropped: queueDrop,
    resyncRequested: resyncReq.length,
    resyncServed: resyncServed.length,
    applied: applied.length,
    appliedByKind,
    cdpDropped: cdpDropped.length,
    cdpByReason,
    cdpSamples: cdpDropped.slice(0, 12),
    rejected: rejected.length,
    admissionDropped: admissionDropped.length,
    scrollEcho,
  },
  front: {
    lines: front.length,
    hopCounts,
    desyncCount: desyncFront.length,
    desyncSamples: desyncFront.slice(0, 10),
    bufferedWhileDesynced: buffered.length,
    framed: framedFront.slice(0, 5),
  },
  netFails: { count: netFails.length, byStatus: netByStatus, samples: netFails.slice(0, 20) },
  consoleWarnings: consoleTxt
    .split(/\n/)
    .filter(Boolean)
    .slice(0, 40),
};

fs.writeFileSync(path.join(OUT, `${PREFIX}-digest.json`), JSON.stringify(digest, null, 2));
console.log(JSON.stringify(digest, null, 2));
console.log("Wrote", `${PREFIX}-digest.json`);
