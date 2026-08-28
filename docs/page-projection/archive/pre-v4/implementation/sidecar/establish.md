# Implementation — Establish

| Field | Value |
|-------|-------|
| **Future path** | `sidecar/browser/patchright/mirror/page/establish.ts` **and** in-page fragment `inpage/establish.frag.ts` |
| **LOC ceiling** | 350 |
| **Contracts implemented** | [05-establish.md](../../contracts/05-establish.md); redesign §5.6; D-SPEC-4 (checksum); D-SPEC-9 (when to run); D-SPEC-1 documentState timing |
| **Invariants** | Runs at emitter init: session start and real top-level Document swap only. Wire order: `cssomInstall` → `establishBegin` → `establishChunk`* → `establishEnd`. HTML carries `speculum-anchor` (establish only). Handoff: accumulate live before walk; drain after end; no mutation left in neither snapshot nor frame. Sequence: establish frame MAY use `sequence=0`; live starts at 1 after drain. |
| **Ban list** | Full DomMap dump / bootstrap after stream seed. Soft-nav re-establish. `framenavigated` alone as trigger. Arm before cssomInstall + registry verify. Silent click targeting while unarmed. JSON tree ferry for establish. |

---

## Types / signatures

```ts
interface EstablishProducer {
  /**
   * Open epoch, start live accum, walk+stream HTML, emit end, drain handoff.
   * Called in-page; parts pushed via channel.
   */
  run(ctx: EstablishContext): Promise<void>;
}

interface EstablishContext {
  document: Document;
  fmap: FMap;
  identity: IdentitySpace;
  cssom: CssomProducer;
  encode: FrameEncoder;
  channel: InPageChannel;
  generation: number;
  chunkBytes: number; // establishChunkBytes default 65536
  viewport: { w: number; h: number };
}

interface EstablishEndPayload {
  nodeCount: number; // u32
  checksum: number;  // u32 FNV-1a
}
```

---

## When to run (D-SPEC-9)

| Event | Establish? | Generation |
|-------|------------|------------|
| Session start / first Document | Yes | current (initial) |
| Soft-nav (same Document) | **No** | unchanged |
| Hard-nav / top-level Document swap | Yes | bump first, then establish |
| Pierced iframe Document swap | No bump; pierce re-publish only | unchanged |

Detection: document token and/or CDP non-same-document. **Never** `framenavigated` alone.

---

## Step-by-step algorithm — handoff + stream (PP-EST-3)

### A. Open epoch

1. Set `establishEpochOpen = true`.
2. Ensure observe/clock already running or start them.
3. Live `FrameAccum` begins accepting mutations **before** HTML walk.
4. Handoff buffer: `liveFrames: EncodedPart[][]` (or op lists) starts empty; flush during epoch appends to buffer instead of channel (or channels with a “hold” flag — normative: **do not** deliver live frames to API until after `establishEnd`).

### B. Cssom install snapshot

1. `sheets = cssom.snapshotInstall()`.
2. Encode frame flags=`FLAG_ESTABLISH`, `sequence=0`, ops=`[cssomInstall, …]` — **or** single establish frame containing all establish ops. Preferred: **one establish frame** (possibly multi-part) containing ops in order: cssomInstall, establishBegin, chunks…, establishEnd. Live frames separate after.

### C. establishBegin

Payload:

- `generation`
- `viewport { w, h }` CSS px
- `scrollViewport { x: scrollX, y: scrollY }`
- `scrollElements[]`: every published Element with scroll offset ≠ 0 (or all scrollers with non-default), `{ id, top, left }` — ids must already exist: **allocate during walk**, so begin’s scroll element ids are filled **after** walk identity allocation OR begin is encoded after walk but **ordered before chunks on the wire**.

**Normative sequencing of production vs wire order:**

1. Walk tree once: allocate ids, build HTML string with anchors, collect scroll element list + documentState, compute checksum inputs.
2. Encode wire ops in contract order (install → begin → chunks → end), using data from the walk snapshot.
3. Live mutations during walk are only in handoff buffer, not in HTML snapshot — declarative live frames heal (PP-EST-3).

### D. HTML walk (snapshot as of walk)

Preorder F-visible walk using `fmap.visibleChildren` from `document.documentElement` (and doctype omitted; html is root).

For each published node:

1. `id = identity.allocate(node)`.
2. Serialize to HTML with `speculum-anchor="<id>"` on **every** published element, and for text/comment use wrapper policy below.

#### Text / comment in establish HTML

HTML cannot attribute text nodes. Normative approach (checksum-compatible):

- **Elements:** `<tag speculum-anchor="ID" …attrs…>` … children … `</tag>` (void tags: no children).
- **Text:** emit as raw text (escaped) **and** record the text node in the checksum walk via a sidecar ordered list built during the same walk; for registry bootstrap, client registry registers elements from anchors and registers text/comment when live/fresh appears — **Conflict with contract 05:** “establish HTML anchors elements, text, and comment wrappers consistently with F”.

**Normative wrapper for text/comment in establish HTML only:**

- Text: `<speculum-text speculum-anchor="ID">escaped data</speculum-text>`
- Comment: `<speculum-comment speculum-anchor="ID"></speculum-comment>` with data in `data-value` attr **or** HTML comment body — prefer element wrapper with `data-value` holding the comment text (escaped) so parser creates an Element the client maps then **replaces** with Comment node during registry build.

Client establish apply ([web impl — not this file]) MUST:

