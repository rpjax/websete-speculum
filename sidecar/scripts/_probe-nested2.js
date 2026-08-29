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
  const right = document.querySelector("#right");
  const probeChild = async (w, label) => {
    if (!w) return { label, err: "no-w" };
    try {
      const ready = w.__SPECULUM_PROJECTION_READY__;
      let readyVal = "no";
      if (ready) {
        try { readyVal = await Promise.race([ready.then(v => v ? "config" : "null"), new Promise(r => setTimeout(() => r("timeout"), 100))]); }
        catch (e) { readyVal = "err:" + e.message; }
      }
      return {
        label,
        href: w.location.href,
        hasConfig: !!w.__SPECULUM_PROJECTION__,
        hasProj: !!w.__speculumProjection,
        readyVal,
        // peek bus internals if any leak
        upwardReady: !!(w.__speculumProjection && w.__speculumProjection.bus && w.__speculumProjection.bus.upwardReady),
        keys: Object.keys(w).filter(k => k.includes("speculum") || k.includes("SPECULUM")),
      };
    } catch (e) { return { label, err: String(e.message || e) }; }
  };
  // Inspect root nested host rows via DOM describe if API exists
  const apiKeys = p ? Object.keys(p) : [];
  return (async () => {
    const leftP = await probeChild(left && left.contentWindow, "left");
    const rightP = await probeChild(right && right.contentWindow, "right");
    let nestedP = null;
    try {
      const nest = right.contentDocument && right.contentDocument.querySelector("iframe");
      nestedP = await probeChild(nest && nest.contentWindow, "nested");
    } catch (e) { nestedP = { err: String(e.message || e) }; }
    // Did root emit nestedHost ops? check table via snapshot-ish
    let nestedHostHint = null;
    try {
      if (p && typeof p.keyOfSelector === "function") {
        const a = p.keyOfSelector({ selector: "#left", contextId: 1 });
        const b = p.keyOfSelector({ selector: "#right", contextId: 1 });
        nestedHostHint = { left: a, right: b };
      }
    } catch (e) { nestedHostHint = { err: String(e.message || e) }; }
    return { apiKeys, leftP, rightP, nestedP, nestedHostHint, rootCtx: p && p.contextId };
  })();
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
