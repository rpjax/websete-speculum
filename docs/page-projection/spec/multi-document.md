# PageProjection — multi-document

**Status:** lab same-origin iframe on the wire (OPEN-6). Multi-context observability **shipped**. XO / srcdoc / sandbox / fenced NIT. Production not cutover.  
**Law:** this file is the spec. Code is a reflection. Do not invent in code what is still OPEN here.  
**Index:** [README.md](README.md). PP ISA: [frame-protocol.md](frame-protocol.md).

**Lab** is a harness. Do not call the algorithm “lab”.

The algorithm **observes** the page. It never writes host identity onto live DOM.

---

## 0. Topic queue

| # | Topic | State |
|---|--------|--------|
| Machine | Context, child-scope indexer, reinstall | **LOCKED** |
| Runtime vs algorithm | Root runtime ≠ per-window algorithm | **LOCKED** (this file §1) |
| Header `contextId` | This instance’s mine (contract “who am I”). Not a parent field. | **LOCKED** |
| Root `contextId` | `1`; nested never `1`; `0` invalid; root does not call `getScopeId` | **LOCKED** |
| Nested id | This instance mints into **its** indexer; child asks the contract who it is | **LOCKED** |
| Mint | `u32`; root **runtime** RPC; reserve `1` for root. Not a GUID. | **LOCKED** |
| Child-scope indexer | Per instance, like the node indexer. Drop with the host **row**. Not in `CHECK`. | **LOCKED** |
| `NODE_NEW` extra arg | Only when nested-context host; omit otherwise. Presence = bit 7 of `ns` byte | **LOCKED** |
| Classify host | `contentWindow != null` (not `.contentDocument`). Admit connected. | **LOCKED** |
| Projected host iframe | Same-origin blank; do not navigate live `src`. Parent installs nested algorithm. | **LOCKED** |
| Bus | Transport = **[context-bus.md](context-bus.md)** (**SEALED** — `emit` / `invoke`). Domain still: events all layers; `emitFrame` via root runtime; postMessage is the carrier. | **LOCKED** domain roles; transport **SEALED** |
| Resync request | **Control plane only:** `{ type: 'requestResync', contextId, … }` on `PlaneChannel.Control` → root bootstrap `publishResyncRequest` → matching Virtual `emitResyncFrame`. Loose bus `resyncRequest` is **fan-down only** (root → nested producers), never an entry path. | **LOCKED** |
| RPC pipe | request / response / heartbeat; TCS awaiter; `getScopeId`, `mint`, **`snapshot`** | **LOCKED** shape; TS names OPEN |
| Name | Header field `contextId` (was `documentId`) | **LOCKED** name |
| M2 | PP header layout (`contextId: u32` after flags) | **LOCKED** layout |
| Nav / blank `load` | Same `contextId`; reinstall; no remint | **LOCKED** |
| Shadow | Kind 1 — [shadow.md](shadow.md); shipped | not this file |

Dead ends (child-only generate, random child id, timeout-means-root, session document table as router, `DOC_ATTACH` join, id on the element row, remint on `load`, hashing `hosts` into `tableHash`) stay in the decision log. They are not the machine.

---

## 0.1 What this file is (and is not)

Foundation: [subtrees.md](subtrees.md). This file is **kind 2** (nested browsing context). Shadow is the **same** algorithm instance ([shadow.md](shadow.md)).

Classify a nested host with **`contentWindow != null`**. Do **not** read `.contentDocument` (null cross-origin; would miss XO iframes). Detached elements often have a null `contentWindow` — admit only **connected** nodes (already the producer rule).

The lab Projected **surface** iframe (where apply paints) is **not** a nested browsing context of the target. Do not treat it as a `contextId`.

---

## 1. Runtime vs algorithm

Two codebases. The algorithm **consumes** the runtime through an interface. It does not own the Chromium↔sidecar socket.