1. Parse HTML.
2. Walk all `[speculum-anchor]`.
3. For `speculum-text` / `speculum-comment` tags: replace with real Text/Comment nodes carrying the id in registry; remove wrapper from tree.
4. For normal elements: keep node, registry.set(id, el); MAY leave attribute.

Placeholder elements serialize as `<div speculum-projected-tag="…" speculum-anchor="…">`.

Pierce host stamps included as attributes.

**Do not** include Cssom rule text inside `<style>` as Dom HTML authority — style/link hosts may appear as placeholders or empty; rules ride `cssomInstall`.

### E. Chunking

1. Target `establishChunkBytes` (65536).
2. Split UTF-8 byte sequence at boundaries where the prefix is well-formed HTML for progressive parse (prefer split between top-level tags after `</head>`, between block elements; never mid-tag or mid-attribute).
3. Head + above-the-fold first (html/head before late body).
4. Each chunk → op `establishChunk`.

### F. Checksum + nodeCount (D-SPEC-4) — normative exact mix

After the walk, build `anchored: { id: u32, kind: u8, tagUtf8: Uint8Array }[]` in **the same order the client will walk after applying all chunks and performing wrapper substitution**:

**Walk order:** depth-first preorder of the parsed document’s registry-anchored nodes (elements that retain `speculum-anchor`, plus text/comment nodes created from wrappers), which matches producer walk order over F-visible nodes.

For each anchored node in that order, append a record:

| Field | Value |
|-------|-------|
| `id` | NodeId |
| `kind` | `1` ELEMENT, `2` TEXT, `3` COMMENT (same as wire Node kind) |
| `tagUtf8` | For ELEMENT: UTF-8 bytes of the **published** tag string (`div` for placeholders, else `localName`). For TEXT/COMMENT: **empty byte sequence** (length 0). |

`nodeCount = anchored.length` (u32). Includes elements, text, and comments.

#### FNV-1a 32-bit parameters

```
offset_basis = 0x811C9DC5  // 2166136261
prime        = 0x01000193  // 16777619
hash width   = 32-bit (use >>>0 after each step in JS)
```

#### Exact byte mix order (per anchored node, in walk order)

Initialize `h = offset_basis`.

For each record in `anchored` **in order**, mix bytes in this exact order:

1. **id** as 4 bytes **little-endian**:  
   `b0 = id & 0xff`, `b1 = (id >>> 8) & 0xff`, `b2 = (id >>> 16) & 0xff`, `b3 = (id >>> 24) & 0xff`  
   For each `b` in `[b0,b1,b2,b3]`: `h = (h ^ b) * prime >>> 0`  
   (standard FNV-1a: XOR then multiply).

2. **kind** as 1 byte: `h = (h ^ kind) * prime >>> 0`.

3. **tag UTF-8 bytes** in array order (zero iterations for text/comment):  
   For each byte `b` in `tagUtf8`: `h = (h ^ b) * prime >>> 0`.

No separators, no length prefixes between fields, no endian marker beyond LE id.  
After all records, `checksum = h` (u32).

Pseudo:

```ts
function fnv1aEstablish(anchored: {id:number; kind:number; tagUtf8:Uint8Array}[]): number {
  let h = 0x811c9dc5;
  const mix = (b: number) => { h = Math.imul(h ^ (b & 0xff), 0x01000193) >>> 0; };
  for (const rec of anchored) {
    mix(rec.id); mix(rec.id >>> 8); mix(rec.id >>> 16); mix(rec.id >>> 24);
    mix(rec.kind);
    for (let i = 0; i < rec.tagUtf8.length; i++) mix(rec.tagUtf8[i]!);
  }
  return h >>> 0;
}
```

Client recomputes with the same walk after chunked parse + wrapper substitution; mismatch ⇒ desync (`establish_checksum_mismatch` / `establish_node_count_mismatch`) — PP-EST-7.

### G. establishEnd

Emit `{ nodeCount, checksum }`.

### H. Drain handoff

1. Set `establishEpochOpen = false`.
2. Emit buffered live frames in order with sequences `1..n` (allocate sequences at drain time, not during buffering — during buffer store ops only; assign sequence on emit).
3. Guarantee: every mutation observed during epoch is either in the HTML snapshot or in a drained frame (PP-EST-3).

### I. documentState

Include opcode 12 in the establish frame after begin data is known and before end (with patches N/A): place after `establishBegin` and before or after chunks? Contract: “during establish, emit after establishBegin scroll restore data is known and before arming”. Safe placement: **after establishBegin, before first establishChunk**, or immediately before establishEnd. Prefer **after begin, before chunks** so client can apply title/lang/dir early. CssomInstall remains first.

---

## Browser pool note

Session acquire/destroy of Chromium instances is **not** inside establish walk. See [PageProjection.md](PageProjection.md) and [contract 12](../../contracts/12-session-lifecycle.md): pool hands a clean never-navigated instance; establish runs after first navigation to the target Document. Release **destroys** the instance.

---

## PP-* tests

| ID | Assert |
|----|--------|
| `PP-EST-1` | Streams; paints before stream completes |
| `PP-EST-2` | Holds E2 at 20k nodes |
| `PP-EST-3` | Handoff neither loses nor double-applies |
| `PP-EST-4` | Scroll restored before arm |
| `PP-EST-5` | No pointer intents before arm |
| `PP-EST-6` | cssomInstall before first chunk paint |
| `PP-EST-7` | nodeCount/checksum mismatch desyncs |
| `PP-NAV-2` | Soft-nav no re-establish |
| `PP-WIRE-3` | No JSON on establish path |
| `PP-ID-1` | Anchors only in establish HTML, never live Virtual DOM attrs |
