# Live PP → 0.3.0 — implementation order

**What this document is:** the complete, ordered work list for **0.3.0**. Everything inside it
blocks the release; nothing outside it does. 0.3.0 is the next release and it contains all of
A, B and D. This is settled — do not re-derive it, do not introduce another version number.

**What this document is not:** it does not restate specs. Normative sources:
[spec/motor-0.3.0.md](spec/motor-0.3.0.md) (tag gates) ·
[spec/motor-migration.md](spec/motor-migration.md) (migration §D, `file:line` evidence) ·
[spec/acceptance.md](spec/acceptance.md) (1:1 accept) · [spec/open.md](spec/open.md) ·
[spec/browser-session.md](spec/browser-session.md).

**Last verified:** 2026-08-31.

---

## Status legend — use exactly these, nothing else

| Mark | Meaning |
|------|---------|
| `[x]` | **Done.** Evidence exists and is named in the row. |
| `[ ]` | **Open.** Not started or in progress. |
| `[-]` | **Deferred by decision.** Written reason + where the limitation is recorded. Never silently reopened. |
| `[~]` | **Withdrawn.** Decided against; kept only so nobody proposes it again. |

A row without evidence is not `[x]`. "Compiles" is not evidence. "Landed" is not evidence.
Evidence is a dossier path, a test name, or a `file:line`.

---

## Execution order — one sequence, stated once

Any other ordering in any file is wrong; fix it there, not here.

```
A (motor gates) → B (Live preview) → D (motor migration) → tag v0.3.0 → C (prod RBI, not a gate)
```

- **A is finished** except cutting the tag (A6), which happens last, after B and D.
- **B before D.** B validates the Live path as it exists today; D then rebuilds parts of it.
  Running D first means validating the same path twice.
- **C does not gate this release.**

---

## 1 — A — motor gates: closed

Gates live in [motor-0.3.0.md](spec/motor-0.3.0.md). Reproduced here as state only.

| Gate | State | Evidence |
|------|-------|----------|
| **A0** iOS/CSP · K5 | `[x]` code+unit / `[-]` device | CSP `script-src 'none'; object-src 'none'` in `PROJECTED_STANDARDS_SRCDOC` + `ensureProjectedK5Csp`; no `iframe.sandbox` anywhere (static assert in unit); regression fixture `k5-script-block.html` — `data-k5-probe` never set with CSP, control without CSP does run, Chromium fail-closed without `CHROME_EXECUTABLE`. **Deferred:** iPhone Safari `emitted > 0` — no device 2026-08-31; limitation recorded in motor-0.3.0 "does not promise" |
| **A1** nested gen-pack revert | `[x]` | Packing `(rootGen << 16) \| installIndex` removed from wire; monotonic per-`contextId` mint in the same `initContext` answer; property units (monotonic / never reused / no reset on root reinstall); normative line in [frame-protocol.md](spec/frame-protocol.md) |
| **A2** Eneba `/` → `/br/` | `[-]` partial → limitation | Soak `sidecar/lab-runs/2026-08-31T01-07-05-005Z-soak`: Virtual desync 0, invariants green, nested ctx 2/3 present. **Not observed:** redirect gen bump (`generation` stayed `1` across 49 frames). **Not exercised:** Projected apply gate (`applyOk: 0` — soak CLI has no DOM client). Full proof is **B5c** below |
| **A3** SessionCollector race | `[x]` | `SessionCollectorTests.TimedOut_DoesNotFireAfterReattachClaimRace` PASS 2026-08-31 |
| **A4** Windows / full gates | `[x]` | `cd sidecar && npm test` + build with `CHROME_EXECUTABLE` set (K5 Chromium probe ran); dotnet A3 PASS. Pre-existing blockers fixed: `mintHold` mock `localName`, `projectedInputCapture` mock `document`/`closest`, nativeGuard null-safe |
| **A5** honest limitations | `[x]` | motor-0.3.0 "does not promise" updated (empty `verdicts.json`, A2 partial, iPhone open); `CHANGELOG.md [0.3.0]`; `version.txt` = `0.3.0` |
| **A6** cut tag | `[ ]` | Cut `v0.3.0` after §4 — last step, not first. **Do not claim** RBI, sealed 1:1 accept, or "iPhone proven" |

