"use strict";
(() => {
  // browser/mirror/projection/models/frame.ts
  var DOCUMENT_ID = 1;
  var INSERT_AT_END = 0;
  var CHECK_SCOPE_TABLE = 0;
  var CHECK_SCOPE_RANGE = 1;

  // browser/mirror/projection/models/limits.ts
  var MAX_STR_BYTES = 1 << 20;
  var MAX_ATTRS = 1024;
  var MAX_CHILDREN_PER_OP = 8192;
  var MAX_OPS_PER_FRAME = 65536;
  var MAX_ROWS = 2e5;

  // browser/mirror/projection/models/decode.ts
  var WIRE_VERSION = 1;
  var WIRE_MAGIC = 20560;
  var LOCAL_STR_BIT = 2147483648;
  var RESYNC_FLAG_BIT = 2;
  var textDecoder = new TextDecoder("utf-8");
  var ByteReader = class {
    view;
    bytes;
    offset = 0;
    constructor(bytes) {
      this.bytes = bytes;
      this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }
    get remaining() {
      return this.bytes.byteLength - this.offset;
    }
    u8() {
      const v = this.view.getUint8(this.offset);
      this.offset += 1;
      return v;
    }
    u16() {
      const v = this.view.getUint16(this.offset, true);
      this.offset += 2;
      return v;
    }
    u32() {
      const v = this.view.getUint32(this.offset, true);
      this.offset += 4;
      return v;
    }
    u64() {
      const v = this.view.getBigUint64(this.offset, true);
      this.offset += 8;
      return v;
    }
    bytes_(len) {
      const v = this.bytes.subarray(this.offset, this.offset + len);
      this.offset += len;
      return v;
    }
    utf8(len) {
      if (len > MAX_STR_BYTES) {
        throw new Error(`string byteLen ${len} exceeds MAX_STR_BYTES (${MAX_STR_BYTES})`);
      }
      return textDecoder.decode(this.bytes_(len));
    }
  };
  var PersistentStringTable = class {
    byId = /* @__PURE__ */ new Map();
    define(strId, value) {
      this.byId.set(strId, value);
    }
    resolve(ref) {
      return this.byId.get(ref);
    }
    clear() {
      this.byId.clear();
    }
  };
  function decodeFramePart(input, persistent) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    try {
      const r = new ByteReader(bytes);
      if (r.remaining < 24) return malformed("frame shorter than the fixed header");
      if (r.u16() !== WIRE_MAGIC) return malformed("bad magic");
      const version = r.u8();
      if (version !== WIRE_VERSION) {
        return { ok: false, reason: "unknown_version", message: `unsupported wire version ${version}` };
      }
      const flags = r.u8();
      const generation = r.u32();
      const sequence = r.u32();
      const partIndex = r.u16();
      const partCount = r.u16();
      const preTableHash = r.u64();
      const strCount = r.u32();
      if (strCount > MAX_OPS_PER_FRAME) return malformed(`strCount ${strCount} exceeds MAX_OPS_PER_FRAME`);
      const localStrings = new Array(strCount);
      for (let i = 0; i < strCount; i++) localStrings[i] = r.utf8(r.u32());
      const resolveStr = (ref) => {
        if ((ref & LOCAL_STR_BIT) !== 0) return localStrings[ref & 2147483647] ?? "";
        return persistent.resolve(ref) ?? "";
      };
      const opCount = r.u32();
      if (opCount > MAX_OPS_PER_FRAME) return malformed(`opCount ${opCount} exceeds MAX_OPS_PER_FRAME`);
      const ops = new Array(opCount);
      for (let i = 0; i < opCount; i++) {
        const opCode = r.u8();
        const op = decodeOp(opCode, r, resolveStr, persistent);
        if (!op) return malformed(`unknown opcode ${opCode}`);
        ops[i] = op;
      }
      return {
        ok: true,
        part: {
          version,
          resync: (flags & RESYNC_FLAG_BIT) !== 0,
          generation,
          sequence,
          partIndex,
          partCount,
          preTableHash,
          ops
        }
      };
    } catch (err) {
      return malformed(err instanceof Error ? err.message : String(err));
    }
  }
  function malformed(message) {
    return { ok: false, reason: "malformed", message };
  }
  function decodeAttrs(r, resolveStr) {
    const count = r.u16();
    if (count > MAX_ATTRS) throw new Error(`attribute count ${count} exceeds MAX_ATTRS (${MAX_ATTRS})`);
    const attrs = new Array(count);
    for (let i = 0; i < count; i++) attrs[i] = { name: resolveStr(r.u32()), value: resolveStr(r.u32()) };
    return attrs;
  }
  function checkChildCount(count) {
    if (count > MAX_CHILDREN_PER_OP) {
      throw new Error(`child count ${count} exceeds MAX_CHILDREN_PER_OP (${MAX_CHILDREN_PER_OP})`);
    }
  }
  function decodeOp(opCode, r, resolveStr, persistent) {
    switch (opCode) {
      case 1 /* Check */: {
        const scope = r.u8();
        const lo = r.u32();
        const hi = r.u32();
        const hash = r.u64();
        if (scope !== CHECK_SCOPE_TABLE && scope !== CHECK_SCOPE_RANGE) return null;
        return { op: 1 /* Check */, scope, lo, hi, hash };
      }
      case 2 /* EpochReset */:
        return { op: 2 /* EpochReset */, generation: r.u32() };
      case 33 /* NodeDrop */: {
        const count = r.u16();
        checkChildCount(count);
        const ids = new Array(count);
        for (let i = 0; i < count; i++) ids[i] = r.u32();
        return { op: 33 /* NodeDrop */, ids };
      }
      case 3 /* StrDef */: {
        const strId = r.u32();
        const value = r.utf8(r.u32());
        persistent.define(strId, value);
        return { op: 3 /* StrDef */, strId, value };
      }
      case 32 /* NodeNew */: {
        const id = r.u32();
        const kind = r.u8();
        if (kind === 1 /* Element */) {
          const name = resolveStr(r.u32());
          const attrs = decodeAttrs(r, resolveStr);
          return { op: 32 /* NodeNew */, id, kind: 1 /* Element */, name, attrs };
        }
        if (kind === 6 /* Doctype */) {
          return { op: 32 /* NodeNew */, id, kind: 6 /* Doctype */, name: resolveStr(r.u32()) };
        }
        if (kind === 2 /* Text */ || kind === 3 /* Comment */) {
          return { op: 32 /* NodeNew */, id, kind, value: resolveStr(r.u32()) };
        }
        return null;
      }
      case 64 /* Insert */: {
        const parent = r.u32();
        const before = r.u32();
        const count = r.u16();
        checkChildCount(count);
        const ids = new Array(count);
        for (let i = 0; i < count; i++) ids[i] = r.u32();
        return { op: 64 /* Insert */, parent, before: before === 0 ? INSERT_AT_END : before, ids };
      }
      case 65 /* Remove */: {
        const parent = r.u32();
        const count = r.u16();
        checkChildCount(count);
        const ids = new Array(count);
        for (let i = 0; i < count; i++) ids[i] = r.u32();
        return { op: 65 /* Remove */, parent, ids };
      }
      case 96 /* AttrSet */: {
        const node = r.u32();
        const attrs = decodeAttrs(r, resolveStr);
        return { op: 96 /* AttrSet */, node, attrs };
      }
      case 97 /* AttrDel */: {
        const node = r.u32();
        const count = r.u16();
        if (count > MAX_ATTRS) throw new Error(`attribute count ${count} exceeds MAX_ATTRS (${MAX_ATTRS})`);
        const names = new Array(count);
        for (let i = 0; i < count; i++) names[i] = resolveStr(r.u32());
        return { op: 97 /* AttrDel */, node, names };
      }
      case 98 /* TextSet */: {
        const node = r.u32();
        return { op: 98 /* TextSet */, node, value: resolveStr(r.u32()) };
      }
      default:
        return null;
    }
  }
  var FramePartAssembler = class {
    pending = /* @__PURE__ */ new Map();
    ingest(part) {
      if (part.partCount <= 1) return assemble(part, [part]);
      const key = `${part.generation}:${part.sequence}`;
      let slot = this.pending.get(key);
      if (!slot || slot.parts.length !== part.partCount) {
        slot = { parts: new Array(part.partCount), received: 0 };
        this.pending.set(key, slot);
      }
      if (!slot.parts[part.partIndex]) slot.received += 1;
      slot.parts[part.partIndex] = part;
      if (part.partIndex !== part.partCount - 1) return null;
      this.pending.delete(key);
      if (slot.received !== part.partCount) return "missing_part";
      return assemble(part, slot.parts);
    }
    /** Drops every in-flight partial assembly (desync / generation bump). */
    reset() {
      this.pending.clear();
    }
  };
  function assemble(last, parts) {
    const ops = [];
    for (const part of parts) ops.push(...part.ops);
    return {
      version: last.version,
      resync: last.resync,
      generation: last.generation,
      sequence: last.sequence,
      preTableHash: last.preTableHash,
      ops
    };
  }

  // browser/mirror/projection/models/rowHash.ts
  var FNV_OFFSET_BASIS = 14695981039346656037n;
  var FNV_PRIME = 1099511628211n;
  var MASK64 = 0xffffffffffffffffn;
  var sharedEncoder = new TextEncoder();
  function h64Bytes(bytes, seed = FNV_OFFSET_BASIS) {
    let h = seed;
    for (let i = 0; i < bytes.length; i++) {
      h ^= BigInt(bytes[i]);
      h = h * FNV_PRIME & MASK64;
    }
    return h;
  }
  function h64Str(value, seed = FNV_OFFSET_BASIS) {
    return h64Bytes(sharedEncoder.encode(value), seed);
  }
  function h64U32(value, seed = FNV_OFFSET_BASIS) {
    let h = seed;
    h ^= BigInt(value & 255);
    h = h * FNV_PRIME & MASK64;
    h ^= BigInt(value >>> 8 & 255);
    h = h * FNV_PRIME & MASK64;
    h ^= BigInt(value >>> 16 & 255);
    h = h * FNV_PRIME & MASK64;
    h ^= BigInt(value >>> 24 & 255);
    h = h * FNV_PRIME & MASK64;
    return h;
  }
  function addMod64(a, b) {
    return a + b & MASK64;
  }
  function subMod64(a, b) {
    return a - b & MASK64;
  }
  function hashName(name) {
    return h64Str(`\0N${name}`);
  }
  function hashValue(value) {
    return h64Str(`\0V${value}`);
  }
  function hashAttr(name, value) {
    return h64Str(`\0A${name}${value}`);
  }
  function computeRowHash(id, kind, parent, prevSibling, contentHash) {
    let h = h64U32(id);
    h = h64U32(kind, h);
    h = h64U32(parent, h);
    h = h64U32(prevSibling, h);
    h ^= contentHash;
    h = h * FNV_PRIME & MASK64;
    return h;
  }
  var TableHashTracker = class {
    total = 0n;
    rowHashes = /* @__PURE__ */ new Map();
    get value() {
      return this.total;
    }
    get size() {
      return this.rowHashes.size;
    }
    has(id) {
      return this.rowHashes.has(id);
    }
    upsert(id, newRowHash) {
      const old = this.rowHashes.get(id);
      if (old !== void 0) this.total = subMod64(this.total, old);
      this.rowHashes.set(id, newRowHash);
      this.total = addMod64(this.total, newRowHash);
    }
    remove(id) {
      const old = this.rowHashes.get(id);
      if (old === void 0) return;
      this.total = subMod64(this.total, old);
      this.rowHashes.delete(id);
    }
    clear() {
      this.total = 0n;
      this.rowHashes.clear();
    }
  };

  // browser/mirror/projection/models/replicatedTable.ts
  var NONE = 0;
  var ReplicatedTable = class {
    rows = /* @__PURE__ */ new Map();
    /** ELEMENT rows only — id -> attrName -> that attribute's own contentHash contribution. */
    attrHashes = /* @__PURE__ */ new Map();
    /** Derived, non-hashed: id -> the id currently linked immediately after it under the same parent. */
    nextSiblingOf = /* @__PURE__ */ new Map();
    /** Derived, non-hashed: parentId -> the id currently linked last under that parent (0 = none). */
    lastChildOf = /* @__PURE__ */ new Map();
    tracker = new TableHashTracker();
    /** Stamped onto every row `setRow` touches until changed again — one frame, one `lms` (§4 preamble). */
    currentSequence = 0;
    get tableHash() {
      return this.tracker.value;
    }
    /**
     * Call once per frame before applying its ops (producer: `tableFrameBuilder.ts`/`resync.ts`;
     * client: `replicatedTableApply.ts`) — every row touched by a subsequent op this pass stamps
     * `lms` with this value (§1.3/§4: "every instruction that touches a row sets that row's
     * `lms = sequence`"). Not part of `rowHash`/`tableHash` (§1.5) — diagnostics/GC only (§1.6).
     */
    setSequence(sequence) {
      this.currentSequence = sequence;
    }
    /** Row count — excludes the implicit, never-stored Document row (id 1). */
    get size() {
      return this.rows.size;
    }
    has(id) {
      return this.rows.has(id);
    }
    getRow(id) {
      return this.rows.get(id);
    }
    /**
     * §4.1 `CHECK.scope = 1` — Σ `rowHash` (mod 2^64) over ids in `[lo, hi]` inclusive. O(size),
     * not O(1): OPEN-3 resolves the *model* (id ranges over per-bucket partial sums) but its O(1)
     * bucket-maintenance mechanism is not built, and the v0 producer never emits `scope: 1` (only
     * resync's whole-table close, §5.8 step 4) — this exists so a client still decodes and
     * evaluates one correctly (P7: strict, not silently ignored) rather than leaving it unusable.
     */
    hashRange(lo, hi) {
      let sum = 0n;
      for (const [id, row] of this.rows) {
        if (id >= lo && id <= hi) sum = addMod64(sum, row.rowHash);
      }
      return sum;
    }
    /**
     * Child ids of `parent` in sibling order (first → last). Walks the derived `lastChildOf` +
     * hashed `prevSibling` chain then reverses — O(children), not hashed. Lab O2 local oracle
     * (`tableLiveOracle.ts`) compares this to live `childNodes`; do not expose `nextSiblingOf`.
     */
    orderedChildIds(parent) {
      const backwards = [];
      let child = this.lastChildOf.get(parent) ?? NONE;
      while (child !== NONE) {
        backwards.push(child);
        const row = this.rows.get(child);
        child = row?.prevSibling ?? NONE;
      }
      backwards.reverse();
      return backwards;
    }
    /** Every stored row id (excludes implicit Document `1`). */
    forEachRow(fn) {
      for (const [id, row] of this.rows) fn(id, row);
    }
    /** Drops every row and derived index — `EPOCH_RESET` (§4.1) and resync's wholesale replace (§5.8). */
    reset() {
      this.rows.clear();
      this.attrHashes.clear();
      this.nextSiblingOf.clear();
      this.lastChildOf.clear();
      this.tracker.clear();
    }
    // ---- NODE_NEW (§4.2) — always creates a detached row (parent=0, prevSibling=0). ----
    createElementRow(id, tagName, attrs) {
      const attrMap = /* @__PURE__ */ new Map();
      let sum = hashName(tagName);
      for (let i = 0; i < attrs.length; i++) {
        const { name, value } = attrs[i];
        const h = hashAttr(name, value);
        attrMap.set(name, h);
        sum = addMod64(sum, h);
      }
      this.attrHashes.set(id, attrMap);
      this.setRow(id, 1 /* Element */, NONE, NONE, sum);
    }
    /** TEXT/COMMENT (`value`) or DOCTYPE (`name`) — both a single content-carrying string field. */
    createLeafRow(id, kind, contentField) {
      this.setRow(id, kind, NONE, NONE, hashValue(contentField));
    }
    // ---- ATTR_SET / ATTR_DEL / TEXT_SET (§4.4) — content-only, topology untouched. ----
    setAttrs(id, attrs) {
      const row = this.rows.get(id);
      if (row === void 0) return;
      const attrMap = this.attrHashes.get(id) ?? /* @__PURE__ */ new Map();
      let sum = row.contentHash;
      for (let i = 0; i < attrs.length; i++) {
        const { name, value } = attrs[i];
        const old = attrMap.get(name);
        if (old !== void 0) sum = subMod64(sum, old);
        const h = hashAttr(name, value);
        attrMap.set(name, h);
        sum = addMod64(sum, h);
      }
      this.attrHashes.set(id, attrMap);
      this.setRow(id, row.kind, row.parent, row.prevSibling, sum);
    }
    delAttrs(id, names) {
      const row = this.rows.get(id);
      if (row === void 0) return;
      const attrMap = this.attrHashes.get(id);
      if (attrMap === void 0) return;
      let sum = row.contentHash;
      for (let i = 0; i < names.length; i++) {
        const old = attrMap.get(names[i]);
        if (old === void 0) continue;
        sum = subMod64(sum, old);
        attrMap.delete(names[i]);
      }
      this.setRow(id, row.kind, row.parent, row.prevSibling, sum);
    }
    setValue(id, value) {
      const row = this.rows.get(id);
      if (row === void 0) return;
      this.setRow(id, row.kind, row.parent, row.prevSibling, hashValue(value));
    }
    // ---- INSERT / REMOVE (§4.3) — topology only, content untouched. ----
    /**
     * §4.3 `INSERT` table effect: unlinks each id from wherever it currently is (a move), then
     * links the whole batch, in wire order, immediately before `before` (or at the end of
     * `parent`'s children when `before === 0`). Exactly two rows change per link (the linked id,
     * and whichever row now follows it) — never O(children in parent).
     */
    insertBatch(parent, before, ids) {
      let prev = before === NONE ? this.lastChildOf.get(parent) ?? NONE : this.rows.get(before)?.prevSibling ?? NONE;
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        const existing = this.rows.get(id);
        if (existing !== void 0 && existing.parent !== NONE) this.unlink(id, existing);
        this.linkAfter(id, parent, prev);
        prev = id;
      }
      if (before !== NONE) {
        this.relinkPrevSibling(before, prev);
        if (prev !== NONE) this.nextSiblingOf.set(prev, before);
      } else {
        this.lastChildOf.set(parent, prev);
      }
    }
    /**
     * §4.3 `REMOVE` table effect: detaches each id and repairs the sibling that followed it.
     * `parent` is redundant with the table (§4.3: "kept as a cheap assert") — accepted here for
     * call-site symmetry with `RemoveOp`; precondition validation (Stage 2) is what actually checks
     * it against `getRow(id).parent`, not this method.
     */
    removeBatch(_parent, ids) {
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        const row = this.rows.get(id);
        if (row === void 0) continue;
        this.unlink(id, row);
        this.setRow(id, row.kind, NONE, NONE, row.contentHash);
      }
    }
    /** `NODE_DROP` (§4.2, OPEN-1/OPEN-2, Stage 3) — permanently removes one row's contract state. */
    dropRow(id) {
      this.rows.delete(id);
      this.attrHashes.delete(id);
      this.nextSiblingOf.delete(id);
      this.lastChildOf.delete(id);
      this.tracker.remove(id);
    }
    /**
     * `NODE_DROP`'s actual `Table` effect (§4.2: "drops each row **and all its descendants** — a
     * detached row may still have children"). `id` is a subtree root (validated by the caller —
     * `replicatedTableApply.ts` — to have `parent = 0` before this runs); its descendants are
     * discovered by walking the same derived links `INSERT`/`REMOVE` already maintain
     * (`lastChildOf` + each child's own `prevSibling`), never touched by `unlink()` when only the
     * *root* of a detached subtree was itself detached from its old parent. Returns every id
     * actually dropped (root + descendants) so the caller (producer: `tableFrameBuilder.ts`) can
     * release the matching `DomNodeTable` identity entries too.
     */
    dropSubtree(id) {
      const ids = [];
      this.collectSubtreeIds(id, ids);
      for (let i = 0; i < ids.length; i++) this.dropRow(ids[i]);
      return ids;
    }
    /**
     * Read-only twin of {@link dropSubtree}'s discovery walk — same root+descendants list, no
     * mutation. Lets a caller that needs to know the *full* set before the table effect actually
     * runs (producer: `tableFrameBuilder.ts`'s `emitNodeDropSweep`, which must release every
     * descendant's `DomNodeTable` identity too, not just the swept root's — a live JS reference
     * that later reinserts an unreleased descendant would otherwise be handed back its old,
     * already-dropped id, corrupting `ReplicatedTable` silently instead of being re-described as
     * new content) query it ahead of the real drop.
     */
    subtreeIds(id) {
      const ids = [];
      this.collectSubtreeIds(id, ids);
      return ids;
    }
    /**
     * Detached (`parent === 0`) subtree roots whose `lms` is at least `maxAge` frame-`sequence`s
     * behind `currentSequence` — OPEN-2's deferred-age GC sweep candidates (§1.6). Non-root
     * detached descendants (`parent !== 0`, pointing at another detached row) are excluded: they
     * are collected transitively by `dropSubtree` once their root is chosen, never listed on the
     * wire themselves (§4.2). Bounded by `limit` — same "forced flush over unbounded per-tick
     * work" reasoning as `MAX_DIRTY_NODES` (§8).
     */
    collectDroppableIds(currentSequence, maxAge, limit) {
      const out = [];
      for (const [id, row] of this.rows) {
        if (out.length >= limit) break;
        if (row.parent !== NONE) continue;
        if (currentSequence - row.lms >= maxAge) out.push(id);
      }
      return out;
    }
    collectSubtreeIds(id, out) {
      out.push(id);
      let child = this.lastChildOf.get(id) ?? NONE;
      while (child !== NONE) {
        this.collectSubtreeIds(child, out);
        const row = this.rows.get(child);
        child = row?.prevSibling ?? NONE;
      }
    }
    // ---- internals ----
    setRow(id, kind, parent, prevSibling, contentHash) {
      const rowHash = computeRowHash(id, kind, parent, prevSibling, contentHash);
      this.rows.set(id, { kind, parent, prevSibling, contentHash, rowHash, lms: this.currentSequence });
      this.tracker.upsert(id, rowHash);
    }
    relinkPrevSibling(id, prevSibling) {
      const row = this.rows.get(id);
      if (row === void 0) return;
      this.setRow(id, row.kind, row.parent, prevSibling, row.contentHash);
    }
    linkAfter(id, parent, prevId) {
      const row = this.rows.get(id);
      const kind = row?.kind ?? 1 /* Element */;
      const contentHash = row?.contentHash ?? 0n;
      this.setRow(id, kind, parent, prevId, contentHash);
      if (prevId !== NONE) this.nextSiblingOf.set(prevId, id);
    }
    /** Removes `id` from its current position, repairing its neighbor's `prevSibling`/`lastChildOf`. */
    unlink(id, row) {
      if (row.parent === NONE) return;
      const nextId = this.nextSiblingOf.get(id) ?? NONE;
      this.nextSiblingOf.delete(id);
      if (nextId !== NONE) {
        this.relinkPrevSibling(nextId, row.prevSibling);
        if (row.prevSibling !== NONE) this.nextSiblingOf.set(row.prevSibling, nextId);
      } else if (this.lastChildOf.get(row.parent) === id) {
        this.lastChildOf.set(row.parent, row.prevSibling);
      }
    }
  };

  // browser/mirror/projection/models/replicatedTableApply.ts
  function applyOpToTable(table, op) {
    switch (op.op) {
      case 1 /* Check */:
        return;
      case 2 /* EpochReset */:
        table.reset();
        return;
      case 3 /* StrDef */:
        return;
      case 32 /* NodeNew */:
        if (op.kind === 1 /* Element */) table.createElementRow(op.id, op.name, op.attrs);
        else if (op.kind === 6 /* Doctype */) table.createLeafRow(op.id, op.kind, op.name);
        else table.createLeafRow(op.id, op.kind, op.value);
        return;
      case 33 /* NodeDrop */:
        for (let i = 0; i < op.ids.length; i++) table.dropSubtree(op.ids[i]);
        return;
      case 64 /* Insert */:
        table.insertBatch(op.parent, op.before, op.ids);
        return;
      case 65 /* Remove */:
        table.removeBatch(op.parent, op.ids);
        return;
      case 96 /* AttrSet */:
        table.setAttrs(op.node, op.attrs);
        return;
      case 97 /* AttrDel */:
        table.delAttrs(op.node, op.names);
        return;
      case 98 /* TextSet */:
        table.setValue(op.node, op.value);
        return;
      default:
        return;
    }
  }
  function evaluateCheck(table, op) {
    return op.scope === CHECK_SCOPE_RANGE ? table.hashRange(op.lo, op.hi) : table.tableHash;
  }
  function applyFrameToTableChecked(table, resync, ops, sequence = 0) {
    if (resync) table.reset();
    table.setSequence(sequence);
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      if (op.op === 1 /* Check */) {
        const actual = evaluateCheck(table, op);
        if (actual !== op.hash) {
          return {
            ok: false,
            reason: "precondition",
            failedOpIndex: i,
            opName: "check",
            scope: op.scope,
            lo: op.lo,
            hi: op.hi,
            expected: op.hash,
            actual
          };
        }
        continue;
      }
      if (op.op === 33 /* NodeDrop */) {
        for (let j = 0; j < op.ids.length; j++) {
          const id = op.ids[j];
          if (!table.has(id)) {
            return {
              ok: false,
              reason: "malformed",
              failedOpIndex: i,
              opName: "nodeDrop",
              id,
              message: "NODE_DROP of an absent id (frame-protocol.md OPEN-1)"
            };
          }
          if (table.getRow(id).parent !== 0) {
            return {
              ok: false,
              reason: "precondition",
              failedOpIndex: i,
              opName: "nodeDrop",
              id,
              message: "NODE_DROP of an attached row (frame-protocol.md \xA74.2)"
            };
          }
        }
        for (let j = 0; j < op.ids.length; j++) table.dropSubtree(op.ids[j]);
        continue;
      }
      if (op.op === 32 /* NodeNew */ && !table.has(op.id) && table.size >= MAX_ROWS) {
        return {
          ok: false,
          reason: "precondition",
          failedOpIndex: i,
          opName: "nodeNew",
          id: op.id,
          message: `MAX_ROWS (${MAX_ROWS}) exceeded (frame-protocol.md \xA78)`
        };
      }
      applyOpToTable(table, op);
    }
    return { ok: true };
  }

  // browser/mirror/projection/client/applyDom.ts
  var DomFrameApplier = class {
    queued = [];
    raf = null;
    doc;
    registry;
    options;
    table = new ReplicatedTable();
    constructor(doc, registry, options = {}) {
      this.doc = doc;
      this.registry = registry;
      this.options = options;
    }
    /** Client's own row/hash table (§1.3-§1.5) — read-only outside this class. */
    get replicatedTable() {
      return this.table;
    }
    enqueue(frame) {
      this.queued.push(frame);
      if (this.raf != null) return;
      this.raf = requestAnimationFrame(() => {
        this.raf = null;
        this.flush();
      });
    }
    flush() {
      if (this.raf != null) {
        cancelAnimationFrame(this.raf);
        this.raf = null;
      }
      const batch = this.queued.sort((a, b) => a.sequence - b.sequence);
      this.queued = [];
      if (batch.length === 0) return;
      const start = performance.now();
      let lastSequence = 0;
      for (const frame of batch) {
        lastSequence = frame.sequence;
        this.applyFrame(frame);
      }
      const duration = performance.now() - start;
      const budget = this.options.applyBudgetMs ?? 4;
      if (duration > budget) this.options.onOverrun?.(duration, lastSequence);
    }
    reset() {
      if (this.raf != null) {
        cancelAnimationFrame(this.raf);
        this.raf = null;
      }
      this.queued = [];
      this.table.reset();
    }
    applyFrame(frame) {
      const start = performance.now();
      if (!frame.resync && frame.preTableHash !== this.table.tableHash) {
        this.fail("precondition", "preTableHash", frame.preTableHash, this.table.tableHash);
        return;
      }
      const result = applyFrameToTableChecked(this.table, frame.resync, frame.ops, frame.sequence);
      if (!result.ok) {
        if (result.opName === "check") {
          this.fail("precondition", "check", result.expected, result.actual);
        } else {
          this.failOp(result.reason, result.opName, result.id, result.message);
        }
        return;
      }
      for (let i = 0; i < frame.ops.length; i++) {
        if (!this.applyOp(frame.ops[i])) return;
      }
      this.options.onApplied?.(frame, performance.now() - start);
    }
    fail(reason, opName, a, b) {
      if (typeof a === "bigint") {
        this.options.onDesync?.({ reason, op: opName, id: 0, expected: a, actual: b });
      } else {
        this.options.onDesync?.({ reason, op: opName, id: a });
      }
      return false;
    }
    /** `NODE_DROP`/`MAX_ROWS` phase-1 failures (Stage 3) — `message` for diagnostics, explicit `phase`. */
    failOp(reason, opName, id, message) {
      this.options.onDesync?.({ reason, op: opName, id, message, phase: "apply" });
      return false;
    }
    applyOp(op) {
      switch (op.op) {
        case 1 /* Check */:
          return true;
        // §4.1 — no DOM effect; already evaluated in phase 1
        case 2 /* EpochReset */:
          return this.applyEpochReset();
        case 3 /* StrDef */:
          return true;
        // already resolved at decode time (decode.ts PersistentStringTable)
        case 32 /* NodeNew */:
          return this.applyNodeNew(op);
        case 33 /* NodeDrop */:
          return this.applyNodeDrop(op);
        case 64 /* Insert */:
          return this.applyInsert(op);
        case 65 /* Remove */:
          return this.applyRemove(op);
        case 96 /* AttrSet */:
          return this.applyAttrSet(op);
        case 97 /* AttrDel */:
          return this.applyAttrDel(op);
        case 98 /* TextSet */:
          return this.applyTextSet(op);
        default:
          return true;
      }
    }
    /**
     * §4.1 `EPOCH_RESET` `DOM` effect: "the surface is discarded (a new document buffer is
     * prepared — §6)." No double-buffer surface exists yet (Stage 4) — discards in place, which is
     * safe here specifically because phase 1 already validated the *whole* frame (§P3: "if phase
     * 1 fails, the DOM was never touched") and `EPOCH_RESET` is ordering-guaranteed first (§7 rule
     * 1), so every `NODE_NEW`/`INSERT` immediately following in this same frame rebuilds the
     * surface before Phase 2 returns — there is no observable empty-document frame.
     */
    applyEpochReset() {
      this.doc.replaceChildren();
      this.registry.clear();
      this.registry.register(DOCUMENT_ID, this.doc);
      return true;
    }
    /** §4.2 `NODE_DROP` `DOM` effect: "none — the subtree is already detached." Registry-only. */
    applyNodeDrop(op) {
      for (let i = 0; i < op.ids.length; i++) {
        const node = this.registry.get(op.ids[i]);
        if (node !== void 0) this.registry.unregisterSubtree(node);
      }
      return true;
    }
    applyNodeNew(op) {
      let node;
      if (op.kind === 1 /* Element */) {
        node = this.doc.createElement(op.name);
        applyAttrs(node, op.attrs);
      } else if (op.kind === 2 /* Text */) {
        node = this.doc.createTextNode(op.value);
      } else if (op.kind === 3 /* Comment */) {
        node = this.doc.createComment(op.value);
      } else if (op.kind === 6 /* Doctype */) {
        node = this.doc.implementation.createDocumentType(op.name || "html", "", "");
      } else {
        return this.fail("bad_target", "nodeNew", op.id);
      }
      this.registry.register(op.id, node);
      return true;
    }
    applyInsert(op) {
      const parent = this.registry.get(op.parent);
      if (!parent) return this.fail("address_miss", "insert", op.parent);
      let before = null;
      if (op.before !== INSERT_AT_END) {
        before = this.registry.get(op.before) ?? null;
        if (before === null) return this.fail("address_miss", "insert", op.before);
      }
      for (let i = 0; i < op.ids.length; i++) {
        const id = op.ids[i];
        const node = this.registry.get(id);
        if (!node) return this.fail("address_miss", "insert", id);
        parent.insertBefore(node, before);
      }
      return true;
    }
    applyRemove(op) {
      const parent = this.registry.get(op.parent);
      if (!parent) return this.fail("address_miss", "remove", op.parent);
      for (let i = 0; i < op.ids.length; i++) {
        const id = op.ids[i];
        const node = this.registry.get(id);
        if (!node) return this.fail("address_miss", "remove", id);
        if (node.parentNode === parent) parent.removeChild(node);
      }
      return true;
    }
    applyAttrSet(op) {
      const node = this.registry.get(op.node);
      if (!node || node.nodeType !== Node.ELEMENT_NODE) return this.fail("address_miss", "attrSet", op.node);
      applyAttrs(node, op.attrs);
      return true;
    }
    applyAttrDel(op) {
      const node = this.registry.get(op.node);
      if (!node || node.nodeType !== Node.ELEMENT_NODE) return this.fail("address_miss", "attrDel", op.node);
      const el = node;
      for (let i = 0; i < op.names.length; i++) el.removeAttribute(op.names[i]);
      return true;
    }
    applyTextSet(op) {
      const node = this.registry.get(op.node);
      if (!node) return this.fail("address_miss", "textSet", op.node);
      node.textContent = op.value;
      return true;
    }
  };
  function applyAttrs(el, attrs) {
    for (let i = 0; i < attrs.length; i++) {
      const { name, value } = attrs[i];
      try {
        el.setAttribute(name, value);
      } catch {
      }
    }
  }

  // browser/mirror/projection/client/registry.ts
  var PageProjectionRegistry = class {
    nodesById = /* @__PURE__ */ new Map();
    idsByNode = /* @__PURE__ */ new WeakMap();
    /** Registers (or re-registers) one node under `id`. O(1). */
    register(id, node) {
      if (id <= 0) return;
      const existing = this.nodesById.get(id);
      if (existing && existing !== node) this.idsByNode.delete(existing);
      this.nodesById.set(id, node);
      this.idsByNode.set(node, id);
    }
    /** Resolves an id to its live node, or `undefined` on a miss (a desync trigger upstream). */
    get(id) {
      return this.nodesById.get(id);
    }
    /** Reverse lookup — input intents address by id via this map. */
    idOf(node) {
      return this.idsByNode.get(node);
    }
    /** Nearest registered id walking up from `node`. */
    idOfNearest(node) {
      let cur = node;
      while (cur) {
        const id = this.idsByNode.get(cur);
        if (id != null) return id;
        cur = cur.parentNode;
      }
      return void 0;
    }
    /** Removes exactly one id, without touching its node's descendants. */
    unregister(id) {
      const node = this.nodesById.get(id);
      if (!node) return;
      this.nodesById.delete(id);
      this.idsByNode.delete(node);
    }
    /** Unregisters `root` and every descendant carrying a registered id. */
    unregisterSubtree(root) {
      const stack = [root];
      while (stack.length > 0) {
        const node = stack.pop();
        const id = this.idsByNode.get(node);
        if (id != null) {
          this.nodesById.delete(id);
          this.idsByNode.delete(node);
        }
        for (const child of Array.from(node.childNodes)) stack.push(child);
      }
    }
    /** Total registered ids — perf/soak signal. */
    get size() {
      return this.nodesById.size;
    }
    /**
     * Drops every `id → node` entry — `EPOCH_RESET`'s `DOM` effect (§4.1, Stage 3 of
     * frame-protocol-production-completeness): `applyDom.ts`'s `applyEpochReset` calls this, then
     * immediately re-registers `DOCUMENT_ID`, before any `NODE_NEW`/`INSERT` in the same frame
     * repopulates the rest. Leaves the reverse `idsByNode` `WeakMap` alone — its entries key off
     * now-discarded nodes and fall out of scope for GC on their own; nothing reads a stale id back
     * out of it without first missing on `nodesById.get`, which this already empties.
     */
    clear() {
      this.nodesById.clear();
    }
  };

  // browser/mirror/projection/client/surface.ts
  function attachBareIframe(container) {
    const iframe = document.createElement("iframe");
    iframe.title = "Projected surface";
    iframe.sandbox.add("allow-same-origin");
    iframe.style.cssText = "position:absolute;inset:0;width:100%;height:100%;border:0";
    container.appendChild(iframe);
    const doc = iframe.contentDocument;
    if (!doc) throw new Error("surface: no contentDocument");
    while (doc.firstChild) doc.removeChild(doc.firstChild);
    return iframe;
  }
  function docOf(iframe) {
    const doc = iframe.contentDocument;
    if (!doc) throw new Error("surface: no contentDocument");
    return doc;
  }
  function createSurfaceHost(container, opts = { width: 1280, height: 720 }) {
    container.style.position = "relative";
    container.style.width = `${opts.width}px`;
    container.style.height = `${opts.height}px`;
    container.style.overflow = "hidden";
    container.replaceChildren();
    let activeIframe = attachBareIframe(container);
    let standbyIframe = null;
    return {
      get document() {
        return docOf(activeIframe);
      },
      beginResyncBuild() {
        if (standbyIframe !== null) standbyIframe.remove();
        standbyIframe = attachBareIframe(container);
        standbyIframe.style.visibility = "hidden";
        return docOf(standbyIframe);
      },
      commitSwap() {
        const standby = standbyIframe;
        if (standby === null) {
          throw new Error("surface: commitSwap called with no resync build in progress");
        }
        standby.style.visibility = "";
        const old = activeIframe;
        activeIframe = standby;
        standbyIframe = null;
        old.remove();
        return docOf(activeIframe);
      },
      discardBuild() {
        if (standbyIframe === null) return;
        standbyIframe.remove();
        standbyIframe = null;
      }
    };
  }

  // browser/mirror/projection/client/parityFingerprint.ts
  function captureParityFingerprint(doc, registry) {
    const title = doc.title ?? "";
    const h1 = doc.querySelector("h1")?.textContent ?? "";
    const tags = [...doc.body?.children ?? []].slice(0, 24).map((el) => el.tagName.toLowerCase());
    return {
      registrySize: registry.size,
      title,
      h1,
      bodyChildTags: tags.join(","),
      scriptCount: doc.querySelectorAll("script").length,
      pCount: doc.querySelectorAll("p").length,
      htmlLen: doc.documentElement?.outerHTML.length ?? 0
    };
  }

  // browser/mirror/projection/models/tableDigest.ts
  function digestReplicatedTable(table) {
    return { rowCount: table.size, tableHash: table.tableHash.toString() };
  }

  // browser/mirror/projection/client/labProjectionClient.ts
  var MAX_RESYNC_ATTEMPTS = 3;
  var RESYNC_BACKOFF_MS = 300;
  var RESYNC_RESPONSE_TIMEOUT_MS = 5e3;
  var LabProjectionClient = class {
    persistentStrings = new PersistentStringTable();
    assembler = new FramePartAssembler();
    surface;
    onTelemetry;
    onArmedCb;
    onDesyncCb;
    onRequestResyncCb;
    /** The currently-live target — reassigned wholesale on a successful resync swap. */
    live;
    /** Set only while a resync response is being built into the standby surface; `null` otherwise. */
    resync = null;
    resyncAttempts = 0;
    resyncExhausted = false;
    resyncBackoffTimer = null;
    resyncTimeoutTimer = null;
    lastSequence = 0;
    generation = 1;
    armed = false;
    /**
     * Stage 4 — distinguishes cold start from mid-session recovery. `resync: true` is not unique to
     * `emitResyncFrame`: bootstrap's own cold-start frame (`resyncVirtual`) sets it too, for the
     * same reason (§2 — "no prior state to check against a wholesale replace", the *first* frame
     * has no prior state either). The double buffer exists to protect an already-good live surface
     * while a replacement is built off to the side; at cold start there is no live surface yet to
     * protect, so a resync-flagged frame is only routed into a standby build once this has been
     * `true` at least once — i.e. once the ordinary live target has actually shown something.
     */
    everArmed = false;
    constructor(opts) {
      this.surface = createSurfaceHost(opts.surfaceHost, {
        width: opts.width ?? 1280,
        height: opts.height ?? 720
      });
      this.onTelemetry = opts.onTelemetry;
      this.onArmedCb = opts.onArmed;
      this.onDesyncCb = opts.onDesync;
      this.onRequestResyncCb = opts.onRequestResync;
      const registry = new PageProjectionRegistry();
      registry.register(DOCUMENT_ID, this.surface.document);
      this.live = { applier: this.createApplier(this.surface.document, registry, true), registry };
    }
    get isArmed() {
      return this.armed;
    }
    /**
     * Last sequence accepted into the apply queue (may still be one `requestAnimationFrame` away
     * from actually hitting the DOM) — lab test introspection only (Stage 2 gate: a test needs
     * this to construct a corrupted frame's `sequence` field as exactly `lastAcceptedSequence + 1`).
     */
    get lastAcceptedSequence() {
      return this.lastSequence;
    }
    /** Surface's currently-*active* document — changes identity across a resync swap (Stage 4). */
    get document() {
      return this.surface.document;
    }
    /** Probe: replicated table at the last applied sequence (same turn as the caller). */
    snapshotTable() {
      return {
        sequence: this.lastSequence,
        table: digestReplicatedTable(this.live.applier.replicatedTable)
      };
    }
    ingest(bytes) {
      const decoded = decodeFramePart(bytes, this.persistentStrings);
      if (!decoded.ok) {
        this.desync(decoded.reason, { message: decoded.message });
        return;
      }
      const assembled = this.assembler.ingest(decoded.part);
      if (assembled === "missing_part") {
        this.desync("missing_part");
        return;
      }
      if (assembled === null) return;
      this.applyAssembled(assembled);
    }
    applyAssembled(frame) {
      if (frame.generation !== this.generation) {
        const firstOp = frame.ops[0];
        const isEpochReset = firstOp !== void 0 && firstOp.op === 2 /* EpochReset */;
        if (!isEpochReset || firstOp.generation !== frame.generation) {
          this.desync("generation_mismatch", { message: `got ${frame.generation} have ${this.generation}` });
          return;
        }
        this.generation = frame.generation;
        this.lastSequence = frame.sequence - 1;
        this.abandonResyncAttempt();
        this.resyncAttempts = 0;
        this.resyncExhausted = false;
      }
      if (frame.resync) {
        this.lastSequence = frame.sequence - 1;
        if (this.everArmed) this.beginResyncTarget();
      }
      if (frame.sequence !== this.lastSequence + 1) {
        this.desync("sequence_gap", { expectedSequence: this.lastSequence + 1, gotSequence: frame.sequence });
        return;
      }
      this.lastSequence = frame.sequence;
      const target = this.resync ?? this.live;
      target.applier.enqueue(frame);
    }
    /**
     * Stage 4 — one independent `DomFrameApplier` per target (live or standby-under-resync), never
     * a single mutable target: each owns its own `ReplicatedTable` (constructed internally by
     * `DomFrameApplier`) and registry, so a resync build's phase 1/2 can never observe or corrupt
     * the live surface's own table, and vice versa. `swapped` starts `false` for a resync target and
     * flips exactly once, on its first successful apply (always the resync frame itself, since
     * that's what creates this target) — every callback after that behaves like an ordinary live
     * frame, whether this *is* the live target from construction or was just promoted to it.
     */
    createApplier(doc, registry, initiallyLive) {
      const state = { swapped: initiallyLive };
      const applier = new DomFrameApplier(doc, registry, {
        onDesync: (info) => {
          if (state.swapped) {
            this.reportApplyResult({ ok: false, sequence: this.lastSequence, opCount: 0, applyMs: 0, reason: info.reason });
            this.desync(info.reason, {
              op: info.op,
              id: info.id,
              expected: info.expected,
              actual: info.actual,
              message: info.message,
              phase: info.phase
            });
          } else {
            this.failResyncAttempt(info.reason);
          }
        },
        onApplied: (frame, applyMs) => {
          if (state.swapped) {
            this.reportApplyResult({ ok: true, sequence: frame.sequence, opCount: frame.ops.length, applyMs });
            this.emitFingerprint(frame.sequence);
            if (!this.armed) {
              this.armed = true;
              this.everArmed = true;
              this.onArmedCb?.();
            }
          } else {
            state.swapped = true;
            this.commitResyncSwap(frame, applyMs);
          }
        },
        onOverrun: (durationMs, lastSequence) => {
          this.onTelemetry?.({
            v: 1,
            kind: "applyOverrun",
            t: performance.now(),
            generation: this.generation,
            sequence: lastSequence,
            durationMs,
            budgetMs: 4
          });
        }
      });
      return applier;
    }
    /** Begins (or restarts) a standby build the moment a `resync`-flagged frame is first seen. */
    beginResyncTarget() {
      if (this.resyncTimeoutTimer !== null) {
        clearTimeout(this.resyncTimeoutTimer);
        this.resyncTimeoutTimer = null;
      }
      if (this.resync !== null) {
        this.surface.discardBuild();
        this.resync = null;
      }
      const doc = this.surface.beginResyncBuild();
      const registry = new PageProjectionRegistry();
      registry.register(DOCUMENT_ID, doc);
      const applier = this.createApplier(doc, registry, false);
      this.resync = { applier, registry, attempt: this.resyncAttempts };
    }
    /** Stage 4, §5.8: closing `CHECK` verified OK (this is what `DomFrameApplier`'s `onApplied` already gates on) — swap. */
    commitResyncSwap(frame, applyMs) {
      const built = this.resync;
      if (built === null) return;
      this.surface.commitSwap();
      this.live = { applier: built.applier, registry: built.registry };
      this.resync = null;
      this.resyncAttempts = 0;
      this.resyncExhausted = false;
      this.onTelemetry?.({
        v: 1,
        kind: "resyncCompleted",
        t: performance.now(),
        generation: this.generation,
        sequence: frame.sequence,
        attempt: built.attempt
      });
      this.reportApplyResult({ ok: true, sequence: frame.sequence, opCount: frame.ops.length, applyMs });
      this.emitFingerprint(frame.sequence);
      if (!this.armed) {
        this.armed = true;
        this.everArmed = true;
        this.onArmedCb?.();
      }
    }
    /**
     * A resync frame's own phase 1/2 failed (frame-protocol.md: "a resync frame whose closing CHECK
     * fails is a defect, not a recoverable state") or the producer never answered in time. Neither
     * touches the live surface — `this.live` is untouched, still showing whatever it showed before
     * this attempt, stale but not broken further. Retries (bounded) rather than giving up on one
     * failure, purely as defensive engineering against a transient blip, not because failure here
     * is expected to be routine.
     */
    failResyncAttempt(reason) {
      const attempt = this.resync?.attempt ?? this.resyncAttempts;
      if (this.resync !== null) {
        this.surface.discardBuild();
        this.resync = null;
      }
      this.onTelemetry?.({
        v: 1,
        kind: "resyncFailed",
        t: performance.now(),
        generation: this.generation,
        sequence: this.lastSequence,
        attempt,
        reason,
        exhausted: false
      });
      this.scheduleResyncAttempt(reason);
    }
    abandonResyncAttempt() {
      if (this.resyncBackoffTimer !== null) {
        clearTimeout(this.resyncBackoffTimer);
        this.resyncBackoffTimer = null;
      }
      if (this.resyncTimeoutTimer !== null) {
        clearTimeout(this.resyncTimeoutTimer);
        this.resyncTimeoutTimer = null;
      }
      if (this.resync !== null) {
        this.surface.discardBuild();
        this.resync = null;
      }
    }
    /**
     * Bounded retry with backoff (frame-protocol.md §5.8: "ordinary defensive engineering against a
     * retry storm ... exceeding the bound MUST surface as a hard, catalogued session failure ...
     * never a silent, indefinite retry loop"). One attempt in flight at a time — a concurrent
     * backoff timer or an already-answered-and-building resync makes this a no-op.
     */
    scheduleResyncAttempt(reason) {
      if (this.resyncExhausted) return;
      if (this.resyncBackoffTimer !== null || this.resyncTimeoutTimer !== null || this.resync !== null) return;
      const attempt = this.resyncAttempts + 1;
      if (attempt > MAX_RESYNC_ATTEMPTS) {
        this.resyncExhausted = true;
        this.onTelemetry?.({
          v: 1,
          kind: "resyncFailed",
          t: performance.now(),
          generation: this.generation,
          sequence: this.lastSequence,
          attempt: this.resyncAttempts,
          reason,
          exhausted: true
        });
        return;
      }
      const delay = attempt === 1 ? 0 : RESYNC_BACKOFF_MS * (attempt - 1);
      this.resyncBackoffTimer = setTimeout(() => {
        this.resyncBackoffTimer = null;
        this.resyncAttempts = attempt;
        this.onTelemetry?.({
          v: 1,
          kind: "resyncRequested",
          t: performance.now(),
          generation: this.generation,
          sequence: this.lastSequence,
          reason,
          attempt
        });
        this.onRequestResyncCb?.({ generation: this.generation, sequence: this.lastSequence, reason });
        this.resyncTimeoutTimer = setTimeout(() => {
          this.resyncTimeoutTimer = null;
          this.failResyncAttempt("resync_timeout");
        }, RESYNC_RESPONSE_TIMEOUT_MS);
      }, delay);
    }
    emitFingerprint(sequence) {
      const fp = captureParityFingerprint(this.surface.document, this.live.registry);
      this.onTelemetry?.({
        v: 1,
        kind: "parityFingerprint",
        t: performance.now(),
        generation: this.generation,
        sequence,
        ...fp
      });
    }
    reportApplyResult(info) {
      this.onTelemetry?.({
        v: 1,
        kind: "applyResult",
        t: performance.now(),
        generation: this.generation,
        sequence: info.sequence,
        ok: info.ok,
        opCount: info.opCount,
        applyMs: info.applyMs,
        tableSize: this.live.applier.replicatedTable.size,
        reason: info.reason
      });
    }
    desync(reason, extra) {
      this.onTelemetry?.({
        v: 1,
        kind: "desynced",
        t: performance.now(),
        generation: this.generation,
        sequence: extra?.gotSequence ?? this.lastSequence,
        errorCode: reason,
        phase: extra?.phase ?? desyncPhase(reason),
        expectedSequence: extra?.expectedSequence,
        op: extra?.op,
        id: extra?.id,
        message: extra?.message,
        // §4.1 CHECK / §2 preTableHash mismatch (`reason: 'precondition'`) — u64 rides as a decimal
        // string, `bigint` is not JSON-serializable.
        expected: extra?.expected?.toString(),
        actual: extra?.actual?.toString()
      });
      this.armed = false;
      this.assembler.reset();
      this.live.applier.reset();
      this.onDesyncCb?.(reason);
      this.scheduleResyncAttempt(reason);
    }
  };

  // browser/mirror/projection/client/domTreeSnapshot.ts
  function snapshotTree(root) {
    return walkNode(root ?? document);
  }
  function walkNode(node) {
    switch (node.nodeType) {
      case 9:
        return { tag: "#document", children: mapChildren(node) };
      case 10: {
        const dt = node;
        return { tag: "#doctype", text: dt.name };
      }
      case 1: {
        const el = node;
        const attrs = [];
        for (let i = 0; i < el.attributes.length; i++) {
          const a = el.attributes[i];
          attrs.push([a.name, a.value]);
        }
        attrs.sort((x, y) => x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0);
        const result = { tag: el.tagName.toLowerCase() };
        if (attrs.length > 0) result.attrs = attrs;
        const children = mapChildren(node);
        if (children.length > 0) result.children = children;
        return result;
      }
      case 3:
        return { tag: "#text", text: node.textContent ?? "" };
      case 8:
        return { tag: "#comment", text: node.textContent ?? "" };
      default:
        return { tag: `#unknown(${node.nodeType})` };
    }
  }
  function mapChildren(node) {
    const out = [];
    const children = node.childNodes;
    for (let i = 0; i < children.length; i++) out.push(walkNode(children[i]));
    return out;
  }

  // browser/mirror/projection/lab/client/main.ts
  function $(id) {
    const el = document.getElementById(id);
    if (!el) throw new Error(`#${id} missing`);
    return el;
  }
  function logActivity(text, kind = "info") {
    const log = $("activity");
    const line = document.createElement("div");
    line.dataset.kind = kind;
    line.textContent = `${(/* @__PURE__ */ new Date()).toISOString().slice(11, 23)} ${text}`;
    log.prepend(line);
    while (log.childElementCount > 400) log.lastChild?.remove();
  }
  function setStatus(text) {
    $("status").textContent = text;
  }
  function defaultFixtureUrl() {
    return `${location.origin}/fixtures/demo.html`;
  }
  function readConfigFromUi() {
    return {
      enabled: $("telEnabled").checked,
      frameEmitted: $("telFrameEmitted").checked,
      transportDeferred: $("telDeferred").checked,
      aggregate: $("telAggregate").checked,
      applyResult: $("telApply").checked,
      desync: $("telDesync").checked,
      applyOverrun: $("telOverrun").checked,
      clock: $("telClock").checked,
      aggregateIntervalMs: Number($("telAggMs").value) || 2e3
    };
  }
  function fmtStat(label, s, unit = "") {
    return `  ${label.padEnd(9)} min=${s.min.toFixed(2)}${unit} avg=${s.avg.toFixed(2)}${unit} p50=${s.p50.toFixed(2)}${unit} p95=${s.p95.toFixed(2)}${unit} max=${s.max.toFixed(2)}${unit}  (n=${s.count})`;
  }
  function renderBenchmarkReport(report) {
    const m = report.metrics;
    const lines = [];
    lines.push(`${report.meta.url}`);
    if (report.verdicts && report.verdicts.length > 0) {
      lines.push("verdicts:");
      for (const v of report.verdicts) lines.push(`  ${v.status.toUpperCase()} ${v.id}: ${v.reason}`);
    }
    lines.push(`wallMs=${m.wallMs.toFixed(0)}  steadyFrames=${m.steadyFrameCount} (~${m.steadyFps.toFixed(1)}fps)  lastTableSize=${m.lastTableSize}  wireBytes=${m.wireBytesTotal}`);
    if (m.bootstrap) {
      lines.push(`bootstrap: seq=${m.bootstrap.sequence} opCount=${m.bootstrap.opCount} bytes=${m.bootstrap.bytes} tableSize=${m.bootstrap.tableSize} buildMs=${m.bootstrap.buildMs.toFixed(2)}`);
    }
    lines.push("steady-state:");
    lines.push(fmtStat("buildMs", m.buildMs, "ms"));
    lines.push(fmtStat("opCount", m.opCount));
    lines.push(fmtStat("bytes", m.bytes));
    lines.push(fmtStat("applyMs", m.applyMs, "ms"));
    lines.push(`applyOk=${m.applyOk} applyFail=${m.applyFail} desync=${m.desyncCount} overrun=${m.applyOverrunCount} deferred=${m.transportDeferredCount}`);
    if (report.cpuProfile) {
      const oc = report.cpuProfile.summary.ourCode;
      lines.push(`cpu (Virtual, CDP): our-code=${oc.totalPct.toFixed(2)}% (${oc.totalMs.toFixed(2)}ms of ${report.cpuProfile.summary.wallMs.toFixed(0)}ms, ${report.cpuProfile.summary.totalSamples} samples)`);
    }
    if (report.invariants) {
      const failed = report.invariants.filter((i) => i.failCount > 0);
      lines.push(`invariants: ${report.invariants.length} checks, ${failed.length} with failures`);
      for (const i of failed) lines.push(`  FAIL ${i.id}: ${i.failCount} failures / ${i.passCount} passes`);
    }
    if (report.structuralDiff) {
      if (report.structuralDiff.status === "ok") {
        const r = report.structuralDiff.result;
        lines.push(`structuralDiff: ${r.identical ? "identical" : `${r.divergenceCount} divergence(s)`}`);
      } else {
        lines.push(`structuralDiff: unavailable (${report.structuralDiff.reason})`);
      }
    }
    return lines.join("\n");
  }
  var speculumLabTestHooks = {};
  globalThis.__speculumLabTestHooks = speculumLabTestHooks;
  function clientKindEnabled(kind) {
    if (kind === "desynced") return $("telDesync").checked;
    if (kind === "applyOverrun") return $("telOverrun").checked;
    if (kind === "parityFingerprint") return true;
    if (kind === "applyResult") return $("telApply").checked;
    return true;
  }
  function bootLabClient() {
    const urlInput = $("url");
    urlInput.value = defaultFixtureUrl();
    let ws = null;
    let frames = 0;
    let applyOk = 0;
    let desyncCount = 0;
    let resyncCount = 0;
    let opsTotal = 0;
    let lastBuildMs = 0;
    const projection = new LabProjectionClient({
      surfaceHost: $("surfaceHost"),
      onArmed: () => {
        setStatus("armed \u2014 live apply");
        logActivity("first frame applied", "applyResult");
      },
      onDesync: (reason) => {
        desyncCount += 1;
        $("streamDesync").textContent = String(desyncCount);
        setStatus(`desync: ${reason}`);
        logActivity(`desync ${reason}`, "desynced");
        speculumLabTestHooks.onDesync?.(reason);
      },
      // Stage 4 (frame-protocol-production-completeness) §5.8 — the client's own recovery
      // mechanism has no transport of its own; relay its request over the same session control
      // WS `injectRawFrame`/`clientTelemetry` already use, to `lab/session.ts`'s `requestResync`
      // case, which forwards it onto `PlaneChannel.Control` for the Virtual page to answer.
      onRequestResync: (info) => {
        logActivity(`resync requested reason=${info.reason} gen=${info.generation} seq=${info.sequence}`, "resyncRequested");
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "requestResync", ...info }));
        }
      },
      onTelemetry: (msg) => {
        const kind = String(msg.kind ?? "applyResult");
        const send = clientKindEnabled(kind);
        if (kind === "desynced" || msg.ok === false || send) {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "clientTelemetry", message: msg }));
          }
        }
        if (msg.ok === true) applyOk += 1;
        $("streamApply").textContent = String(applyOk);
        if (kind === "resyncCompleted") {
          resyncCount += 1;
          $("streamResync").textContent = String(resyncCount);
        }
        if (typeof msg.opCount === "number") {
          opsTotal += msg.opCount;
          $("streamOps").textContent = String(opsTotal);
        }
        if (typeof msg.applyMs === "number") {
          $("streamApplyMs").textContent = msg.applyMs.toFixed(2);
        }
        logActivity(
          `${kind} ok=${String(msg.ok ?? "-")} seq=${String(msg.sequence ?? "-")} ops=${String(msg.opCount ?? "-")} ${msg.reason ? msg.reason : ""}`,
          kind
        );
      }
    });
    speculumLabTestHooks.projection = projection;
    speculumLabTestHooks.sendControl = (message) => {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
    };
    const connectBtn = $("connect");
    const startBtn = $("start");
    const stopBtn = $("stop");
    const runBenchmarkBtn = $("runBenchmark");
    function setConnected(on) {
      connectBtn.disabled = on;
      startBtn.disabled = !on;
      stopBtn.disabled = !on;
      runBenchmarkBtn.disabled = !on;
    }
    function showTab(name) {
      for (const id of ["panelStream", "panelActivity", "panelConfig", "panelRun"]) {
        $(id).hidden = id !== `panel${name}`;
      }
      for (const btn of document.querySelectorAll("[data-tab]")) {
        btn.classList.toggle("active", btn.dataset.tab === name);
      }
    }
    for (const btn of document.querySelectorAll("[data-tab]")) {
      btn.addEventListener("click", () => showTab(btn.dataset.tab ?? "Stream"));
    }
    showTab("Stream");
    connectBtn.addEventListener("click", () => {
      if (ws !== null) return;
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(`${proto}//${location.host}/lab/session`);
      ws.binaryType = "arraybuffer";
      setStatus("connecting\u2026");
      ws.addEventListener("open", () => {
        setConnected(true);
        setStatus("connected \u2014 press Start");
        logActivity("session WS open");
      });
      ws.addEventListener("close", () => {
        ws = null;
        setConnected(false);
        setStatus("disconnected");
        logActivity("session WS closed");
      });
      ws.addEventListener("message", (ev) => {
        if (typeof ev.data !== "string") {
          frames += 1;
          $("streamFrames").textContent = String(frames);
          projection.ingest(new Uint8Array(ev.data));
          return;
        }
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          logActivity(`bad control: ${ev.data.slice(0, 80)}`);
          return;
        }
        speculumLabTestHooks.onControlMessage?.(msg);
        if (msg.type === "hello") {
          logActivity(`hello session=${msg.sessionId ?? "?"}`);
          return;
        }
        if (msg.type === "ready") {
          setStatus(`Virtual ready \u2014 ${msg.url ?? ""}`);
          logActivity(`ready dataPlane=${msg.dataPlaneUrl ?? ""}`);
          return;
        }
        if (msg.type === "stats") {
          $("hostStats").textContent = `host frames=${msg.frames ?? 0} bytes=${msg.bytes ?? 0} gen=${msg.generation ?? "-"} seq=${msg.sequence ?? "-"} tel=${msg.telemetryMessages ?? 0}`;
          if (msg.sequence != null) $("streamSeq").textContent = String(msg.sequence);
          if (msg.generation != null) $("streamGen").textContent = String(msg.generation);
          return;
        }
        if (msg.type === "telemetry") {
          const tel = msg.message;
          const kind = tel?.kind ?? "?";
          logActivity(`telemetry ${kind} ${JSON.stringify(tel).slice(0, 120)}`, kind);
          if (kind === "frameEmitted") {
            if (tel?.sequence != null) $("streamSeq").textContent = String(tel.sequence);
            if (typeof tel?.buildMs === "number") {
              lastBuildMs = tel.buildMs;
              $("streamBuildMs").textContent = lastBuildMs.toFixed(2);
            }
          }
          return;
        }
        if (msg.type === "error") {
          setStatus(`error: ${typeof msg.message === "string" ? msg.message : "?"}`);
          logActivity(`error ${typeof msg.message === "string" ? msg.message : "?"}`);
          if (runBenchmarkBtn.disabled) {
            runBenchmarkBtn.disabled = false;
            $("benchStatus").textContent = `error: ${typeof msg.message === "string" ? msg.message : "?"}`;
          }
          return;
        }
        if (msg.type === "requestSnapshot") {
          const tree = snapshotTree(projection.document);
          const tableSnap = projection.snapshotTable();
          ws?.send(JSON.stringify({ type: "snapshotResult", tree, table: tableSnap.table, sequence: tableSnap.sequence }));
          logActivity("snapshot captured \u2014 sent to session");
          return;
        }
        if (msg.type === "benchmarkStarted") {
          runBenchmarkBtn.disabled = true;
          $("benchStatus").textContent = `running \u2014 ${msg.url ?? ""} for ${msg.durationMs ?? "?"}ms\u2026`;
          $("benchResults").textContent = "";
          logActivity(`benchmark started ${msg.url ?? ""} durationMs=${msg.durationMs ?? "?"}`);
          return;
        }
        if (msg.type === "benchmarkComplete") {
          runBenchmarkBtn.disabled = false;
          $("benchStatus").textContent = `done \u2014 report: ${msg.reportDir ?? "?"}`;
          $("benchResults").textContent = msg.report ? renderBenchmarkReport(msg.report) : "(no report)";
          logActivity(`benchmark complete reportDir=${msg.reportDir ?? "?"}`);
          return;
        }
        logActivity(`control ${msg.type}`);
      });
    });
    startBtn.addEventListener("click", () => {
      if (ws === null || ws.readyState !== WebSocket.OPEN) return;
      frames = 0;
      applyOk = 0;
      desyncCount = 0;
      resyncCount = 0;
      opsTotal = 0;
      $("streamDesync").textContent = "0";
      $("streamResync").textContent = "0";
      $("streamOps").textContent = "0";
      ws.send(
        JSON.stringify({
          type: "start",
          url: urlInput.value.trim(),
          telemetry: readConfigFromUi(),
          frameRateHz: Number($("cfgFrameRate").value) || 60
        })
      );
      setStatus("starting Virtual\u2026");
    });
    stopBtn.addEventListener("click", () => {
      if (ws === null || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: "stop" }));
    });
    runBenchmarkBtn.addEventListener("click", () => {
      if (ws === null || ws.readyState !== WebSocket.OPEN) return;
      runBenchmarkBtn.disabled = true;
      $("benchStatus").textContent = "starting\u2026";
      ws.send(
        JSON.stringify({
          type: "runBenchmark",
          url: urlInput.value.trim(),
          durationMs: Number($("benchDurationMs").value) || 15e3,
          telemetry: readConfigFromUi(),
          frameRateHz: Number($("cfgFrameRate").value) || 60,
          options: {
            cpuProfile: $("benchCpuProfile").checked,
            invariants: $("benchInvariants").checked,
            structuralDiff: $("benchStructuralDiff").checked,
            isomorphism: $("benchIso").checked
          }
        })
      );
    });
    setConnected(false);
    setStatus("idle");
  }
  bootLabClient();
})();
