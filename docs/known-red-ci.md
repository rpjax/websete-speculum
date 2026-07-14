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

A9 viewport dims, E3 multi-entry history, E7 cookie/LS after drain, F3 DELETE→404, J7 mirroring `missing[]`, L11 soft-cap `ok:false`, M1 exact `Diagnostics.ConfigApplied`, no StartSession retry.

## Hotfix plan (next)

1. MessagePack camelCase (or web normalize) for `SessionIdentity` + `SessionStatus`.
2. Any product fixes for hardened MotorAssert failures.
3. CI green **without** weakening asserts.
