const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch({ headless: true });
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  await p.goto("http://localhost:8080/", { waitUntil: "domcontentloaded" });
  for (let i = 0; i < 45; i++) {
    const ok = await p.evaluate(() => {
      const e = document.querySelector("[data-speculum-dom-surface]");
      let n = 0;
      for (const st of document.querySelectorAll("style[data-speculum-cssom-id]")) {
        try {
          n += st.sheet?.cssRules?.length || 0;
        } catch {}
      }
      return !!(e && e.childElementCount > 0 && n > 100);
    });
    if (ok) break;
    await p.waitForTimeout(400);
  }
  await p.waitForTimeout(1500);
  const info = await p.evaluate(() => {
    const ns = document.querySelector(
      '[data-speculum-dom-surface] [speculum-projected-tag="noscript"]',
    );
    const header = document.querySelector("[data-speculum-dom-surface] header");
    const sr = document.querySelector("[data-speculum-dom-surface]")?.getBoundingClientRect();
    const hr = header?.getBoundingClientRect();
    return {
      noscriptDisplay: ns ? getComputedStyle(ns).display : null,
      noscriptH: ns ? Math.round(ns.getBoundingClientRect().height) : null,
      headerTop: hr && sr ? Math.round(hr.top - sr.top) : null,
    };
  });
  console.log(JSON.stringify(info));
  await b.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
