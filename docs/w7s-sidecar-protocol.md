# W7S sidecar wire protocol

Canonical wire format between **Speculum.Api** (Motor relay) and the **sidecar** (remote Chrome). The **W7S** prefix applies to this public boundary only; internal C# types use Speculum/Motor naming.

Source of truth for encoders: [`sidecar/src/protocol/wire-protocol.ts`](../sidecar/src/protocol/wire-protocol.ts)  
C# mirror: `Speculum.Api/Motor/Sidecar/SidecarWireProtocol.cs`

---

## Transport

- **Sidecar → API:** binary WebSocket frames (first byte = opcode)
- **API → Sidecar:** UTF-8 JSON text frames

---

## Binary opcodes (sidecar → API)

| Opcode | Name | Layout |
|--------|------|--------|
| `0x04` | URL | `[0x04][u32 len LE][utf8 url]` |
| `0x05` | Console | `[0x05][u8 level][u32 len LE][utf8 text]` |
| `0x06` | Eval result | `[0x06][u32 id LE][u8 ok][u32 len LE][utf8 value]` |
| `0x08` | Screencast | `[0x08][jpeg bytes…]` |
| `0x09` | Status | `[0x09][u32 len LE][utf8 json]` |
| `0x0A` | Redirect | `[0x0A][u32 len LE][utf8 url]` |

Console level bytes: `0=log`, `1=warn`, `2=error`, `3=info`, `4=debug`.

Status JSON shape:

```json
{ "tabCount": 1, "url": "https://…", "resizing": false, "width": 1280, "height": 720 }
```

---

## JSON control (API → sidecar)

### Session create (first message)

```json
{
  "type": "create",
  "sessionId": "uuid",
  "width": 1280,
  "height": 720,
  "url": "https://example.com/",
  "scripts": [{ "position": "HeaderBottom", "type": "Classic", "file": "/inj/a.js", "content": "…" }],
  "jsBridgeEnabled": false,
  "allowedNavigationDomains": ["example.com", "*.example.com"],
  "browserState": { }
}
```

Sidecar replies with `{"type":"ready","sessionId":"…"}` or:

```json
{ "type": "error", "sessionId": "…", "message": "…", "errorCode": "cookie_import_invalid|sidecar_session_create_failed" }
```

`errorCode` is stable for API diagnostics (`Network.setCookies` / invalid cookie params → `cookie_import_invalid`).

### Input events (after create)

`navigate`, `mousemove`, `mousedown`, `mouseup`, `wheel`, `keydown`, `keyup`, `type`, `text`, `touch`, `resize`, `refresh`, `goback`, `goforward`, `evaljs`.

Touch (CDP `Input.dispatchTouchEvent`):

```json
{
  "type": "touch",
  "phase": "start|move|end|cancel",
  "points": [{ "id": 1, "x": 10, "y": 20, "radiusX": 1, "radiusY": 1, "force": 0.5 }],
  "changedIds": [1]
}
```

CDP requires empty `touchPoints` on `touchEnd`/`touchCancel`. On a partial lift the wire still lists remaining contacts in `points`; the sidecar sends empty end/cancel then re-asserts remaining via `touchStart`.

Text (IME / virtual keyboard — CDP `Input.insertText`):

```json
{ "type": "text", "text": "こんにちは", "source": "composition" }
```

Create / resize may include a device profile:

```json
{
  "mobile": true,
  "touch": true,
  "deviceScaleFactor": 2,
  "maxTouchPoints": 5,
  "userAgentProfile": "mobile",
  "screenOrientation": "portrait-primary"
}
```

Status JSON may include optional editing focus for the client virtual keyboard:

```json
{ "editing": { "focused": true, "inputMode": "text", "multiline": false, "tagName": "input" } }
```

### Export state

`{"type":"exportState"}` — sidecar responds with browser state payload (see sidecar `BrowserState.ts`), or:

```json
{ "type": "stateExportError", "message": "…", "errorCode": "export_failed|export_session_gone" }
```

### Diagnostics probe

`{"type":"diagProbe","requestId":"…","ops":["process","tabs","export","cookies","storage","dom","evaluate","resources"],"evaluateExpression":"…","domSelector":"…","maxProbeResponseBytes":524288}`

- `ops` selects evidence sections to collect (all optional except those listed).
- `evaluateExpression` required when `evaluate` is in `ops`.
- `domSelector` required when `dom` is in `ops`.
- `maxProbeResponseBytes` optional cap on the serialized `diagResult` payload (default **512 KiB** / `524288`). Exceeding the cap yields `errorCode: response_too_large`.

Sidecar replies with:

```json
{ "type": "diagResult", "requestId": "…", "ok": true, "data": { } }
```

On failure: `{ "type": "diagResult", "requestId": "…", "ok": false, "errorCode": "session_gone" }` (no active session), `response_too_large` (payload exceeds `maxProbeResponseBytes`), or other probe error codes.

---

## Client-visible W7S

Motor apex+NSO mode exposes navigation state in query param **`_w7s_nso`** (constant `W7sNavigationQueryParam` in API). This is separate from the sidecar binary protocol but part of the W7S wire surface.

---

## Regression tests

Golden byte tests in `Speculum.Api.Tests/SidecarWireProtocolTests.cs` must match TypeScript encoders in `sidecar/src/protocol/`.