| | **Runtime** | **Algorithm** |
|--|-------------|---------------|
| Install | **Once**, session-root tab | **Every** `window` (root and each nested browsing context) |
| Job | Sidecar connection. **Implements `emitFrame`.** Dumb mux. **`u32` mint allocator.** Bus (postMessage) so every layer can emit/listen. | Observe / produce / two-phase apply **one tree**. Calls `emitFrame` / listens; does not own the socket. |
| Knows | How bytes leave the tab; next unused `contextId` | `mine`, node table, **child-scope indexer**, MO |
| Does not | Observe the child’s DOM; apply frames | Open its own WS from a nested heap; hold the session mint counter |

A nested algorithm does **not** open a socket. It calls the **interface** (`emitFrame`, `getScopeId`, `mint`). The **root runtime** implements `emitFrame` (bytes onto the sidecar). The bus carries events through every layer so that call works from a nested heap.

The root algorithm instance is **not special** except: it has no embedder, so it does not call `getScopeId` (`mine = 1` from the contract). Same produce/apply loop as a child. When it admits a nested host, it still **mints** via the runtime (that is a different call).

---

## 2. What a context is

A **context** is one install of the projection algorithm in one JS heap (`window`). By design it observes **one tree**.

At init the algorithm asks the **contract** “who am I?”, stores `mine`, and stamps **every** frame it emits with `header.contextId = mine`. That field is **not** a parent/child binding. The embedder answering (`getScopeId`) is how the JS environment implements the contract for nested heaps — not the algorithm.

| Context | Host | `contextId` |
|---------|------|-------------|
| Session root | The session browsing context. `window.parent === window` / `frameElement == null`. | **`1`** (both Virtual and Projected). Reserved. Not minted. |
| Nested (`iframe` / `frame` / `object` / `embed`) | An **element node** in the **parent** context’s tree | Session-global `C ≠ 1`, minted when **that parent instance** first admits the host node |

`0` is invalid. Space is **`u32`** (not a GUID).

The id names the **context**, not an HTML `Document` object. It is a **different space** from node-table id `1` (that context’s Document row — [frame-protocol.md](frame-protocol.md) §1.2). Every nested instance still has Document row `1` **inside its own table**.

**When `C` changes:** the host **row** is dropped, or a **new** host node is admitted. Inner navigation does **not** remint. Same-node move keeps the row → keeps `C`.

Navigating the iframe replaces the inner JS heap and the inner tree; the host **row** in the parent is the same, so `C` is the same. The new heap **reinstalls** the algorithm, asks the contract who it is, gets the same `C`, cold `resyncVirtual` / empty apply + incoming resync.

---

## 3. Child-scope indexer — not the page, not the node table

Each algorithm instance keeps its own indexer of **child** scopes (same idea as the node indexer; nesting recurses because every instance has one):

```text
childScopes: Map<nodeId, contextId>
```

- Virtual: when this instance first admits a **connected** node with **`contentWindow != null`**, it asks the root runtime to **mint** a `u32` `C`, then `childScopes.set(hostNodeId, C)`. Live iframe is untouched. Not a tag list. Not `.contentDocument`.
- That `C` **rides `NODE_NEW` of the host** as an extra operand **only on that case**. Ordinary elements **omit** the field (logical `nestedHost=false`, `childScopeId=null`). Do not write an explicit `0` u32 on every ELEMENT.
- **Cursor:** bit 7 of the ELEMENT `ns` byte is the presence mark (`ELEMENT_NS_NESTED_HOST_BIT`). Same omit pattern as `ns === custom` → uri. Bits 4–6 reserved 0. If the bit is set, `childScopeId: u32` follows attrs (`C ≥ 2`). Projected apply of that `NODE_NEW` fills the **same** indexer. Projected **never** mints. Still not a DOM write. Still not a hashed column of the element row. **Not** in `tableHash` / closing `CHECK`.
- Drop of that **host row** (`NODE_DROP` of the node) drops the indexer entry. `REMOVE` that only detaches, or a same-tick move, does **not** remint. Inner nav does not touch the indexer.
- No `SCOPE_NEW` opcode.

This indexer is **not** a session router. Frames still go on the shared bus; each instance applies iff `header.contextId === mine`. `DOC_ATTACH` stays unimplemented.

