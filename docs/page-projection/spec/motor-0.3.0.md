# Motor 0.3.0 — release scope

**Status:** in progress (2026-08-30).  
**Previous:** [0.2.0](../../../CHANGELOG.md) (screencast / sessions polish).  
**Target:** Speculum **motor** semver bump — PageProjection session path **lab-proven**, not full M1 accept.

---

## What 0.3.0 ships

| Area | Scope |
|------|--------|
| **PageProjection engine** | `@speculum/page-projection` — DOM table, CSSOM poll+apply, shadow, OPEN-6 same-origin nested, sparse-cdp input, extension-plane loopback, virtual assets |
| **Session path** | `PageProjectionBrowserSession` + sealed factory on Live; loopback WS sole data plane |
| **Lab** | Headed/browse + dossier on **http://127.0.0.1:4077/**; CPU profile probe; wire invariants |
| **Antibot class** | Eneba + Turnstile browse — protocol + input green on `/br/` direct load (dossier `2026-08-30T06-10-17-942Z-www.eneba.com`) |

## What 0.3.0 does **not** claim

- **Accept 1:1** sealed on all Eneba journeys — see [open.md](open.md) residuals.
- **M1 production cutover** — canvas (gate 7) still **0%**; [roadmap.md](roadmap.md).
- **MotorAssert** deep Live E2E compose — gate 11 open.
- **Full nested generation via SW mint** — interim pack `(rootGen << 16) | installIndex` still in tree; revert planned before tag.

---

## Exit checklist (before tag `v0.3.0`)

- [ ] Eneba **`/` → `/br/`** dossier — gen bump + Turnstile nested; no `sequence_gap` storm (apply gate proof on redirect path).
- [ ] SW mint monotônico — nested gen from root via ContextBus; **no** nested→SW direct (flake 4/10 class).
- [ ] Lab telemetry sink catalogs `applyGateDrain` / `applyGateOverflow` / `applyGateOverflowLoop`.
- [ ] `version.txt` = `0.3.0`; [CHANGELOG.md](../../../CHANGELOG.md) section complete.
- [ ] CI green (`SessionsTest` PageProjection category).

---

## Performance baseline (Eneba `/br/` browse, 2026-08-30)

Instrumented build+apply ≈ **712 ms / 28 s wall (~2.5%)**. CPU profile our-code ≈ **1% wall (~260 ms)**. Median frame ≈ **2.3 ms** (2 ms Virtual build + 0.3 ms Projected apply). See dossier `probes/cpu/summary.json` + `probes/metrics.json`.

---

## Key PP fixes in this line (2026-08-29…30)

- **PP-LOOPBACK-DOC-INSTALL** — `document.install` + same-socket hello generation supersede; `waitEstablished({ afterGeneration })`.
- **PP-APPLY-GATE-OVERRUN** — `ProjectedApplyGate`: queue during async recreate/cold resync; `flightDepth` + `draining`; cap 64; overflow anti-loop (streak 3).
- **Cold resync on armed surface** — `everArmed && resync && sequence === 1` → full `recreateForGenerationAsync`, not standby-only async.

Normative detail: [open.md](open.md) · [decision-log.md](decision-log.md) §L.