**Baseline dossier for the motor claim:** `sidecar/lab-runs/2026-08-30T06-10-17-942Z-www.eneba.com`
(`/br/` direct — 33k+ wire invariant checks 0 fail, apply 96 ok / 0 fail, desync 0, input 44/44,
our-code CPU ≈1% wall).

---

## 2 — B: Live preview

Goal: an operator turns PP on in the full stack and CI proves **effect**, never a green hop.

### Already closed in B

| Item | State | Evidence |
|------|-------|----------|
| **B1** default + seed = PageProjection | `[x]` | `SessionsConfiguration.MirrorMode` default PageProjection (VideoStreaming = legacy); Admin `SESSIONS_BASELINE` + fill/summarize; `deploy/dockup.json` (dev/test/prod) and `docker-compose.sessions-test.yml` set `Sessions__MirrorMode=PageProjection`; SPA PreStart / `normalizeMirrorMode` / mocks; docs (Admin Mirror = DOM projection, env first-boot, old SQLite = GET→patch→PUT) |
| **B2** SessionsTest PP category | `[x]` code / `[ ]` proof | Real `Category=PageProjection` filter (not reusing VideoStreamingInput asserts as PP proof). PP1 frame body + `contextId` + sequence · PP2 intent click → `#out[data-clicks]` in the Virtual · PP3 resync HTTP → resync frame + Virtual ready · PP4 NavigationBlocked → `Redirect`. MATRIX.md depth updated; CI filter added, C*/H1 forced to `videoStreaming`. **Proof missing — see B2b** |
| **B3** pre-V4 contract cleanup | `[x]` | `establish_chunk_bytes` / `client_state_ms` obsolete, `ReportClientState` purged, mappers do not send dead knobs; journal/admin catalog: DomMap* = legacy, `ResyncServed`/`ResyncRequested` = frame in stream; header in `PageProjectionBrowserSession.ts`; GoBack/GoForward = intent-only (Conn does not call the unary). **Field removal from the proto itself is D/M6, not done here** |

### Open in B — these block the release

---

#### B2b — Run the PP category in CI

The code exists; it has never been run against the stack.

- [ ] Bring up the SessionsTest compose and run `Category=PageProjection`
- [ ] Attach the run output to the PR — **PR:** https://github.com/rpjax/websete-speculum/pull/9 (pushed 2026-08-31; CI proof pending)

**Done when:** PP1–PP4 pass in the compose CI run, and the run is linked. Compiling is not passing.

**Refs:** `Speculum.Api.SessionsTest.Tests` · `.github/workflows/ci.yml` ·
[MATRIX.md](../../Speculum.Api.SessionsTest.Tests/MATRIX.md)

---

#### B4 — `PP-HARDNAV-PLANE-ACK`

Race on hello-ack after a hard navigation, on the extension Port path.

- [ ] **First, answer this and report:** is this the same family as the already-fixed same-socket
      generation supersede (`nodeDataPlane` + `waitEstablished({ afterGeneration })`)? If yes,
      the fix **converges with that mechanism**. Do not create a second way to establish.
- [ ] Fix
- [ ] Lab dossier on a real site with a hard navigation

**Done when:** in a hard-nav dossier, `data_plane_not_established` appears **zero times after the
hard nav completes**. If some occurrences are legitimate, they must carry a **distinct reason
code** and the criterion becomes "zero of code X". The word "false" must not appear in the
criterion — a criterion that needs a human to classify occurrences is not a criterion.

**Refs:** [spec/open.md](spec/open.md) · `sidecar/browser/mirror/projection/session/nodeDataPlane.ts`

---

#### B5 — Live coverage of what landed

**Naming correction:** this is **new coverage**, not regression. Three of the four paths below
have never been exercised at the Live level. Size the work accordingly — four end-to-end Live
tests against the full stack is not one day.

- [ ] **B5.1** allowlist main-frame + `Redirect` reaching the client
- [ ] **B5.2** restore/export LS + IDB round-trip on a profile
- [ ] **B5.3** PermissionGate → `Control` → SessionHooks: default **deny**; a registered grant
      allows, proven in the test
