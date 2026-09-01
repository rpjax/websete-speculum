# Contract 17 — Module map (future code)

**Norm:** redesign §9. **No file > 600 LOC. Orchestration files contain no algorithm.**

## Sidecar — `sidecar/browser/patchright/mirror/page/`

| Future file | Ceiling | Contracts | Impl spec |
|-------------|---------|-----------|-----------|
| `identity.ts` | 250 | 01 | [identity.md](../implementation/sidecar/identity.md) |
| `fmap.ts` | 500 | 02 | [fmap.md](../implementation/sidecar/fmap.md) |
| `observe.ts` | 400 | 02, 03 | [observe.md](../implementation/sidecar/observe.md) |
| `frame.ts` | 500 | 03 | [frame.md](../implementation/sidecar/frame.md) |
| `clock.ts` | 200 | 03 | [clock.md](../implementation/sidecar/clock.md) |
| `encode.ts` | 300 | 04 | [encode.md](../implementation/sidecar/encode.md) |
| `establish.ts` | 350 | 05 | [establish.md](../implementation/sidecar/establish.md) |
| `cssom.ts` | 400 | 06 | [cssom.md](../implementation/sidecar/cssom.md) |
| `channel.ts` | 200 | 04, 07 | [channel.md](../implementation/sidecar/channel.md) |
| `PageProjection.ts` | 300 | orch only | [PageProjection.md](../implementation/sidecar/PageProjection.md) |
| `inpage/` fragments + concat | 600 each | 01–06 | [inpage.md](../implementation/sidecar/inpage.md) |
| `pierce.ts` | 300 | 02 D-SPEC-3 | [pierce.md](../implementation/sidecar/pierce.md) |
| `assetPriority.ts` | 200 | 11 D-SPEC-11 | [assetPriority.md](../implementation/sidecar/assetPriority.md) |
| `input-resolve` (DomElementInput port) | — | 10 | [input-resolve.md](../implementation/sidecar/input-resolve.md) |
| `node/mirror.ts` | 400 | 07 | [node-mirror.md](../implementation/sidecar/node-mirror.md) |
| `node/rewrite.ts` | 300 | 02, 11 | [node-rewrite.md](../implementation/sidecar/node-rewrite.md) |

## Web — `web/src/features/sessions/live/page/`

| Future file | Ceiling | Contracts | Impl spec |
|-------------|---------|-----------|-----------|
| `registry.ts` | 150 | 09 | [registry.md](../implementation/web/registry.md) |
| `decode.ts` | 300 | 04 | [decode.md](../implementation/web/decode.md) |
| `applyDom.ts` | 400 | 09 | [applyDom.md](../implementation/web/applyDom.md) |
| `applyCssom.ts` | 300 | 06, 09 | [applyCssom.md](../implementation/web/applyCssom.md) |
| `surface.tsx` | 350 | 08 | [surface.md](../implementation/web/surface.md) |
| `interaction.ts` | 400 | 10 | [interaction.md](../implementation/web/interaction.md) |
| `clientState.ts` | 150 | 10 | [clientState.md](../implementation/web/clientState.md) |
| `ProjectionClient.ts` | 300 | orch | [ProjectionClient.md](../implementation/web/ProjectionClient.md) |
| `opcodes.ts` | 100 | 04 | shared constants (may live next to decode) |

## API

| Future area | Contracts | Impl spec |
|-------------|-----------|-----------|
| Opaque frame relay DTO | 04 | [relay.md](../implementation/api/relay.md) |
| Shared L2 cache | 11 | [assets-l2.md](../implementation/api/assets-l2.md) |
| ClientState hub method | 10 | [client-state.md](../implementation/api/client-state.md) |
| PageProjection options | 15 | [config.md](../implementation/api/config.md) |
| Telemetry facts | 14 | [telemetry.md](../implementation/api/telemetry.md) |

## Ported / kept (redesign §9)

- Port: DomElementInput → id addressing only (contract 10).  
- Keep: DomAssetCache, srcsetParse, gRPC/hub/fan-out/admission transport, virtual-asset serve plane (fixed per §5.12).  

## Forbidden in a future cutover (conceptual deletes)

Any path that:

- Writes live identity attrs into Virtual DOM  
- Uses MutationRecord-as-wire-unit  
- JSON tree ferry for establish/live frames  
- CSS selector rewriting for html/body stand-ins  
- Resolves input via `speculum-anchor` on Virtual  
- Dom stand-in surface instead of sandboxed iframe  

Exact file deletion list for an existing tree belongs to the **future code plan**, not this pack.
