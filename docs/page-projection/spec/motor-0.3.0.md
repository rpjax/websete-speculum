# Motor 0.3.0 — release scope

**Status:** in progress (2026-08-30).  
**Previous:** [0.2.0](../../../CHANGELOG.md) (screencast / sessions polish).  
**Normative index:** [README.md](README.md) **Now** · [open.md](open.md) · [runtime-redesign.md](runtime-redesign.md) §15.  
**Implementation TODOs (A → B → D migration → tag → C M1):** [../LIVE-PP-0.3.0-IMPLEMENTATION.md](../LIVE-PP-0.3.0-IMPLEMENTATION.md) · [motor-migration.md](motor-migration.md).

---

## Two readings — pick one (do not merge)

| Reading | Promise | Verdict |
|---------|---------|---------|
| **Motor milestone** | Single-session PP preview; lab-proven core; internal / early adopters | **What 0.3.0 is.** Defensável com os gates abaixo. |
| **Production RBI** | Multi-session density, antibot stealth pass, datacenter IP, accept 1:1 sealed | **Not this tag.** Stealth spike (V3), bisseção patchright vs extensão, IP de datacenter = frentes próprias. |

**Rodrigo / Opus (2026-08-30):** cortar **0.3.0 como marco de motor**, não como RBI de produção.

---

## What is mature (evidence, not optimism)

**Projection core (`@speculum/page-projection` + wire path)** — dossier `2026-08-30T06-10-17-942Z-www.eneba.com` (Eneba `/br/` browse, ~28 s):

| Signal | Result |
|--------|--------|
| Wire invariants | **33k+ checks, 0 fail** (`wire/invariants.json`) |
| Client apply | **96 ok, 0 fail, desync 0** |
| Input | **44/44** intents, 0 sidecar rejects |
| CPU (profile) | **~1% wall** our-code; instrumented build+apply **~2.5% wall** |
| Runtime carrier | Extension + ContextBus cutover shipped; ~1200 LOC boot-guard class removed ([runtime-redesign.md](runtime-redesign.md)) |

This supports **“PP engine lab-proven on hostile browse”** — not full accept 1:1 (no parity oracle on that run; `verdicts.json` empty).

**Session layer** — not the same maturity: multi-session **density** claims still owe optional live two-Chrome proof ([runtime-redesign.md](runtime-redesign.md) §15.3). C2 isolation is **implemented** (see B1 below).

---

## What 0.3.0 ships (motor milestone)

| Area | In scope |
|------|----------|
| PP algorithm | DOM table, CSSOM poll+apply, shadow, OPEN-6 same-origin nested, sparse-cdp input, resync + apply gate |
| Session path | `PageProjectionBrowserSession` + sealed factory; loopback WS; **per-session** extension dir (B1) |
| **Motor migration** | .NET cano burro — M0–M8 ([motor-migration.md](motor-migration.md) · LIVE-PP §D) |
| Lab | Browse + dossier on **http://127.0.0.1:4077/**; CPU profile; wire invariants |
| **iOS / WebKit touch** | Projected surface: no `iframe.sandbox` (blocks touch delivery); K5 via CSP meta in stamped srcdoc + `ensureProjectedK5Csp` on apply |
| Proof class | Eneba `/br/` direct — protocol + input green |

## What 0.3.0 does **not** promise

Document these as **known limitations**, not surprises for users:

| Limitation | Notes |
|------------|--------|
| **Accept 1:1 sealed** | DOM/CSSOM oracles on browse not closed; widget/visual parity needs re-measure (legacy evidence had offset issues). |
| **Antibot / stealth pass** | Turnstile/CF browse ≠ stealth spike V3; desafio repro 100% — investigation not started. |
| **Multi-session production** | K3 density; optional live 2-session Chrome proof still owed. |
| **Datacenter IP** | Production egress — independent; untouched. |
| **Canvas** (gate 7) | M1 blocker; placeholder only. |
| **Nested render inside shadow** | Not a 0.3.0 claim; track separately if product needs it. |
| **MotorAssert Live deep** | Compose `MirrorMode.PageProjection` — gate 11 open. |
| **M1 cutover** | [roadmap.md](roadmap.md) — canvas + full product law. |
| **Lab `verdicts.json`** | Soak/browse dossiers often leave `verdicts.json` empty or skip-heavy — metrics exist; **no automatic pass/fail declaration**. Reader must interpret (as of 2026-08-31). |
| **Eneba `/` → `/br/` full proof** | Partial only: Virtual soak on `/` (`2026-08-31T01-07-05-005Z-soak`) desync 0, gen stayed `1`, no Projected apply. Full redirect+Turnstile+apply-gate proof still owed (or re-run with lab DOM client). `/br/` direct remains the strong baseline. |
| **iPhone touch evidence** | Code+unit K5/CSP done for 0.3.0. Safari `emitted > 0` **deferred to next version** (no device available 2026-08-31). |

---

## Release gate (ordered) — signal vs noise

Only items marked **GATE** block the tag. Others are **polish** or **already done**.