- [ ] **B5.4** `Sessions.CpuProfiling=true` → probes registered

**Done when:** each assertion is on **observed state or event**, never on a `200`. For B5.4 the
assertion is *"the flag propagates and probes are registered"* — write it exactly that way in the
test name. It does **not** prove profiling works (no Start RPC yet), and must not be counted as
such.

---

#### B5b — PP5: LS/IDB assertion in SessionsTest

Split out of B2 and never placed. **Decide once:** it lives here, at SessionsTest level, and is
distinct from B5.2 which is Live level.

- [ ] Restore profile with LS/IDB → assert counts / probe. **No soft-skip** — a skipped test is
      an open gap, not a pass.

---

#### B5c — Eneba `/` → `/br/` full proof

Carried over from A2, which shipped as a limitation.

- [ ] Re-run with the lab DOM client (headed), not the soak CLI

**Oracle / timing (2026-08-31):** Prior integrator verdict rejected — dossier
`sidecar/lab-runs/2026-08-31T10-13-07-798Z-eneba-turnstile` had **oracle defects**, not product
failures. **Classification deferred** until re-run after fixes.

| Defect | Evidence | Fix |
|--------|----------|-----|
| **(A) head off-by-one** | `iso.tree` 20 divergences; `html[0]` `child_count_mismatch` virtual=11 client=12 — extra parser scaffold in Projected srcdoc `head`; `html` `style` is surface-only | `structuralDiff.ts` — fingerprint child alignment + parser-scaffold exclusion under `html>head` (structural, not tag allowlist); omit `style` on `<html>` from attr compare |
| **(B) URL rewrite** | 6× `attr_mismatch` on `href`/`src`: virtual=`/favicon.ico` vs client=`/w7s/virtual-assets/…?speculum-session-token=…` | Same file — `normalizeUrlAttrValue` via `classifyAndRewriteUrl` / `httpUrlToVirtual`; session/cache-bust query stripped |
| **Table hash false red** | `iso.table` `hash mismatch` with `virtual rows=92 client rows=92` | Oracle: structural diff must not fail B5c when table digests match — root cause (A)+(B) |
| **Widget INDETERMINATE** | `turnstile.virtual.nestedContext` pass (ctx 2,3); `liveDom` `iframeCount=0`; `iso.context` 2/3 `gone` SKIPPED `nested context absent (post-drop)` | `turnstileDiagnostic.ts` — single `haltClocks` instant for `contextIds`, live DOM, nested peek, and iso (timing instrument) |

**Land (code):** `structuralDiff.ts` boundary + `isomorphism.ts` `pageBaseUrl`; `turnstileDiagnostic.ts` atomic probe; unit `testStructuralDiffOracleNormalization` (`sidecar/unit.ts`).

**Re-run:** `npm run lab:eneba-turnstile` (headed) → new dossier. **Gate stays open** — no B5c classification until re-run proves redirect + gen bump + nested Turnstile + apply gate together.

**Done when:** one dossier shows all four in the same run — redirect followed, generation bump
observed, Turnstile nested context established, Projected apply gate exercised (`applyOk > 0`)
with no `sequence_gap` burst. Anything less stays a limitation; do not soften the criterion.

---

## 3 — D: motor migration .NET → sidecar

**Normative:** [spec/motor-migration.md](spec/motor-migration.md) — phases, `file:line` evidence,
work rules, stop rules. This section is the index, not a second copy.

### Target architecture (owner-specified)

```text
client ──socket──► .NET ──── control socket ────► sidecar   permanent, host level, NEVER closes
                    │
                    └──── session socket (gRPC) ─► sidecar   one per session, carries EVERYTHING
```

- **.NET** persists the session (identity, journal, config), starts the `BrowserSession` and opens
  that session's socket.
- **.NET on the stream path = dumb pipe.** No coalescing, dropping, parsing or reframing of PP
  payload (I1).
- **Sidecar reads no config at runtime** — immutable snapshot injected at Launch (I2).
- **Backpressure:** the motor decides what may be discarded; .NET only **reports** consumer
  pressure (I3).
