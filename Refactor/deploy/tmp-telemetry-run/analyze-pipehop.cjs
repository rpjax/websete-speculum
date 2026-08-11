const fs = require("fs");
const { buildStory, checkParityDebugComplete } = require("./build-page-epoch-story.cjs");
const j = JSON.parse(fs.readFileSync("pipehop-journal-export.json", "utf8"));
const facts = j.facts || [];

function payload(f) {
  const raw = f.payload;
  if (typeof raw === "string") return JSON.parse(raw);
  return raw || {};
}

function ofType(suffix) {
  return facts
    .filter((f) => (f.type || "").endsWith(suffix) || (f.type || "") === suffix)
    .map((f) => ({ ...payload(f), _schema: f.schemaVersion, _type: f.type }));
}

const OSO = ofType("OutputStreamOpened");
const FE = ofType("FanOutEnqueued");
const SD = ofType("StreamDequeued");
const WD = ofType("WireDelivered");
const QD = ofType("QueueDropped");
const FR = ofType("FrameReceived");

const meta = JSON.parse(fs.readFileSync("pipehop-meta.json", "utf8"));
console.log("session", meta.sessionId);
console.log("counts", {
  FR: FR.length,
  FE: FE.length,
  SD: SD.length,
  WD: WD.length,
  QD: QD.length,
  OutputStreamOpened: OSO.length,
});

console.log("\n--- OutputStreamOpened ---");
OSO.forEach((p) =>
  console.log({
    kind: p.kind,
    streamId: p.streamId,
    consumerId: p.consumerId,
    openStreamCount: p.openStreamCount,
    diffChannelCapacity: p.diffChannelCapacity,
  }),
);

const feKinds = {};
const feBySeq = {};
for (const p of FE) {
  feKinds[p.kind] = (feKinds[p.kind] || 0) + 1;
  feBySeq[p.sequence] = (feBySeq[p.sequence] || 0) + 1;
}
const hist = {};
for (const n of Object.values(feBySeq)) hist[n] = (hist[n] || 0) + 1;
console.log("\nFE by kind", feKinds);
console.log("FE copies/seq histogram", hist);
const s1 = FE.filter((p) => p.sequence === 1);
console.log(
  "seq1 FE",
  s1.map((p) => ({
    kind: p.kind,
    streamId: p.streamId,
    consumerId: p.consumerId,
    targetIndex: p.targetIndex,
    targetCount: p.targetCount,
    diffChannelCount: p.diffChannelCount,
  })),
);

const sdKinds = [...new Set(SD.map((p) => p.kind).filter(Boolean))];
const wdKinds = [...new Set(WD.map((p) => p.kind).filter(Boolean))];
// WireDelivered / StreamDequeued may omit kind — infer from FE stream map
const streamKind = Object.fromEntries(OSO.map((p) => [p.streamId, p.kind]));
const sdKindsInferred = [
  ...new Set(SD.map((p) => streamKind[p.streamId] || p.kind || "unknown")),
];
const wdKindsInferred = [
  ...new Set(WD.map((p) => streamKind[p.streamId] || p.kind || "unknown")),
];
console.log("\nSD kinds", sdKindsInferred, "unique streams", new Set(SD.map((p) => p.streamId)).size);
console.log("WD kinds", wdKindsInferred, "unique streams", new Set(WD.map((p) => p.streamId)).size);

console.log("\n--- QD ---");
QD.forEach((p) =>
  console.log({
    stage: p.stage,
    sequence: p.sequence,
    kind: p.kind,
    streamId: p.streamId,
    consumerId: p.consumerId,
    targetCount: p.targetCount,
    diffChannelCount: p.diffChannelCount,
    capacity: p.capacity,
    reason: p.reason,
  }),
);

const max = (arr) => (arr.length ? Math.max(...arr.map((p) => p.sequence || 0)) : 0);
console.log("\nmaxSeq", { FR: max(FR), FE: max(FE), SD: max(SD), WD: max(WD) });

const RR = ofType("ResyncRequested");
const RS = ofType("ResyncServed");
const initFail = facts.filter((f) => String(f.type || "").endsWith("InitialNavigationFailed"));
const initOk = facts.filter((f) => String(f.type || "").endsWith("InitialNavigationCompleted"));
const resyncDurations = RS.map((p) => Number(p.durationMs || p.DurationMs || 0)).filter((n) => n > 0);
const resyncMaxMs = resyncDurations.length ? Math.max(...resyncDurations) : 0;
console.log("\nResync", { RR: RR.length, RS: RS.length, maxDurationMs: resyncMaxMs });
console.log("InitialNav", { failed: initFail.length, completed: initOk.length });

let frontRows = 0;
let frontSeqMin = null;
let frontSeqMax = null;
let sequenceJump = 0;
let frontRowsParsed = [];
try {
  const lines = fs.readFileSync("pipehop-front-activity.jsonl", "utf8").trim().split(/\n/).filter(Boolean);
  frontRows = lines.length;
  for (const line of lines) {
    const e = JSON.parse(line);
    frontRowsParsed.push(e);
    const hop = e.fields?.hop || e.hop || "";
    if (String(hop).includes("sequence_jump") || e.fields?.reason === "sequence_jump_after_oob") {
      sequenceJump += 1;
    }
    const seq = Number(e.fields?.sequence ?? 0);
    if (seq > 0) {
      frontSeqMin = frontSeqMin == null ? seq : Math.min(frontSeqMin, seq);
      frontSeqMax = frontSeqMax == null ? seq : Math.max(frontSeqMax, seq);
    }
  }
} catch (_) {}
console.log("front", { frontRows, frontSeqMin, frontSeqMax, sequenceJump });

