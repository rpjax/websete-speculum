# Implementation — Frame (accumulate + flush)

| Field | Value |
|-------|-------|
| **Future path** | `sidecar/browser/patchright/mirror/page/frame.ts` **and** in-page fragment `inpage/frame.frag.ts` |
| **LOC ceiling** | 500 |
| **Contracts implemented** | [03-frame.md](../../contracts/03-frame.md); redesign §5.3; D-SPEC-1 ordering for `documentState`; D-SPEC-5 viewport scroll |
| **Invariants** | Frame = net effect since previous boundary; one ordered op list; one `sequence` if non-empty; empty ⇒ no emit, no sequence. Flush order fixed. Declarative `childList` (FULL/APPEND). Moves preserve identity. Cssom ops coalesce in same window via cssom module. |
| **Ban list** | Emitting one wire envelope per MutationRecord. Filtering by visual relevance. Consuming sequence on empty frames. Mixing establish\* ops with live ops in the same frame. Dropping frames under load. Coalesce knobs from superseded coalesce doc. |

---

## Types / signatures

```ts
type ChildListMode = 0 | 1; // FULL=0, APPEND=1

interface ChildRefExisting { kind: 0; id: NodeId }
interface ChildRefFresh { kind: 1; node: Node } // encode expands to Node encoding
type ChildRef = ChildRefExisting | ChildRefFresh;

interface DomOpChildList {
  op: 4;
  parent: NodeId;
  mode: ChildListMode;
  children: ChildRef[];
}
interface DomOpPatch {
  op: 5;
  node: NodeId;
  snapshot: NodeSnapshot;
}
interface DomOpScrollViewport { op: 6; scrollX: number; scrollY: number }
interface DomOpScrollElement { op: 7; node: NodeId; scrollTop: number; scrollLeft: number }
interface DomOpDocumentState {
  op: 12;
  title: string;
  lang: string;
  dir: string;
  viewportContent: string;
}

type DomLiveOp =
  | DomOpChildList
  | DomOpPatch
  | DomOpDocumentState
  | DomOpScrollElement
  | DomOpScrollViewport;

interface FrameAccum {
  dirtyParentNodes: Set<Node>;
  attrDirtyNodes: Set<Node>;
  textDirtyNodes: Set<Node>;
  stateDirtyNodes: Set<Node>;
  newNodes: Set<Node>;          // first published this frame (track at allocate time)
  detachedIds: Set<NodeId>;
  scrollDirty: Map<NodeId, { x: number; y: number }>;
  documentStateDirty: boolean;
  clear(): void;
}

interface FrameFlusher {
  /** Called by clock each boundary. Returns null if empty. */
  flush(ctx: FlushContext): { sequence: number; ops: WireOp[] } | null;
}

interface FlushContext {
  fmap: FMap;
  identity: IdentitySpace;
  cssom: CssomProducer;
  echo: ScrollEchoSuppressor;
  sequenceNext: { value: number }; // live sequences start at 1 after establish handoff
}
```

Track `newNodes`: when `identity.allocate` assigns a **new** id during flush snapshotting, add node to `newNodes` for this frame. Observe may also add to `newNodes` when a previously unpublished node becomes a candidate — exact rule: any node that receives its first id during this frame’s flush is ephemeral-candidate for prune step 1.

---

## Step-by-step algorithm — `flush`

If establish epoch is open and this is not the establish frame itself, live ops accumulate into a handoff buffer ([establish.md](establish.md)); algorithm below is identical when draining.

### 0. Snapshot sets

Copy references to local variables; immediately `accum.clear()` **after** taking ownership of the sets for this flush (so concurrent MO can start next frame). Cssom producer similarly snapshot-and-clear its dirty sets.

### 1. Prune ephemerals (PP-FR-1)

For each node in `newNodes`:
- If `!node.isConnected` (or not in published pierce tree): 
  - Forget id side-effects: do not emit; remove from all dirty sets; if id was allocated, it was never sent — **id remains consumed** (never reuse) but reverse may release via finalizer when node is GC’d.
  - Remove from `newNodes`.

