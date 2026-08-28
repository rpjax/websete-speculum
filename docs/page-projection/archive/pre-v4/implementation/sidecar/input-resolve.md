# Implementation — Input resolve (id-addressed)

| Field | Value |
|-------|-------|
| **Future path** | `sidecar/browser/patchright/mirror/dom/DomElementInput.ts` (ported) + thin adapter |
| **LOC ceiling** | keep ported module focused; resolve path ≤150 LOC change surface |
| **Contracts** | [10-interaction.md](../../contracts/10-interaction.md) §5.11 |
| **Invariants** | Intents address `uint32` id. Resolve via in-page `IdentitySpace.resolve`. Retry then drop. Disarmed while desynced / unarmed. |
| **Ban list** | `querySelector('[speculum-anchor=…]')` on Virtual. Wire `click` event. Sending intents before arm. |

## Algorithm — resolveElement

1. If `targetId` missing or `≤ 0` → fail (`anchor_miss`).  
2. For attempt in `0..2`:  
   a. For each frame in page: `evaluateHandle` → `__speculumPageProjectionV2.resolve(targetId)`.  
   b. If ElementHandle obtained → return.  
   c. Else wait `16 * (attempt+1)` ms.  
3. Emit failure `errorCode=anchor_miss`, `phase=input`; drop intent.  
4. **MUST NOT** fall through to attribute selector.

## Coordinates

Map from Projected iframe content box CSS px to Virtual viewport per input §6.3 as amended by surface §5.8.7.

## Remainder

Inject chain, move collapsing, `setFiles`, scroll intent types: keep sealed input doc behaviour unchanged except addressing and iframe mapping.
