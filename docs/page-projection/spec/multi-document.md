# PageProjection — multi-document

**Status:** design in progress (OPEN-6). Not on the wire.  
**Law:** this file is the spec. Code is a reflection. Do not invent in code what is still OPEN here.  
**Index:** [README.md](README.md). PP ISA: [frame-protocol.md](frame-protocol.md).

**Lab** is a harness. Do not call the algorithm “lab”.

The algorithm **observes** the page. It never writes host identity onto live DOM.

---

## 0. Topic queue

| # | Topic | State |
|---|--------|--------|
| Machine | Context, parent host map, reinstall | **LOCKED** (this file) |
| Name | Header field `contextId` (was `documentId`) | **LOCKED** name; not shipped |
| M2 | PP header v3 layout | **LOCKED** layout, not shipped |
| Nav / blank `load` | Same `contextId`; reinstall; no remint | **LOCKED** |
| ISA | `NODE_NEW` operand that fills the parent map | **OPEN** |
| Ports | Names / TS of Id, Bus | **OPEN** |
| Bus impl | postMessage vs CDP vs ports | **OPEN** (M8) |
| Shadow | Feature 1 — [shadow.md](shadow.md); this file waits | not this file |

Dead ends (child-only generate, session document table as router, `DOC_ATTACH` join, id on the element row, remint on `load`) stay in the decision log. They are not the machine.

---

## 0.1 What this file is (and is not)

Foundation: [subtrees.md](subtrees.md). This file is **kind 2** (nested browsing context). Shadow is [shadow.md](shadow.md) — later.

`.contentDocument` classifies nested browsing context. The parent still does not read that pointer.


---

## 1. What the id is

A **context** is one install of the projection algorithm. By design it observes **one tree**.

Every context has a **host**:

| Context | Host |
|---------|------|
| Session root | The session browsing context. No parent algorithm. `frameElement` is null. |
| Nested (`iframe` / `frame` / `object` / `embed`) | An **element node** in the **parent** context’s tree |

The id names that context, not an HTML `Document` object. Navigating the iframe replaces the inner JS heap and the inner tree; the host in the parent is the same node, so the id is the same. The new heap gets a **reinstall** of the algorithm, same id, cold `resyncVirtual` / empty apply + incoming resync.

**Rename:** PP header field is `contextId` (not `documentId`). Same `u32` slot in v3.

`0` invalid. Root is `1` on both Virtual and Projected (neither root generates independently). Nested ids are session-global, minted by the **parent** when it first admits the host node. Nested never `1`.

---

## 2. Parent map — not the page, not the node table

Each context that can contain nested hosts keeps algorithm memory:

```text
hosts: Map<nodeId, contextId>
```

- Virtual: when the observer first admits a nested-browsing-context host, `mint()` → `hosts.set(hostNodeId, childId)`. Live iframe is untouched.
- That assignment **rides `NODE_NEW` of the host** (operand layout OPEN) so the Projected parent fills the **same map** while applying. Still not a DOM write. Still not a hashed column of the element row (the element did not change).
- Child boot, both sides: `Id.myId()` asks the embedder. Embedder answers `hosts.get(thatHost)`. Projected does not mint. Child does not scrape frames to guess.

This map is **not** a session router. Frames still go on the shared bus; each Projected context applies iff `header.contextId === mine`. `DOC_ATTACH` stays unimplemented.

`Id.mint()` uniqueness is session-global (not a per-parent JS counter). Who holds the allocator (root Virtual vs sidecar) is **OPEN**. Produce/apply do not implement it.

---

## 3. Sequences

```text
Virtual parent
  observer sees host node
  mint C, hosts.set(host, C)
  NODE_NEW(host, …, childContextId=C)
  frames use header.contextId = parent’s mine

Projected parent
  apply NODE_NEW → create the iframe in this tree (as today)
  hosts.set(host, C)     // map only

Inner document appears (blank, src, later navigation — same)
  algorithm reinstalls in that JS heap
  Id.myId() → C
  Virtual: observe that tree, resyncVirtual, emit header.contextId = C
  Projected: onFrame apply iff C
```

