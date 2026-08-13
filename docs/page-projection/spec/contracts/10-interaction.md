# Contract 10 — Interaction and input

**Norm:** redesign §5.9.2–5.9.5, §5.11; input doc as amended. **Tests:** PP-IN-1..5. **Impl:** `interaction.md`, `clientState.md`, sidecar input port.

## Ownership table

| Class | Owner | Rule |
|-------|-------|------|
| `:hover`, `:active`, `:focus-visible`, CSS transitions | Client | Native; never round-trip |
| Scroll movement | Client immediate | Intent + echo suppression follow |
| Caret / selection | **Client-authoritative** | Never dictated by Virtual |
| Typed echo | Client immediate | Upstream reconciles |
| Focus ring / control state | Client immediate, reconciled | Upstream patch wins on genuine conflict |
| Navigation / submit / document change | Virtual | Instant local progress affordance |

## Caret (§5.9.3) — PP-IN-2

While control dirty, differing upstream `speculum-input-value` applies **without** moving caret (prefix/suffix reconcile). If impossible, prefer user caret and report conflict.

## Scroll (§5.9.4) — PP-IN-3

Local scroll paints immediately. Intents coalesced per scroller, last sample. Virtual suppresses echo equal to last applied intent position. Never drop under inject pressure — collapse to latest.

## ClientState (§5.9.5)

```
PageProjectionClientState {
  visibility: "visible" | "hidden"
  appliedThroughSequence: u32
  queuedFrames: u16
  applyP50Ms, applyP95Ms: f32
  overrunCount: u32
}
```

Send on change and ≤ every `clientStateMs` (1000). Control message; MUST NOT affect `sequence`. Drives rate policy.

## Intents (§5.11) — PP-IN-5

1. Address by `uint32` id via reverse map on Virtual. **No** `speculum-anchor` resolve on Virtual.  
2. Coordinates: surface CSS px → Virtual viewport; iframe content box.  
3. Rest of input seal: no wire `click`; CDP dispatch; inject chain; move collapse under pressure; `setFiles`; disarm while desynced; two scroll intent types.  
4. MUST NOT send pointer intents before arming — queue or visibly refuse (PP-EST-5).

## Miss policy

Retry then drop with `AnchorMiss` / equivalent errorCode+phase (input §8).
