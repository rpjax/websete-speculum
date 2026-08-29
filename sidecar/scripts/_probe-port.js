const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { labAssetRoots } = require("../dist/browser/mirror/projection/lab/assetRoots");
const { LabChassis } = require("../dist/browser/mirror/projection/lab/host/chassis");
function contentType(file) {
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  return "text/html; charset=utf-8";
}
const EXPR = `
(() => {
  const CHANNEL = "speculum.context.bus";
  const RUNTIME = 0xffffffff;
  const left = document.querySelector("#left");
  const child = left.contentWindow;
  return new Promise((resolve) => {
    const out = { steps: [] };
    const channel = new MessageChannel();
    // Listen on child for ack — parent should transfer port2 to child
    const onMsg = (ev) => {
      if (!ev.data || ev.data.channel !== CHANNEL) return;
      if (ev.data.kind === "port-setup-ack") {
        out.steps.push("ack");
        const port = ev.ports && ev.ports[0];
        if (!port) { out.steps.push("no-port"); resolve(out); return; }
        port.start && port.start();
        let done = false;
        const t = setTimeout(() => {
          if (done) return;
          done = true;
          out.steps.push("init-timeout");
          resolve(out);
        }, 2000);
        port.onmessage = (e) => {
          out.steps.push("port-msg:" + (e.data && e.data.type));
          if (e.data && e.data.type === "invocation-response") {
            done = true;
            clearTimeout(t);
            out.response = e.data;
            resolve(out);
          }
        };
        // send initContext
        port.postMessage({
          channel: CHANNEL,
          source: 0,
          destination: RUNTIME,
          type: "request-invocation",
          event: { invocationId: 1, name: "initContext", args: {} },
        });
        out.steps.push("sent-init");
      }
    };
    child.addEventListener("message", onMsg);
    // Child posts setup to parent (same as ParentPortLink)
    try {
      child.parent.postMessage({ channel: CHANNEL, kind: "port-setup" }, "*");
      out.steps.push("sent-setup");
    } catch (e) {
      out.steps.push("setup-err:" + e.message);
      resolve(out);
    }
    setTimeout(() => {
      if (!out.steps.includes("ack")) {
        out.steps.push("no-ack-timeout");
        resolve(out);
      }
    }, 1500);
  });
})()`;
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
    await chassis.boot({ mode: "browse", url, frameRateHz: 60, telemetry: { enabled: true } });
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
