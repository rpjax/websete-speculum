const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { labAssetRoots } = require("../dist/browser/mirror/projection/lab/assetRoots");
const { LabChassis } = require("../dist/browser/mirror/projection/lab/host/chassis");
function contentType(file) {
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  return "text/html; charset=utf-8";
}
const EXPR = `(() => {
  const p = globalThis.__speculumProjection;
  const left = document.querySelector("#left");
  const lw = left.contentWindow;
  const cfg = lw.__SPECULUM_PROJECTION__;
  const lines = lw.__speculumBootDiagLines;
  const bootDiag = lw.__speculumBootDiag;
  // childScopes via frameBuilder
  const fb = p.frameBuilder;
  const cs = fb && fb.childScopes;
  let scopeDump = null;
  if (cs) {
    const mapEntries = [];
    // map is private — poke via admit re-check
    const leftId = p.domNodes && null;
    scopeDump = {
      hasContext2: cs.hasContext(2),
      hasContext3: cs.hasContext(3),
      hasContext4: cs.hasContext(4),
      get34: cs.get(34),
      get36: cs.get(36),
      w2: !!cs.windowOf(2, (id) => p.domNodes.get(id)),
      w3: !!cs.windowOf(3, (id) => p.domNodes.get(id)),
    };
  }
  // table row nested hint for left/right
  const row = (id) => {
    try {
      const r = p.table.get(id);
      return r ? { id, keys: Object.keys(r), nested: r.nestedHost || r.childScopeId || r.nested, raw: JSON.parse(JSON.stringify(r, (k,v) => typeof v === "bigint" ? String(v) : v)) } : null;
    } catch (e) { return { err: String(e.message||e) }; }
  };
  // hub size — bus not on api; try frameBuilder
  let busHub = null;
  try {
    // no bus exposed
  } catch (_) {}
  return {
    nestedCfgDiagBoot: cfg && cfg.diagBoot,
    nestedCfgKeys: cfg ? Object.keys(cfg) : null,
    bootDiag,
    bootLines: lines || null,
    scopeDump,
    row34: row(34),
    row36: row(36),
    // describe left element from live
    leftTag: left && left.tagName,
    leftCw: !!(left && left.contentWindow),
  };
})()`;
async function main() {
  process.env.CHROME_EXECUTABLE = process.env.CHROME_EXECUTABLE || "C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe";
  process.env.SPECULUM_DIAG_BOOT = "1";
  const { fixturesDir } = labAssetRoots();
  const server = http.createServer((req, res) => {
    const raw = req.url || "/";
    if (!raw.startsWith("/fixtures/")) { res.writeHead(404).end(); return; }
    const rel = decodeURIComponent(raw.split("?")[0].slice("/fixtures/".length));
    const file = path.join(fixturesDir, rel);
    res.writeHead(200, { "Content-Type": contentType(file) });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = "http://127.0.0.1:" + server.address().port + "/fixtures/iframe-anim.html";
  const chassis = new LabChassis({ headless: true });
  try {
    await chassis.boot({ mode: "browse", url, frameRateHz: 60, telemetry: { enabled: true, diagBoot: true } });
    await new Promise((r) => setTimeout(r, 3000));
    const cdp = chassis.session.cdpSession;
    const r = await cdp.send("Runtime.evaluate", { expression: EXPR, returnByValue: true, awaitPromise: true });
    console.log(JSON.stringify(r.result && r.result.value || r, null, 2));
    if (r.exceptionDetails) console.log("EX", JSON.stringify(r.exceptionDetails, null, 2));
  } finally {
    try { await chassis.disposeVirtual(); } catch (_) {}
    try { await chassis.dispose(); } catch (_) {}
    await new Promise((r) => server.close(r));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
