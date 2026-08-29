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
  return new Promise((resolve) => {
    const left = document.querySelector("#left").contentWindow;
    // Force a fresh initContext-like port setup probe NOW (after root admitted)
    const CHANNEL = "speculum.contextBus"; // guess — read from code
    // Better: ask live child to call requestInitContext if bus still exists — it does not.
    // Measure: can parent still see ports in hub?
    const p = globalThis.__speculumProjection;
    // Monkey: post a port-setup from left and see if parent accepts (new MessageChannel side effect)
    let got = false;
    const handler = (ev) => {
      if (ev.data && ev.data.kind === "port-setup-ack") { got = true; }
    };
    left.addEventListener("message", handler);
    // Find real channel constant by reading from parent bus listener — try both
    const channels = ["speculum.contextBus", "speculum.context-bus", "w7s.contextBus"];
    for (const ch of channels) {
      try { left.parent.postMessage({ channel: ch, kind: "port-setup" }, "*"); } catch (_) {}
    }
    setTimeout(() => {
      left.removeEventListener("message", handler);
      // Also check console errors collected
      resolve({ gotAck: got, channelProbe: channels });
    }, 200);
  });
})()`;
// Also pull console
async function main() {
  process.env.CHROME_EXECUTABLE = process.env.CHROME_EXECUTABLE || "C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe";
  const { fixturesDir } = labAssetRoots();
  const server = http.createServer((req, res) => {
    const raw = req.url || "/";
    if (!raw.startsWith("/fixtures/")) { res.writeHead(404).end(); return; }
    const rel = decodeURIComponent(raw.split("?")[0].slice("/fixtures/".length));
    res.writeHead(200, { "Content-Type": contentType(path.join(fixturesDir, rel)) });
    fs.createReadStream(path.join(fixturesDir, rel)).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = "http://127.0.0.1:" + server.address().port + "/fixtures/iframe-anim.html";
  const chassis = new LabChassis({ headless: true });
  try {
    const logs = [];
    await chassis.boot({ mode: "browse", url, frameRateHz: 60, telemetry: { enabled: true, diagBoot: true } });
    const page = chassis.session.page;
    page.on("console", (msg) => {
      const t = msg.text();
      if (t.includes("speculum") || t.includes("bootstrap") || t.includes("initContext")) logs.push(t.slice(0, 300));
    });
    await new Promise((r) => setTimeout(r, 4000));
    const cdp = chassis.session.cdpSession;
    const r = await cdp.send("Runtime.evaluate", { expression: EXPR, returnByValue: true, awaitPromise: true });
    console.log("eval", JSON.stringify(r.result && r.result.value || r, null, 2));
    console.log("logs", logs.slice(0, 40));
  } finally {
    try { await chassis.disposeVirtual(); } catch (_) {}
    try { await chassis.dispose(); } catch (_) {}
    await new Promise((r) => server.close(r));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
