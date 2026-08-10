/**
 * Analyze bughunt artifacts → named findings.
 * Usage: node analyze-bug-hunt.cjs
 */
const fs = require("fs");
const path = require("path");

const OUT = process.env.OUT_DIR || __dirname;
const PREFIX = "bughunt";

function loadJson(name, fallback) {
  const p = path.join(OUT, name);
  if (!fs.existsSync(p)) return fallback;
  return JSON.parse(fs.readFileSync(p, "utf8"));
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
    .filter((f) => String(f.type || "").endsWith(suffix))
    .map((f) => ({ at: f.publishedAt, ...parsePayload(f) }));
}

const summary = loadJson(`${PREFIX}-summary.json`, {});
const cold = loadJson(`${PREFIX}-cold.json`, {});
const final = loadJson(`${PREFIX}-final.json`, {});
const acts = loadJson(`${PREFIX}-acts.json`, []);
const journal = loadJson(`${PREFIX}-journal-export.json`, { facts: [] });
const facts = journal.facts || [];
const front = loadFront();

const findings = [];

// Framing
const framed = front.find((r) => /Invalid framed length/i.test(String(r.detail || "")));
if (framed || cold.framedErr || final.framedErr) {
  findings.push({
    id: "FRAMED_LENGTH",
    severity: "blocker",
    detail: cold.framedErr || final.framedErr || String(framed.detail || "").slice(0, 200),
  });
}

// Desync
const desyncFront = front.filter((r) => r.fields?.hop === "client_desync");
const firstDesync = desyncFront[0] || (cold.desync ? { fields: cold.desync } : null);
if (firstDesync) {
  const f = firstDesync.fields || {};
  findings.push({
    id: "DESYNC_ADDRESS_MISS",
    severity: "blocker",
    detail: {
      reason: f.errorCode || f.reason || cold.desync?.reason,
      sequence: f.sequence || cold.desync?.seq,
      phase: f.phase || cold.desync?.phase,
      matchCount: f.matchCount || cold.desync?.matchCount,
      selector: f.selectorQuery || f.extra?.selectorQuery || cold.desync?.selector,
      bufferedDrops: front.filter((r) => r.fields?.errorCode === "buffered_while_desynced").length,
    },
  });
}

// Duplicate anchors in projected tree
const dups = final.duplicateAnchors || cold.duplicateAnchors || [];
if (dups.length) {
  findings.push({
    id: "DUPLICATE_ANCHORS",
    severity: "high",
    detail: { count: dups.length, top: dups.slice(0, 10) },
  });
}

// Empty body / no scroll range
if ((final.bodyKids ?? 0) < 15 && (final.textLen ?? 0) < 800) {
  findings.push({
    id: "SPARSE_PROJECTED_TREE",
    severity: "high",
    detail: {
      bodyKids: final.bodyKids,
      textLen: final.textLen,
      htmlLen: final.htmlLen,
      scrollHeight: final.scrollHeight,
      clientHeight: final.clientHeight,
    },
  });
}

if (
  final.scrollHeight != null
  && final.clientHeight != null
  && final.scrollHeight <= final.clientHeight + 2
  && (final.htmlLen || 0) > 5000
) {
  findings.push({
    id: "NO_SCROLL_RANGE",
    severity: "medium",
    detail: { scrollHeight: final.scrollHeight, clientHeight: final.clientHeight },
  });
}

// Input funnel from journal
const cdpDrop = ofFacts(facts, "PageProjection.Input.CdpDropped");
const applied = ofFacts(facts, "PageProjection.Input.Applied");
const echoHit = ofFacts(facts, "PageProjection.Input.ScrollEchoHit");
const genBump = ofFacts(facts, "PageProjection.Diff.GenerationBumped");
const softNav = ofFacts(facts, "PageProjection.Diff.SoftNavObserved");

if (cdpDrop.length) {
  const reasons = {};
  for (const d of cdpDrop) reasons[d.reason || "?"] = (reasons[d.reason || "?"] || 0) + 1;
  findings.push({
    id: "CDP_DROPPED",
    severity: "medium",
    detail: { count: cdpDrop.length, reasons, samples: cdpDrop.slice(0, 8) },
  });
}

