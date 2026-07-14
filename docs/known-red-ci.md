# Known red CI (diagnostics + bug traps)

This branch intentionally keeps **failing** tests that document real product bugs and hardened contracts. Do not `[Skip]` / `[Ignore]` them.

## Bug traps (must stay red until hotfix plan)

| ID | Test | Failure means |
|----|------|---------------|
| A′ | `MsgPackHubContractTests.SessionIdentity_deserializes_js_camelCase_clientToken` | Web `clientToken` does not bind → session rebind broken |
| B′ | `MsgPackHubContractTests.SessionStatus_roundtrip_exposes_camelCase_url_for_js_client` | Hub status keys not camelCase → `MotorEngine` never sees `url` |
| B′ web | `sessionStatusPayload.test.ts` PascalCase case | Same bug from the React reader path |
| E8 | MotorAssert rebind trap | (C# path may pass; MsgPack is the real browser trap) |
| B12 | MotorAssert UrlMapped / status NSO | Relay mapped-URL contract |

## Hardened asserts (may fail; fix product, not the assert)

A8 SidecarFaulted + session_gone, A9 viewport dims, B1 probe `/nav/b`, E3 multi-entry history, E6 SidecarFaulted then StateExportFailed, E7 cookie/LS after drain, F1 DELETE SessionPolicy, F3 DELETE→404, J7 mirroring `missing[]`, K3 CORS success status, L11 soft-cap `ok:false`, M1 exact `Diagnostics.ConfigApplied`, no StartSession retry, strict FindPersistedSessionId (token-only), camelCase-only detail JSON (`history`/`cookies`/`localStorage`).

## Diagnostics emitter publish (unit — must stay green)

`DiagnosticsEmitterPublishTests`: SessionResolved payload fields, restored+counts, UrlMapped once per distinct clientUrl, Off drops publishes, Degraded accepts catalog Motor events.

## Hotfix plan (next)

1. MessagePack camelCase (or web normalize) for `SessionIdentity` + `SessionStatus`.
2. Any product fixes for hardened MotorAssert failures.
3. CI green **without** weakening asserts.
