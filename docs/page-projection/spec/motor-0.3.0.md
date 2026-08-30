# Motor 0.3.0 — release scope

**Status:** in progress (2026-08-30).  
**Previous:** [0.2.0](../../../CHANGELOG.md) (screencast / sessions polish).  
**Normative index:** [README.md](README.md) **Now** · [open.md](open.md) · [runtime-redesign.md](runtime-redesign.md) §15.

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
| Lab | Browse + dossier on **http://127.0.0.1:4077/**; CPU profile; wire invariants |
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

---

## Release gate (ordered) — signal vs noise

Only items marked **GATE** block the tag. Others are **polish** or **already done**.

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | **B1 — per-session `c2-endpoint.json`** | **DONE 2026-08-29** | `materializeSpeculumPpForSession` → temp copy per `sessionId`; unit `extensionC2Host.unit.ts`. **Not an open fix** — Opus review predates landing. Optional: live two-Chrome concurrency smoke before **density** claims. |
| 2 | **B2 — `managedTabId` fail-closed** | **NOISE / withdrawn** | Product law: **1 session = 1 tab**; protocol deleted 2026-08-29 ([runtime-redesign.md](runtime-redesign.md) §15.1 B2, §15.4). Do **not** reintroduce for 0.3.0. |
| 3 | **B3 — .NET test** | **GATE if red** | `SessionCollectorTests.TimedOut_DoesNotFireAfterReattachClaimRace` — reproduce on `main`, fix or attribute. Out of band until confirmed. |
| 4 | **PP-NESTED-GEN-PACK revert** | **GATE — wire** | Interim `(rootGen << 16) \| installIndex` is **on the wire** today. Revert → SW monotonic mint, **root → nested via bus** (no nested→SW). **Must land before tag** or encoding becomes compat surface. [open.md](open.md). |
| 5 | **Eneba `/` → `/br/`** | **GATE — proof** | Redirect + Turnstile nested + gen bump; apply gate must hold (no `sequence_gap` storm). `/br/` direct already green. |
| 6 | **Windows / full gates** | **GATE** | `sidecar npm test` + build; relevant `dotnet test`; SessionsTest PP category on CI. |
| 7 | **Known limitations doc** | **GATE — honesty** | This file § “does not promise” + CHANGELOG; antibot/nested-shadow called out. |

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

- [ ] **PP-NESTED-GEN-PACK** reverted (wire clean before tag)
- [ ] Eneba **`/` → `/br/`** dossier green
- [ ] B3 green or attributed on `main`
- [ ] Full gates green on Windows (sidecar + dotnet SessionsTest PP)
- [ ] Optional: live two-session Chrome C2 smoke (if claiming concurrent sessions)
- [x] Apply gate + loopback `document.install` — shipped
- [x] B1 per-session extension dir — shipped 2026-08-29
- [x] `version.txt` = `0.3.0`; CHANGELOG `[0.3.0]` section drafted
- [ ] Tag `v0.3.0` only after gates above

---

## Performance baseline (Eneba `/br/` browse, 2026-08-30)

Instrumented build+apply ≈ **712 ms / 28 s wall (~2.5%)**. CPU profile our-code ≈ **1% wall (~260 ms)**. Median frame ≈ **2.3 ms** (2 ms Virtual build + 0.3 ms Projected apply). E6 steady-state **OK** on this browse class; adversarial prepend-stress remains ceiling test ([budgets.md](budgets.md)).

Dossier: `sidecar/lab-runs/2026-08-30T06-10-17-942Z-www.eneba.com` (`probes/cpu/summary.json`, `probes/metrics.json`).

---

## Key PP fixes already in tree (2026-08-29…30)

- **PP-LOOPBACK-DOC-INSTALL** — same-socket hello generation supersede; `waitEstablished({ afterGeneration })`.
- **PP-APPLY-GATE-OVERRUN** — `ProjectedApplyGate`; cap 64; overflow anti-loop (streak 3).
- **Cold resync on armed surface** — full recreate, not standby-only async.

Detail: [open.md](open.md) · [decision-log.md](decision-log.md) §L · §M.
