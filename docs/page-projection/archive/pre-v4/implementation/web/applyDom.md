# Implementation — `applyDom.ts` (web)

**Future path:** `web/src/features/sessions/live/page/applyDom.ts`  
**LOC ceiling:** 400  
**Contracts:** [09-apply.md](../../contracts/09-apply.md), [02-f-map.md](../../contracts/02-f-map.md), [04-wire.md](../../contracts/04-wire.md), [10-interaction.md](../../contracts/10-interaction.md)  
**Decisions:** D-SPEC-1 (`documentState`), D-SPEC-5 (viewport scroll sentinel / `scrollViewport`)  
**Norm:** redesign §5.4.1–5.4.2, §5.2.1, §5.9.1, §5.9.3  

---

## Purpose

ACID Dom-plane apply of an **already assembled** frame’s Dom ops into the active surface `Document` + `Registry`. Owns: `childList` FULL/APPEND (moves), `patch`, `documentState`, scrolls, establish chunk feed hooks (parser write owned with surface), and §5.2.1 imperative state apply. Exposes a **caret reconcile hook** consumed when applying `speculum-input-value`.

Does **not** own: rAF scheduling, sequence tracking, Cssom ops, sandbox/iframe lifecycle (orchestration / surface / applyCssom).

---

## Invariants

1. **ACID:** resolve **every** Dom address in the frame’s Dom ops **before** any mutation; any miss ⇒ throw `ApplyDesyncError` (`id_unresolved`); **no partial apply**.
2. During apply MUST NOT read layout (`getBoundingClientRect`, `offsetTop`, `scrollHeight`, computed style).
3. `existing` ChildRef ⇒ **move** (`appendChild` / `insertBefore` of the live node), never clone/destroy/recreate.
4. `fresh` ⇒ construct nodes, `registry.set`, insert.
5. FULL: children absent from declared list are removed; `registry.deleteSubtree` for each removed root.
6. APPEND: only append suffix; MUST NOT remove or reorder prior children.
7. Never call `normalize()` on the document or any subtree (PP-F-2).
8. `documentState` updates `document.title`, `document.documentElement.lang` / `dir`, and viewport meta content — never a T6 node-tree `document` payload.
9. Scroll ops set absolute positions; viewport via `scrollViewport` (no node id).

---

## Bans

- Index-arithmetic insert/remove triplets as the apply model.
- Destroy+recreate on move (breaks PP-MOVE-*).
- Soft-skip unresolved ids.
- Applying Cssom opcodes here.
- Layout reads inside the write batch.
- Dictating caret/selection from Virtual (caret hook restores user caret).

---

## Types and signatures

```ts
export class ApplyDesyncError extends Error {
  constructor(
    readonly errorCode: 'id_unresolved' | 'establish_checksum_mismatch' | 'establish_node_count_mismatch',
    readonly phase: 'live_apply' | 'establish' | 'resync',
    message: string,
  ) { super(message); }
}

/** Provided by interaction / ProjectionClient for dirty text controls. */
export type CaretReconcileHook = {
  /**
   * Called instead of naive `.value = next` when the target is a dirty text control.
   * MUST apply value without moving caret when possible (PP-IN-2); else prefer user caret + report conflict.
   */
  applyInputValue(el: HTMLInputElement | HTMLTextAreaElement, next: string): void;
  /** Optional: whether this control is dirty (local edits not yet echoed). */
  isDirty?(el: Element): boolean;
};

export type ApplyDomContext = {
  document: Document;
  registry: Registry;
  caret?: CaretReconcileHook;
  /** Write HTML into the streaming parser (establish). */
  writeEstablishChunk?(utf8Html: string | Uint8Array): void;
  /** After establishEnd + registry verify — apply begin scrolls. */
  applyEstablishScrolls?(begin: Extract<WireOp, { op: 'establishBegin' }>): void;
};

export type DomApplyResult = {
  /** Ops consumed (Dom plane only). */
  applied: number;
};

/**
 * Validate then apply Dom ops in order. Cssom ops in `ops` MUST be skipped
 * (ProjectionClient partitions) OR this function ignores non-Dom opcodes.
 */
export function applyDomOps(ops: WireOp[], ctx: ApplyDomContext, phase: ApplyDesyncError['phase']): DomApplyResult;

/** Pure resolve pass — used by ACID preflight. */
export function resolveAllDomAddresses(ops: WireOp[], registry: Registry): void;
```

