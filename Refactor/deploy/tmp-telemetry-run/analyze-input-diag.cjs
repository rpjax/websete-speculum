/**
 * Analyze input-focused diag harvest (journal + front + acts).
 * Usage: node analyze-input-diag.cjs
 */
const fs = require("fs");
const path = require("path");

const OUT = process.env.OUT_DIR || __dirname;
const PREFIX = "input";

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
    .filter((f) => String(f.type || f.Type || "").endsWith(suffix))
    .map((f) => ({ at: f.publishedAt || f.PublishedAt, ...parsePayload(f) }));
}

function loadFront() {
  const p = path.join(OUT, `${PREFIX}-front-activity.jsonl`);
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, "utf8")
    .split(/\n/)
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

function loadJournal() {
  const p = path.join(OUT, `${PREFIX}-journal-export.json`);
  if (!fs.existsSync(p)) return [];
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  return j.facts || [];
}

function loadActs() {
  const p = path.join(OUT, `${PREFIX}-acts.json`);
  if (!fs.existsSync(p)) return [];
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function countBy(arr, keyFn) {
  const m = {};
  for (const x of arr) {
    const k = keyFn(x) || "(none)";
    m[k] = (m[k] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]));
}

const facts = loadJournal();
const front = loadFront();
const acts = loadActs();

const dp = ofFacts(facts, "PageProjection.Input.DataPlaneReceived");
const applied = ofFacts(facts, "PageProjection.Input.Applied");
const pushed = ofFacts(facts, "PageProjection.Input.SidecarPushWritten");
const admitted = ofFacts(facts, "PageProjection.Input.SidecarAdmitted");
const cdpDrop = ofFacts(facts, "PageProjection.Input.CdpDropped");
const rejected = ofFacts(facts, "PageProjection.Input.Rejected");
const admissionDrop = ofFacts(facts, "PageProjection.Input.AdmissionDropped");
const echoHit = ofFacts(facts, "PageProjection.Input.ScrollEchoHit");
const fr = ofFacts(facts, "PageProjection.Diff.FrameReceived");
const softNav = ofFacts(facts, "PageProjection.Diff.SoftNavObserved");

const clientSent = front.filter(
  (e) => e.fields?.hop === "client_sent" && e.fields?.plane === "pageProjectionIntent",
);
const suppress = front.filter((e) => e.fields?.hop === "programmaticSuppress");
const desync = front.filter((e) => e.fields?.hop === "client_desync");
const scrollDiff = fr.filter((e) => /scroll/i.test(String(e.operation || "")));

const funnel = {
  client_sent: clientSent.length,
  DataPlaneReceived: dp.length,
  SidecarPushWritten: pushed.length,
  SidecarAdmitted: admitted.length,
  Applied: applied.length,
  CdpDropped: cdpDrop.length,
  Rejected: rejected.length,
  AdmissionDropped: admissionDrop.length,
  ScrollEchoHit: echoHit.length,
  programmaticSuppress: suppress.length,
};

const kindFunnel = {};
for (const e of clientSent) {
  const k = e.fields?.kind || "?";
  kindFunnel[k] = kindFunnel[k] || {
    client_sent: 0,
    dataPlane: 0,
    applied: 0,
    admitted: 0,
    cdpDropped: 0,
  };
  kindFunnel[k].client_sent += 1;
}
for (const e of dp) {
  const k = e.kind || e.Kind || "?";
  kindFunnel[k] = kindFunnel[k] || {
    client_sent: 0,
    dataPlane: 0,
    applied: 0,
    admitted: 0,
    cdpDropped: 0,
  };
  kindFunnel[k].dataPlane += 1;
}
for (const e of applied) {
  const k = e.kind || e.Kind || "?";
  kindFunnel[k] = kindFunnel[k] || {
    client_sent: 0,
    dataPlane: 0,
    applied: 0,
    admitted: 0,
    cdpDropped: 0,
  };
  kindFunnel[k].applied += 1;
}
for (const e of admitted) {
  const k = e.kind || e.Kind || "?";
  kindFunnel[k] = kindFunnel[k] || {
    client_sent: 0,
    dataPlane: 0,
    applied: 0,
    admitted: 0,
    cdpDropped: 0,
  };
  kindFunnel[k].admitted += 1;
}
for (const e of cdpDrop) {
  const k = e.kind || e.Kind || "?";
  kindFunnel[k] = kindFunnel[k] || {
    client_sent: 0,
    dataPlane: 0,
    applied: 0,
    admitted: 0,
    cdpDropped: 0,
  };
  kindFunnel[k].cdpDropped += 1;
}

