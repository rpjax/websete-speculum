# PageProjection — shadow

**Status:** shipped (open / named). Closed / UA / manual slot remain NIT.  
**Feature 1 of [subtrees.md](subtrees.md).** Protocol: [frame-protocol.md](frame-protocol.md).  
**Tracker:** [seal-gaps.md](seal-gaps.md) `SEAL-DOM-P1-SHADOW` (closed).  
**Not this file:** nested browsing contexts — [multi-document.md](multi-document.md).

Same Document. Same JS loop. Same instance. Same node-id space. Same frame. Creation mechanism does not matter.

---

## Locked machine

Project the shadow **as a real `ShadowRoot`**. Interior mutates like any tree. Do not flatten slots onto the wire. Do not mix shadow children into the host’s light `childNodes`.

Observe is local. Interior ops are the existing ones. The only new wire is naming the root (`NODE_NEW` kind `SHADOW_ROOT`). No `SHADOW_*` mutation opcodes.

This version: **open** + **named** slot only (`element.shadowRoot` readable, `slotAssignment !== 'manual'`). **Closed**, **UA**, and **manual slot** are **NIT** — explicit unsupported, never soft-skip. Not CDP. Not iframe.

---

## Topology

A host `ELEMENT` has two collections:

| Collection | Live | Table |
|------------|------|--------|
| Light | `host.childNodes` | `parent + prevSibling` among rows with `parent = host` and `kind ≠ SHADOW_ROOT` |
| Shadow | at most one `host.shadowRoot` | one `SHADOW_ROOT` row, `parent = host`, **not** in the light chain |

`SHADOW_ROOT.prevSibling` is always `0` and unused. Light `prevSibling = 0` still means first **light** child.

Children of the root: `parent = shadowRootId`, live `shadowRoot.childNodes`. Nested open shadow: recurse. Same kind.

`dropSubtree(host)` walks the light `prevSibling` chain **and** the owned `SHADOW_ROOT` (if any). The derived light `lastChild` walk alone leaks the shadow. Ancestor checks use the `parent` column (so a root’s parent is the host).

At most one shadow per host. A second `NODE_NEW SHADOW_ROOT` for the same host is `malformed`. The platform does not replace a root.

The `SHADOW_ROOT` row is **never** `INSERT`ed or `REMOVE`d. Host `REMOVE` / `NODE_DROP` of the host takes the root with `dropSubtree`. `REMOVE`/`INSERT` of a `SHADOW_ROOT` id is `precondition`.

Move **between** light and shadow (a node, not the root) is a normal `INSERT` (unlink + link). Allowed.

---

## Produce

`attachShadow` is not a mutation record. Document MO does not see inside a root.

**Discover.** Each tick, for connected `ELEMENT` rows that do not yet own a `SHADOW_ROOT`, read `.shadowRoot`. If null, closed, or `slotAssignment === 'manual'`: skip (NIT). Else first admit **this frame**: `NODE_NEW` the root **after** the host already has a row, `initFlags` from the live root (missing `clonable`/`serializable` ⇒ bit off), walk `shadowRoot.childNodes` with existing `prepareChild` / INSERT batching, then observe that root.

**Observe.** Same record **buffer** as the document. **One `MutationObserver` per admitted root** (plus the existing document one). Same `takeRecords` into that buffer. When the host/root dies: `disconnect` that root’s observer. Do not `disconnect` the document observer.

**Resync.** Walk light `childNodes`, then `.shadowRoot` if admissible. Pass 1 `NODE_NEW` includes roots. Pass 2 `INSERT`s light lists from `childNodes` and shadow lists from `shadowRoot.childNodes`. Never `INSERT` the root under the host.

**Incremental.** A record whose `target` is inside a shadow (or is the `ShadowRoot`) is the same `walkChildList` / attr / text path; parent id is that target’s row.

---

## Apply

Phase 2 `NODE_NEW SHADOW_ROOT`: `host.attachShadow({ mode: 'open', delegatesFocus, clonable, serializable })` from `initFlags`. Not `insertBefore`. Host element must already exist in the registry (same-frame: host `NODE_NEW` first). Detached host is legal.

`INSERT` / `REMOVE` whose parent is the root go into that `ShadowRoot`. Light ops on the host unchanged. Browser slots (`named`).

Registry holds the `ShadowRoot` as the node for that id.

---

## Wire ([frame-protocol.md](frame-protocol.md))

Kind `SHADOW_ROOT = 7`. Frame **version stays 2**.

`NODE_NEW`: `host: u32`, `mode: u8` (`0` only; `1` NIT `malformed`), `initFlags: u8`:

| Bit | Meaning |
|-----|---------|
| `0x01` | `delegatesFocus` |
| `0x02` | `clonable` |
| `0x04` | `serializable` |

Other bits `malformed`. Hashed with `mode`. `INSERT`/`REMOVE` parent may be `SHADOW_ROOT`; ids must not be `SHADOW_ROOT`.

`NODE_META` `SHADOW_HOST` / `SHADOW_CLOSED` / `PIERCE_ROOT` are **dead**. Do not emit them to mean a shadow.

---

## Probes

O2 and tree iso **enter** each open `.shadowRoot` (second list, not smashed into light `child_order`). Closed/manual fixture: **fail explicit unsupported**.

---

## CSSOM (this instance, not a second plane)

When a root is admitted, this instance’s existing poll also sees that root: `adoptedStyleSheets` on the `ShadowRoot` and `<style>` / constructed sheets whose `ownerNode` lives in that tree. Same `SHEET`/`RULE` ops. Scope = that host (existing pierceHost). Host kill ⇒ those sheets die (already C7). No new CSSOM opcodes.

DOM walk without this poll leaves web components unstyled. The implementation plan includes this poll extension in the same feature.

---

## NIT (not this version)

- Closed / UA
- `slotAssignment: 'manual'` and `slot.assign` sync

Do not observe `contentDocument`.