---

## Algorithm — ACID preflight (`resolveAllDomAddresses`)

Scan Dom ops; collect every address that must exist **before** mutation:

| Op | Addresses |
|----|-----------|
| `childList` | `parent`; every `existing` child id |
| `patch` | `node` |
| `scrollElement` | `node` |
| `documentState` | none (document-level) |
| `scrollViewport` | none |
| `establish*` | none for registry resolve (establish builds registry later) |

For live/resync-after-registry frames:

```
for each required id:
  if registry.get(id) === undefined → throw id_unresolved
```

For `fresh` nodes inside `childList`: ids MUST NOT already exist (collision ⇒ `wire_decode_error` / desync — treat as `id_unresolved` or decode invariant; prefer desync with clear message). Fresh nested children are validated after construction order within the op (parent resolved; fresh ids new).

**Establish frames:** skip live resolve; chunk/end handled separately.

Only after preflight succeeds, mutate in op order.

---

## Algorithm — `childList` FULL

```
parentNode = registry.get(parent)  // Element
declared = children[]

1. Preflight already resolved all existing ids.
2. Build Set(declaredExistingIds).
3. Snapshot current childNodes (F-visible — all registry-published children of parent).
4. For each current child C:
     id = idOf(C)  // via registry reverse: scan map is O(n) — FORBIDDEN at scale.
     **Required:** either keep data-attr speculum-anchor on live nodes for O(1) id read,
     or maintain Registry.reverse weak side table within registry.ts budget.
     Spec choice for this pack: live nodes MAY carry speculum-anchor for unregister/idOf;
     live resolve of ops still uses Registry.get only.
5. If C's id not in declared set → remove C from parent; registry.deleteSubtree(id).
6. For i, ref in declared:
     if existing: node = registry.get(ref.id); parent.insertBefore(node, referenceChild)
                  // move preserves focus, media, scroll (PP-MOVE-*)
     if fresh: node = construct(ref.node); register tree; insertBefore
7. Final child order MUST equal declared order.
```

`construct(DecodedNode)` recursive:

```
ELEMENT: el = document.createElement(tag)  // placeholders already rewritten by producer
         for attrs: applyAttribute(el, name, value)  // deny-list already stripped upstream
         registry.set(id, el)
         for child: append construct(child)
TEXT:    tn = document.createTextNode(value); registry.set(id, tn)
COMMENT: cn = document.createComment(value); registry.set(id, cn)
```

Placeholder tags arrive as `div` + `speculum-projected-tag` etc. per F — apply does not re-derive F.

---

## Algorithm — `childList` APPEND

```
1. Resolve parent.
2. For each ref in children (suffix only):
     existing → appendChild(move)
     fresh → construct + appendChild
3. MUST NOT remove or reorder existing prefix children.
4. If producer violated “pure suffix” contract, O2 will fail — client still applies as append; do not invent FULL repair.
```

---

## Algorithm — `patch`

```
node = registry.get(id)
switch snapshot.kind:
  text / comment:
    node.data = snapshot.value
  element:
    // Full snapshot of published attrs + §5.2.1 state attrs — idempotent
    reconcileAttributes(el, snapshot.attrs)
    applyStateFromAttrs(el, snapshot.attrs, caret)
```

### `reconcileAttributes`

- Apply the full published attribute set as truth for F attrs.
- Remove attributes present on el that are in the Speculum-published set but absent from snapshot (implementation: track last applied published names, or replace all non-browser-internal attrs carefully).
- MUST NOT strip browser-internal state blindly if not in F — prefer: set each snapshot attr; remove attrs that were previously applied from F and are now missing.