const suppress = front.filter((r) => r.fields?.hop === "programmaticSuppress");
const wheelActs = acts.filter((a) => /wheel/i.test(a.name));
const wheelDead = wheelActs.filter((a) => a.delta.scrollTop === 0 && !a.err);
if (wheelActs.length && wheelDead.length === wheelActs.length) {
  findings.push({
    id: "WHEEL_NO_EFFECT",
    severity: "high",
    detail: wheelActs.map((a) => ({
      name: a.name,
      delta: a.delta,
      desyncAfter: !!a.after.desync,
    })),
  });
}

const clickActs = acts.filter((a) => /click/i.test(a.name));
const clickNoop = clickActs.filter(
  (a) => !a.delta.hrefChanged && Math.abs(a.delta.htmlLen) < 50 && !a.delta.textLen && !a.err,
);
if (clickNoop.length) {
  findings.push({
    id: "CLICK_LITTLE_EFFECT",
    severity: "medium",
    detail: clickNoop.map((a) => ({ name: a.name, delta: a.delta, err: a.err })),
  });
}

const actErrs = acts.filter((a) => a.err);
if (actErrs.length) {
  findings.push({
    id: "ACT_ERRORS",
    severity: "medium",
    detail: actErrs.map((a) => ({ name: a.name, err: String(a.err).slice(0, 240) })),
  });
}

// Bundle hint
if (cold.scriptSrc && /BCOpnb2O|old/i.test(cold.scriptSrc)) {
  findings.push({
    id: "STALE_BUNDLE",
    severity: "high",
    detail: cold.scriptSrc,
  });
}

const hopCounts = {};
for (const r of front) {
  const hop = r.fields?.hop || "?";
  hopCounts[hop] = (hopCounts[hop] || 0) + 1;
}

const report = {
  sessionId: summary.sessionId || cold.sessionId,
  coldPhase: summary.coldPhase || cold.phase,
  findings,
  metrics: {
    frontLines: front.length,
    factCount: facts.length,
    appliedInputs: applied.length,
    cdpDropped: cdpDrop.length,
    scrollEchoHit: echoHit.length,
    programmaticSuppress: suppress.length,
    generationBumped: genBump.length,
    softNav: softNav.length,
    hopCounts: Object.fromEntries(
      Object.entries(hopCounts).sort((a, b) => b[1] - a[1]).slice(0, 20),
    ),
    duplicateAnchors: dups.slice(0, 10),
  },
  acts: acts.map((a) => ({
    name: a.name,
    err: a.err,
    delta: a.delta,
    desyncAfter: !!a.after?.desync,
  })),
};

fs.writeFileSync(path.join(OUT, `${PREFIX}-analysis.json`), JSON.stringify(report, null, 2));

const md = [];
md.push("# Bug hunt report");
md.push("");
md.push(`Session: \`${report.sessionId}\` · cold phase: **${report.coldPhase}**`);
md.push("");
md.push("## Findings");
if (!findings.length) md.push("- (none)");
for (const f of findings) {
  md.push(`- **${f.id}** (${f.severity}): \`${JSON.stringify(f.detail).slice(0, 300)}\``);
}
md.push("");
md.push("## Metrics");
md.push("```json");
md.push(JSON.stringify(report.metrics, null, 2));
md.push("```");
md.push("");
md.push("## Acts");
for (const a of report.acts) {
  md.push(
    `- **${a.name}**: Δscroll=${a.delta?.scrollTop} Δhtml=${a.delta?.htmlLen} hrefChanged=${a.delta?.hrefChanged} desyncAfter=${a.desyncAfter} err=${a.err ? "Y" : "N"}`,
  );
}
fs.writeFileSync(path.join(OUT, `${PREFIX}-analysis.md`), md.join("\n"));
console.log(JSON.stringify({ findings: findings.map((f) => ({ id: f.id, severity: f.severity, detail: f.detail })), metrics: report.metrics }, null, 2));
console.log("Wrote", `${PREFIX}-analysis.json`, `${PREFIX}-analysis.md`);
