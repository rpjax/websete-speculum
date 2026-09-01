# `@speculum/page-projection`

Shared PageProjection V4 algorithm for Speculum.

| Export | Role |
|--------|------|
| `./core` | Wire/ISA, table, decode, plane constants, intent types, DOM tree snapshot |
| `./virtual` | In-page producer (`bootstrap` → IIFE `virtual.js`) |
| `./projected` | Two-phase apply + `ProjectionClient` + projected input capture |

**Not in this package:** lab harness, BrowserSession, CDP dispatch, React UI.

Consumers: sidecar (session + lab) via `file:`; web at Integration (gate 10) imports `./projected` + `./core` only.

See `docs/page-projection/spec/decision-log.md` §J.