### §5.2.1 state apply (`applyStateFromAttrs`)

| Attr | Apply |
|------|-------|
| `speculum-input-value` | If `caret` + dirty text control → `caret.applyInputValue(el, v)`; else `el.value = v` |
| `speculum-input-checked` | `(el as HTMLInputElement).checked = v === 'true'` |
| `speculum-option-selected` | `(el as HTMLOptionElement).selected = …` |
| `speculum-dialog-modal="true"` | If not already modal top-layer: `(el as HTMLDialogElement).showModal()`; if attr absent/false and was modal: `close()` |
| `speculum-popover-open="true"` | `showPopover()` / `hidePopover()` |
| `speculum-media-paused` | `pause()` / `play()` as implied |
| `speculum-media-current-time` | set `currentTime` (number parse) |
| `speculum-media-muted` | `muted` |
| `speculum-media-volume` | `volume` |
| `speculum-custom-validity` | `setCustomValidity(message)` (empty clears) |

Exact attr names for media MUST match producer F map (`implementation/sidecar/fmap.md`). Absence of modal/popover attrs means closed.

**Dialog note (PP-D16-1):** attribute `open` alone is insufficient for modal; MUST call `showModal()` when `speculum-dialog-modal` is true.

---

## Algorithm — caret reconcile hook (PP-IN-2)

Implemented in `interaction.ts`; applyDom only calls the hook:

```
applyInputValue(el, next):
  if selection/caret owned locally and el is dirty:
    save selectionStart/End (and direction)
    if next is prefix/suffix compatible with current value:
      el.value = next
      restore caret to logical offset (same index, or shifted by prefix delta)
    else:
      // cannot preserve — prefer user caret
      report conflict (ClientState / telemetry optional fact under ParityDebug)
      do not set selection from Virtual
  else:
    el.value = next
```

Virtual NEVER sends caret indices as authority.

---

## Algorithm — `documentState` (D-SPEC-1)

```
document.title = title
document.documentElement.setAttribute('lang', lang) // or .lang
document.documentElement.setAttribute('dir', dir)
meta = document.querySelector('meta[name="viewport"]')
  if missing and viewportContent length: create in head
  meta.content = viewportContent
```

No layout read required. Ordering: after `patch`, before Cssom live list/patch (producer); applyDom runs when orchestrator feeds Dom partition in order.

---

## Algorithm — scrolls

```
scrollViewport: document.defaultView.scrollTo(scrollX, scrollY)
scrollElement:  el.scrollTop/Left = …
```

Establish: after registry verify, apply `establishBegin` scroll lists + viewport **before arm** (PP-EST-4). Prefer `applyEstablishScrolls` in ctx so surface viewport sizing is already applied.

---

## Algorithm — establish chunks

```
establishChunk: ctx.writeEstablishChunk(bytes)  // progressive parse — PP-EST-1
establishEnd:   NOT fully handled here — ProjectionClient calls registry.buildFromDocument + verify
establishBegin: stash for post-end scroll restore
```

---

## Tests

| ID | Assert |
|----|--------|
| `PP-MOVE-1` | Move playing video: same node identity; playback continues |
| `PP-MOVE-2` | Move focused element: focus preserved |
| `PP-MOVE-3` | Move scrolled container: scrollTop/Left preserved |
| `PP-FR-6` | Soak: client tree matches Virtual/mirror (O2) |
| `PP-F-2` | No `normalize()` |
| `PP-F-5` | `documentState` projects title/lang/dir/viewport; RTL renders RTL |
| `PP-D16-1..4` | Modal, popover, media, custom validity |
| `PP-IN-2` | Dirty input + differing `speculum-input-value` does not jump caret |
| `PP-REC-1` | Unresolved id ⇒ desync, no partial tree |
| ACID | Inject frame with one bad id among many ops → zero DOM mutations |
