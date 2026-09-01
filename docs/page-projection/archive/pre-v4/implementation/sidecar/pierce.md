# Implementation — Pierce (closed shadow + cross-origin)

| Field | Value |
|-------|-------|
| **Future path** | `sidecar/browser/patchright/mirror/page/pierce.ts` (Node CDP) + in-page `pierceAdopt.frag.ts` |
| **LOC ceiling** | 300 (Node) + 150 (in-page adopt fragment, counted under inpage) |
| **Contracts implemented** | [02-f-map.md](../../contracts/02-f-map.md) pierce rules; D-SPEC-3; redesign §5.2.5; WP15 caution |
| **Invariants** | Default identity remains in-page WeakMap (not CDP `backendNodeId` allocator). CDP MAY be used **only** to discover closed shadow roots / cross-origin frames and to inject host/root **references** into in-page WeakMaps / observation sets. Pierce flatten publishes one tree. Slot assignment = flattened rendered result. |
| **Ban list** | CDP full-tree ferry as default producer. CDP as identity allocator unless WP15 reopened with evidence. Publishing light+shadow side-by-side. Skipping closed/XO pierce (PP-F-4). Using pierce to write identity attrs into Virtual. |

---

## Problem split

| Target | In-page accessible? | Mechanism |
|--------|---------------------|-----------|
| Open shadow root | Yes (`element.shadowRoot`) | Pure in-page adopt |
| Closed shadow root | No from page JS | CDP discover + inject reference into page |
| Same-origin iframe | Yes (`contentDocument`) | Pure in-page |
| Cross-origin iframe | No from page JS | CDP discover + inject document/root handle into page maps |

---

## Types / signatures

```ts
interface PierceRegistry {
  listRoots(): Node[];
  onAdopted(cb: (host: Element, root: Node, kind: PierceKind) => void): void;
}

type PierceKind = 'open-shadow' | 'closed-shadow' | 'so-iframe' | 'xo-iframe';

/** Node-side. */
interface PierceHost {
  start(page: PageLike, opts: { pollMs?: number }): Promise<void>;
  stop(): Promise<void>;
  /** Force scan after navigation. */
  rescan(): Promise<void>;
}

/** In-page adopt API called from CDP-injected evaluation. */
interface PierceAdopt {
  adoptClosedShadow(host: Element, shadowRoot: ShadowRoot): void;
  adoptXoFrame(iframe: HTMLIFrameElement, doc: Document): void;
  detach(host: Element): void;
}
```

---

## Step-by-step — in-page (open / same-origin)

1. On observe start and on MO `childList`, detect `element.shadowRoot` (open) → register root; stamp host attrs via fmap; `observe.observeRoot(shadowRoot)`.
2. Detect `iframe` with `contentDocument` accessible → adopt documentElement tree under iframe host; stamp `speculum-iframe`; observe.
3. Flatten: `fmap.visibleChildren` uses shadow flattened composition APIs (`assignedNodes({flatten:true})` where applicable) — PP-F-3.

---

## Step-by-step — Node CDP for closed / XO only (D-SPEC-3)

### Discovery (allowed)

1. Enable CDP `DOM` domain as needed for piercing (node tracking cost noted in WP15 — keep minimal).
2. Periodically or on DOM events: find elements with closed shadow (`DOM.describeNode` / pierce flags) and iframes whose document is cross-origin.
3. For each new closed root:
   - Resolve corresponding in-page `Element` handle (Patchright ElementHandle).
   - Obtain a JS handle for the closed `ShadowRoot` via CDP backend binding / `DOM.resolveNode` on the shadow root backend id.
   - `page.evaluate((host, root) => PP.pierceAdopt.adoptClosedShadow(host, root), host, root)`.
4. For each XO iframe:
   - Resolve iframe element handle in parent page.
   - Resolve content document handle via CDP (frame tree → document node → resolveNode in that execution context).
   - Inject into **parent** page adopt function that stores WeakMap iframe→document and notifies observe — the adopted document’s nodes are observed by installing MO in the **child frame’s** world if required:

**XO observation:** MO must run in the frame that owns the nodes. For XO, inject the same producer fragments into the child frame (init script every frame) **or** drive mutations via CDP → still only for adopt/dirtiness signals, not full tree ferry. Normative preferred path:

1. Init script installs producer in all frames.
2. Child frame runs identity/observe/encode locally and pushes parts tagged with frame routing — **OR** child marks dirty and parent pierce flatten pulls snapshots across injected Document reference.

**Simplest D-SPEC-3-compliant path:** CDP only injects the Document/ShadowRoot object into a WeakMap in a context that can touch it; if parent cannot touch XO nodes, producer runs **per browsing context** with a shared generation/sequence coordinator in Node that merges F-flatten at Node mirror by routing.  

**Normative choice for this pack (no invention later):**

- **Closed shadow:** inject ShadowRoot into parent page WeakMap; parent observe/F can walk `root` because the object reference is now in-page — CDP used only to obtain the reference.
- **XO iframe:** install identical in-page producer in the child frame via init script; child pushes binary parts to Node with a `frameKey`; Node rewrite/mirror merges child’s published subtree under the parent iframe host id using a pierce attachment table maintained from CDP frame tree (host element id in parent ↔ child generation). Dom ids remain per-session monotonic via Node-issued id range splits **or** child allocates Dom ids from a Node-provided id lease.

**Id lease (XO):** To keep one id space (contract 01), Node hands each frame an `idLo/idHi` lease within Dom range `[1..0x7FFFFFFF]` via bootstrap config; parent gets first lease; children get subsequent leases. Never overlap. Cssom leases similarly in Cssom range.

This is still not CDP identity allocation (WP15); CDP only attaches frame tree topology.

### MUST NOT

- Call `DOMSnapshot.captureSnapshot` as the default establish/live producer.
- Allocate `NodeId` from `backendNodeId`.
- Ferry columnar CDP snapshots as wire frames.

---

## Adopt algorithm (in-page `adoptClosedShadow`)

1. If host already adopted → return.
2. `closedRoots.set(host, shadowRoot)`.
3. Notify observe to `observeRoot(shadowRoot)`.
4. Mark host dirty for childList (flattened).
5. fmap stamps `speculum-shadow-root` + `speculum-shadow-closed` on snapshot.

### `adoptXoFrame` / child producer attach

1. Register pierce attachment in Node: `{ parentIframeId, childFrameId }`.
2. Child bootstrap runs establish/live for its Document.
3. Mirror places child root’s published children under iframe host when applying child frames / establish.

---

## Detach

On host removal or frame detach: unobserve; detach maps; mark detached ids; CDP rescan drops stale entries.

---

## PP-* tests

| ID | Assert |
|----|--------|
| `PP-F-3` | Slotted flatten correct |
| `PP-F-4` | Closed shadow + XO iframe pierced and published |
| `PP-ID-1` | No identity attrs written during pierce |
| WP15 | Default path does not use captureSnapshot identity |
| `PP-ISO-2` | Pierce state per session only |
