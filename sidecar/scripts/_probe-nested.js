const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { labAssetRoots } = require("../dist/browser/mirror/projection/lab/assetRoots");
const { LabChassis } = require("../dist/browser/mirror/projection/lab/host/chassis");
function contentType(file) {
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  return "text/html; charset=utf-8";
}
const CHILD_PROBE = `(() => {
  const probeWin = (w) => {
    if (!w) return { err: "no-window" };
    try {
      return {
        href: w.location.href,
        hasProj: !!w.__speculumProjection,
        hasConfig: !!w.__SPECULUM_PROJECTION__,
        hasReady: w.__SPECULUM_PROJECTION_READY__ !== undefined,
        hasUpward: !!w.__speculumProjectionUpward,
        ctx: w.__speculumProjection && w.__speculumProjection.contextId != null ? w.__speculumProjection.contextId : null,
        bootLines: (w.__speculumBootDiagLines || []).slice(-10),
      };
    } catch (e) {
      return { err: String(e && e.message ? e.message : e) };
    }
  };
  const left = document.querySelector("iframe[name=left], #left");
  const right = document.querySelector("iframe[name=right], #right");
  const nested = right && right.contentDocument ? right.contentDocument.querySelector("iframe[name=nested], #nested") : null;
  return {
    root: probeWin(window),
    left: probeWin(left && left.contentWindow),
    right: probeWin(right && right.contentWindow),
    nested: probeWin(nested && nested.contentWindow),
    iframeCount: document.querySelectorAll("iframe").length,
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
    if (!fs.existsSync(file) || !file.startsWith(fixturesDir)) { res.writeHead(404).end("missing"); return; }
    res.writeHead(200, { "Content-Type": contentType(file) });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = "http://127.0.0.1:" + server.address().port + "/fixtures/iframe-anim.html";
  console.log("url", url);
  const chassis = new LabChassis({ headless: true });
  try {
    await chassis.boot({ mode: "browse", url, frameRateHz: 60, telemetry: { enabled: true, frameEmitted: true, applyResult: true, aggregate: true, cssomPoll: false, diagBoot: true } });
    await new Promise((r) => setTimeout(r, 5000));
    const session = chassis.session;
    const cdp = session.cdpSession;
    await cdp.send("Runtime.enable");
    const r = await cdp.send("Runtime.evaluate", { expression: CHILD_PROBE, returnByValue: true, awaitPromise: true });
    console.log(JSON.stringify(r.result && r.result.value || r, null, 2));
    if (r.exceptionDetails) console.log("ex", JSON.stringify(r.exceptionDetails, null, 2));
  } finally {
    try { await chassis.disposeVirtual(); } catch (_) {}
    try { await chassis.dispose(); } catch (_) {}
    await new Promise((r) => server.close(r));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