- **The one in-session decision .NET owns:** permission hooks (cam/mic/geo) → SignalR → consumer.
- **Attach / fan-out** (`SessionBindingRegistry`, `SessionOutputFanOut`, …) **stays** — correct as
  designed, do not redesign (I7).

### Invariants

I1 dumb pipe · I2 config only at Launch · I3 backpressure in the motor · I4 DOM concepts only in
`packages/page-projection` · I5 port + immutable config record · I6 K2/K5 with browser-level tests ·
I7 attach layer untouched · I8 session-scoped messages ride the session socket, never the host
control socket.

### What D removes from .NET (verified 2026-08-31 — re-verify before deleting)

| Violation | Evidence | Phase |
|-----------|----------|-------|
| Coalesces PP intents | `PageProjectionIntentAdmissionChannel.cs` · `LiveSession.cs:56,1674` | M2 |
| Coalesces video input | `VideoStreamingInputAdmissionChannel.cs` · `LiveSession.cs:54,1624` | M2 |
| Drops frames + sequence bookkeeping | `SequencedDiffChannels.cs` · `GrpcSessionConnection.cs:106,1087` | M3 |
| Materialises the frame as a typed object | `GrpcSessionConnection.cs:19,451` · `Mirror/PageProjection/*` | M4 |
| Owns the shared asset tier | `SharedAssetCacheL2.cs` · `LiveSession.cs:35` | M5 |
| Parses motor telemetry payloads | `PageProjectionParityTelemetryJournal.cs` | M6 |
| Owns URL resolution / mirroring | `UrlResolver.cs` (639) | M1 |
| ~~Per-session `Control` + one shared channel~~ | **LANDED M8** — `GrpcBrowserClient._hostControl` + `PumpHostControlAsync` (`GrpcBrowserClient.cs:36-37,57,333`); per-session `GrpcChannel` at `StartConnectionAsync` (`:249-265`); proto `HostControl` `proto/browser_session.proto:814`; density 100 sessions `hostControlSocket.unit.ts:13,91` wired `unit.ts:4364` | M8 `[x]` |

**Already correct — do not "fix":** opaque `PageProjectionFrame` in the proto (`proto:379`);
Launch snapshot as the injection point; `SessionConfigAssembler` / `LaunchScriptResolver`;
separate HTTP/2 streams per RPC (no head-of-line problem).

### Phases

| Order | Phase | Depends on | Delivers |
|-------|-------|------------|----------|
| 1 | **M0** spec audit | — | `spec/spec-audit-0.3.0.md`: every spec file `CURRENT`/`STALE`/`UNKNOWN`, each `STALE` sentence paired with the `file:line` that contradicts it. No rewriting yet |
| 2 | **M1** `IUrlResolver` → sidecar | M0 | `NavigationPolicy` injected at Launch; .NET keeps only the pre-session entry resolve; written inventory of every outbound URL surface |
| 3 | **M8** host control vs session socket | M0 | `[x]` Permanent host control stream (`GrpcBrowserClient._hostControl`/`PumpHostControlAsync`); per-session `GrpcChannel` (`StartConnectionAsync`); proto `HostControl` (`proto:814`); density test 100 sessions (`hostControlSocket.unit.ts:13,91`, `unit.ts:4364`) |
| 4 | **M2** delete .NET coalescing | M8 | Admission channels and their tests deleted; sidecar coverage confirmed first |
| 5 | **M3** delete .NET frame drop + `ConsumerPressure` | M8, M2 | .NET reports, motor reacts; slow consumer never yields a silent gap |
| 6 | **M4** delete C# DOM types | — | .NET relays opaque envelopes; grep clean |
| 7 | **M5** shared asset tier → sidecar | M4 | K2 browser-level test (session A's credentialed bytes never reach session B) |
| 8 | **M6** telemetry inversion | M4 | Sidecar emits typed lifecycle; `parity_*` parsing deleted from C#; dead proto fields removed |
| 9 | **M7** decompose `LiveSession` | M1–M6, M8 | Only after the motor has left the file |

**One phase = one revertible PR.** Never mix phases in one commit.

**VideoStreaming** is out of scope except M2's deletion of its coalescing (that is stream-path
logic in .NET). Whether the video path survives at all is a separate front — if a phase forces
that decision, **stop and ask**.

