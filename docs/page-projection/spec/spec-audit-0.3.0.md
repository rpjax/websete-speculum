# PageProjection spec audit — M0 (0.3.0)

**Date:** 2026-08-31  
**Agent:** M0-Audit (Wave 0)  
**Scope:** `docs/page-projection/spec/` — audit only; no spec rewrites in this phase.  
**Authority:** [motor-migration.md](motor-migration.md) M0 · [../LIVE-PP-0.3.0-IMPLEMENTATION.md](../LIVE-PP-0.3.0-IMPLEMENTATION.md) §D.

**Method:** Read each file; for `STALE`, pair the exact normative sentence with contradicting code at `file:line`. Never guessed.

---

## Summary

| Status | Count |
|--------|------:|
| **CURRENT** | 22 |
| **STALE** | 9 |
| **UNKNOWN** | 0 |

**Top 5 STALE items blocking M1 / M8** (see §3): PP-WIRE-1, PP-LOAD-2, M1 URL resolution in .NET, M2/M3 .NET stream path, browser-session launch-script carrier.

---

## 1. File status table

Priority order first, then remaining spec files (alphabetical).

| File | Status | Notes |
|------|--------|-------|
| [browser-session.md](browser-session.md) | **STALE** | Session contracts mostly current; launch-script carrier + CDP timing rows contradict extension cutover (§2). |
| [frame-protocol.md](frame-protocol.md) | **CURRENT** | V4 opcode/apply canon; aligns with `packages/page-projection`. No contradicting code found in spot checks. |
| [input.md](input.md) | **STALE** | Top § canonical sparse-cdp is current; collapsed historical §2.1 still normatively describes `os-abs` opt-in path removed from code. |
| [input-v2.md](input-v2.md) | **STALE** | Self-marked SUPERSEDED; not a live path. **Propose archive** (§4). |
| [input-unified-design-draft.md](input-unified-design-draft.md) | **STALE** | Promoted header points at `input.md`; body is OS ABS / uinput design draft. **Propose archive** (§4). |
| [loopback.md](loopback.md) | **CURRENT** | LB-08…19; matches `packages/page-projection/src/core/loopback/` + `nodeDataPlane.ts`. |
| [observability.md](observability.md) | **CURRENT** | Probe vs event law; apply-gate events match `projectedApplyGate.ts`. |
| [open.md](open.md) | **CURRENT** | Living tracker; closed rows match decision-log / code. |
| [runtime-redesign.md](runtime-redesign.md) | **STALE** | §15 B3 still OPEN; test green per `motor-0.3.0.md`. §2 root-cause text references deleted `projectionRuntimeInstaller.ts`. |
| [acceptance.md](acceptance.md) | **CURRENT** | Constitution; no code contradiction. |
| [test-matrix.md](test-matrix.md) | **STALE** | `PP-WIRE-1` / `PP-LOAD-2` contradict .NET frame path (§2). |
| [support-matrix.md](support-matrix.md) | **CURRENT** | Published gaps; matches roadmap gates. |
| [README.md](README.md) | **CURRENT** | Index + Now box; points at migration work correctly. |
| [budgets.md](budgets.md) | **CURRENT** | K/P/E budgets; normative targets. |
| [context-bus.md](context-bus.md) | **CURRENT** | MessagePort transport matches runtime-redesign §0. |
| [csp.md](csp.md) | **CURRENT** | Document surgery law; `sidecar/browser/mirror/projection/session/csp/` exists. |
| [cssom.md](cssom.md) | **STALE** | C9 wire still describes `plane`/`operation` JSON envelope (§2). |
| [cssom-poll-algorithm.md](cssom-poll-algorithm.md) | **CURRENT** | Algorithm canon; matches sidecar poll path. |
| [cssom-sensor-journey.md](cssom-sensor-journey.md) | **CURRENT** | Narrative / rationale only. |
| [decision-log.md](decision-log.md) | **STALE** | Append-only log is correct as history; row D-SPEC-2 “STILL IN FORCE — API never parses body” contradicts code (§2). |
| [extension-plane.md](extension-plane.md) | **CURRENT** | EP carrier; matches `sidecar/extensions/speculum-pp/`. |
| [lab-design.md](lab-design.md) | **CURRENT** | Lab architecture; no product-code contradiction found. |
| [motor-0.3.0.md](motor-0.3.0.md) | **CURRENT** | Release scope + verified evidence table. |
| [motor-migration.md](motor-migration.md) | **CURRENT** | Target architecture + verified delta (intentionally documents pre-migration .NET behaviour). |
| [multi-document.md](multi-document.md) | **CURRENT** | OPEN-6 law; matches `initContext` / per-window instances. |
| [oracles.md](oracles.md) | **STALE** | O5 row claims input plane “not cut over”; lab sparse-cdp suite is green (§2). |
| [roadmap.md](roadmap.md) | **CURRENT** | Gate ordering; no contradiction found. |
| [seal-gaps.md](seal-gaps.md) | **CURRENT** | Lab tracker; references match shipped seals. |
| [shadow.md](shadow.md) | **CURRENT** | Open shadow law; matches frame-protocol + apply. |
| [subtrees.md](subtrees.md) | **CURRENT** | Two subtree kinds; matches multi-document split. |
| [virtual-assets.md](virtual-assets.md) | **CURRENT** | Serve plane; matches sidecar rewrite + L1/L2 path. |

