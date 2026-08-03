## Stealth suite results

- When (UTC): 2026-08-03 09:45 (post WebGL-auto + Worker wrap + Linux/Android kits)
- Env: **dev** (`http://127.0.0.1:8080/w7s`)
- Sidecar image / git SHA: `speculum-refactor/speculum-refactor-sidecar:dev` (WebGL/Worker rebuild) / `5f669cf`
- SPECULUM_INPUT_BACKEND: `patchright`
- Navigation allowlist note: `Any` (dev seed)
- Method: SessionHub + harness evaluate (remote Chrome)
- Policy: [stealth-suite.md — Antibot policy](stealth-suite.md) — pc=Linux; GL=auto; no `SPECULUM_GL*`
- Raw: [`stealth-suite-raw.json`](stealth-suite-raw.json)

### Delta vs prior run (kits-only, WebGL null / Worker host)

| Signal | Before | After (this run) |
|--------|--------|------------------|
| WebGL `getContext` | **null** | **ok** (software path, no GPU, no env) |
| UNMASKED pc | n/a | **Intel Mesa Linux** (not D3D11) |
| UNMASKED phone | n/a | **Adreno** |
| Harness classic Worker | cores **22**, host UA | **cores 8**, kit UA/platform/mem |
| Main-frame HW / platform | kit (already) | unchanged (pc Linux / phone armv8l) |
| CreepJS Worker line | cores 22 | **still** `cores: 22` (ServiceWorker / Creep path; classic wrap proven separately) |
| CreepJS like-headless / stealth | ~44% / 0% | ~44% / 0% |
| Fonts image | Liberation / Noto CJK | + DejaVu + Noto core + EGL |

### Executive snapshot

| Axis | Desktop (`pc`) | Phone 414×711 |
|------|----------------|---------------|
| Launch / CSS prove | ok 1280×720 | ok 414×711 |
| `navigator.webdriver` | false | false |
| `navigator.platform` | Linux x86_64 | Linux armv8l |
| Main HW | concurrency 8, memory 8 | concurrency 8, memory 4 |
| WebGL UNMASKED | Google Inc. (Intel) / Mesa UHD 620 | Qualcomm / Adreno 730 |
| Harness Worker | cores 8, mem 8, Linux x86_64 | cores 8, mem 4, armv8l + Android UA |
| CreepJS | 44% like headless; WebGL kit strings; Worker line still 22 | same; Adreno visible |
| Sannysoft WebDriver | passed | passed |
| Vastel | 502 | 502 |
| Cloudflare.com | homepage load (collector flagged blocked-ish text) | same |

---

### Profile: Desktop (`pc`)

- Viewport: 1280×720 — Device: pc kit (Linux)
- Snapshot: WebGL ok + Intel Mesa UNMASKED; Worker probe `cores=8 mem=8 platform=Linux x86_64`

| # | URL | Load | Key findings |
|---|-----|------|--------------|
| 1 | creepjs | ok | WebGL Intel Mesa; main `cores: 8, ram: 8`; Worker section still `cores: 22` |
| 2 | sannysoft | ok | WebDriver passed; WebGL present |
| 3 | vastel | timeout | 502 upstream |
| 4–6 | pixelscan / fingerprint / cloudflare | ok | Same class as prior |

### Profile: Mobile (`phone`)

- Viewport: 414×711 — Device: phone kit (Pixel-class Android)
- Snapshot: WebGL Adreno; Worker probe Android UA + `cores=8 mem=4 platform=Linux armv8l`

| # | URL | Load | Key findings |
|---|-----|------|--------------|
| 1 | creepjs | ok | Adreno UNMASKED; main identity coherent; Creep Worker line still 22 |
| 2 | sannysoft | ok | WebDriver passed; Android UA |
| 3 | vastel | timeout | 502 |
| 4–6 | same pattern | | |

---

### Priority backlog (objective) — next score moves

1. **CreepJS Worker/ServiceWorker realm** — classic `Worker`/`SharedWorker` wrap is kit-correct (harness); Creep still prints `cores: 22` (likely ServiceWorkerGlobalScope / other realm).
2. Soft: TZ vs egress IP (network).
3. Full Windows `pc` kit only as a complete pack (out of V1).
4. Deploy: keep sidecar images in sync.

### Explicitly out of scope this run

- TLS JA3/JA4, IP/ASN, CF private ML.
- Windows pc kit; JS font fingerprint spoof; GL env knobs.

### Method note

- Shipped: auto WebGL (`--use-gl=angle` + unsafe SwiftShader, no `SPECULUM_GL*`), kit UNMASKED via init + Linux-aligned extension, classic Worker wrap via `importScripts` preamble, Docker fonts/EGL.