### 2. Absorb descendants (PP-FR-2)

For each node in `attrDirty ∪ textDirty ∪ stateDirty ∪ dirtyParents` (as nodes):
- Walk published ancestors; if any ancestor ∈ `newNodes` (surviving), remove this node’s individual dirty entries — state rides in ancestor’s fresh snapshot / childList.

### 3. Prune orphans under detached

For each id in `detachedIds`:
- Any dirty node whose published ancestor chain includes a detached id → discard dirty entries.
- Detached ids themselves do not emit patches; absence from parent `childList` removes them (declarative).

### 4. Emit `childList` — ancestor-first document order

1. Materialize `dirtyParents` as published nodes still needing child list emit.
2. Sort by document order / tree depth (ancestor before descendant): compare via `Node.compareDocumentPosition` across pierce flattening order (main document order with pierce interiors nested under hosts).
3. For each parent:
   a. `parentId = identity.allocate(parent)` if needed (must already be published).
   b. `kids = fmap.visibleChildren(parent)`.
   c. Build `ChildRef[]`: for each child, if `identity.idOf(child) > 0` and child not in surviving `newNodes` requiring fresh encode… **Rule:** if child had no id before this frame **or** child ∈ `newNodes`, emit `fresh { node }`; else `existing { id }`.
   d. Mode: if previous F-visible child id list (mirror-side or last-emitted cache in-page) is an exact prefix of new list and only suffix grew → `APPEND` with **only the suffix refs**; else `FULL` with complete list.
   e. Push `DomOpChildList`.
4. In-page MAY keep `lastChildIds: WeakMap<Node, NodeId[]>` updated after emit for APPEND detection. On generation bump, clear.

### 5. Emit `patch` (PP-FR-3)

For each surviving node in `attrDirty ∪ textDirty ∪ stateDirty` (set union), document order optional:
1. `snap = fmap.snapshot(node, identity)` — full flush-time snapshot, no children.
2. Push `DomOpPatch { node: snap.id, snapshot: snap }`.

### 6. Emit Cssom ops

Call `cssom.flushOps()` → append ops in Cssom coalesce order (install not used on live path). Live order relative to Dom: after patches and documentState (step 7), before scrolls — so **insert documentState before cssom** per contract 04:

### 7. Emit `documentState` if dirty (D-SPEC-1)

If `documentStateDirty`: push opcode 12 from `fmap.documentState(document)`.

**Ordering correction (normative contract 04):** within the assembled op list:

1. `childList` (ancestor-first)
2. `patch`
3. `documentState`
4. Cssom live ops (`cssomSheetList` / `cssomRuleList` / `cssomPatch`)
5. `scrollElement` then `scrollViewport`

Therefore step 6 Cssom flush is **after** documentState.

### 8. Emit scroll ops

For each entry in `scrollDirty`:
- If echo suppressor says equal to last client intent → skip.
- If key `0` → `scrollViewport`.
- Else → `scrollElement`.
At most one op per key; last sample already in map.

### 9. Sequence + return

If op list empty (and cssom empty) → return `null` (PP-FR-4).

Else:
1. `seq = sequenceNext.value; sequenceNext.value += 1` (after establish, first live seq is 1).
2. Return `{ sequence: seq, ops }`.

Encode + channel happen outside this module ([encode.md](encode.md), [channel.md](channel.md)).

---

## Force flush

Clock watchdog / Node rate path may call `flush` out of band. Same algorithm. MUST NOT drop ops.

---

## PP-* tests

| ID | Assert |
|----|--------|
| `PP-FR-1` | Ephemeral create/destroy never sent |
| `PP-FR-2` | 200-node subtree → one childList entry path |
| `PP-FR-3` | N attr writes → one patch |
| `PP-FR-4` | Empty frame consumes no sequence |
| `PP-FR-6` | O2 soak |
| `PP-FR-8` | Oversized frame split at encode — flush still one sequence |
| `PP-MOVE-1..3` | Declarative move preserves media/focus/scroll |
| `PP-LOAD-1..4` | Rate degrade, no desync; hidden rate |