**Mint:** session-global `u32` from the **root runtime** (simple RPC). `0` invalid. `1` reserved for the session root. Not a GUID. Not a per-heap `2, 3, 4…`. Nested and root algorithm instances both call mint when *they* admit a host; only the root runtime holds the counter. Nested **never** invents an id. Timeout never becomes an id.

---

## 4. Bus — events at every layer

> **Transport contract:** **[context-bus.md](context-bus.md)** (`ContextBus`: envelope, `emit`, `invoke`). This section keeps **domain / runtime** rules. Do not re-specify invoke heartbeats here.

The bus **propagates events through all layers**. It is not the algorithm. Carrier today: `postMessage` under ContextBus.

Two transport layers:

| Layer | Contract | Domain examples |
|------|----------|-----------------|
| **ContextBus** (in-page) | `emit` / `invoke` per [context-bus.md](context-bus.md) | `getScopeId`, `mint`, `snapshot`, `emitFrame`, `telemetry`, `resyncRequest` |
| **Loopback mux** (Virtual root ↔ sidecar) | §10.1c in [input-unified-design-draft.md](input-unified-design-draft.md) | `frame`, `telemetry`, `invoke` (`applyScrollCensus`) |

Legacy Control/Loose `projectionBus` shapes are **deleted** (D-UI-27 cutover).

Algorithm at any nesting level: `interface.emitFrame(frame)`. It does not know hops, `window.top`, or the sidecar socket.

**Who implements `emitFrame`:** the **root runtime** (write to the sidecar). Nested heaps reach that implementation because the bus carries the event through the layers.

**Resync:** Projected client (root or nested) → session/lab relay → **`PlaneChannel.Control` `requestResync`** → root bootstrap → `publishResyncRequest` → local `onResyncRequest` listeners + loose fan-down to nested producer windows. There is **no** upward loose resync, **no** `emitResyncRequest`, **no** parallel sidecar stub. DataPlane does not route by `contextId`; Control plane is the contract ([open.md](open.md) closed 2026-08-19).

**Who listens to frames:** every algorithm instance; apply iff `header.contextId === mine`. The DataPlane does not route by document.

`getScopeId` is a **control** call: nested → immediate parent algorithm (`event.source === iframe.contentWindow` → `childScopes.get`). Not a broadcast. **`mint`** is control answered by the root runtime.

Heartbeat keeps a control awaiter alive. It does not complete the call. `getScopeId` stays fast; retry if the embedder has not `childScopes.set` yet. Do **not** invent an id. Do **not** treat timeout as “I am root.”

**Root never calls `getScopeId`.** `window.parent === window` / `frameElement == null` → `mine = 1`.

Do not punch CSP to make page-JS `WebSocket` to localhost ([open.md](open.md) E-03/E-08). Nested has no own WS. The root runtime’s sidecar connection is not a page `connect()`.

---

## 4.1 Projected nested host — blank, same origin

The host element exists for **DOM isomorphism**. It is **our** iframe: same-origin, blank (`about:blank` / no live navigation). It does **not** load the site’s `src` / `srcdoc`. Setting those as navigation would fetch the real page into Projected.

Who paints inside that window is the **nested algorithm**. The **parent** installs it into that `contentWindow` (same-origin blank makes that legal). Virtual still observes the real nested document in Chromium.

Table attrs `src` / `srcdoc` stay on the row (producer truth). Phase 2 on a nested-context host **must not** navigate the browsing context to those URLs.

**Install / drop (LOCKED 2026-08-27):** parent waits for the blank iframe’s initial `load` before binding `NestedProjectedApply` + `ProjectedInputRuntime.registerContext` (`nestedHostAwaitingLoad`). On **`NODE_DROP` / `onNestedHostDrop`**, Projected MUST **cancel** that pending bind (`cancelled` flag + `removeEventListener`) and drop any `pendingNestedFrames` for that `contextId` — even when bind has not run yet. Clearing the awaiting map alone is **not** enough: a late `load` would register a ghost context into the S6 census and poison input Phase A ([input.md](input.md) §4). `reset()` cancels all pending binds the same way.

---

## 5. Sequences

