# PageProjection — support matrix

**Status:** published accepted gaps (K1/K5 consequences). Canon: [budgets.md](budgets.md) K1–K5,
[acceptance.md](acceptance.md). Index: [README.md](README.md).

**Position (2026-08-14):** V4 lab engine exists (DOM table, single document). **Production cutover is forbidden** until CSSOM + OPEN-6 + redesigned input exist — [roadmap.md](roadmap.md). Iframes/pierce are **OPEN-6** (cutover blocker), not an accepted gap.

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
normal browser on Virtual (K4, [acceptance.md](acceptance.md)). A
surface that is incomplete, slow, crushed, desynced or unusable is a defect, not an accepted gap —
see the hard bans in [acceptance.md](acceptance.md) and the always-applied workspace rules.
