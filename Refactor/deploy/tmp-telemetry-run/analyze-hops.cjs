const fs = require("fs");
const path = process.env.OUT_DIR;
const items = JSON.parse(fs.readFileSync(path + "/journal-telemetry.json", "utf8"));
const arr = Array.isArray(items) ? items : [items];

function of(type) { return arr.filter((e) => e.type === type); }

const kinds = {};
for (const e of of("Telemetry.Sessions.DomProjection.Input.DataPlaneReceived")) {
  const k = e.payload.kind;
  kinds[k] = (kinds[k] || 0) + 1;
}

// hop latency per traceId
const byTrace = new Map();
for (const e of arr) {
  if (!e.type.includes("DomProjection.Input")) continue;
  const t = e.payload.traceId;
  if (!t) continue;
  const row = byTrace.get(t) || {};
  row[e.type.split(".").pop()] = Date.parse(e.publishedAt);
  row.kind = e.payload.kind;
  row.clientTimestampMs = e.payload.clientTimestampMs;
  byTrace.set(t, row);
}
const latencies = [];
for (const [traceId, row] of byTrace) {
  if (row.DataPlaneReceived && row.Applied) {
    latencies.push({
      traceId,
      kind: row.kind,
      admitToAppliedMs: row.Applied - row.DataPlaneReceived,
      pushToAppliedMs: row.SidecarPushWritten ? row.Applied - row.SidecarPushWritten : null,
      dataToPushMs: row.SidecarPushWritten ? row.SidecarPushWritten - row.DataPlaneReceived : null,
    });
  }
}
latencies.sort((a, b) => b.admitToAppliedMs - a.admitToAppliedMs);
const admit = latencies.map((x) => x.admitToAppliedMs).sort((a, b) => a - b);
const pct = (p) => admit[Math.min(admit.length - 1, Math.floor((p / 100) * admit.length))];

const resizeRejected = of("Telemetry.Sessions.Resize.Rejected").map((e) => e.payload);
const resizeApplied = of("Telemetry.Sessions.Resize.Applied").map((e) => e.payload);
const loc = of("Telemetry.Sessions.Browse.LocationChanged").map((e) => ({ at: e.publishedAt, url: e.payload.url || e.payload.Url }));
const startUrl = of("Telemetry.Sessions.Start.UrlResolved").map((e) => e.payload);

// Diff timestamps vs publishedAt lag
const diffLags = of("Telemetry.Sessions.DomProjection.Diff.FrameReceived").map((e) => {
  const pub = Date.parse(e.publishedAt);
  const ts = e.payload.timestamp;
  return { kind: e.payload.kind, generation: e.payload.generation, sequence: e.payload.sequence, pubMinusTs: pub - ts, ts, pub };
});

const out = {
  inputKinds: kinds,
  hopStats: {
    traces: latencies.length,
    admitToAppliedMs: { min: admit[0], p50: pct(50), p95: pct(95), max: admit[admit.length - 1] },
    slowest: latencies.slice(0, 8),
  },
  resizeRejected,
  resizeApplied,
  locationChanged: loc,
  startUrlResolved: startUrl,
  diffLagSample: diffLags.slice(0, 5),
  noteDiffTimestamp: "payload.timestamp appears epoch-ms; compare carefully with publishedAt timezone",
};
fs.writeFileSync(path + "/analysis-hops.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));