---

## 2. STALE claims (sentence + contradicting code)

### browser-session.md

| Sentence | Code |
|----------|------|
| “**Carrier** \| **Same CDP bundle** as the projection runtime (`ProjectionRuntimeInstaller` / `buildProjectionInjectBundle`).” | Runtime is extension MAIN (`runtime-redesign.md` §0); `buildProjectionInjectBundle` / `ProjectionRuntimeInstaller` **absent** from `sidecar/` (glob 2026-08-31). Session uses extension template: `PageProjectionBrowserSession.ts` (extension C2 path). |
| “**Targets** \| Registered on **every** CDP browsing-context target (page + OOPIF), same as Virtual.” | `PageProjectionBrowserSession.ts:1556-1558` — launch scripts resolved for extension `SessionConfig` gate, not per-CDP-target `onNewDocument`. |
| “CDP timing is document-start (`onNewDocument` / lateBoot), not Head/Body HTML slots.” | Extension `document_start` boot per `runtime-redesign.md` §0 sketch; CDP `lateBoot` path deleted with `projectionRuntimeInstaller.ts`. |

### input.md (historical collapsed §2.1 — still readable as law)

| Sentence | Code |
|----------|------|
| “`'os-abs'` … is **frozen legacy** — opt-in only via `BrowserLaunchOptions.pageProjectionInputAdapterKind: 'os-abs'`” | `sidecar/browser/input/createInputAdapter.ts:1-20` — factory accepts **only** `'sparse-cdp'`; comment: “OS ABS (`os-abs`) was **removed** from the codebase”. `osAbsInputAdapter.ts` **not present** in tree. |
| “Two `ClickDeliveryStrategy` variants now coexist … `'census-coordinated'` \| `'live-node-resolve'`” | `sidecar/browser/input/clickDelivery.ts:2` — “live-node resolve **only** (sparse-cdp)”. `EventApplier.ts:2` — “sparse-cdp / live-node only”. |

### test-matrix.md

| Sentence | Code |
|----------|------|
| “`PP-WIRE-1` \| The API never parses a frame body; relay cost is O(1) in payload size” | `GrpcSessionMappers.cs:694-769` — legacy V1 path `JsonDocument.Parse` + `ParseDomNode` / `ParseDomSelector` when `plane`+`operation` set. `PageProjectionFrame.cs` + `DomNode.cs` under `Sessions/Mirror/PageProjection/`. |
| “`PP-LOAD-2` \| `QueueDropped` is zero under sustained overload; drops occur only on genuine faults” | `GrpcSessionConnection.cs:1087-1101` — `SequencedDiffChannels.WriteDropAllOnOverflowDetailedAsync` publishes `QueueDropped` on overflow. Channel created at `:106`. |

### cssom.md (C9 — wire)

| Sentence | Code |
|----------|------|
| “envelope = `{ generation, sequence, plane, operation, payload… }`” (one pipe, plane tag) | `proto/browser_session.proto` `PageProjectionFrame` — `body` opaque bytes; `plane`/`operation` deprecated for binary frames. `GrpcSessionMappers.cs:655-679` — empty plane/operation ⇒ relay `Body` only. Canon: [frame-protocol.md](frame-protocol.md) §5.5 binary frames. |

### runtime-redesign.md

| Sentence | Code |
|----------|------|
| “### B3 — a .NET test is failing — **OPEN**” (`SessionCollectorTests.TimedOut_DoesNotFireAfterReattachClaimRace`) | Test exists and asserts pass path: `Speculum.Api.Sessions.Tests/SessionCollectorTests.cs:123-148`. `motor-0.3.0.md` marks **DONE 2026-08-31**. |
| “`projectionRuntimeInstaller.ts` … **whole file** — lateBoot, probe, settle, coalesce” (§14 deletion table) | File **not in tree** (glob 2026-08-31). Correct as deletion intent; §2 “verified against code” prose still reads as **current** anti-model — stale framing post-cutover. |

### oracles.md

| Sentence | Code |
|----------|------|
| “**O5** … Not in lab tree (**input plane not cut over**)” | `input.md:9` — Docker blueprints **10/10 PASS** sparse-cdp V1 (2026-08-28). `PageProjectionBrowserSession.ts:326` — `createInputAdapter('sparse-cdp', …)` only. |

### decision-log.md

| Sentence | Code |
|----------|------|
| “D-SPEC-2 … Accumulate/flush/encode **in-page**; **API never parses body**; no JSON on path \| **STILL IN FORCE**” | Same as `PP-WIRE-1`: `GrpcSessionMappers.cs:694-769`. Domain types `Sessions/Mirror/PageProjection/*` still materialised. |

---

## 3. .NET stream-work sentences (migration-invalidated)

