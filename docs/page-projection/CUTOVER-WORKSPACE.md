# Cutover workspace (TEMP)

**Status:** contrato + Integration Live (§1 hygiene + gate 10 surface) — 2026-08-21/22.  
**Não é spec.** Scratchpad; canvas (gate 7) / NIT / antibot pleno ainda abertos.  
**Normativo:** [spec/browser-session.md](spec/browser-session.md).

**Alvo:** `PageProjectionBrowserSession` + sealed factory + `web/` → `@speculum/page-projection/projected`  
**LivePageProjection:** deleted. Lab aliases (`flushProjection*`) deleted. Live data plane = CDP binding (lab = loopback).  
**Cleanup wave (W3):** `labLaunch` / `PageProjectionInputDispatch` / `PageProjectionFactoryOptions` renames; `FirstFrameEmitted` journal fact; dead `IPageProjectionDiffTelemetry` / `PageProjectionClientStateReport` removed.

Quando o produto restante fechar: apagar este arquivo.

---

## Já fechado

| Item | Evidência |
|------|-----------|
| Lab iso via `getStateSnapshot` / `pushInput` / `requestResync` | lab probes + runner; PP aliases gone |
| Fat port / Patchright video-only | `BrowserSession` shrunk; stub `liveAttach` deleted |
| Wire Launch split + Frames stream | `LaunchPageProjection` / `LaunchVideoStreaming` / `WatchPageProjectionFrames` |
| web Integration | `file:@speculum/page-projection`; `live/page` apply deleted; resync trigger-only |
| Live data plane | `projectionDataPlane: 'cdp'` default; lab `loopback` |
| Surface asserts | `LiveSessionTests` frame body+contextId + RequestResync; MATRIX P1 |

---

## Ainda produto

- Canvas content (gate 7)
- Nested XO/NIT, antibot kits, asset store real, IDB/localStorage restore pleno
- MotorAssert compose MirrorMode seed for full Live E2E (Sessions.Tests surface smoke is gate 10 baseline)
