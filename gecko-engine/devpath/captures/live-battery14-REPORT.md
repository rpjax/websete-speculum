# Live battery 1–4 — hop kill (eneba-promocoes.com.br)

Date: 2026-09-17
Sessions: `558d2a01-…`, `c4ffa902-…`
Captures: `gecko-engine/devpath/captures/live-battery14-*`

## Asset

| Hop | Result |
|-----|--------|
| SW controlling + fetch intercept | **OK** (`fromServiceWorker: true`) |
| SW → page `asset-fetch` | **OK** (seen late listener) |
| Page → hub `FetchProjectedAsset` | **DEAD** — zero hub invokes in API logs |
| Page → SW reply | **`404` / statusText `no_session`** |

SW is fine. Page handler answers `no_session` and never calls the hub.

Source of that string:
- `geckoLiveAssets.wireLiveAssetSw` when `fetchProjectedAssetRef` is null, or
- `sessionLifecycle.fetchProjectedAsset` when `sessionRef.current` is null

## Click

| Hop | Result |
|-----|--------|
| Trusted pointerdown/up on Sim | **OK** |
| Intent pipe open on vstream | **OK** (mux open kind 8) |
| Intent data frames on click | **DEAD** — delta 0 |
| Virtual effect | Sim stays |

`sendDomInput` no-ops when `sessionRef.current` is null — same hole as asset.

## Same root

Surface still painted (last PP frames) while client session handle is gone / not wired for asset+intent.

Also seen: REST `page-projection/resync` → **401** (auth path sick; separate from SW).

## Not the bug

- Frame wire / raw PP (already fixed; paint works)
- Intent ABI encoder (never reached)
- SW script / CSP / intercept (intercept + `no_session` prove path)

## Next fix target (not done here)

Why Live clears or never holds `sessionRef` / `fetchProjectedAsset` while Projected surface still shows content — then restore designed SW→hub and capture→intent paths. No ad-hoc.
