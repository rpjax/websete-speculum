# PageProjection oracles — coverage truth (WP1/WP2)

Style: [SessionsTest MATRIX](../Speculum.Api.SessionsTest.Tests/MATRIX.md).  
Canon: [docs/page-projection-engine-redesign.md](../../docs/page-projection-engine-redesign.md) §7–§8.  
Policy: [docs/assert-failure-policy.md](../../docs/assert-failure-policy.md) — no soft-skip.

| ID | Oracle | Assert | Fixture / live |
|----|--------|--------|----------------|
| O1 | Visual P7 | Dual stills; ≤0.5% pixels **and** 0 structural regions (≥2% viewport or text-only-one-side) | Fixture blank-hero **FAIL** on current; live Beleza/Eneba/odds |
| O2 | Structural | F(V)↔mirror↔client isomorphic (CI full); prod = count+checksum | Fixture drift **FAIL**; live CI full |
| O3 | Budgets | Any P1–P7 / E1–E11 miss = fail | `fixtures/current-engine-sample` **FAIL** E2/E8/E1/E10/D1 |
| O4 | Density | Knee curve; `PP-DEN-2` baseline | Synthetic current-engine curve; knee ≪ 100 |
| O5 | Interaction | P4 ≤16ms (stalled net); P5 ≤RTT+50 | Current-engine fixture **FAIL** P4 (D6) |

**WP1 exit:** oracles that **pass** today's engine evidence are broken. Unit tests above assert FAIL on current fixtures (suite green = oracles correctly reject). Live stack job remains red until engine WP9+.

## Finish-100% / armed-gate lab (2026-08-12)

**F1–F6** remain in tree. **Armed gate unblocked** on V2:

| Fix | Root cause |
|-----|------------|
| Layout waiter | `waitForCanvasLayout` 600ms lost race after mirrorMode swap zeroed layout |
| Surface attach | `ProjectionClient.attachSurface` missed when ref null at client construct |
| Runner NSO | Per-site Navigation PUT hung; entry URL now carries `_w7s_nso` |
| Cssom before head | `cssomInstall` after `doc.open()` → `appendChild` on null; buffer until first chunk |
| Iframe `instanceof` | Parent-realm `instanceof Element` always false on iframe nodes → `clientNodeCount: 0` |
| Establish checksum | Element-only tag FNV (text/comment not isomorphic across HTML round-trip) |
| `contentDocument` | `Document.open()` can replace the Document object — handle reads frame fresh |

**Live O1/O2/O5 (latest lab):**

| Site | Armed | O1/O2/O5 |
|------|-------|----------|
| example.com (smoke) | yes | **PASS** (single-site `live-one.cjs`) |
| Beleza | yes (after checksum) | FAIL — O1 ~99% (Virtual often WAF/minimal `nodeCount≈10`; Projected partial) |
| Eneba | flaky | Often SignalR timeout after heavy prior session |
| live-odds | depends on env URL | example.com used as stand-in when unset |

**§9 V1 deletion (F8) stays blocked** until Beleza + Eneba + real odds pass. No soft-skip; protocol-only greens do not count.

### Redesign §5 audit (honest)

| Area | Status |
|------|--------|
| §5.1–§5.9 core V2 path | Implemented (identity, frames, binary wire, establish, surface, local-first) |
| §5.10 Cssom | Partial — W4 cross-origin rule bodies still TODO |
| §5.12 L2 asset cache | Code exists (`SharedAssetCacheL2`); not oracle-proven |
| §5.15 telemetry unit | Frame/Pool/PageEpoch added; E8 not gated |
| §9 LOC ceiling | `liveAttach.ts` still ≫ 300 LOC orchestration |
| §9 V1 deletion | Blocked on live greens |
| WP14 density / E6–E11 | Not calibrated |

**Sites (live):** `www.belezanaweb.com.br`, Eneba soft-nav, live-odds (`SPECULUM_LIVE_ODDS_URL`).

**Runner:** `SPECULUM_LIVE_ORACLES=1 SPECULUM_BASE_URL=http://127.0.0.1:8080 npm run oracle:live` (requires Playwright + operational stack). Diag: `node bin/armed-diag.cjs <host>`.

**K1:** stills only — no Screencast / VideoStreaming for O1.
