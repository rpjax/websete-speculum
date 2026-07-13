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

Sidecar replies with `{"type":"ready","sessionId":"…"}` or `{"type":"error","sessionId":"…","message":"…"}`.

### Input events (after create)

`navigate`, `mousemove`, `mousedown`, `mouseup`, `wheel`, `keydown`, `keyup`, `type`, `resize`, `refresh`, `goback`, `goforward`, `evaljs`.

### Export state

`{"type":"exportState"}` — sidecar responds with browser state payload (see sidecar `BrowserState.ts`).

---

## Client-visible W7S

Motor apex+NSO mode exposes navigation state in query param **`_w7s_nso`** (constant `W7sNavigationQueryParam` in API). This is separate from the sidecar binary protocol but part of the W7S wire surface.

---

## Regression tests

Golden byte tests in `Speculum.Api.Tests/SidecarWireProtocolTests.cs` must match TypeScript encoders in `sidecar/src/protocol/`.
