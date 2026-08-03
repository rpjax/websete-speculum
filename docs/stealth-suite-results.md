## Stealth suite results

- When (UTC): 2026-08-03 ~09:02 (post antibot-first easy: kits + platform + HW spoof)
- Env: **dev** (`http://127.0.0.1:8080/w7s`)
- Sidecar image / git SHA: `speculum-refactor/speculum-refactor-sidecar:dev` (kits rebuild) / `f08516e`
- SPECULUM_INPUT_BACKEND: `patchright`
- Navigation allowlist note: `Any` (dev seed)
- Method: SessionHub + harness evaluate (remote Chrome)
- Policy: [stealth-suite.md — Antibot policy](stealth-suite.md)
- Raw: [`stealth-suite-raw.json`](stealth-suite-raw.json)

### Delta vs prior run (same stack)

| Signal | Before | After (this run) |
|--------|--------|------------------|
| Phone `navigator.platform` | `Linux x86_64` (lie vs Android UA) | **`Linux armv8l`** (kit) |
| Main-frame `hardwareConcurrency` | **22** (host) | **8** (kit) |
| Main-frame `deviceMemory` | 4 (host) | **8 pc / 4 phone** (kit) |
| Phone UA / UA-CH | Android Pixel 7 | unchanged (already kit) |
| WebGL | null / blocked | **unchanged** (P0) |
| CreepJS Worker UA / cores | Linux X11 / **22** | **still** Linux X11 / **22** (worker realm) |
| CreepJS like-headless / stealth | ~44% / 0% | ~44% / 0% |

### Executive snapshot

| Axis | Desktop (`pc`) | Phone 414×711 |
|------|----------------|---------------|
| Launch / CSS prove | ok 1280×720 | ok 414×711 |
| `navigator.webdriver` | false | false |
| `navigator.platform` | Linux x86_64 (pc kit) | **Linux armv8l** |
| Main HW | **concurrency 8, memory 8** | **concurrency 8, memory 4** |
| WebGL | no context | no context |
| CreepJS | 44% like headless / 0% stealth; Worker still 22 cores | same; Worker UA still X11 Linux |
| Sannysoft WebDriver | passed | passed |
| Vastel | 502 | 502 |
| Cloudflare.com | homepage passed | homepage passed |

---

### Profile: Desktop (`pc`)

- Viewport: 1280×720 — Device: pc kit
- Snapshot: `platform=Linux x86_64`, `hardwareConcurrency=8`, `deviceMemory=8`, `webgl=null`, `webdriver=false`

| # | URL | Load | Key findings |
|---|-----|------|--------------|
| 1 | creepjs | ok | Headless band unchanged; **Worker still reports cores: 22**; WebGL blocked; fonts Linux |
| 2 | sannysoft | ok | WebDriver passed; WebGL no context |
| 3 | vastel | timeout | 502 upstream |
| 4–6 | pixelscan / fingerprint / cloudflare | ok / loading / passed | Same class as prior |

### Profile: Mobile (`phone`)

- Viewport: 414×711 — Device: phone kit (Pixel-class)
- Snapshot: `platform=Linux armv8l`, Android UA + UA-CH mobile, `hardwareConcurrency=8`, `deviceMemory=4`, `mtp=5`

| # | URL | Load | Key findings |
|---|-----|------|--------------|
| 1 | creepjs | ok | Main identity coherent; **Worker UA still X11 Linux + cores 22**; WebGL blocked |
| 2 | sannysoft | ok | WebDriver passed; WebGL no context |
| 3 | vastel | timeout | 502 |
| 4–6 | same pattern | | |

---

### Priority backlog (objective) — next score moves

1. **P0 WebGL context** — still null; string spoof cannot help until `getContext('webgl')` works (`ChromeRuntime` / SwiftShader / Mesa).
2. **P1 Worker realm** — CreepJS Worker still sees host UA/cores; need script injection that covers dedicated workers (or CDP worker target attach).
3. **P1 Font kit** — Android claim + Liberation/Noto Linux fonts.
4. **P1 Windows `pc` kit** (full pack) — Linux pc is consistent but weak vs residential Win Chrome.
5. Soft: TZ vs egress IP (unchanged; network).

### Explicitly out of scope this run

- TLS JA3/JA4, IP/ASN, CF private ML.

### Method note

- Easy leva shipped: docs policy, `deviceCategory` phone|tablet|pc, CDP `platform`, kit HW spoof on main frame, client soft `languages`.