// PageEpoch story + ParityDebug completeness gate (docs/telemetry.md § PageEpoch story).
const pageEpochStory = buildStory({ facts, frontRows: frontRowsParsed });
const parityDebugGate = checkParityDebugComplete(pageEpochStory, facts);
fs.writeFileSync("pipehop-page-epoch-story.json", JSON.stringify(pageEpochStory, null, 2));
console.log("\nParityDebug gate", parityDebugGate);
if (parityDebugGate.gated && !parityDebugGate.ok) {
  console.error("FAIL — ParityDebug pack on but PageEpoch story incomplete:", JSON.stringify(parityDebugGate.incomplete));
}

const openKinds = new Set(OSO.map((p) => p.kind));
const acceptDiffOpened = OSO.length === 0 || openKinds.has("pageProjectionDiff");
const acceptNotificationOpened = OSO.length === 0 || openKinds.has("notification");
const acceptFeDiffOnly =
  Object.keys(feKinds).length === 1 && feKinds.pageProjectionDiff > 0;
const acceptFeOncePerSeq = Object.keys(hist).length === 1 && hist["1"] > 0;
const acceptMuxEqual =
  FR.length > 0 &&
  FR.length === FE.length &&
  FE.length === SD.length &&
  SD.length === WD.length &&
  QD.length === 0;
const acceptSdWdDiffOnly =
  acceptMuxEqual &&
  (sdKindsInferred.every((k) => k === "pageProjectionDiff" || k === "unknown") &&
    wdKindsInferred.every((k) => k === "pageProjectionDiff" || k === "unknown"));
const qdNonDiff = QD.filter((p) => p.kind && p.kind !== "pageProjectionDiff");
const acceptNoNotificationDiffQd = !qdNonDiff.some(
  (p) => p.stage === "api_fanout_backpressure",
);

const stallFixed =
  acceptDiffOpened &&
  acceptNotificationOpened &&
  acceptFeDiffOnly &&
  acceptFeOncePerSeq &&
  acceptSdWdDiffOnly &&
  acceptNoNotificationDiffQd &&
  acceptMuxEqual;

// Absolute 1:1 accept gates (docs/page-projection-acceptance.md) — protocol alone insufficient.
const acceptNoSequenceJump = sequenceJump === 0;
const acceptOobFast = RS.length === 0 || resyncMaxMs < 2500;
const acceptResyncBounded = RS.length <= 2;
const acceptNoInitNavFail = initFail.length === 0;
const acceptFrontCoversBoot = frontRows > 2000 && (frontSeqMin == null || frontSeqMin <= 50);
const acceptParity =
  stallFixed &&
  acceptNoSequenceJump &&
  acceptOobFast &&
  acceptResyncBounded &&
  acceptNoInitNavFail &&
  acceptFrontCoversBoot;

const diagnosis = {
  hypothesisConfirmed: false,
  stallFixed,
  acceptParity,
  acceptDiffOpened,
  acceptNotificationOpened,
  acceptFeDiffOnly,
  acceptFeOncePerSeq,
  acceptSdWdDiffOnly,
  acceptNoNotificationDiffQd,
  acceptNoSequenceJump,
  acceptOobFast,
  acceptResyncBounded,
  acceptNoInitNavFail,
  acceptFrontCoversBoot,
  evidence: {
    outputStreamOpened: OSO.map((p) => ({
      kind: p.kind,
      streamId: p.streamId,
      consumerId: p.consumerId,
      count: p.openStreamCount,
      cap: p.diffChannelCapacity,
    })),
    feByKind: feKinds,
    feCopiesHist: hist,
    sdKinds: sdKindsInferred,
    wdKinds: wdKindsInferred,
    qd: QD,
    maxSeq: { FR: max(FR), FE: max(FE), SD: max(SD), WD: max(WD) },
    resync: { RR: RR.length, RS: RS.length, maxDurationMs: resyncMaxMs },
    initialNav: { failed: initFail.length, completed: initOk.length },
    front: { frontRows, frontSeqMin, frontSeqMax, sequenceJump },
    ratio: {
      FE_over_uniqueSeq: Object.keys(feBySeq).length
        ? FE.length / Object.keys(feBySeq).length
        : 0,
      FR: FR.length,
      SD: SD.length,
      WD: WD.length,
    },
  },
};

diagnosis.parityDebugGate = parityDebugGate;

fs.writeFileSync("pipehop-diagnosis.json", JSON.stringify(diagnosis, null, 2));
console.log("\n=== ACCEPT (stall fixed) ===", stallFixed);
console.log("=== ACCEPT (parity 1:1 gates) ===", acceptParity);
console.log(JSON.stringify(diagnosis, null, 2));
if (!acceptParity) process.exit(2);
if (parityDebugGate.gated && !parityDebugGate.ok) process.exit(3);
process.exit(0);
