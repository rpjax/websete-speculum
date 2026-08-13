# PageProjection oracles — coverage truth (WP1/WP2)

Style: [SessionsTest MATRIX](../Speculum.Api.SessionsTest.Tests/MATRIX.md).  
Canon: [docs/page-projection/spec/engine-redesign.md](../../docs/page-projection/spec/engine-redesign.md) §7–§8.  
Policy: [docs/assert-failure-policy.md](../../docs/assert-failure-policy.md) — no soft-skip.

| ID | Oracle | Assert | Fixture / live |
|----|--------|--------|----------------|
| O1 | Visual P7 | Dual stills; ≤0.5% pixels **and** 0 structural regions (≥2% viewport or text-only-one-side) | Fixture blank-hero **FAIL** on current; live Beleza/Eneba/odds |
| O2 | Structural | F(V)↔mirror↔client isomorphic (CI full); prod = count+checksum | Fixture drift **FAIL**; live CI full |
| O3 | Budgets | Any P1–P7 / E1–E11 miss = fail | `fixtures/current-engine-sample` **FAIL** E2/E8/E1/E10/D1 |
| O4 | Density | Knee curve; `PP-DEN-2` baseline | Synthetic current-engine curve; knee ≪ 100 |
| O5 | Interaction | P4 ≤16ms (stalled net); P5 ≤RTT+50 | Current-engine fixture **FAIL** P4 (D6) |

**WP1 exit:** oracles that **pass** today's engine evidence are broken. Unit tests above assert FAIL on current fixtures (suite green = oracles correctly reject). Live stack job remains red until engine WP9+.

## Finish-100% lab (2026-08-12, continued)

**Stack:** dockup `dev` + nouinput; `client-config.operational: true`.

**Algorithm / harness landed this pass (not protocol-only PASS):**
- O1 Virtual still = Speculum Virtual viewport PNG via harness `screenshot` probe (+ `docker exec` path spill); Projected = iframe element viewport (not full `html` scrollHeight).
- O1 `diffMask` + structural flood-fill fixed (pixelmatch grayscale no longer counts as a structural region).
- O2 Virtual F prefers `__speculumPageProjectionV2.snapshotDocument` (closed-shadow aware); open-shadow fallback when API missing.
- CSSOM: re-inject in-page API before snapshot; fail establish when `styleSheets>0` but `ruleCount===0`; CDP enrich **exact URL match only** (no basename/order soft-match); checksum on ephemeral page (never mutates Virtual); client insertRule fail-closed (`cssom_apply_failed`).
- Settle fingerprint ignores carousel `innerText` churn (bucketed htmlLen).
- Client: `establishBegin` scroll + `documentState` before arm; refuse arm if `cssomInstall` never applied; Observe chrome hidden for O1; establish-miss → OOB resync watchdog (~20s).
- `liveAttach` orch ≤600 (S8); density baseline present.

**S6 live three-site accept:** **still open** — do **not** claim PASS from protocol-only signals.

| Site | Lab result (honest) |
|------|---------------------|
| example.com | O1+O2+O5+ASSET **PASS** (Speculum Virtual stills) |
| Beleza | **M3 in progress.** M2 arm/CSSOM/assets OK via `m2-surface-check`. Live `live-one` oracle: first successful arm showed **O1 FAIL** `diffPct≈12%` / 1 structural region (Projected blank hero vs Virtual full); **O2** `session_gone` mid-run; **ASSET** probe inflated by in-flight imgs. **Fixes:** L1 prefetch key = API serve key (`toDomAssetServeKey`); **ad-hoc purge** — checksum off Virtual (ephemeral page), auth buffer (no silent resync no-op), establish re-try, swapTimeout after cssomReady, CSSOM fail-closed, CSS-first prefetch concurrency 2. **Harness:** arm gate = `armed` + `docHtml>1000`; in-flight imgs ≠ broken; bucketed quiet before stills. **Not** an establish fix: raising `detachedSessionTimeout` (reverted). Accept (O1) still open. |
| Eneba | **M2 work:** arms styled (`docHtml`~365k, `ownedRules`~1839, `brokenImgs=0`). Prior black shell / auth brokenImgs closed via CSSOM fail-closed + live stamp. **O1/O2/O5 accept still open (M3).** |
| live-odds | **M2 isolated:** `www.flashscore.com` arms (`docHtml`~1.5M, `ownedRules`~7419, `brokenImgs=0`). Prior suite red = abort on upstream site / stack wedge — not odds-specific product bug. **Accept (O1/O2/O5) still open (M3).** |
| F8 V1 delete | **Done** (implementation cutover) — web DomProjector/DiffApplier/rewriteHtmlBodySelectors and sidecar mirror/dom PageProjection/DomTreeSerializer/parityUtil/VirtualEpochTelemetry removed; KEEP DomAssetCache/srcset/DomElementInput |

**Implementation completeness (cutover):** F8 done; `mirror/page` + `inpageScript` fragments ≤600 LOC; live O1/O2/O5 accept remains a separate frontier (not required for completeness).

**S8 LOC:** `liveAttach.ts` orch **≤600**; `inpageScript` concatenated from Core/Cssom/Observe fragments (≤600 each).

**Sites (live):** `www.belezanaweb.com.br`, Eneba soft-nav, live-odds (`SPECULUM_LIVE_ODDS_URL`).

**Runner:** `SPECULUM_LIVE_ORACLES=1 SPECULUM_BASE_URL=http://127.0.0.1:8080 npm run oracle:live` (patchright preferred). Diag: `node bin/diag-virtual-cssom.cjs <host>`.

**K1:** stills only — no Screencast / VideoStreaming for O1.
