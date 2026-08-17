# PageProjection engine (WIP)

## Folder meaning

| Folder | Audience | Holds |
|--------|----------|--------|
| **`plane/`** | Shared Virtual ↔ sidecar | Muxed data-plane envelope + channels |
| **`models/`** | Shared Virtual ↔ sidecar | Wire types for deserialize (`Frame`, `OpCode`, `DomNodeKey`) |
| **`virtual/`** | Virtual page JS | Bidirectional projection endpoint |
| **`virtual/models/`** | Virtual only | Internal models (`DirtySets`, …) |
| **`virtual/{dom,clock,frame,transport}/`** | Virtual only | **Contract + impls for that domain** (same folder) |
| **`inject/`** | Node | Config pre-script + load `virtual.js` |
| **`lab/`** | Node (dev) | Projection lab — HTTP/WS, 1 Chrome/session, no gRPC/.NET |
| **`host/`** | Node | Production data-plane host (later) |

### Domain folders (contract beside impls)

```text
virtual/
  config/
    projectionConfig.ts   # read once from globalThis.__SPECULUM_PROJECTION__
  clock/
    frameClock.ts           # port
    timerFrameClock.ts      # impl
  …
```

Injection order: `buildConfigPreScript(opts)` → `loadInpageScript()` (`virtual.js`).

Paste / console: set `{ transport: 'console', frameRateHz: 60 }` then paste `virtual.js`
(see `virtual/COMPONENTS.md`).

## Run the lab

From `Refactor/sidecar` — install once (`npm ci`), then:

```bash
npm run lab:projection
```

Open http://127.0.0.1:4077/ → Connect. Full deploy (CLI, CSSOM gates, env): [sidecar README](../../../README.md#pageprojection-lab-local). Lab internals (today): [lab/README.md](lab/README.md). Target architecture: [lab-design.md](../../../../../docs/page-projection/spec/lab-design.md).

## Build

```bash
npm run build:virtual
npm run build
```