```text
This instance (Virtual) admits a connected node with contentWindow != null
  mint C from root runtime
  childScopes.set(host, C)
  NODE_NEW(host, …, childScopeId=C)   // extra arg only because it is a host
  emitFrame — header.contextId = this instance’s mine

Projected peer
  apply NODE_NEW → our blank same-origin iframe; childScopes.set(host, C)
  do not navigate live src
  parent installs nested algorithm into that contentWindow
  does not mint

Inner document (Virtual: real nested load; Projected: blank apply target)
  algorithm reinstalls in that JS heap
  asks the contract who am I → C
  Virtual: observe that tree, resyncVirtual, emitFrame stamped C
  Projected: listen; apply iff C
```

Navigate (Virtual inner): parent MutationObserver is silent (host row unchanged). Indexer unchanged. Old inner instances die with the old heap. New ones reinstall, ask, get the same `C`. No remint. No extra opcode to “update the id.”

Blank then `src` on **Virtual** (two `load`s): same host row, same `C`, two reinstalls. First tree is empty-ish; second resync replaces it. Do **not** special-case this. Projected inner stays blank; the nested algorithm applies the new tree.

Host **row** dropped: drop `childScopes` entry; inner heaps gone; leftover frames for that `C` → every remaining applier noops. A **new** host node (even same tag, same `src`) is a **new** `C`.

---

## 6. Instance loop

```text
Virtual tick:
  drain MO → table → encode PP (header.contextId = mine, wire v2) → emitFrame
  first admit of nested host: contentWindow != null → mint + childScopes.set + extra arg on that NODE_NEW

Projected onFrame (bus; iff header.contextId === mine):
  assemble parts → two-phase apply
  NODE_NEW nested host → blank same-origin iframe, childScopes.set, parent installs nested algorithm
  do not navigate src/srcdoc

halt (this JS heap unloading):
  drop bus subscription; stop observe; instance gone with the realm
  contextId remains in the embedder’s indexer until that host row is dropped
```

In-flight frames from a previous install of the same `C` are the existing recovery path (`generation` / `sequence` / `preTableHash` / resync), not a new id. Do not remint to isolate them.

---

## 7. What each side needs

| Role | Needs |
|------|--------|
| Nested Virtual | contract “who am I” → `C`; `emitFrame` stamped with `C` |
| Nested Projected | contract “who am I” → `C`; listen; apply iff `C`; on desync → **`requestResync` via Control plane** (lab: WS → session `requestResync`; same contract at cutover) |
| Any algorithm that can host nested contexts | Node table + **child-scope indexer**; mint on admit (`contentWindow != null`); answer `getScopeId` for `event.source === that contentWindow` |
| Projected parent of a host | Blank same-origin iframe; **install** nested algorithm into `contentWindow`; never live `src` |
| Root algorithm | `mine = 1`; no `getScopeId`; same loop; mint when *it* admits a host |
| Root runtime | Sidecar connection; **implements `emitFrame`**; **`u32` mint**; bus; **telemetry fan-out**; **snapshot RPC routing** (forward/recurse like `mint`); not the child-scope indexer |

---

## 8. PP header (wire v2 + `contextId`)

Shipped at **`FRAME_WIRE_VERSION` 2** — `contextId: u32` in the fixed prefix ([frame.ts](../../../sidecar/browser/mirror/projection/models/frame.ts)). Not a separate v3 bump.

```text
offset 0   magic        u16   0x5050
offset 2   version      u8    2
offset 3   flags        u8
offset 4   contextId    u32   this instance’s mine (contract). Not a parent field.
offset 8   generation   u32
offset 12  sequence     u32
offset 16  partIndex    u16
offset 18  partCount    u16
offset 20  preTableHash u64
offset 28  strCount     u32   …
```

All parts of one frame share `contextId`, `generation`, `sequence`. Mismatch → `malformed`.

---

## 9. Desync / CSSOM

