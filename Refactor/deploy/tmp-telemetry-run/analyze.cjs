const fs = require("fs");
const path = process.env.OUT_DIR;
const tel = JSON.parse(fs.readFileSync(path + "/journal-telemetry.json", "utf8"));
const sess = JSON.parse(fs.readFileSync(path + "/journal-sessions.json", "utf8"));
const items = Array.isArray(tel) ? tel : [tel];
const sessions = Array.isArray(sess) ? sess : [sess];

const byType = {};
for (const e of items) byType[e.type] = (byType[e.type] || 0) + 1;

const sessionIds = new Set();
for (const e of items) {
  const sid = e.indexKeys?.session || e.payload?.sessionId || e.payload?.SessionId;
  if (sid) sessionIds.add(sid);
}

function payloads(type) {
  return items.filter((e) => e.type === type).map((e) => ({
    at: e.publishedAt,
    seq: e.sequence,
    schema: e.schemaVersion,
    payload: e.payload,
  }));
}

const diff = payloads("Telemetry.Sessions.DomProjection.Diff.FrameReceived");
const domIn = [
  ...payloads("Telemetry.Sessions.DomProjection.Input.DataPlaneReceived"),
  ...payloads("Telemetry.Sessions.DomProjection.Input.SidecarPushWritten"),
  ...payloads("Telemetry.Sessions.DomProjection.Input.Applied"),
  ...payloads("Telemetry.Sessions.DomProjection.Input.Rejected"),
];
const vsi = items.filter((e) => e.type.includes("VideoStreamingInput"));
const rejected = items.filter((e) => /Rejected|Failed|Fault/i.test(e.type));

// Diff sequence analysis
const diffSorted = [...diff].sort((a, b) => (a.payload?.sequence ?? 0) - (b.payload?.sequence ?? 0));
const gaps = [];
let lastSeq = null;
let lastGen = null;
const genBumps = [];
for (const d of diffSorted) {
  const s = d.payload?.sequence ?? d.payload?.Sequence;
  const g = d.payload?.generation ?? d.payload?.Generation;
  if (lastSeq != null && s != null && s > lastSeq + 1) gaps.push({ from: lastSeq, to: s, at: d.at });
  if (lastGen != null && g != null && g !== lastGen) genBumps.push({ from: lastGen, to: g, at: d.at, seq: s });
  lastSeq = s ?? lastSeq;
  lastGen = g ?? lastGen;
}

const kinds = {};
for (const d of diff) {
  const k = d.payload?.kind || d.payload?.Kind || "?";
  kinds[k] = (kinds[k] || 0) + 1;
}

const withTrace = items.filter((e) => e.payload?.traceId || e.payload?.TraceId).length;
const withClientTs = items.filter((e) => e.payload?.clientTimestampMs != null || e.payload?.ClientTimestampMs != null).length;
const withDiffTs = diff.filter((e) => e.payload?.timestamp != null || e.payload?.Timestamp != null).length;

// Input path correlation samples
const sampleDom = payloads("Telemetry.Sessions.DomProjection.Input.DataPlaneReceived").slice(0, 5);
const sampleApplied = payloads("Telemetry.Sessions.DomProjection.Input.Applied").slice(0, 5);
const sampleDiff = diff.slice(0, 3).concat(diff.slice(-3));

const report = {
  totals: { telemetryFacts: items.length, sessionFacts: sessions.length, sessionIds: [...sessionIds] },
  byType: Object.fromEntries(Object.entries(byType).sort((a, b) => b[1] - a[1])),
  diff: {
    count: diff.length,
    kinds,
    gaps,
    genBumps,
    withTimestamp: withDiffTs,
    first: diffSorted[0]?.payload,
    last: diffSorted[diffSorted.length - 1]?.payload,
  },
  domInput: {
    dataPlane: byType["Telemetry.Sessions.DomProjection.Input.DataPlaneReceived"] || 0,
    push: byType["Telemetry.Sessions.DomProjection.Input.SidecarPushWritten"] || 0,
    applied: byType["Telemetry.Sessions.DomProjection.Input.Applied"] || 0,
    rejected: byType["Telemetry.Sessions.DomProjection.Input.Rejected"] || 0,
    samples: { dataPlane: sampleDom, applied: sampleApplied },
  },
  videoStreamingInputCount: vsi.length,
  rejectedOrFault: rejected.map((e) => ({ type: e.type, at: e.publishedAt, payload: e.payload })),
  correlation: { factsWithTraceId: withTrace, factsWithClientTimestampMs: withClientTs },
  sessionNarrative: sessions.map((e) => ({ type: e.type, at: e.publishedAt, payload: e.payload })),
  sampleDiff,
};

fs.writeFileSync(path + "/analysis-summary.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));