Navigate: parent MutationObserver is silent (host unchanged). Parent map unchanged. Old inner instances die with the old heap. New ones reinstall, ask, get the same `C`. No remint. No extra opcode to “update the id.”

Blank then `src` (two `load`s): same host, same `C`, two reinstalls. First tree is empty-ish; second resync replaces it. Do **not** special-case this.

Host removed: drop `hosts` entry; inner heaps gone; leftover frames for that `C` → every remaining applier noops.

---

## 4. Instance loop

```text
Virtual tick:
  drain MO → table → encode PP v3 (header.contextId = mine) → Bus.emit
  first admit of a host: mint + hosts.set + childContextId on that NODE_NEW

Projected onFrame(bytes):
  peek header.contextId
  if ≠ mine: return
  assemble parts → two-phase apply

halt (this JS heap unloading):
  drop bus subscription; stop observe; instance gone with the realm
  contextId remains assigned to the host until the host is removed
```

In-flight frames from a previous install of the same `C` are the existing recovery path (`generation` / `sequence` / `preTableHash` / resync), not a new id. Do not remint to isolate them.

---

## 5. PP header v3

Not shipped. Current engine version **2**. No shim.

```text
offset 0   magic        u16   0x5050
offset 2   version      u8    3
offset 3   flags        u8
offset 4   contextId    u32   this context’s mine
offset 8   generation   u32
offset 12  sequence     u32
offset 16  partIndex    u16
offset 18  partCount    u16
offset 20  preTableHash u64
offset 28  strCount     u32   …
```

All parts of one frame share `contextId`, `generation`, `sequence`. Mismatch → `malformed`.

---

## 6. Desync / CSSOM

| Event | Effect |
|-------|--------|
| Host removed | Inner contexts halt; leftover frames for those ids → noop |
| Inner nav / blank→src | §3 reinstall, same `contextId` |
| Applier desync | That `contextId` only: resync request; matching Virtual `emitResyncFrame` |
| Producer map untrusted | That install `resyncVirtual` only |

Input disarm and string table are per install (the current heap), not “per host forever.”

CSSOM: that install’s poll + that node table. Shadow waits until shadow uses this machine.

---

## 7. OPEN (do not code)

- `NODE_NEW` ELEMENT operand for `childContextId` (`0` = this node is not a nested host).
- Who owns session-global `Id.mint()`.
- Port TypeScript (Id, Bus).
- Bus transport (postMessage is a candidate impl; antibot constrains the impl, not the algorithm).
- Shadow, `srcdoc`, sandbox, fenced.

---

## Decision log (this file)

| Date | Topic |
|------|--------|
| 2026-08-18 | Premises: N instances; DataPlane dumb; id on PP header not envelope |
| 2026-08-18 | Document table schema + `byId`/`byHost`; Virtual = slice, client = union |
| 2026-08-18 | Header v3 layout (28-byte prefix); not shipped |
| 2026-08-18 | M4 binding was OPEN — mint/join across heaps |
| 2026-08-18 | **Restate.** Algorithm + ports; self id; bus filter; install inside |
| 2026-08-18 | Retract produce-onFrame-noop |
| 2026-08-18 | Exclusive-port / first-frame bind (wrong bus model) |
| 2026-08-18 | Parent mints nested id; host row carries it |
| 2026-08-18 | Root id `1`; nested query; remint on nav (retracted below) |
| 2026-08-18 | **Retract** id-on-element-row and remint-on-load. **Context** = algorithm install / one tree; parent `hosts: Map<nodeId, contextId>`; algorithm does not mutate the page; nav and blank→src are reinstall, same id. Header field renamed `contextId`. |
| 2026-08-18 | **Three subtree products.** Nested browsing context (this file) ≠ shadow (same instance) ≠ inert `template.content` (ignore). Declarative shadow is shadow. |