const findings = [];

// Leak / drop ratios
if (clientSent.length > 0 && dp.length < clientSent.length * 0.5) {
  findings.push({
    id: "FUNNEL_LOSS_BEFORE_DATAPLANE",
    detail: `client_sent=${clientSent.length} dataPlane=${dp.length}`,
  });
}
if (dp.length > 0 && applied.length < dp.length * 0.5) {
  findings.push({
    id: "FUNNEL_LOSS_BEFORE_APPLIED",
    detail: `dataPlane=${dp.length} applied=${applied.length}`,
  });
}
if (cdpDrop.length > 0) {
  findings.push({
    id: "CDP_DROPPED",
    detail: `${cdpDrop.length} drops; reasons=${JSON.stringify(countBy(cdpDrop, (e) => e.reason || e.Reason))}`,
  });
}
if (rejected.length > 0) {
  findings.push({
    id: "INPUT_REJECTED",
    detail: `${rejected.length}; ${JSON.stringify(rejected.slice(0, 5).map((e) => ({ code: e.errorCode, phase: e.phase, kind: e.kind })))}`,
  });
}

const wheelSent = clientSent.filter((e) => e.fields?.kind === "wheel").length;
const scrollVpSent = clientSent.filter((e) => e.fields?.kind === "scrollViewport").length;
const scrollElSent = clientSent.filter((e) => e.fields?.kind === "scrollElement").length;
const scrollDiffN = scrollDiff.length;
if (wheelSent + scrollVpSent > 0 && scrollDiffN > (wheelSent + scrollVpSent) * 3) {
  findings.push({
    id: "SCROLL_DIFF_STORM",
    detail: `intents wheel=${wheelSent} scrollVp=${scrollVpSent} scrollEl=${scrollElSent} suppress=${suppress.length} echoHit=${echoHit.length} diffScroll=${scrollDiffN}`,
  });
}
if (wheelSent > 0 && scrollVpSent === 0 && scrollDiffN === 0) {
  findings.push({
    id: "WHEEL_NO_EFFECT",
    detail: `wheel intents=${wheelSent} but no scrollViewport intent and no Diff scroll`,
  });
}

const clickish = clientSent.filter((e) =>
  /mousedown|mouseup|click|pressed|released/i.test(String(e.fields?.kind || "")),
);
const clickActs = acts.filter((a) => /click/i.test(a.name));
const clickNoDom = clickActs.filter((a) => !a.delta?.textChanged && !a.delta?.hrefChanged && Math.abs(a.delta?.htmlLen || 0) < 500);
if (clickNoDom.length >= 2) {
  findings.push({
    id: "CLICKS_LITTLE_DOM_EFFECT",
    detail: clickNoDom.map((a) => `${a.name} intents=${a.front?.intentLabels?.length} Δhtml=${a.delta?.htmlLen}`).join("; "),
  });
}

const enterAct = acts.find((a) => a.name === "search_enter");
if (enterAct && !enterAct.delta?.hrefChanged && softNav.length === 0) {
  findings.push({
    id: "SEARCH_ENTER_NO_SOFTNAV",
    detail: `enter Δtext=${enterAct.delta?.textChanged} Δhtml=${enterAct.delta?.htmlLen} softNav=${softNav.length}`,
  });
}

