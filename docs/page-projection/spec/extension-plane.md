# PageProjection — Extension plane carrier

**Status:** **SEALED 2026-08-27** (Rodrigo) — normative bridge from Virtual main world to sidecar loopback WS via managed Chrome extension.  
**Extends:** [loopback.md](loopback.md) (mux + establish LB-08…19 unchanged on the wire).  
**Distinct from:** [context-bus.md](context-bus.md) — **separate channel**; do not multiplex loopback on ContextBus.  
**Code:** `Refactor/sidecar/extensions/speculum-plane/` · `Refactor/packages/page-projection/src/core/extensionPlane/` · `Refactor/packages/page-projection/src/virtual/transport/extensionPlaneSocket.ts` · `Refactor/sidecar/browser/mirror/projection/inject/extensionPlaneMainShim.ts`.

---

## 1. Goal

Virtual root must reach `ws://127.0.0.1:<port>/` without opening a page-origin WebSocket (blocked by LNA/CSP on strict HTTPS sites). The **Speculum Plane** extension opens the real socket in the background service worker; an isolated content script relays bytes to the main world via `postMessage`.

**Law EP-07:** The extension is a **transparent byte tunnel**. It does not parse loopback mux (LB-01…07) or handshake (LB-11…13). `LoopbackDataPlane` on the Virtual side remains the sole interpreter.

---

## 2. Architecture

```text
Main world (Virtual)  ←postMessage→  Content (isolated)  ←Port→  Background  ←WebSocket→  NodeDataPlane
```

Only the **root** document uses this carrier. Nested documents continue ContextBus → root ([browser-session.md](browser-session.md)).

---

## 3. Topic queue

| ID | State | Rule |
|----|-------|------|
| **EP-01** | **LOCKED** | Channel = `speculum.extension.plane` on every bridge message |
| **EP-02** | **LOCKED** | Kinds: `bind`, `bind-ack`, `open`, `open-ok`, `open-fail`, `send`, `message`, `close`, `error` |
| **EP-03** | **LOCKED** | Binary payload = `Uint8Array` (structured clone); prefer `postMessage(..., [buffer])` transfer for large frames |
| **EP-04** | **LOCKED** | `planeBridgeToken` (UUID) in `__SPECULUM_PROJECTION__`; messages without valid token → drop |
| **EP-05** | **LOCKED** | Content script **isolated** world, `run_at: document_start`, `all_frames: false` (top frame only) |
| **EP-06** | **LOCKED** | Background: at most **one** WS per tab; new `open` closes predecessor (mirrors LB-15) |
| **EP-07** | **LOCKED** | Extension does not interpret loopback JSON — forward bytes only |
| **EP-08** | **LOCKED** | Managed Chrome carrier = `extension` only. Page-origin WS is not a product/config option; Node units inject mock sockets. |
| **EP-09** | **LOCKED** | Bind handshake: main shim sends `bind` until `bind-ack` (timeout 5s → boot fail) |
| **EP-10** | **LOCKED** | `event.source === window` required on main↔content postMessage |
| **EP-11** | **LOCKED** | Sidecar `NodeDataPlane` / `ProjectionDataPlaneHost` **unchanged** — extension is another WS client |
| **EP-12** | **LOCKED** | `dataPlaneUrl` still injected — background uses it for `open` |
| **EP-13** | **LOCKED** | Fail-fast if `speculum-plane` extension missing at Chrome launch |
| **EP-14** | **IMPL** | Optional diag: `SPECULUM_DIAG_PLANE=1` → stderr in extension background (not product gate) |
| **EP-15** | **LOCKED** | Accept: zero `ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS` in **page** console + bilateral `isEstablished` |

---

## 4. Bridge envelope

