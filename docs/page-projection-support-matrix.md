# PageProjection — support matrix

**Status:** product support matrix (WP16). Canon: [page-projection-engine-redesign.md](page-projection-engine-redesign.md)
§11. Related: [page-projection-acceptance.md](page-projection-acceptance.md) (K4 — absolute 1:1 parity is
the acceptance bar everywhere this matrix does not list an accepted gap).

An accepted gap that is not published here is a bug. K1 (indistinguishable UX by design intent) and K5
(no page JavaScript on the Projected surface, ever) make some browser features structurally
unprojectable — these are explicit, permanent product boundaries, not defects to fix later.

## Accepted gaps

| Area | Status |
|------|--------|
| `<canvas>` / WebGL pixels | **Not projectable.** Box and `speculum-canvas-placeholder` only. Maps, charts, games, 3D. |
| MSE / DRM playback | Stub attributes; bridges later |
| File / HLS / DASH media | **Works** — bytes via the pass-through serve plane, played by the client's media engine |
| Animations driven by page JS / WAAPI | Only their DOM/CSSOM effects project |
| IME / composition (CJK) | Non-support in V1 |
| Timing-critical interaction (drag, freehand drawing, games) | Bounded by **P5**; cannot beat the round trip |
| Independent client zoom of projected content | **Forbidden** — zoom propagates to the Virtual viewport (§5.8.6); independent zoom would break hit-testing |

## What does work

`:hover`, `:focus-within`, `:active` and CSS transitions work locally once the surface is a real
document. Text selection and copy work natively — an advantage over pixel-based isolation approaches.

## Everything else is K4

Any behaviour not listed above is held to **absolute 1:1 parity** with opening the same site in a
normal browser on Virtual (K4, [page-projection-acceptance.md](page-projection-acceptance.md)). A
surface that is incomplete, slow, crushed, desynced or unusable is a defect, not an accepted gap —
see the hard bans in [page-projection-engine-redesign.md](page-projection-engine-redesign.md) and the
always-applied workspace rules.
