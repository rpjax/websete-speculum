# Implementation — Identity

| Field | Value |
|-------|-------|
| **Future path** | `sidecar/browser/patchright/mirror/page/identity.ts` (Node host API) **and** in-page fragment `inpage/identity.frag.ts` (authoritative allocator) |
| **LOC ceiling** | 250 (Node host shim ≤ 80; in-page fragment ≤ 170; total across both ≤ 250) |
| **Contracts implemented** | [01-identity.md](../../contracts/01-identity.md); redesign §5.1; D-SPEC-2 (allocation in-page) |
| **Invariants** | Per-session id space (K2). Ids `uint32` monotonic from 1; `0` = none. Never reuse an id (within or across generations — counter continues on bump). Forward `WeakMap` + reverse `WeakRef` + `FinalizationRegistry`. No identity attributes written into Virtual DOM. Elements, text, and comments all get ids. Id allocated only when F first publishes the node. |
| **Ban list** | Writing `speculum-anchor` / `speculum-last-mutation-sequence` (or any id attr) into Virtual DOM in production. CSS `querySelector` / `querySelectorAll` for identity on Virtual. Remint / collision tables for clones. `childAt` addressing. Sharing id space across sessions. Resetting the monotonic counter on generation bump. Materialize-debug flag reachable from production config. |

---

## Placement

Authoritative `IdentitySpace` lives **in-page** (Virtual). Node holds only a thin evaluate/handle façade used by input resolve ([contract 10](../../contracts/10-interaction.md)) and by pierce adoption hooks that inject host references into the same in-page maps ([pierce.md](pierce.md)). Allocation algorithm is never duplicated on the Node side.

---

## Types / signatures

```ts
/** Wire / registry node id. 0 is NONE (D-SPEC-5 viewport sentinel shares this constant). */
type NodeId = number; // uint32

const NONE_NODE_ID = 0;
const DOM_ID_MAX = 0x7fffffff; // Dom range upper bound (D-SPEC-8); Cssom uses disjoint range

interface IdentitySpace {
  readonly generation: number;
  /** First publish; idempotent. Throws if Dom counter would leave Dom range. */
  allocate(node: Node): NodeId;
  /** 0 if never published. */
  idOf(node: Node): NodeId;
  resolve(id: NodeId): Node | undefined;
  /** Optional explicit drop (also FinalizationRegistry). */
  release(node: Node): void;
  /** Document swap only (D-SPEC-9). Clears maps; does NOT reset nextId. */
  bumpGeneration(): number;
  /** Debug / O2: count of live reverse entries (WeakRef still alive). */
  liveReverseCount(): number;
}

/** Node-side façade (evaluate into page). */
interface IdentityHost {
  resolve(id: NodeId): Promise<JSHandle<Node> | undefined>;
  bumpGeneration(): Promise<number>;
  generation(): Promise<number>;
}
```

Internal state (in-page only):

```ts
interface IdentityState {
  generation: number;          // starts at 1 for first Document of the session
  nextId: number;              // starts at 1; never reset
  forward: WeakMap<Node, NodeId>;
  reverse: Map<NodeId, WeakRef<Node>>;
  finalizer: FinalizationRegistry<NodeId>;
}
```

---

## Step-by-step algorithm

### Construction (`createIdentitySpace()`)

1. Set `generation = 1`, `nextId = 1`.
2. Allocate empty `WeakMap` and `Map`.
3. Create `FinalizationRegistry` whose callback receives `NodeId` and deletes `reverse.get(id)` if the WeakRef is dead or points at a different object.
4. Return the `IdentitySpace` object closing over that state.

### `allocate(node)`

1. If `node` is null/undefined → throw `IdentityError('null_node')`.
2. Look up `forward.get(node)`. If present, return that id (idempotent).
3. If `nextId > DOM_ID_MAX` → throw `IdentityError('dom_id_space_exhausted')` with `errorCode`/`phase` for telemetry (`encode` / `establish` caller).
4. Let `id = nextId`, then `nextId += 1`.
5. `forward.set(node, id)`.
6. `reverse.set(id, new WeakRef(node))`.
7. `finalizer.register(node, id)`.
8. Return `id`.

### `idOf(node)`

1. Return `forward.get(node) ?? 0`.

### `resolve(id)`

1. If `id === 0` → return `undefined`.
2. Let `ref = reverse.get(id)`. If absent → `undefined`.
3. Let `node = ref.deref()`. If undefined → delete reverse entry; return `undefined`.
4. Return `node`.

### `release(node)`

1. Let `id = forward.get(node)`. If absent → return.
2. Delete forward entry; delete reverse entry for `id`.
3. (FinalizationRegistry will also fire; delete is idempotent.)

### `bumpGeneration()` — hard Document swap only (D-SPEC-9)

1. Clear `forward` by replacing with a new `WeakMap`.
2. Clear `reverse` by replacing with a new `Map`.
3. Recreate `FinalizationRegistry` (old one may still fire; callbacks no-op on missing keys).
4. `generation += 1`.
5. **Do not** set `nextId = 1` — ids never reuse across generations either.
6. Return new `generation`.

### Soft-nav

Soft navigation (same Document) MUST NOT call `bumpGeneration`. Identity maps and `nextId` continue unchanged (D-SPEC-9, PP-NAV-2).

### Clone semantics (PP-ID-2)

A cloned DOM node is a distinct object. `WeakMap` has no entry → `idOf(clone) === 0` until F publishes it and `allocate` runs. Never copy ids from source attributes (there are none on Virtual).

### Input coupling

Sidecar input resolve calls `IdentityHost.resolve(id)`. Miss → retry policy then `AnchorMiss` ([contract 16](../../contracts/16-errors.md)). MUST NOT fall back to querying `speculum-anchor` on Virtual.

---

## Debug materialize (optional)

A build-time / harness-only flag MAY write ids onto Virtual for human debugging. Default **off**. MUST NOT appear in Sessions → PageProjection production knobs ([contract 15](../../contracts/15-configuration.md)). When off, PP-ID-1 holds: zero identity attributes on Virtual.

---

## PP-* tests

| ID | Assert for this module |
|----|------------------------|
| `PP-ID-1` | No `speculum-anchor` or `speculum-last-mutation-sequence` on Virtual DOM at any point |
| `PP-ID-2` | Clone of published node gets a distinct id when later published; no duplicate ids emitted |
| `PP-ID-3` | Text and comment nodes receive ids; no `childAt` on wire |
| `PP-ID-4` | Reverse map releases detached nodes; does not grow unbound over 5-minute soak |
| `PP-ISO-2` | Id space never crosses sessions |
| `PP-IN-5` | Intents resolve through reverse map; miss → retry then drop |
| `PP-NAV-2` | Soft-nav does not bump generation / clear identity |

---

## Failure shape

| Condition | errorCode | phase |
|-----------|-----------|-------|
| Dom id space exhausted | `dom_id_space_exhausted` | `encode` or `establish` |
| Input resolve exhausted | `anchor_miss` | `input` |
