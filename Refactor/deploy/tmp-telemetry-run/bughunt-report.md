# Bug hunt report (2026-08-09)

## Setup
- Live: `http://127.0.0.1:8080/` (PageProjection)
- First pass: `Navigation.defaultTargetHost=www.belezanaweb.com.br` → Akamai **Access Denied** (projected correctly; not a Speculum paint bug)
- Retest: host switched to `www.eneba.com` (no polluted `?_bughunt=` on start URL)
- Session (eneba): `c82ed6e8-30ab-4c06-8304-74726ae71c93`
- Wheel probe: `75ec4723-04b1-4050-9ed6-18698513b7cc` (ΔscrollTop **+2781**)

## Verdict
On Eneba, cold paint + CSSOM arm, Diff apply, and viewport scroll **work**. The “bem bugado” feel is mostly: (1) WAF-blocked default host, (2) SoftNav / modal stealing clicks, (3) empty/lazy product shells after scroll, (4) residual input noise.

## Findings

### BLOCKER (environment)
| ID | Evidence |
|----|----------|
| **TARGET_WAF_ACCESS_DENIED** | Beleza projects Akamai “Access Denied” (`edgesuite.net` ref). Sparse tree, no scroll range, no nav/search — expected for that HTML. |

### HIGH
| ID | Evidence | Notes |
|----|----------|-------|
| **EMPTY_SHELLS_AFTER_SCROLL** | `bughunt-wheel-only.png`: “Upcoming games” cards are empty purple shells after wheel; cold had spinners before content filled. | Layout/CSS present; product media/text often lag or stay empty. Not framing (10 MB OK). |
| **VIRTUAL_DATA_1x1** | Several `<img src="/w7s/virtual-data/…">` with `naturalWidth/Height=1`. | Blob/data rewrite likely collapsing real media to 1×1 placeholders. |

### MEDIUM
| ID | Evidence | Notes |
|----|----------|-------|
| **SOFTNAV_CLICK_COLLAPSE** | `click_center` → SoftNav to `/promo/game-points`; htmlLen 540k→268k then rebuild; `hrefChanged=true`. | Contract SoftNav; feels like a wipe. Geo modal (“Sim”) also blocks clicks. |
| **CDP_BLUR_ANCHOR_MISSING** | 1× `CdpDropped` `blur`/`anchor_missing`. | Noise around focus transitions. |
| **HUB_EDITABLEFOCUS_MISSING** | Console: `No client method with the name 'editablefocuschanged'`. | SignalR client/hub drift. |

### FALSE POSITIVES (hunt noise)
| ID | Why false |
|----|-----------|
| **WHEEL_NO_EFFECT** (first analyzer) | Measured `surface.scrollTop` after SoftNav to short page (`scrollHeight===clientHeight`) or mid-rebuild. Dedicated wheel probe: scrollViewport apply + `programmaticSuppress` + **Δscroll=+2781**. |
| **SPARSE_PROJECTED_TREE** (Beleza run) | Was WAF error page, not empty Speculum surface. |

## Healthy signals (Eneba)
- Cold armed ~4.6s: `ownedRules=1832`, `htmlLen≈311k`, no desync, no framed-length, no duplicate anchors
- Front: ~948 `client_apply` / ~939 `client_recv`
- Inputs: 27 Applied; ScrollEchoHit=1; programmaticSuppress≥2
- SoftNavObserved=2 (home + promo); GenerationBumped=0 in main hunt
- Virtual-assets image GETs: **200** (41 sampled)

## Not reproduced this run
- `client_desync` / `address_miss` (incl. `matchCount:2`)
- `Invalid framed length`
- `generation_stale` flood
- Diff fanout black screen

## Artifacts
`Refactor/deploy/tmp-telemetry-run/bughunt-*`, `bughunt-wheel-probe.json`, `bughunt-wheel-only.png`, `probe-wheel.cjs`

## Config note
Local `Navigation.defaultTargetHost` was left as **`www.eneba.com`** after the retest (was Beleza). Restore Beleza only if you still want that host despite WAF.
