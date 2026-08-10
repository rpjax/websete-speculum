const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");

function getJson(urlPath) {
  return new Promise((resolve, reject) => {
    http
      .get(urlPath, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          try {
            resolve(JSON.parse(text));
          } catch {
            resolve(text);
          }
        });
      })
      .on("error", reject);
  });
}

(async () => {
  const b = await chromium.launch({ headless: true });
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const failed = [];
  p.on("response", (res) => {
    const u = res.url();
    if (!u.includes("virtual-assets") && !u.includes("/w7s/api/")) return;
    if (res.status() >= 400) failed.push({ status: res.status(), url: u.slice(0, 200) });
  });

  await p.goto("http://127.0.0.1:8080/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  for (let i = 0; i < 50; i++) {
    const ok = await p.evaluate(() => {
      const e = document.querySelector("[data-speculum-dom-surface]");
      return !!(e && e.innerHTML.length > 80000 && e.scrollHeight > e.clientHeight + 100);
    });
    if (ok) break;
    await p.waitForTimeout(400);
  }

  const before = await p.evaluate(() => {
    const e = document.querySelector("[data-speculum-dom-surface]");
    return {
      st: e.scrollTop,
      sh: e.scrollHeight,
      ch: e.clientHeight,
      html: e.innerHTML.length,
      imgs: e.querySelectorAll("img").length,
      broken: [...e.querySelectorAll("img")].filter((i) => !i.complete || i.naturalWidth === 0)
        .length,
    };
  });

  const box = await p.locator("[data-speculum-dom-surface]").boundingBox();
  await p.mouse.move(box.x + 500, box.y + 500);
  for (let i = 0; i < 8; i++) {
    await p.mouse.wheel(0, 450);
    await p.waitForTimeout(200);
  }
  await p.waitForTimeout(2000);

  const after = await p.evaluate(() => {
    const e = document.querySelector("[data-speculum-dom-surface]");
    const rows =
      typeof window.__speculumFrontDebugLog === "function"
        ? window.__speculumFrontDebugLog()
        : [];
    const scrollOps = rows
      .filter((r) =>
        /scroll|wheel|suppress|echo/i.test(
          `${r.label || ""}${r.fields?.hop || ""}${r.detail || ""}`,
        ),
      )
      .slice(-30)
      .map((r) => {
        let d = {};
        try {
          d = JSON.parse(r.detail || "{}");
        } catch {
          /* ignore */
        }
        return {
          hop: r.fields?.hop,
          label: r.label,
          seq: d.sequence,
          target: d.target,
          gen: d.generation,
          kind: d.kind,
          detail: String(r.detail || "").slice(0, 240),
        };
      });
    return {
      st: e.scrollTop,
      sh: e.scrollHeight,
      ch: e.clientHeight,
      html: e.innerHTML.length,
      scrollOps,
      sessionId: window.__speculumSessionId,
    };
  });

  await p.screenshot({ path: "bughunt-wheel-only.png" });
  const out = {
    before,
    after: { st: after.st, sh: after.sh, ch: after.ch, html: after.html, sessionId: after.sessionId },
    deltaScroll: after.st - before.st,
    scrollOps: after.scrollOps,
    failCount: failed.length,
    failed: failed.slice(0, 40),
  };
  fs.writeFileSync("bughunt-wheel-probe.json", JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));

  if (after.sessionId) {
    const j = await getJson(
      `http://127.0.0.1:8080/w7s/api/sessions/${after.sessionId}/journal-export`,
    );
    const facts = j.facts || [];
    const interesting = facts.filter((f) =>
      /Scroll|Wheel|CdpDrop|Applied|FrameReceived|SoftNav|Generation/i.test(f.type),
    );
    console.log("interesting facts", interesting.length);
    for (const f of interesting.slice(-50)) {
      const payload = typeof f.payload === "string" ? JSON.parse(f.payload) : f.payload;
      if (
        /scroll|wheel|CdpDrop|Generation|SoftNav/i.test(f.type) ||
        (payload && /scroll|wheel/i.test(JSON.stringify(payload)))
      ) {
        console.log(
          f.type.split(".").slice(-2).join("."),
          JSON.stringify(payload).slice(0, 260),
        );
      }
    }
  }

  await b.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
