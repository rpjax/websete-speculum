# Implementation — Node mirror (flat)

| Field | Value |
|-------|-------|
| **Future path** | `Refactor/sidecar/browser/patchright/mirror/page/node/mirror.ts` |
| **LOC ceiling** | 400 |
| **Contracts implemented** | [07-recovery.md](../../contracts/07-recovery.md); redesign §5.7.3; E7 / `mirrorMaxBytes` |
| **Invariants** | Flat decoded form (not heavy object graphs). Apply every rewritten frame relayed. Source for OOB resync HTML + O2. Budget ≤ 4 MiB default. `serializeHtml` emits `speculum-anchor` for registry bootstrap. Generation bump clears mirror. Resync MUST NOT advance live sequence. |
| **Ban list** | Retaining full JS DOM object trees per node. Involving the page in resync serialize. Exceeding budget without fault. Applying live frames without prior rewrite hop. |

---

## Types / signatures

```ts
type MirrorKind = 1 | 2 | 3; // ELEMENT TEXT COMMENT

interface MirrorNode {
  id: number;
  kind: MirrorKind;
  tag?: string;                 // element published tag
  attrs: Map<string, string>;   // includes stamps
  value?: string;               // text/comment
  children: number[];           // child ids in order
  parent: number;               // 0 if root
}

interface NodeMirror {
  applyPart(bytes: Uint8Array): void; // decode ops internally or take decoded ops
  applyOps(ops: WireOp[]): void;
  serializeHtml(): string;
  serializeCssomInstall(): CssomSheetRecord[];
  clear(): void;
  byteSize(): number;
  lastApplied(): { generation: number; sequence: number };
  coversThroughSequence(): number; // watermark helper
}
```

Storage: `Map<number, MirrorNode>` + root id + Cssom side maps (sheet/rule records) updated from Cssom ops. Prefer typed arrays / pooled string arenas if needed to hold E7 — logical model remains flat nodes.

---

## Step-by-step — `applyOps`

For each op in order (establish or live):

### establishBegin

Store generation, viewport, pending scroll restore list (for serialize fidelity).

### establishChunk

Append HTML into an establish buffer **or** parse incrementally into mirror nodes. Normative for mirror: **parse chunks into the flat map** as they arrive (same wrapper rules as client) so resync mid-flight is rare; if establish incomplete, resync waits for end.

### establishEnd

Verify optional internal checksum for O2; store nodeCount; mark establish complete.

### childList

1. Resolve parent; miss → throw `MirrorDesyncError` (`id_unresolved`).
2. FULL: build new `children` id list; for `existing` ids must resolve; for `fresh` insert new MirrorNodes from encoding; any prior child id absent → delete subtree recursively.
3. APPEND: append refs only.
4. Update each child’s `parent`.

### patch

Replace tag/attrs/value on node; no children mutation.

### documentState

Store title/lang/dir/viewportContent on mirror document meta.

### scroll\*

Update scroll fields on viewport or node (for resync begin payload).

### cssom\*

Apply to Cssom side maps (install replaces; list/patch mutate).

After all ops of a **fully assembled** frame: update `lastApplied { generation, sequence }`; recompute `byteSize`; if `byteSize > mirrorMaxBytes` → fault `mirror_over_budget`.

Part assembly: if parts used, buffer by sequence until complete — same rules as client.

---

## Step-by-step — `serializeHtml` (resync / O2)

Preorder from root:

1. Elements: open tag with attributes (deny-list already applied upstream) plus `speculum-anchor="<id>"`.
2. Text/comment: emit `<speculum-text speculum-anchor="…">` / `<speculum-comment …>` wrappers matching [establish.md](establish.md) so client registry build is identical.
3. Placeholders already stored as `div` + `speculum-projected-tag`.
4. Do **not** consult the Virtual page.

Chunk the string for `establishChunk` ops in the resync encoder.

### `serializeCssomInstall`

Dump current Cssom sheet records with ids/scopes/rules.

---

## `clear`

On generation bump: empty node map, cssom maps, meta; byteSize=0.

---

## Resync production (called by orchestration)

1. Build ops: cssomInstall, establishBegin (from stored viewport/scrolls), chunks from `serializeHtml`, establishEnd with **recomputed** nodeCount+checksum using the **same FNV-1a byte mix order** as [establish.md](establish.md) over mirror anchored nodes.
2. Flags: `FLAG_RESYNC`.
3. Watermark: `{ generation: lastApplied.generation, coversThroughSequence: lastApplied.sequence }`.
4. Do not increment live sequence counters.

---

## PP-* tests

| ID | Assert |
|----|--------|
| `PP-REC-1` | Address miss → desync class error |
| `PP-REC-2` | Resync from mirror; page unused; O1 after |
| `PP-REC-3` | Live sequence not advanced; watermark drain |
| `PP-EST-7` | Mirror checksum matches algorithm |
| E7 | 25k-node tree ≤ mirrorMaxBytes |
| `PP-MOVE-*` | childList moves preserve node ids in mirror |
