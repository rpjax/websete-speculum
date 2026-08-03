## Stealth suite results

- When (UTC): 2026-08-03 ~10:40 (browser-wide worker-target CDP inject)
- Env: **dev** (`http://127.0.0.1:8080/w7s`)
- Sidecar image / git SHA: `speculum-refactor/speculum-refactor-sidecar:dev` / `5f669cf`
- SPECULUM_INPUT_BACKEND: `patchright`
- Navigation allowlist note: `Any` (dev seed)
- Method: SessionHub + harness evaluate (remote Chrome)
- Policy: [stealth-suite.md](stealth-suite.md) — identity is **session/browser-wide**, suite is measure-only
- Raw: [`stealth-suite-raw.json`](stealth-suite-raw.json)

### Delta vs prior (WebGL-auto + classic Worker wrap)

| Signal | Before | After (this run) |
|--------|--------|------------------|
| Harness classic Worker | kit (8) | kit (8) |
| CreepJS Worker line | **cores: 22** | **cores: 8** (pc mem 8 / phone mem 4) |
| CreepJS like-headless / stealth | 44% / 20% | **44% / 20%** (unchanged) |
| WebGL | kit UNMASKED | unchanged ok |
| Blob SW harness probe | n/a | register rejected on google.com (blob protocol) — Creep SW path still kit cores |

### Executive snapshot

| Axis | Desktop (`pc`) | Phone 414×711 |
|------|----------------|---------------|
| Main HW / platform | 8 / Linux x86_64 | 8 / Linux armv8l |
| Harness Worker | cores 8 mem 8 | cores 8 mem 4 + Android UA |
| Creep Worker | **cores: 8, ram: 8** | **cores: 8, ram: 4** |
| WebGL UNMASKED | Intel Mesa | Adreno |
| CreepJS | 44% like headless / 20% stealth | same |
| Sannysoft WebDriver | passed | passed |

### Illustrative browser-side score: **76 / 100** (was ~68)

Realm consistency closed the Worker leak; like-headless band and network/TLS remain the ceiling.

---

### Priority backlog (objective)

1. Like-headless ~44% — multicausal; next only with **browser-wide** mitigations (no URL patches).
2. Soft: TZ vs egress IP (deploy/network).
3. Full Windows `pc` kit only as a complete pack (out of V1).

### Explicitly out of scope this run

- Cpuset/affinity, SW script byte rewrite, Chromium fork, suite-host special-cases, JA3/CF ML.

### Method note

- Product: `Target.setAutoAttach` + `sendMessageToTarget` inject of kit navigator spoof into `worker` / `shared_worker` / `service_worker` for the whole session (any site).
- Classic Worker wrap + main init remain defense-in-depth.
