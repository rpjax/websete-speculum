## Stealth suite results

- When (UTC): 2026-08-03 11:16:54 (collector) — **post worker-realm WebGL** sidecar rebuild
- Env: **dev** (`http://127.0.0.1:8080/w7s`)
- Sidecar image / git SHA: `speculum-refactor/speculum-refactor-sidecar:dev` / `b6600a2`
- SPECULUM_INPUT_BACKEND: `patchright`
- Navigation allowlist note: `Any` (dev seed). **Not** sessions-test.
- Method: SessionHub StartSession/Navigate + harness `POST …/evaluate` **inside remote Chrome** (not the operator browser).
- Raw JSON: [`stealth-suite-raw.json`](stealth-suite-raw.json)
- Runbook: [`stealth-suite.md`](stealth-suite.md)

### Executive snapshot

| Axis | Prior (nav-only CDP worker inject) | This run (nav + WebGL getParameter on worker targets) |
|------|-------------------------------------|------------------------------------------------------|
| Harness WebGL pc | WebKit + Intel UHD kit | unchanged |
| Harness WebGL phone | WebKit + Adreno kit | unchanged |
| Creep GPU dual (`Mesa/X.org` + `llvmpipe` beside kit) | **present** | **gone** |
| Creep GPU strings | kit UNMASKED **and** llvmpipe/Mesa | kit UNMASKED only (Intel UHD / Adreno), coherent |
| Sannysoft WebGL | kit UNMASKED | kit UNMASKED |
| Creep like-headless | **44%** | **44%** (unchanged — observe only; no headless mitigations this wave) |
| Creep headless | 0% | 0% |
| Creep “stealth” composite | 20% | **0%** (hash moved; treat as observation, not a claimed score win) |
| Vastel | 502 | 502 (host down) |

### Wave: worker-realm WebGL (browser-wide)

**Change:** `kitNavigatorSpoofSource` (already CDP-injected into worker / shared / service_worker targets) now includes the same kit `getParameter` block as main (`VENDOR` / `RENDERER` / UNMASKED). Session-wide, any origin — no suite host branches.

**Result:** Creep no longer surfaces conflicting `Mesa/X.org` + `llvmpipe` alongside kit UNMASKED. Desktop Creep/Sannysoft show Intel UHD kit only; mobile shows Adreno kit only.

**Like-headless:** still **44%**. No speculative Chrome flags / toString hygiene this wave — attribute first next.

### Profile: Desktop

- Viewport CSS: 1280×720 — launch ok
- Harness: platform `Linux x86_64`, cores/mem **8/8**, WebGL kit Intel UHD; worker UA/platform/cores match main

| # | URL | Load | Notes |
|---|-----|------|-------|
| 1 | creepjs | ok | GPU kit-coherent; **44%** like-headless; 0% headless; 0% stealth |
| 2 | sannysoft | ok | WebDriver passed; WebGL Vendor/Renderer = kit Intel |
| 3 | vastel | timeout | 502 upstream |
| 4 | pixelscan | ok | marketing/bot copy noise |
| 5 | fingerprint | ok | demo surface |
| 6 | cloudflare | ok | marketing page; CF private score N/A in-page |

### Profile: Mobile

- Viewport CSS: 414×711 — launch ok
- Harness: Android Pixel UA, `Linux armv8l`, cores/mem **8/4**, WebGL Adreno; worker matches

| # | URL | Load | Notes |
|---|-----|------|-------|
| 1 | creepjs | ok | Adreno kit only; **44%** like-headless (same) |
| 2 | sannysoft | ok | WebGL Qualcomm / Adreno kit |
| 3 | vastel | timeout | 502 |
| 4–6 | pixelscan / fingerprint / cloudflare | ok | same caveats as desktop |

### Priority backlog (objective)

1. **Like-headless ~44%** — still unexplained by GPU dual (closed). Attribute next (canvas / X11 / prototype smell / software-GL residual elsewhere). **No** mitigations until attributed.
2. Cloudflare private outcome — not measurable in-page; correlate after browser-side residual shrinks.
3. Soft: TZ vs egress IP (network).
4. Vastel host 502 — external.

### Explicitly out of scope this run

- TLS JA3/JA4, IP/ASN, CF private ML.
- Chrome “anti-headless” flags, cpuset, Windows kit, site-specific patches.