| # | Item | Status | Notes |
|---|------|--------|-------|
| 0 | **iOS/CSP / K5** | **DONE code+unit; device → next** | CSP in srcdoc + `ensureProjectedK5Csp`; no `iframe.sandbox`; Chromium probe fail-closed. Safari iPhone `emitted > 0` **deferred to next version** (no device 2026-08-31). |
| 1 | **B1 — per-session `c2-endpoint.json`** | **DONE 2026-08-29** | `materializeSpeculumPpForSession` → temp copy per `sessionId`; unit `extensionC2Host.unit.ts`. **Not an open fix** — Opus review predates landing. Optional: live two-Chrome concurrency smoke before **density** claims. |
| 2 | **B2 — `managedTabId` fail-closed** | **NOISE / withdrawn** | Product law: **1 session = 1 tab**; protocol deleted 2026-08-29 ([runtime-redesign.md](runtime-redesign.md) §15.1 B2, §15.4). Do **not** reintroduce for 0.3.0. |
| 3 | **B3 — .NET test** | **DONE 2026-08-31** | `SessionCollectorTests.TimedOut_DoesNotFireAfterReattachClaimRace` — PASS. |
| 4 | **PP-NESTED-GEN-PACK revert** | **DONE 2026-08-30** | Monotonic per-`contextId` mint in parent `initContext` answer; packing removed. [frame-protocol.md](frame-protocol.md) §2 · [open.md](open.md). |
| 5 | **Eneba `/` → `/br/`** | **LIMITATION (partial)** | Soak `/` Virtual green (`2026-08-31T01-07-05-005Z-soak`); no gen bump / no Projected apply. Full proof owed — see § does not promise. |
| 6 | **Windows / full gates** | **DONE 2026-08-31** | `sidecar npm test` PASS (with Chrome); Sessions B3 PASS; SessionsTest PP category still weak (honesty noted). |
| 7 | **Known limitations doc** | **DONE 2026-08-31** | verdicts.json / A2 partial / iPhone deferred called out. |

**Polish (post-tag or non-blocking):**

- Lab sink for `applyGateDrain` / `applyGateOverflow` / `applyGateOverflowLoop` ([open.md](open.md) residual #9).
- Dead metrics in dossier fold: `encodeMs`, `dispatchMs`, `clientLagMs` (always 0 on current path).
- Fill `verdicts.json` on blueprint runs; re-run widget parity with fixed harness.

**Noise (do not re-open as 0.3.0 work):**

- “25 dirty files” — **committed** `90fad3d` / `893bfd8` on `feat/mirror-mode` (apply gate, loopback install, docs).
- B1 as mandatory implementation — **already shipped**.
- B2 as mandatory fix — **explicitly rejected**.

---

## Exit checklist (before tag `v0.3.0`)

- [x] **iOS/CSP / K5** — code+unit done; device Safari evidence **deferred to next version**
- [x] **PP-NESTED-GEN-PACK** reverted (wire clean before tag)
- [x] Eneba **`/` → `/br/`** — **limitation written** (partial soak; full proof not claimed)
- [x] B3 green on this tree (`TimedOut_DoesNotFireAfterReattachClaimRace`)
- [x] Full gates green on Windows (sidecar `npm test` + Sessions B3)
- [x] B1–B3 Live preview (default PP, SessionsTest PP, contrato pré-V4)
- [ ] **D motor migration** M0–M8 ([motor-migration.md](motor-migration.md)) — .NET sem coalesce/drop/tipos DOM
- [ ] B4 HARDNAV · B5 Live regress (podem correr em paralelo a D)
- [ ] Optional: live two-session Chrome C2 smoke (if claiming concurrent sessions; overlap M8)
- [x] Apply gate + loopback `document.install` — shipped
- [x] B1 per-session extension dir — shipped 2026-08-29
- [x] `version.txt` = `0.3.0`; CHANGELOG `[0.3.0]` + empty-`verdicts.json` honesty
- [ ] Tag `v0.3.0` when ready — do **not** claim iPhone proven or accept 1:1 sealed

### iPhone touch evidence (next version)

| Date | Device | Fold / notes | `emitted` | `touchstartSeen` |
|------|--------|--------------|-----------|------------------|
| _deferred_ | Safari iPhone | Lab 4077 or Live; `probes/input-pipeline.json` | — | — |

---

## Performance baseline (Eneba `/br/` browse, 2026-08-30)

Instrumented build+apply ≈ **712 ms / 28 s wall (~2.5%)**. CPU profile our-code ≈ **1% wall (~260 ms)**. Median frame ≈ **2.3 ms** (2 ms Virtual build + 0.3 ms Projected apply). E6 steady-state **OK** on this browse class; adversarial prepend-stress remains ceiling test ([budgets.md](budgets.md)).

Dossier: `sidecar/lab-runs/2026-08-30T06-10-17-942Z-www.eneba.com` (`probes/cpu/summary.json`, `probes/metrics.json`).

---

## Key PP fixes already in tree (2026-08-29…30)

- **PP-LOOPBACK-DOC-INSTALL** — same-socket hello generation supersede; `waitEstablished({ afterGeneration })`.
- **PP-APPLY-GATE-OVERRUN** — `ProjectedApplyGate`; cap 64; overflow anti-loop (streak 3).
- **Cold resync on armed surface** — full recreate, not standby-only async.
- **K5 / iOS touch** — `iframe.sandbox` removed (WebKit touch block); K5 enforced via CSP on Projected document (`projectedBlankIframe.ts`, `applyDom.ts`).

Detail: [open.md](open.md) · [decision-log.md](decision-log.md) §L · §M.