| Event | Effect |
|-------|--------|
| Host row dropped | Drop `childScopes` entry; inner contexts halt; leftover frames for those ids → noop |
| Inner nav / blank→src | §5 reinstall, same `contextId` |
| Applier desync | Projected client requests resync on **Control plane** with that instance’s `contextId`; matching Virtual `emitResyncFrame` after `publishResyncRequest` |
| Producer map untrusted | That install `resyncVirtual` only |

Input disarm and string table are per install (the current heap), not “per host forever.”

CSSOM: that install’s poll + that node table. Shadow stays **this** instance when the inner document has shadow.

---

## 10. OPEN (do not code)

- Port TypeScript names (Id, Bus, Rpc / `emitFrame`).
- `srcdoc`, sandbox, fenced (NIT until decided). `object`/`embed`/`frame` follow `contentWindow`, not a separate kind.

---

## Decision log (this file)

| Date | Topic |
|------|--------|
| 2026-08-18 | Premises: N instances; DataPlane dumb; id on PP header not envelope |
| 2026-08-18 | Document table schema + `byId`/`byHost`; Virtual = slice, client = union |
| 2026-08-18 | Header v3 layout (28-byte prefix) — **superseded:** shipped as **v2 + `contextId`** (no v3 bump) | [multi-document.md](multi-document.md) §8 |
| 2026-08-18 | M4 binding was OPEN — mint/join across heaps |
| 2026-08-18 | **Restate.** Algorithm + ports; self id; bus filter; install inside |
| 2026-08-18 | Retract produce-onFrame-noop |
| 2026-08-18 | Exclusive-port / first-frame bind (wrong bus model) |
| 2026-08-18 | Parent mints nested id; host row carries it |
| 2026-08-18 | Root id `1`; nested query; remint on nav (retracted below) |
| 2026-08-18 | **Retract** id-on-element-row and remint-on-load. **Context** = algorithm install / one tree; parent `hosts: Map<nodeId, contextId>`; algorithm does not mutate the page; nav and blank→src are reinstall, same id. Header field renamed `contextId`. |
| 2026-08-18 | **Three subtree products.** Nested browsing context (this file) ≠ shadow (same instance) ≠ inert `template.content` (ignore). Declarative shadow is shadow. |
| 2026-08-19 | **Runtime ≠ algorithm.** Runtime once at the root tab (sidecar connection). Algorithm installs in every `window`. Nested has no own WS. |
| 2026-08-19 | **Root `contextId = 1`** without RPC. Nested `getScopeId` to immediate parent (`event.source === iframe.contentWindow`). Timeout-as-root forbidden. Retry if parent has not indexed yet. |
| 2026-08-19 | **RPC pipe** locked as shape: request / response / heartbeat + TCS awaiter. `getScopeId` is one method. Heartbeat is generic; `getScopeId` stays fast. |
| 2026-08-19 | **`hosts` not in `CHECK`.** Assignment rides host `NODE_NEW`. New host element → new `C`. Inner nav → same `C`. |
| 2026-08-19 | **Header is mine**, not a parent field. Child-scope indexer per instance. Extra `NODE_NEW` arg only for host nodes (omit otherwise). Mint = root-runtime `u32` RPC, not GUID; reserve `1`. Indexer lifetime = host **row**. `ns` bit 7 = nested-host presence (`childScopeId` u32 after attrs). |
| 2026-08-19 | **Classify** `contentWindow != null`; never `.contentDocument`. Admit connected. |
| 2026-08-19 | **Projected host** = our blank same-origin iframe; parent installs nested algorithm; do not navigate live `src`/`srcdoc`. |
| 2026-08-19 | **Bus** = events all layers (control RPC vs loose emit/listen). `emitFrame` implemented by root runtime. postMessage is the bus. Not hop-vs-top as algorithm. |
| 2026-08-19 | **Resync request** — **Control plane only** (`requestResync` → `publishResyncRequest`); loose bus `resyncRequest` fan-down only. Matching Virtual `emitResyncFrame`. Not in PP body. |
| 2026-08-19 | **Multi-context observability** — telemetry `contextId` + loose bus `telemetry`; control RPC **`snapshot`** per instance; lab context index; wire monitor per scope; CPU Profiler tab-level only. | [observability.md](observability.md) §10 |