### B3 → D bridge

| Closed in B3 | Completed in D |
|--------------|----------------|
| `establish_chunk_bytes` / `client_state_ms` obsolete; mappers do not send them | **M6:** remove the fields from the proto, not merely ignore them |
| DomMap* / Resync copy = frame in stream | **M6:** sidecar emits typed lifecycle; zero motor parsing in C# |
| GoBack/GoForward intent-only | **M1:** history URLs enter the outbound `ProjectToClient` inventory |

### Pre-1.0 proto hygiene (lands with M4/M6)

One commit, .NET + sidecar + [frame-protocol.md](spec/frame-protocol.md) together: remove
`plane` / `operation`, `establish_chunk_bytes`, `anchor` in `DomInputEvent`; document or reuse the
field-number gaps. Detail in [motor-migration.md](spec/motor-migration.md) §6.

### D definition of done

- [ ] `grep -E 'Dom(Node|Selector|Asset)\b|PageProjectionIntentAdmission|VideoStreamingInputAdmission|SequencedDiff'` under `Speculum.Api/Sessions/Mirror` and `Speculum.Api/Sessions/Services/Streaming` returns nothing (**narrow scope** — migration stream-path only; not Journal/Telemetry/resize coalescer/proto `GetDomAsset`/`DomSelector` RPC names)
- [ ] `Speculum.Api` compiles with no reference to `Mirror/PageProjection` types
- [ ] Sidecar session performs no config read at runtime — enforced by an extended
      `check:page-projection-boundaries`
- [ ] Slow consumer produces frames **or** a resync **or** a disconnect with a reason code —
      never a hole
- [ ] K2 and K5 browser-level regression tests pass
- [ ] M0 `spec-audit-0.3.0.md` hygiene: `input-v2.md` + `input-unified-design-draft.md` archived (2026-08-31); remaining STALE rows are **post-0.3.0 follow-up** (see below) — not 0.3.0 gate
- [ ] Windows full gates green **and** `Category=PageProjection` actually run in CI

### D STALE disposition (M0 audit — 2026-08-31)

| File | 0.3.0 action |
|------|----------------|
| [archive/input-v2.md](archive/input-v2.md) | **Archived** from `spec/` 2026-08-31 |
| [archive/input-unified-design-draft.md](archive/input-unified-design-draft.md) | **Archived** from `spec/` 2026-08-31 |
| `browser-session.md`, `input.md`, `runtime-redesign.md`, `test-matrix.md`, `cssom.md`, `decision-log.md`, `oracles.md` | **Post-0.3.0 follow-up** — rewrite or trim per `spec-audit-0.3.0.md` §2–§5 when the matching M-phase lands; **not** release gate |

### D stop rules

Adding a queue, counter or opcode to make a phase work → **stop and report**: the boundary is in
the wrong place. A test that was never seen red → **stop and report**. An INVESTIGATE item that
cannot be answered from the code → **stop and ask**.

---

## 4 — Release gate

0.3.0 ships when **all** of these hold. Nothing else blocks it.

- [ ] B2b: `Category=PageProjection` green in a real CI run
- [ ] B4: hard-nav dossier with zero `data_plane_not_established` after the nav
- [ ] B5.1–B5.4 green, each asserting state or event
- [ ] B5b: PP5 LS/IDB asserted, not skipped
- [ ] B5c: one dossier proving redirect + gen bump + nested Turnstile + apply gate together
- [ ] D definition of done, fully
- [ ] `CHANGELOG.md [0.3.0]` current, with the limitations that remain
- [ ] `version.txt` = `0.3.0`
- [ ] A6: tag `v0.3.0` cut

**Still not promised** — write these into the changelog, do not let a user discover them:
antibot / stealth (the challenge fails 100%; investigation not started), datacenter IP,
sealed 1:1 accept, canvas, nested render inside shadow, media ingress (`PushCamera` /
`PushMicrophone` are no-ops), `PutDomUpload` (no-op).

---

## 5 — Out of scope (C — prod RBI)

Tracked here so nobody pulls one in mid-phase. None of these gate this release.

