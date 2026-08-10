const { chromium } = require("playwright");
const OUT =
  "C:/RPJ/Coding/Projects/Seven/Websete/Websete Speculum/Refactor/deploy/tmp-telemetry-run";

(async () => {
  const b = await chromium.launch({ headless: true });
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  await p.goto("http://localhost:8080/", {
    waitUntil: "domcontentloaded",
    timeout: 90000,
  });

  let m = null;
  for (let i = 0; i < 60; i++) {
    m = await p.evaluate(() => {
      const e = document.querySelector("[data-speculum-dom-surface]");
      if (!e) return { ok: false, reason: "no-surface" };
      const owned = [...document.querySelectorAll("style[data-speculum-cssom-id]")];
      let ownedRules = 0;
      for (const st of owned) {
        try {
          ownedRules += st.sheet?.cssRules?.length || 0;
        } catch {}
      }
      const body = e.querySelector("[data-speculum-dom-body]");
      const first = e.firstElementChild;
      const sr = e.getBoundingClientRect();
      const fr = first ? first.getBoundingClientRect() : null;
      const header =
        e.querySelector("header") ||
        e.querySelector("[role='banner']") ||
        (body && body.firstElementChild);
      const hr = header ? header.getBoundingClientRect() : null;
      return {
        ok: e.childElementCount > 0 && ownedRules > 100,
        kids: e.childElementCount,
        htmlLen: e.innerHTML.length,
        ownedRules,
        ownedSheets: owned.length,
        surfaceMT: getComputedStyle(e).marginTop,
        surfacePT: getComputedStyle(e).paddingTop,
        bodyMT: body ? getComputedStyle(body).marginTop : null,
        bodyPT: body ? getComputedStyle(body).paddingTop : null,
        firstTop: fr ? Math.round(fr.top - sr.top) : null,
        headerTop: hr ? Math.round(hr.top - sr.top) : null,
        scrollTop: e.scrollTop,
        text: (e.innerText || "").slice(0, 180),
        sessionId: window.__speculumSessionId || null,
        href: location.href,
      };
    });
    if (m.ok) break;
    await p.waitForTimeout(500);
  }
  console.log("COLD", JSON.stringify(m, null, 2));
  await p.screenshot({ path: `${OUT}/user-verify-cold.png` });
  const box = await p.locator("[data-speculum-dom-surface]").first().boundingBox();
  if (box) {
    await p.screenshot({
      path: `${OUT}/user-verify-topband.png`,
      clip: { x: box.x, y: box.y, width: Math.min(box.width, 1400), height: 160 },
    });
  }

  const before = await p.evaluate(
    () => document.querySelector("[data-speculum-dom-surface]")?.scrollTop || 0,
  );
  await p.mouse.move(700, 400);
  await p.mouse.wheel(0, 800);
  await p.waitForTimeout(1500);
  const afterWheel = await p.evaluate(() => {
    const e = document.querySelector("[data-speculum-dom-surface]");
    const entries =
      typeof window.__speculumFrontDebugLog === "function"
        ? window.__speculumFrontDebugLog()
        : [];
    const scrollHops = entries
      .filter((x) => /scroll|suppress|dom_input|client_sent/i.test(x.label || ""))
      .slice(-20)
      .map((x) => ({
        label: x.label,
        kind: x.fields?.kind,
        hop: x.fields?.hop,
      }));
    return { scrollTop: e?.scrollTop || 0, scrollHops };
  });
  console.log("SCROLL before", before, "after", JSON.stringify(afterWheel, null, 2));
  await p.screenshot({ path: `${OUT}/user-verify-after-scroll.png` });

  const search = p
    .locator(
      "[data-speculum-dom-surface] input[type='search'], [data-speculum-dom-surface] input[placeholder*='earch' i]",
    )
    .first();
  if (await search.count()) {
    await search.click({ timeout: 5000 }).catch(() => {});
    await p.keyboard.type("steam", { delay: 40 });
    await p.waitForTimeout(500);
    await p.keyboard.press("Enter");
    await p.waitForTimeout(3500);
    const soft = await p.evaluate(() => {
      const e = document.querySelector("[data-speculum-dom-surface]");
      const entries =
        typeof window.__speculumFrontDebugLog === "function"
          ? window.__speculumFrontDebugLog()
          : [];
      return {
        href: location.href,
        text: (e?.innerText || "").slice(0, 300),
        htmlLen: e?.innerHTML?.length || 0,
        syncUrl: entries
          .filter((x) => x.label === "syncUrl" || x.fields?.hop === "syncUrl")
          .slice(-5)
          .map((x) => ({
            label: x.label,
            fields: x.fields,
            detail: String(x.detail || "").slice(0, 160),
          })),
      };
    });
    console.log("SOFT", JSON.stringify(soft, null, 2));
    await p.screenshot({ path: `${OUT}/user-verify-after-enter.png` });
  } else {
    console.log("NO_SEARCH");
  }

  await b.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