const report = {
  sessionId: acts[0]?.front ? undefined : undefined,
  funnel,
  kindsClientSent: countBy(clientSent, (e) => e.fields?.kind),
  kindsDataPlane: countBy(dp, (e) => e.kind || e.Kind),
  kindsApplied: countBy(applied, (e) => e.kind || e.Kind),
  kindsAdmitted: countBy(admitted, (e) => e.kind || e.Kind),
  kindsCdpDropped: countBy(cdpDrop, (e) => e.kind || e.Kind),
  cdpDropReasons: countBy(cdpDrop, (e) => e.reason || e.Reason),
  kindFunnel,
  scroll: {
    wheelSent,
    scrollViewportSent: scrollVpSent,
    scrollElementSent: scrollElSent,
    programmaticSuppress: suppress.length,
    scrollEchoHit: echoHit.length,
    diffScrollOps: scrollDiffN,
    echoSamples: echoHit.slice(0, 5),
    suppressSamples: suppress.slice(0, 5).map((e) => ({
      target: e.fields?.target,
      gen: e.fields?.generation,
    })),
  },
  softNav: {
    observed: softNav.length,
    samples: softNav.slice(0, 5).map((e) => ({
      url: e.url || e.Url,
      gen: e.generation ?? e.Generation,
      armed: e.liveArmed ?? e.LiveArmed,
    })),
  },
  desync: {
    count: desync.length,
    reasons: countBy(desync, (e) => e.fields?.errorCode || e.fields?.reason),
  },
  acts: acts.map((a) => ({
    name: a.name,
    err: a.err,
    delta: a.delta,
    intentKinds: (a.front?.intentLabels || []).map((x) => x.kind || x.hop || x.label),
    intentCount: a.front?.intentLabels?.length || 0,
  })),
  clickishSent: clickish.length,
  findings,
  cdpDropSamples: cdpDrop.slice(0, 12).map((e) => ({
    kind: e.kind || e.Kind,
    reason: e.reason || e.Reason,
    gen: e.generation ?? e.Generation,
    anchor: e.anchor || e.Anchor,
    phase: e.phase || e.Phase,
  })),
  rejectedSamples: rejected.slice(0, 8),
};

fs.writeFileSync(path.join(OUT, `${PREFIX}-analysis.json`), JSON.stringify(report, null, 2));

const md = [];
md.push(`# Input telemetry diagnosis`);
md.push("");
md.push("## Funnel");
md.push("```json");
md.push(JSON.stringify(funnel, null, 2));
md.push("```");
md.push("");
md.push("## Kind funnel");
md.push("```json");
md.push(JSON.stringify(kindFunnel, null, 2));
md.push("```");
md.push("");
md.push("## Scroll");
md.push("```json");
md.push(JSON.stringify(report.scroll, null, 2));
md.push("```");
md.push("");
md.push("## Soft-nav");
md.push("```json");
md.push(JSON.stringify(report.softNav, null, 2));
md.push("```");
md.push("");
md.push("## Per-act effects");
for (const a of report.acts) {
  md.push(
    `- **${a.name}**: Δscroll=${a.delta?.scrollTop} Δhtml=${a.delta?.htmlLen} textChanged=${a.delta?.textChanged} hrefChanged=${a.delta?.hrefChanged} intents=[${(a.intentKinds || []).join(", ")}]${a.err ? ` ERR=${a.err}` : ""}`,
  );
}
md.push("");
md.push("## Findings");
if (!findings.length) md.push("- (none automated)");
for (const f of findings) md.push(`- **${f.id}**: ${f.detail}`);
md.push("");
md.push("## CdpDropped samples");
md.push("```json");
md.push(JSON.stringify(report.cdpDropSamples, null, 2));
md.push("```");
fs.writeFileSync(path.join(OUT, `${PREFIX}-analysis.md`), md.join("\n"));

console.log(JSON.stringify({ funnel, findings, kindFunnel, scroll: report.scroll, softNav: report.softNav }, null, 2));
console.log("Wrote", `${PREFIX}-analysis.json`, `${PREFIX}-analysis.md`);
