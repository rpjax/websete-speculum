# Contract 02 — F map (structural publish)

**Norm:** redesign §5.2, §5.2.1. **Tests:** PP-F-1..5, PP-D16-1..4. **Impl:** `implementation/sidecar/fmap.md`.

## Purpose

Define the **published** tree `F(Virtual)` that Projected must match structurally after placeholder rewrite and pierce flatten.

## Publish rules

1. Structurally 1:1 with Virtual after placeholder rewrite; main document + all pierced roots **flattened** into one tree.  
2. **Placeholders** (publish as `div` + `speculum-projected-tag`): `script`, `noscript`, `template`, `iframe`, `base`, `object`, `embed`, `applet`.  
   - `iframe` interior = pierced document tree as children of the host.  
   - Others: empty interiors.  
   - Nodes never omitted.  
3. **Attribute deny-list:** remove event-handler attrs, `integrity`, `javascript:` URLs; strip site CSP `meta`; resolve away `<base href>`.  
4. **URL fields** (before Node rewrite hop may finalize `/w7s/...`): `src`, `href`, `xlink:href`, `data-src`, `poster`, `srcset`, `imagesrcset`, inline `style`, CSS `url()`, `@import`, `image-set()` bare forms. Reserved query params per virtual-assets §1.1.  
5. **Pierce mandatory:** open + closed shadow roots, same-origin + cross-origin iframes. Host attrs: `speculum-shadow-root`, `speculum-shadow-closed`, `speculum-iframe`. Slot assignment = **flattened rendered** result, not light+shadow side by side (PP-F-3, PP-F-4).  
6. **Document-level state** (D-SPEC-1): title, `lang`, `dir`, `meta[name=viewport]` content via `documentState` op (PP-F-5).

## Node snapshot (wire `Node` / `patch`)

```
Element: { id, tag, attrs[], /* children only in childList fresh / establish */ }
Text:    { id, value }
Comment: { id, value }
```

`patch` carries full flush-time snapshot **without children**.

## State without attributes (§5.2.1)

| State | Attr on F / patch | Client apply |
|-------|-------------------|--------------|
| input/textarea `.value` | `speculum-input-value` | `.value` (caret rules §5.9.3) |
| checkbox/radio `.checked` | `speculum-input-checked` | `.checked` |
| option `.selected` | `speculum-option-selected` | `.selected` |
| dialog `showModal()` | `speculum-dialog-modal="true"` | `showModal()` |
| popover shown | `speculum-popover-open="true"` | `showPopover()` |
| media paused/time/muted/volume | `speculum-media-*` | apply to media element |
| `setCustomValidity` | `speculum-custom-validity` | `setCustomValidity` |

**Sensors:** `input`, `change`, `toggle`, `close`, media events, plus explicit hooks. Sensor ⇒ mark `stateDirty` only; no payload work in the handler.

**Out of F:** computed style, layout geometry, canvas/WebGL pixels, caret/selection.

## Discard before identity work

Records for non-published subtrees (placeholder interiors except iframe pierce, `<style>`/`<link>` rule bodies → Cssom plane) MUST be discarded at the top of the MO callback before allocate/address/payload (PP-FR-5).

## Text policy

Adjacent text nodes published 1:1; no collapsing. Client never calls `normalize()` (PP-F-2).