```ts
export const EXTENSION_PLANE_CHANNEL = 'speculum.extension.plane' as const;

type ExtensionPlaneEnvelope =
  | { channel: typeof EXTENSION_PLANE_CHANNEL; token: string; kind: 'bind' }
  | { channel: typeof EXTENSION_PLANE_CHANNEL; token: string; kind: 'bind-ack' }
  | { channel: typeof EXTENSION_PLANE_CHANNEL; token: string; kind: 'open'; url: string; socketId: number }
  | { channel: typeof EXTENSION_PLANE_CHANNEL; token: string; kind: 'open-ok'; socketId: number }
  | { channel: typeof EXTENSION_PLANE_CHANNEL; token: string; kind: 'open-fail'; socketId: number; message: string }
  | { channel: typeof EXTENSION_PLANE_CHANNEL; token: string; kind: 'send'; socketId: number; bytes: Uint8Array }
  | { channel: typeof EXTENSION_PLANE_CHANNEL; token: string; kind: 'message'; socketId: number; bytes: Uint8Array }
  | { channel: typeof EXTENSION_PLANE_CHANNEL; token: string; kind: 'close'; socketId: number; code?: number; reason?: string }
  | { channel: typeof EXTENSION_PLANE_CHANNEL; token: string; kind: 'error'; socketId: number; message: string };
```

Malformed envelopes → drop (no throw across worlds).

---

## 5. Config

| Field | When | Rule |
|-------|------|------|
| `loopbackCarrier` | `transport === 'loopback'` | `'extension'` only |
| `planeBridgeToken` | `transport === 'loopback'` | UUID per session; sidecar generates at session create |

---

## 6. Implementation map

| Piece | File |
|-------|------|
| Bridge envelope | `core/extensionPlane/envelope.ts` |
| Loopback socket iface | `core/loopback/socket.ts` |
| Extension socket | `virtual/transport/extensionPlaneSocket.ts` |
| Main shim (inject) | `inject/extensionPlaneMainShim.ts` |
| Extension MV3 | `extensions/speculum-plane/` |
| Chrome launch | `browser/patchright/ChromeRuntime.ts` — CDP `Extensions.loadUnpacked` + `--enable-unsafe-extension-debugging` (branded Chrome 137+ ignores `--load-extension`) |
| Session token | `PageProjectionBrowserSession.ts` |

---

## 7. Test matrix

| Test | Proves |
|------|--------|
| `extensionPlaneEnvelope.unit.ts` | EP-01, EP-02 encode/decode |
| `extensionPlaneBridge.unit.ts` | bind/open/send + ignore premature close while CONNECTING |
| `loopbackDataPlane.unit.ts` | LB-11…13 + whenOpen missed-open race |
| `chromeLnaPolicy.unit.ts` / `unit.ts` Chrome args | extension dirs + CDP debug flag (no CLI `--load-extension`) |
| `diag-extension-plane.js` | controlled fixture establish (lab) |
| `diag-binance-live-plane.js` | EP-15 stress (requires CHROME_EXECUTABLE) |

Tracker: [open.md](open.md) **PP-EXTENSION-PLANE**.

---

## 8. Decision log

| Date | Topic |
|------|-------|
| 2026-08-27 | **Extension plane SEALED** — carrier for loopback WS outside page LNA/CSP; ContextBus untouched; NodeDataPlane unchanged. |
| 2026-08-28 | **Launch path:** managed extensions install via CDP `Extensions.loadUnpacked` (CLI `--load-extension` dead on branded Chrome ≥137). Bridge design unchanged. |
| 2026-08-28 | **Boot fix:** ignore Port `error`/`close` while CONNECTING until `open-ok` (superseded WS churn); `whenOpen` re-check/poll. Inject lateBoot / dual-boot seal lives in [browser-session.md](browser-session.md) (2026-08-28), not here. |
| 2026-08-28 | **Sanitize:** page-origin WS removed from product path (`pageWebSocketLoopbackSocket` deleted; `loopbackCarrier` = `extension` only; CSP diag probe observe-only — no page `new WebSocket`). |