Spec sentences that describe .NET doing motor stream work today. These must be rewritten in the phase that removes the behaviour (M1–M8), not in M0.

| Spec sentence | Migration phase | Contradicting code |
|---------------|-----------------|-------------------|
| `test-matrix.md` — “The API never parses a frame body” (`PP-WIRE-1`) | M4 | `GrpcSessionMappers.cs:650-769` |
| `test-matrix.md` — “`QueueDropped` is zero under sustained overload” (`PP-LOAD-2`) | M3 | `GrpcSessionConnection.cs:106`, `:1087-1101` |
| `decision-log.md` — D-SPEC-2 “API never parses body” STILL IN FORCE | M4 | same as PP-WIRE-1 |
| `cssom.md` C9 — `ILiveSession` / `AdmitDomProjectionInput` rename table (implies .NET owns admission naming on live path) | M2 | `ILiveSession.cs:89` — `AdmitPageProjectionInput`; `LiveSession.cs:1674` — `PageProjectionIntentAdmissionChannel.Create()` coalesces |
| `browser-session.md` §9.10 — “History … `ISessionConnection` does **not** expose GoBack/GoForward`” | — (CURRENT today) | `ISessionConnection.cs:54-170` — no GoBack/GoForward members (verified) |
| Implicit via `motor-migration.md` §3 (not duplicated here) — .NET coalesces intents | M2 | `PageProjectionIntentAdmissionChannel.cs`; `LiveSession.cs:56,1674` |
| Implicit — .NET drops projection frames | M3 | `SequencedDiffChannels.cs`; `GrpcSessionConnection.cs:106,1087` |
| Implicit — .NET URL mirror (`ProjectToClient` / `Resolve`) | M1 | `UrlResolver.cs:11-316`; `Program.cs:45` DI |
| Implicit — .NET shared asset L2 | M5 | `SharedAssetCacheL2.cs`; `LiveSession.cs:35,77` |
| Implicit — .NET parses motor parity telemetry | M6 | `PageProjectionParityTelemetryJournal.cs` |
| Implicit — per-session `Control` on shared `GrpcChannel` | M8 | `GrpcSessionConnection.cs:167`; `GrpcBrowserClient.cs:40` |

---

## 4. INVESTIGATE — input doc lineage

| File | Live path? | Verdict |
|------|------------|---------|
| [input.md](input.md) | **Yes** | **Canonical** for sparse-cdp V1. Top §13–37 is normative; collapsed `<details>` block is explicitly historical OS unified seal — but §2.1 inside it still wrongly describes `os-abs` as opt-in (STALE prose inside CURRENT file). |
| [input-v2.md](input-v2.md) | **No** | Header: “**SUPERSEDED** — do **not** implement.” Mode A/B/C CDP purged 2026-08-26. **Propose move to `docs/page-projection/archive/`** — do not delete (provenance). |
| [input-unified-design-draft.md](input-unified-design-draft.md) | **No** as normative | Header: “**PROMOTED** → normative input.md”. Long-form D-UI register + OS ABS pipeline. `os-abs` adapter **removed** from codebase; draft body is design history. **Propose archive** alongside `input-v2.md`; keep cross-links from `input.md` / `decision-log.md`. |

**README.md** already states: “OS unified seal is historical record only; input-v2.md superseded / purged” — index is correct; archive proposal is hygiene only.

---

## 5. Phase → spec files to update (M0 DoD pointer)

| Phase | Spec files that must be updated when the phase lands |
|-------|------------------------------------------------------|
| **M1** | `browser-session.md` (outbound URL inventory), `virtual-assets.md`, `decision-log.md` |
| **M2** | `test-matrix.md` (`PP-IN-*` admission), `browser-session.md` (pushInput backpressure note) |
| **M3** | `test-matrix.md` (`PP-LOAD-2`, `PP-WIRE-1`), `decision-log.md` (D-SPEC-2), `browser-session.md` (`frameQueueCapacity` semantics) |
| **M4** | `test-matrix.md` (`PP-WIRE-*`), `cssom.md` (C9 wire), `frame-protocol.md` (proto hygiene §6) |
| **M5** | `virtual-assets.md`, `test-matrix.md` (`PP-ASSET-5..8`, `PP-ISO-*`) |
| **M6** | `observability.md`, `browser-session.md` (telemetry DTOs), `frame-protocol.md` |
| **M8** | `browser-session.md` §6 wire, `motor-migration.md` (close delta rows) |
| **Hygiene** | Archive `input-v2.md`, `input-unified-design-draft.md`; fix `runtime-redesign.md` §15 B3; trim `browser-session.md` launch-script CDP rows |

---

## 6. M0 definition of done

- [x] This file exists.
- [x] Every file in `docs/page-projection/spec/` has `CURRENT` / `STALE` / `UNKNOWN`.
- [x] Every `STALE` row has sentence + `file:line` evidence.
- [x] .NET stream-work flags listed (§3).
- [x] Input doc INVESTIGATE answered (§4).
- [ ] **Not in M0:** rewriting spec files — deferred to M1–M8 / hygiene commit.