| Item | Scope |
|------|-------|
| **C1** canvas (gate 7) | Real canvas content in `@speculum/page-projection`, wire → apply, visual oracle |
| **C2** MotorAssert / Live deep | Compose seed PP for MotorAssert; deep intents + parity probes, not smoke |
| **C3** antibot / stealth V3 | Spike on real Turnstile/CF; bisect patchright vs extension. **Without this, do not call it production RBI** |
| **C4** 1:1 accept | Oracles O1/O2/O5 on baseline sites. Never PASS on protocol-only signals (`200`, WD>N, htmlLen) |
| **C5** assets / upload / media | Real asset store; `PutDomUpload` implemented or removed from the Live path; MediaIngress + Conn `PushCamera`/`PushMicrophone` if the product needs GUM |
| **C6** nested XO limits | Strategy without XFO punching (`PP-ASSET-XFO`); about:blank / srcdoc / opaque sandbox per [open.md](spec/open.md) |
| **C7** multi-session density | Two-Chrome live C2 smoke; frame-queue backpressure under load. **Overlaps M8:** the N-session density test is M8's DoD — write it once, use it for both |
| **C8** close the scratchpads | Archive [CUTOVER-WORKSPACE.md](CUTOVER-WORKSPACE.md); fold this file's residue into open.md |

---

## 6 — Contract gaps (documented, not silent)

| Item | Sidecar | .NET | Disposition |
|------|---------|------|-------------|
| `PutDomUpload` | handler ok; PP `putUpload` **no-op** | `PutDomUploadAsync` exists | C5 — implement or remove from the Live path |
| `PushCamera` / `PushMicrophone` | handler; PP **no-op** | streams never opened | C5 — MediaIngress + Conn pump |
| `GoBack` / `GoForward` unary | present | Conn does not call it | `[x]` B3 — intent-only, documented |
| Lab RPCs (`HaltClocks`, `EmitFrame`, `GetStateSnapshot`) | present | no client | `[~]` deliberate — never wire these into prod |
| `startCpuProfile` / `stopCpuProfile` | in-process + Launch flag | flag only | `[-]` acceptable for this release; add the RPC only if Live diagnosis demands it |
| Pre-V4 Launch knobs | deprecated in proto | obsolete; mappers do not send | `[ ]` **M6** removes them from the proto |
| Telemetry `Establish.DomMap*` / Resync "OOB" | — | legacy copy | `[ ]` **M6** — sidecar emits typed, C# parsing deleted |

---

## 7 — Do not reopen

| Item | Why |
|------|-----|
| Per-session `c2-endpoint.json` (B1 of the old numbering) | `[x]` shipped 2026-08-29 — `materializeSpeculumPpForSession` + isolation unit |
| `managedTabId` fail-closed gate | `[~]` withdrawn — product law is 1 session = 1 tab; protocol deleted 2026-08-29 |
| Anything under `docs/page-projection/archive/` | Not a source of implementation |
| Lab RPCs in production | Never |
| Accept declared from `hopdiag` / `ResyncServed` / `ownedRules` alone | Protocol-only signals are not acceptance |
| Re-adding "temporary" drop/coalesce in .NET during D | Revert the whole phase instead |

---

## 8 — Anchors

| Topic | Path |
|-------|------|
| Tag gates | [spec/motor-0.3.0.md](spec/motor-0.3.0.md) |
| Migration (normative) | [spec/motor-migration.md](spec/motor-migration.md) |
| Named open items | [spec/open.md](spec/open.md) |
| Session sealed contract | [spec/browser-session.md](spec/browser-session.md) |
| Acceptance | [spec/acceptance.md](spec/acceptance.md) |
| Roadmap M1 | [spec/roadmap.md](spec/roadmap.md) |
| Proto | `proto/browser_session.proto` |
| Sidecar PP session | `sidecar/browser/mirror/projection/session/PageProjectionBrowserSession.ts` |
| Sidecar gRPC service | `sidecar/grpc/BrowserSessionService.ts` |
| Api connection | `Speculum.Api/BrowserClients/Grpc/GrpcSessionConnection.cs` |
| Api mappers | `Speculum.Api/BrowserClients/Grpc/GrpcSessionMappers.cs` |
| Web surface | `web/src/features/sessions/live/SessionMirrorSurface.tsx` |
