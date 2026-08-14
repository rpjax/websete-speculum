# Contract 01 — Identity

**Norm:** redesign §5.1. **Tests:** PP-ID-1..4. **Impl:** `implementation/sidecar/identity.md`, in-page fragment.

## Interface: `IdentitySpace`

**Owner:** Virtual (in-page). Sidecar holds a **parallel** reverse map only for nodes it needs for input resolve after messages from page; authoritative allocation is in-page.

### Types

```ts
type NodeId = number; // uint32
const NONE_NODE_ID = 0;

interface IdentitySpace {
  readonly generation: number;
  allocate(node: Node): NodeId;       // first publish; idempotent
  idOf(node: Node): NodeId;           // 0 if never published
  resolve(id: NodeId): Node | undefined;
  release(node: Node): void;          // optional explicit drop
  bumpGeneration(): number;           // Document swap only
}
```

### Rules

1. Per-session id space (**K2**). Monotonic from 1. Never reuse within a generation.  
2. Forward: `WeakMap<Node, NodeId>`. Reverse: `Map<NodeId, WeakRef<Node>>` + `FinalizationRegistry` so reverse cannot retain detached nodes (PP-ID-4).  
3. MUST NOT write identity attributes into Virtual DOM (PP-ID-1). Debug materialize flag: default off; not in production config.  
4. Elements, text, and comments all receive ids (PP-ID-3).  
5. Id allocated first time F publishes the node. Unpublished ⇒ no id.  
6. Clone ⇒ new object ⇒ no id until published (PP-ID-2).  
7. `speculum-anchor` appears **only** in establish/resync HTML for the client registry bootstrap. MUST NOT appear in live frame payloads. Client MUST resolve live ops by numeric id, not by querying the attribute for correctness.  
8. **Deleted:** `speculum-last-mutation-sequence` in every form.  
9. On `bumpGeneration`: clear forward+reverse; **do not** reset the monotonic counter (ids never reused across generations either — stronger than “within generation”; counter continues). Generation number increments by 1.

### Preconditions / postconditions

- `allocate`: node is an object the WeakMap accepts. Post: `idOf(node) > 0`, `resolve(id) === node`.  
- `resolve(0)` always undefined.  
- `bumpGeneration` post: `idOf` any prior node is 0; `generation` increased.

### MUST NOT

- CSS `querySelector` for identity on Virtual.  
- Remint / collision tables for cloned anchors.  
- `childAt` addressing.

### Input coupling

Sidecar input resolve uses in-page `resolve(id)` via evaluate/handle (contract 10). Miss ⇒ retry then drop (`AnchorMiss`) — never fall back to `speculum-anchor` on Virtual.
