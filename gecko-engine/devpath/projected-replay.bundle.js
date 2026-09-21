var SpeculumReplay = (() => {
  // packages/page-projection/src/core/elementNs.ts
  var ELEMENT_NS_NESTED_HOST_BIT = 128;
  var ELEMENT_NS_RESERVED_BITS = 112;
  function unpackElementNsWireByte(byte) {
    if ((byte & ELEMENT_NS_RESERVED_BITS) !== 0) {
      throw new Error(`NODE_NEW ns reserved bits 0x${(byte & ELEMENT_NS_RESERVED_BITS).toString(16)} (frame-protocol.md \xA74.2)`);
    }
    const ns = byte & 15;
    if (ns > 4 /* Custom */) {
      throw new Error(`NODE_NEW ns ${ns} out of range (frame-protocol.md \xA74.2)`);
    }
    return { ns, nestedHost: (byte & ELEMENT_NS_NESTED_HOST_BIT) !== 0 };
  }
  function assertNestedChildScopeId(id) {
    if (!Number.isInteger(id) || id < 2 || id > 4294967295) {
      throw new Error(`NODE_NEW childScopeId ${id} is not a nested context (frame-protocol.md \xA74.2)`);
    }
  }
  var ELEMENT_NS_HTML = "http://www.w3.org/1999/xhtml";
  var ELEMENT_NS_SVG = "http://www.w3.org/2000/svg";
  var ELEMENT_NS_MATHML = "http://www.w3.org/1998/Math/MathML";
  function elementNsUri(ns, customUri) {
    switch (ns) {
      case 0 /* Html */:
        return ELEMENT_NS_HTML;
      case 1 /* Svg */:
        return ELEMENT_NS_SVG;
      case 2 /* Mathml */:
        return ELEMENT_NS_MATHML;
      case 3 /* None */:
        return null;
      case 4 /* Custom */:
        return customUri ?? "";
    }
  }

  // packages/page-projection/src/core/propSet.ts
  var PROP_ID_VALUE = 1;
  var PROP_ID_CHECKED = 2;
  var PROP_ID_SELECTED = 3;
  function propValueKind(propId) {
    switch (propId) {
      case PROP_ID_VALUE:
        return "str";
      case PROP_ID_CHECKED:
      case PROP_ID_SELECTED:
        return "bool";
      default:
        return null;
    }
  }

  // packages/page-projection/src/core/frame.ts
  var FRAME_WIRE_VERSION = 2;
  var FRAME_PREFIX_BYTES = 2 + 1 + 1 + 4 + 4 + 4 + 2 + 2 + 8;
  var DOCUMENT_ID = 1;
  var CONTEXT_ID_ROOT = 1;
  var INSERT_AT_END = 0;
  var SHADOW_MODE_OPEN = 0;
  var SHADOW_MODE_CLOSED = 1;
  var SHADOW_INIT_DELEGATES_FOCUS = 1;
  var SHADOW_INIT_CLONABLE = 2;
  var SHADOW_INIT_SERIALIZABLE = 4;
  var SHADOW_INIT_FLAGS_MASK = 7;
  var CHECK_SCOPE_TABLE = 0;
  var CHECK_SCOPE_RANGE = 1;
  var CSSOM_SCOPE_MAIN = 0;
  var CSSOM_SCOPE_PIERCE_HOST = 1;

  // packages/page-projection/src/core/limits.ts
  var MAX_STR_BYTES = 1 << 20;
  var MAX_ATTRS = 1024;
  var MAX_CHILDREN_PER_OP = 8192;
  var MAX_OPS_PER_FRAME = 65536;
  var MAX_ROWS = 2e5;

  // packages/page-projection/src/core/decode.ts
  function peekFrameHeader(bytes) {
    if (bytes.byteLength < FRAME_PREFIX_BYTES) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint16(0, true) !== 20560) return null;
    return {
      version: bytes[2],
      flags: bytes[3],
      contextId: view.getUint32(4, true),
      generation: view.getUint32(8, true),
      sequence: view.getUint32(12, true),
      partIndex: view.getUint16(16, true),
      partCount: view.getUint16(18, true)
    };
  }
  var WIRE_VERSION = FRAME_WIRE_VERSION;
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
    f32() {
      const v = this.view.getFloat32(this.offset, true);
      this.offset += 4;
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
      if (r.remaining < FRAME_PREFIX_BYTES) return malformed("frame shorter than the fixed header");
      if (r.u16() !== WIRE_MAGIC) return malformed("bad magic");
      const version = r.u8();
      if (version !== WIRE_VERSION) {
        return { ok: false, reason: "unknown_version", message: `unsupported wire version ${version}` };
      }
      const flags = r.u8();
      const contextId = r.u32();
      if (contextId === 0) return malformed("contextId 0 is invalid");
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
          contextId,
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
      case 33 /* NodeDrop */: {
        const count = r.u16();
        checkChildCount(count);
        const ids = new Array(count);
        for (let i = 0; i < count; i++) ids[i] = r.u32();
        return { op: 33 /* NodeDrop */, ids };
      }
      case 32 /* NodeNew */: {
        const id = r.u32();
        const kind = r.u8();
        if (kind === 1 /* Element */) {
          const packed = unpackElementNsWireByte(r.u8());
          let uri;
          if (packed.ns === 4 /* Custom */) {
            uri = resolveStr(r.u32());
            if (uri.length === 0) {
              throw new Error("NODE_NEW custom ns empty uri (frame-protocol.md \xA74.2)");
            }
          }
          const name = resolveStr(r.u32());
          const attrs = decodeAttrs(r, resolveStr);
          let nestedHost = false;
          let childScopeId = null;
          if (packed.nestedHost) {
            childScopeId = r.u32();
            assertNestedChildScopeId(childScopeId);
            nestedHost = true;
          }
          return {
            op: 32 /* NodeNew */,
            id,
            kind: 1 /* Element */,
            ns: packed.ns,
            name,
            attrs,
            nestedHost,
            childScopeId,
            ...uri !== void 0 ? { uri } : {}
          };
        }
        if (kind === 6 /* Doctype */) {
          return { op: 32 /* NodeNew */, id, kind: 6 /* Doctype */, name: resolveStr(r.u32()) };
        }
        if (kind === 2 /* Text */ || kind === 3 /* Comment */) {
          return { op: 32 /* NodeNew */, id, kind, value: resolveStr(r.u32()) };
        }
        if (kind === 7 /* ShadowRoot */) {
          const host = r.u32();
          const mode = r.u8();
          const initFlags = r.u8();
          if (mode !== SHADOW_MODE_OPEN && mode !== SHADOW_MODE_CLOSED) {
            throw new Error(`NODE_NEW SHADOW_ROOT mode ${mode} is invalid (frame-protocol.md \xA74.2)`);
          }
          if ((initFlags & ~SHADOW_INIT_FLAGS_MASK) !== 0) {
            throw new Error(`NODE_NEW SHADOW_ROOT initFlags ${initFlags} has reserved bits (frame-protocol.md \xA74.2)`);
          }
          return { op: 32 /* NodeNew */, id, kind: 7 /* ShadowRoot */, host, mode, initFlags };
        }
        throw new Error(`NODE_NEW kind ${kind} is not defined (frame-protocol.md \xA74.2)`);
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
      case 99 /* PropSet */: {
        const node = r.u32();
        const propId = r.u8();
        const kind = propValueKind(propId);
        if (kind === null) {
          throw new Error(`PROP_SET propId ${propId} is not defined (frame-protocol.md \xA74.4)`);
        }
        if (kind === "str") {
          return { op: 99 /* PropSet */, node, propId, value: resolveStr(r.u32()) };
        }
        if (kind === "bool") {
          const flag = r.u8();
          if (flag !== 0 && flag !== 1) {
            throw new Error(`PROP_SET bool operand ${flag} is not 0 or 1 (frame-protocol.md \xA74.4)`);
          }
          return { op: 99 /* PropSet */, node, propId, value: flag === 1 };
        }
        return { op: 99 /* PropSet */, node, propId, value: r.f32() };
      }
      case 160 /* SheetNew */: {
        const id = r.u32();
        const scope = r.u8();
        const hostNode = r.u32();
        const before = r.u32();
        if (scope !== CSSOM_SCOPE_MAIN && scope !== CSSOM_SCOPE_PIERCE_HOST) return null;
        return { op: 160 /* SheetNew */, id, scope, hostNode, before: before === 0 ? INSERT_AT_END : before };
      }
      case 161 /* SheetDrop */: {
        const count = r.u16();
        checkChildCount(count);
        const ids = new Array(count);
        for (let i = 0; i < count; i++) ids[i] = r.u32();
        return { op: 161 /* SheetDrop */, ids };
      }
      case 162 /* SheetOrder */: {
        const count = r.u16();
        checkChildCount(count);
        const ids = new Array(count);
        for (let i = 0; i < count; i++) ids[i] = r.u32();
        return { op: 162 /* SheetOrder */, ids };
      }
      case 163 /* RuleNew */: {
        const sheet = r.u32();
        const id = r.u32();
        const before = r.u32();
        const text = resolveStr(r.u32());
        return { op: 163 /* RuleNew */, sheet, id, before: before === 0 ? INSERT_AT_END : before, text };
      }
      case 164 /* RuleDrop */: {
        const sheet = r.u32();
        const count = r.u16();
        checkChildCount(count);
        const ids = new Array(count);
        for (let i = 0; i < count; i++) ids[i] = r.u32();
        return { op: 164 /* RuleDrop */, sheet, ids };
      }
      case 165 /* RuleSet */: {
        const id = r.u32();
        return { op: 165 /* RuleSet */, id, text: resolveStr(r.u32()) };
      }
      default:
        return null;
    }
  }
  var FramePartAssembler = class {
    pending = /* @__PURE__ */ new Map();
    ingest(part) {
      if (part.partCount <= 1) {
        const assembled2 = assemble(part, [part]);
        return assembled2 === "malformed" ? "malformed" : assembled2;
      }
      const key = `${part.contextId}:${part.generation}:${part.sequence}`;
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
      const assembled = assemble(part, slot.parts);
      if (assembled === "malformed") return "malformed";
      return assembled;
    }
    /** Drops every in-flight partial assembly (desync / generation bump). */
    reset() {
      this.pending.clear();
    }
  };
  function assemble(last, parts) {
    const ops = [];
    for (const part of parts) {
      if (part.contextId !== last.contextId) return "malformed";
      ops.push(...part.ops);
    }
    return {
      version: last.version,
      resync: last.resync,
      contextId: last.contextId,
      generation: last.generation,
      sequence: last.sequence,
      preTableHash: last.preTableHash,
      ops
    };
  }

  // packages/page-projection/src/core/applyBatch.ts
  function applyFramesUntilDesync(batch, applyOne) {
    for (let i = 0; i < batch.length; i++) {
      if (!applyOne(batch[i])) {
        return { lastIndex: i, stoppedEarly: true };
      }
    }
    return { lastIndex: batch.length - 1, stoppedEarly: false };
  }

  // packages/page-projection/src/core/formPropDirty.ts
  var FormPropDirty = class {
    dirty = /* @__PURE__ */ new Set();
    stash = /* @__PURE__ */ new Map();
    mark(id) {
      this.dirty.add(id);
    }
    clear(id) {
      this.dirty.delete(id);
    }
    isDirty(id) {
      return this.dirty.has(id);
    }
    hold(op) {
      this.stash.set(op.node, op);
    }
    take(id) {
      const op = this.stash.get(id);
      this.stash.delete(id);
      return op;
    }
    reset() {
      this.dirty.clear();
      this.stash.clear();
    }
  };

  // packages/page-projection/src/core/attrApply.ts
  function applyAttrPairs(setAttribute, attrs) {
    for (let i = 0; i < attrs.length; i++) {
      const { name, value } = attrs[i];
      try {
        setAttribute(name, value);
      } catch {
        return false;
      }
    }
    return true;
  }

  // packages/page-projection/src/core/cssomApplyIndex.ts
  function orderedSheetIds(table, parent = DOCUMENT_ID) {
    const all = table.orderedChildIds(parent);
    const out = [];
    for (let i = 0; i < all.length; i++) {
      const id = all[i];
      const row = table.getRow(id);
      if (row !== void 0 && row.kind === 4 /* Sheet */) out.push(id);
    }
    return out;
  }
  function allSheetIds(table) {
    const parents = [DOCUMENT_ID];
    const seen = /* @__PURE__ */ new Set([DOCUMENT_ID]);
    table.forEachRow((_id, row) => {
      if (row.kind !== 4 /* Sheet */) return;
      const parent = row.parent === 0 ? DOCUMENT_ID : row.parent;
      if (!seen.has(parent)) {
        seen.add(parent);
        parents.push(parent);
      }
    });
    const out = [];
    for (let i = 0; i < parents.length; i++) out.push(...orderedSheetIds(table, parents[i]));
    return out;
  }
  function orderedRuleIds(table, sheetId) {
    const all = table.orderedChildIds(sheetId);
    const out = [];
    for (let i = 0; i < all.length; i++) {
      const id = all[i];
      const row = table.getRow(id);
      if (row !== void 0 && row.kind === 5 /* Rule */) out.push(id);
    }
    return out;
  }
  function matchCssomEndOfFrame(tableSheetIds, tableRuleIdsBySheet, liveSheetIdsPresent, liveRuleIdsBySheet) {
    for (let s = 0; s < tableSheetIds.length; s++) {
      const sheetId = tableSheetIds[s];
      if (!liveSheetIdsPresent.has(sheetId)) {
        return { ok: false, op: "sheetNew", id: sheetId };
      }
      const tableRules = tableRuleIdsBySheet.get(sheetId) ?? [];
      const liveRules = liveRuleIdsBySheet.get(sheetId) ?? [];
      const liveSet = new Set(liveRules);
      for (let r = 0; r < tableRules.length; r++) {
        const ruleId = tableRules[r];
        if (!liveSet.has(ruleId)) {
          return { ok: false, op: "ruleNew", id: ruleId };
        }
      }
      if (tableRules.length !== liveRules.length) {
        return { ok: false, op: "ruleOrder", id: sheetId };
      }
      for (let r = 0; r < tableRules.length; r++) {
        if (tableRules[r] !== liveRules[r]) {
          return { ok: false, op: "ruleOrder", id: tableRules[r] };
        }
      }
    }
    return { ok: true };
  }
  function insertIndexFromBefore(materializedIds, before) {
    if (before === INSERT_AT_END) return materializedIds.length;
    for (let i = 0; i < materializedIds.length; i++) {
      if (materializedIds[i] === before) return i;
    }
    return -1;
  }
  function declarationBlockFromRuleText(cssText) {
    const open = cssText.indexOf("{");
    const close = cssText.lastIndexOf("}");
    if (open < 0 || close <= open) return cssText.trim();
    return cssText.slice(open + 1, close).trim();
  }

  // packages/page-projection/src/core/cssomRuleSet.ts
  function planRuleSetApply(isCssStyleRule) {
    if (isCssStyleRule) return { mode: "styleDeclarations" };
    return { mode: "desync" };
  }

  // packages/page-projection/src/core/rowHash.ts
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
  function hashProp(propId, value) {
    if (typeof value === "boolean") return h64Str(`\0P${propId}B${value ? "1" : "0"}`);
    if (typeof value === "number") return h64Str(`\0P${propId}F${value}`);
    return h64Str(`\0P${propId}S${value}`);
  }
  function hashNs(ns, uri) {
    if (ns === 4 /* Custom */) return h64Str(`\0U${uri ?? ""}`);
    return h64Bytes(Uint8Array.of(0, 83, ns & 255));
  }
  function hashShadowInit(mode, initFlags) {
    return h64Bytes(Uint8Array.of(0, 72, mode & 255, initFlags & 255));
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

  // packages/page-projection/src/core/replicatedTable.ts
  var NONE = 0;
  var ReplicatedTable = class {
    rows = /* @__PURE__ */ new Map();
    /** ELEMENT rows only — id -> attrName -> that attribute's own contentHash contribution. */
    attrHashes = /* @__PURE__ */ new Map();
    /** ELEMENT rows only — id -> propId -> that prop's contentHash contribution. */
    propHashes = /* @__PURE__ */ new Map();
    /** ELEMENT rows only — last PROP_SET scalar (delta compare on the producer). */
    propValues = /* @__PURE__ */ new Map();
    /** Derived, non-hashed: id -> the id currently linked immediately after it under the same parent. */
    nextSiblingOf = /* @__PURE__ */ new Map();
    /** Derived, non-hashed: parentId -> the id currently linked last under that parent (0 = none). */
    lastChildOf = /* @__PURE__ */ new Map();
    /** Host ELEMENT id → owned `SHADOW_ROOT` id. Not hashed; not a light-chain link. */
    shadowRootByHost = /* @__PURE__ */ new Map();
    /** Reverse of `shadowRootByHost` so `dropRow` of the root clears the host index. */
    hostOfShadowRoot = /* @__PURE__ */ new Map();
    tracker = new TableHashTracker();
    /** Stamped onto every row `setRow` touches until changed again — one frame, one `lms` (§4 preamble). */
    currentSequence = 0;
    /** Scratch for {@link collectSubtreeIds} — reused across walks (hot path; not hashed). */
    walkStack = [];
    walkVisited = /* @__PURE__ */ new Set();
    get tableHash() {
      return this.tracker.value;
    }
    /**
     * Call once per frame before applying its ops (producer: `tableFrameBuilder.ts` / `domResync.ts`;
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
      const seen = /* @__PURE__ */ new Set();
      let child = this.lastChildOf.get(parent) ?? NONE;
      while (child !== NONE) {
        if (seen.has(child)) break;
        seen.add(child);
        backwards.push(child);
        const row = this.rows.get(child);
        child = row?.prevSibling ?? NONE;
      }
      backwards.reverse();
      return backwards;
    }
    /** Rows with hashed `parent` — O(table). Lab O2 uses this to detect a broken `lastChildOf` walk. */
    lastChildId(parent) {
      return this.lastChildOf.get(parent) ?? NONE;
    }
    countAttachedChildren(parent) {
      let n = 0;
      for (const row of this.rows.values()) {
        if (row.parent === parent && row.kind !== 7 /* ShadowRoot */) n += 1;
      }
      return n;
    }
    /** Owned `SHADOW_ROOT` id of `host`, or 0. */
    shadowRootOf(host) {
      return this.shadowRootByHost.get(host) ?? NONE;
    }
    /** Every stored row id (excludes implicit Document `1`). */
    forEachRow(fn) {
      for (const [id, row] of this.rows) fn(id, row);
    }
    /** Drops every row and derived index — resync's wholesale replace (§5.8). */
    reset() {
      this.rows.clear();
      this.attrHashes.clear();
      this.propHashes.clear();
      this.propValues.clear();
      this.nextSiblingOf.clear();
      this.lastChildOf.clear();
      this.shadowRootByHost.clear();
      this.hostOfShadowRoot.clear();
      this.tracker.clear();
    }
    // ---- NODE_NEW (§4.2) — always creates a detached row (parent=0, prevSibling=0). ----
    /**
     * `ns` defaults to html for existing unit callers (API convenience). Decode never
     * invents a default — the wire `u8` is required.
     */
    createElementRow(id, tagName, attrs, ns = 0 /* Html */, uri) {
      const attrMap = /* @__PURE__ */ new Map();
      let sum = addMod64(hashName(tagName), hashNs(ns, uri));
      for (let i = 0; i < attrs.length; i++) {
        const { name, value } = attrs[i];
        const h = hashAttr(name, value);
        attrMap.set(name, h);
        sum = addMod64(sum, h);
      }
      this.attrHashes.set(id, attrMap);
      this.propHashes.set(id, /* @__PURE__ */ new Map());
      this.propValues.set(id, /* @__PURE__ */ new Map());
      this.setRow(id, 1 /* Element */, NONE, NONE, sum);
    }
    /** TEXT/COMMENT (`value`) or DOCTYPE (`name`) — both a single content-carrying string field. */
    createLeafRow(id, kind, contentField) {
      this.setRow(id, kind, NONE, NONE, hashValue(contentField));
    }
    /**
     * `SHADOW_ROOT` — `parent = host` immediately, not linked into the host's light chain.
     * `prevSibling` stays 0.
     */
    createShadowRootRow(id, host, mode, initFlags) {
      this.setRow(id, 7 /* ShadowRoot */, host, NONE, hashShadowInit(mode, initFlags));
      this.shadowRootByHost.set(host, id);
      this.hostOfShadowRoot.set(id, host);
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
    setProp(id, propId, value) {
      const row = this.rows.get(id);
      if (row === void 0) return;
      const hashMap = this.propHashes.get(id) ?? /* @__PURE__ */ new Map();
      const valueMap = this.propValues.get(id) ?? /* @__PURE__ */ new Map();
      let sum = row.contentHash;
      const old = hashMap.get(propId);
      if (old !== void 0) sum = subMod64(sum, old);
      const h = hashProp(propId, value);
      hashMap.set(propId, h);
      valueMap.set(propId, value);
      this.propHashes.set(id, hashMap);
      this.propValues.set(id, valueMap);
      this.setRow(id, row.kind, row.parent, row.prevSibling, addMod64(sum, h));
    }
    getProp(id, propId) {
      return this.propValues.get(id)?.get(propId);
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
      const owned = this.shadowRootByHost.get(id);
      if (owned !== void 0) this.hostOfShadowRoot.delete(owned);
      this.shadowRootByHost.delete(id);
      const host = this.hostOfShadowRoot.get(id);
      if (host !== void 0) this.shadowRootByHost.delete(host);
      this.hostOfShadowRoot.delete(id);
      this.rows.delete(id);
      this.attrHashes.delete(id);
      this.propHashes.delete(id);
      this.propValues.delete(id);
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
    /**
     * Iterative DFS (stack + one visited). Root is first in `out`; remaining order unspecified.
     * Revisit (cycle / corrupt derived links) → throw `ReplicatedTable: subtree walk cycle`.
     */
    collectSubtreeIds(rootId, out) {
      const stack = this.walkStack;
      const visited = this.walkVisited;
      stack.length = 0;
      visited.clear();
      visited.add(rootId);
      stack.push(rootId);
      while (stack.length > 0) {
        const id = stack.pop();
        out.push(id);
        let child = this.lastChildOf.get(id) ?? NONE;
        while (child !== NONE) {
          if (visited.has(child)) {
            throw new Error("ReplicatedTable: subtree walk cycle");
          }
          visited.add(child);
          stack.push(child);
          const row = this.rows.get(child);
          child = row?.prevSibling ?? NONE;
        }
        const shadow = this.shadowRootByHost.get(id);
        if (shadow !== void 0 && shadow !== id) {
          if (visited.has(shadow)) {
            throw new Error("ReplicatedTable: subtree walk cycle");
          }
          visited.add(shadow);
          stack.push(shadow);
        }
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
        if (row.prevSibling !== NONE) this.nextSiblingOf.delete(row.prevSibling);
      }
    }
  };

  // packages/page-projection/src/core/replicatedTableApply.ts
  function applyOpToTable(table, op) {
    switch (op.op) {
      case 1 /* Check */:
        return;
      case 32 /* NodeNew */:
        if (op.kind === 1 /* Element */) table.createElementRow(op.id, op.name, op.attrs, op.ns, op.uri);
        else if (op.kind === 6 /* Doctype */) table.createLeafRow(op.id, op.kind, op.name);
        else if (op.kind === 7 /* ShadowRoot */) table.createShadowRootRow(op.id, op.host, op.mode, op.initFlags);
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
      case 99 /* PropSet */:
        table.setProp(op.node, op.propId, op.value);
        return;
      case 160 /* SheetNew */: {
        const parent = op.hostNode === 0 ? DOCUMENT_ID : op.hostNode;
        if (!table.has(op.id)) table.createLeafRow(op.id, 4 /* Sheet */, "");
        table.insertBatch(parent, op.before, [op.id]);
        return;
      }
      case 161 /* SheetDrop */:
        for (let i = 0; i < op.ids.length; i++) {
          const id = op.ids[i];
          const row = table.getRow(id);
          if (row !== void 0 && row.parent !== 0) table.removeBatch(row.parent, [id]);
          table.dropSubtree(id);
        }
        return;
      case 162 /* SheetOrder */:
        if (op.ids.length === 0) return;
        {
          const first = table.getRow(op.ids[0]);
          const parent = first === void 0 || first.parent === 0 ? DOCUMENT_ID : first.parent;
          table.removeBatch(parent, op.ids);
          table.insertBatch(parent, 0, op.ids);
        }
        return;
      case 163 /* RuleNew */:
        if (!table.has(op.id)) table.createLeafRow(op.id, 5 /* Rule */, op.text);
        else table.setValue(op.id, op.text);
        table.insertBatch(op.sheet, op.before, [op.id]);
        return;
      case 164 /* RuleDrop */:
        for (let i = 0; i < op.ids.length; i++) {
          const id = op.ids[i];
          const row = table.getRow(id);
          if (row !== void 0 && row.parent !== 0) table.removeBatch(row.parent, [id]);
          table.dropSubtree(id);
        }
        return;
      case 165 /* RuleSet */:
        table.setValue(op.id, op.text);
        return;
      default:
        return;
    }
  }
  function evaluateCheck(table, op) {
    return op.scope === CHECK_SCOPE_RANGE ? table.hashRange(op.lo, op.hi) : table.tableHash;
  }
  function failOp(i, reason, opName, id, message) {
    return { ok: false, reason, failedOpIndex: i, opName, id, message };
  }
  function addressExists(table, id) {
    return id === DOCUMENT_ID || table.has(id);
  }
  function isInsertParent(table, parent) {
    if (parent === DOCUMENT_ID) return true;
    const row = table.getRow(parent);
    return row !== void 0 && (row.kind === 1 /* Element */ || row.kind === 7 /* ShadowRoot */);
  }
  function isShadowRootId(table, id) {
    return table.getRow(id)?.kind === 7 /* ShadowRoot */;
  }
  function isSelfOrAncestorOf(table, id, ofId) {
    if (id === ofId) return true;
    let cur = ofId;
    const seen = /* @__PURE__ */ new Set();
    while (cur !== 0 && cur !== DOCUMENT_ID) {
      if (seen.has(cur)) return false;
      seen.add(cur);
      const row = table.getRow(cur);
      if (row === void 0) return false;
      if (row.parent === id) return true;
      cur = row.parent;
    }
    return false;
  }
  function validateOpPre(table, op, i) {
    switch (op.op) {
      case 32 /* NodeNew */: {
        if (op.kind !== 7 /* ShadowRoot */) return null;
        if (op.mode !== SHADOW_MODE_OPEN && op.mode !== SHADOW_MODE_CLOSED) {
          return failOp(
            i,
            "malformed",
            "nodeNew",
            op.id,
            "NODE_NEW SHADOW_ROOT mode must be 0 (open) or 1 (closed) (frame-protocol.md \xA74.2)"
          );
        }
        if ((op.initFlags & ~SHADOW_INIT_FLAGS_MASK) !== 0) {
          return failOp(
            i,
            "malformed",
            "nodeNew",
            op.id,
            "NODE_NEW SHADOW_ROOT reserved initFlags (frame-protocol.md \xA74.2)"
          );
        }
        const host = table.getRow(op.host);
        if (host === void 0 || host.kind !== 1 /* Element */) {
          return failOp(
            i,
            "precondition",
            "nodeNew",
            op.host,
            "NODE_NEW SHADOW_ROOT host missing or not ELEMENT (frame-protocol.md \xA74.2)"
          );
        }
        if (table.shadowRootOf(op.host) !== 0) {
          return failOp(
            i,
            "malformed",
            "nodeNew",
            op.id,
            "NODE_NEW SHADOW_ROOT host already owns a root (frame-protocol.md \xA74.2)"
          );
        }
        return null;
      }
      case 64 /* Insert */: {
        if (op.ids.length > MAX_CHILDREN_PER_OP) {
          return failOp(
            i,
            "malformed",
            "insert",
            op.parent,
            `INSERT count > MAX_CHILDREN_PER_OP (${MAX_CHILDREN_PER_OP}) (frame-protocol.md \xA74.3)`
          );
        }
        if (!isInsertParent(table, op.parent)) {
          return failOp(
            i,
            "precondition",
            "insert",
            op.parent,
            "INSERT parent missing or not ELEMENT/SHADOW_ROOT/Document (frame-protocol.md \xA74.3)"
          );
        }
        if (op.before !== 0) {
          const beforeRow = table.getRow(op.before);
          if (beforeRow === void 0 || beforeRow.parent !== op.parent) {
            return failOp(
              i,
              "precondition",
              "insert",
              op.before,
              "INSERT before must be 0 or a child of parent (frame-protocol.md \xA74.3)"
            );
          }
        }
        const seen = /* @__PURE__ */ new Set();
        for (let j = 0; j < op.ids.length; j++) {
          const id = op.ids[j];
          if (seen.has(id)) {
            return failOp(i, "malformed", "insert", id, "INSERT ids must be distinct (frame-protocol.md \xA74.3)");
          }
          seen.add(id);
          if (!table.has(id)) {
            return failOp(i, "precondition", "insert", id, "INSERT id missing (frame-protocol.md \xA74.3)");
          }
          if (isShadowRootId(table, id)) {
            return failOp(
              i,
              "precondition",
              "insert",
              id,
              "INSERT of a SHADOW_ROOT id (frame-protocol.md \xA74.3)"
            );
          }
          if (isSelfOrAncestorOf(table, id, op.parent)) {
            return failOp(
              i,
              "precondition",
              "insert",
              id,
              "INSERT would create a cycle (frame-protocol.md \xA74.3)"
            );
          }
        }
        return null;
      }
      case 65 /* Remove */: {
        if (op.ids.length > MAX_CHILDREN_PER_OP) {
          return failOp(
            i,
            "malformed",
            "remove",
            op.parent,
            `REMOVE count > MAX_CHILDREN_PER_OP (${MAX_CHILDREN_PER_OP}) (frame-protocol.md \xA74.3)`
          );
        }
        if (!addressExists(table, op.parent)) {
          return failOp(i, "precondition", "remove", op.parent, "REMOVE parent missing (frame-protocol.md \xA74.3)");
        }
        for (let j = 0; j < op.ids.length; j++) {
          const id = op.ids[j];
          const row = table.getRow(id);
          if (row === void 0) {
            return failOp(i, "precondition", "remove", id, "REMOVE id missing (frame-protocol.md \xA74.3)");
          }
          if (row.parent !== op.parent) {
            return failOp(
              i,
              "precondition",
              "remove",
              id,
              "REMOVE id parent mismatch (frame-protocol.md \xA74.3)"
            );
          }
          if (row.kind === 7 /* ShadowRoot */) {
            return failOp(
              i,
              "precondition",
              "remove",
              id,
              "REMOVE of a SHADOW_ROOT id (frame-protocol.md \xA74.3)"
            );
          }
        }
        return null;
      }
      case 96 /* AttrSet */: {
        const row = table.getRow(op.node);
        if (row === void 0 || row.kind !== 1 /* Element */) {
          return failOp(
            i,
            "precondition",
            "attrSet",
            op.node,
            "ATTR_SET requires an ELEMENT row (frame-protocol.md \xA74.4)"
          );
        }
        return null;
      }
      case 97 /* AttrDel */: {
        const row = table.getRow(op.node);
        if (row === void 0 || row.kind !== 1 /* Element */) {
          return failOp(
            i,
            "precondition",
            "attrDel",
            op.node,
            "ATTR_DEL requires an ELEMENT row (frame-protocol.md \xA74.4)"
          );
        }
        return null;
      }
      case 98 /* TextSet */: {
        const row = table.getRow(op.node);
        if (row === void 0 || row.kind !== 2 /* Text */ && row.kind !== 3 /* Comment */) {
          return failOp(
            i,
            "precondition",
            "textSet",
            op.node,
            "TEXT_SET requires TEXT or COMMENT (frame-protocol.md \xA74.4)"
          );
        }
        return null;
      }
      case 99 /* PropSet */: {
        const row = table.getRow(op.node);
        if (row === void 0 || row.kind !== 1 /* Element */) {
          return failOp(
            i,
            "precondition",
            "propSet",
            op.node,
            "PROP_SET requires an ELEMENT row (frame-protocol.md \xA74.4)"
          );
        }
        return null;
      }
      case 160 /* SheetNew */: {
        if (table.has(op.id) && table.getRow(op.id).kind !== 4 /* Sheet */) {
          return failOp(
            i,
            "malformed",
            "sheetNew",
            op.id,
            "SHEET_NEW id exists with a non-SHEET kind (frame-protocol.md \xA74.6)"
          );
        }
        if (op.scope === CSSOM_SCOPE_PIERCE_HOST && !addressExists(table, op.hostNode)) {
          return failOp(
            i,
            "precondition",
            "sheetNew",
            op.hostNode,
            "SHEET_NEW PIERCE_HOST hostNode missing (frame-protocol.md \xA74.6)"
          );
        }
        const parent = op.hostNode === 0 ? DOCUMENT_ID : op.hostNode;
        if (op.before !== 0) {
          const beforeRow = table.getRow(op.before);
          if (beforeRow === void 0 || beforeRow.parent !== parent) {
            return failOp(
              i,
              "precondition",
              "sheetNew",
              op.before,
              "SHEET_NEW before must be 0 or a child of the sheet parent (frame-protocol.md \xA74.6)"
            );
          }
        }
        return null;
      }
      case 161 /* SheetDrop */: {
        for (let j = 0; j < op.ids.length; j++) {
          const id = op.ids[j];
          const row = table.getRow(id);
          if (row === void 0 || row.kind !== 4 /* Sheet */) {
            return failOp(
              i,
              "precondition",
              "sheetDrop",
              id,
              "SHEET_DROP requires SHEET ids (frame-protocol.md \xA74.6)"
            );
          }
        }
        return null;
      }
      case 162 /* SheetOrder */: {
        for (let j = 0; j < op.ids.length; j++) {
          const id = op.ids[j];
          const row = table.getRow(id);
          if (row === void 0 || row.kind !== 4 /* Sheet */) {
            return failOp(
              i,
              "precondition",
              "sheetOrder",
              id,
              "SHEET_ORDER requires SHEET ids (frame-protocol.md \xA74.6)"
            );
          }
        }
        return null;
      }
      case 163 /* RuleNew */: {
        const sheet = table.getRow(op.sheet);
        if (sheet === void 0 || sheet.kind !== 4 /* Sheet */) {
          return failOp(
            i,
            "precondition",
            "ruleNew",
            op.sheet,
            "RULE_NEW sheet missing or not SHEET (frame-protocol.md \xA74.6)"
          );
        }
        if (table.has(op.id) && table.getRow(op.id).kind !== 5 /* Rule */) {
          return failOp(
            i,
            "malformed",
            "ruleNew",
            op.id,
            "RULE_NEW id exists with a non-RULE kind (frame-protocol.md \xA74.6)"
          );
        }
        if (op.before !== 0) {
          const beforeRow = table.getRow(op.before);
          if (beforeRow === void 0 || beforeRow.kind !== 5 /* Rule */ || beforeRow.parent !== op.sheet) {
            return failOp(
              i,
              "precondition",
              "ruleNew",
              op.before,
              "RULE_NEW before must be 0 or a rule of that sheet (frame-protocol.md \xA74.6)"
            );
          }
        }
        return null;
      }
      case 164 /* RuleDrop */: {
        for (let j = 0; j < op.ids.length; j++) {
          const id = op.ids[j];
          const row = table.getRow(id);
          if (row === void 0 || row.kind !== 5 /* Rule */ || row.parent !== op.sheet) {
            return failOp(
              i,
              "precondition",
              "ruleDrop",
              id,
              "RULE_DROP requires RULE ids parented to sheet (frame-protocol.md \xA74.6)"
            );
          }
        }
        return null;
      }
      case 165 /* RuleSet */: {
        const row = table.getRow(op.id);
        if (row === void 0 || row.kind !== 5 /* Rule */) {
          return failOp(
            i,
            "precondition",
            "ruleSet",
            op.id,
            "RULE_SET requires a RULE row (frame-protocol.md \xA74.6)"
          );
        }
        return null;
      }
      default:
        return null;
    }
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
            return failOp(
              i,
              "malformed",
              "nodeDrop",
              id,
              "NODE_DROP of an absent id (frame-protocol.md \xA74.2 / OPEN-1 CLOSED)"
            );
          }
          if (table.getRow(id).parent !== 0) {
            return failOp(
              i,
              "precondition",
              "nodeDrop",
              id,
              "NODE_DROP of an attached row (frame-protocol.md \xA74.2)"
            );
          }
        }
        for (let j = 0; j < op.ids.length; j++) table.dropSubtree(op.ids[j]);
        continue;
      }
      if ((op.op === 32 /* NodeNew */ || op.op === 160 /* SheetNew */ || op.op === 163 /* RuleNew */) && !table.has(op.id) && table.size >= MAX_ROWS) {
        return failOp(
          i,
          "precondition",
          "nodeNew",
          op.id,
          `MAX_ROWS (${MAX_ROWS}) exceeded (frame-protocol.md \xA78)`
        );
      }
      const pre = validateOpPre(table, op, i);
      if (pre !== null) return pre;
      applyOpToTable(table, op);
    }
    return { ok: true };
  }

  // packages/page-projection/src/core/nestedNav.ts
  function isNestedHostNavAttr(name) {
    const n = name.toLowerCase();
    return n === "src" || n === "srcdoc";
  }
  function ensureNestedHostSandboxAccess(iframe) {
    if (iframe.localName.toLowerCase() !== "iframe") return;
    const raw = iframe.getAttribute("sandbox");
    if (raw === null) return;
    const tokens = raw.split(/\s+/).map((t) => t.trim().toLowerCase()).filter((t) => t.length > 0 && t !== "allow-scripts");
    if (!tokens.includes("allow-same-origin")) {
      tokens.push("allow-same-origin");
    }
    iframe.setAttribute("sandbox", tokens.join(" "));
  }

  // packages/page-projection/src/projected/scriptingOnPaintParity.ts
  var SCRIPTING_ON_PAINT_PARITY_CSS = "noscript{display:none!important}";
  var PARITY_STYLE_ATTR = "data-speculum-scripting-on-paint-parity";
  var parityByDocument = /* @__PURE__ */ new WeakMap();
  function paritySheetForDocument(doc) {
    return parityByDocument.get(doc);
  }
  function hasParityStyleElement(doc) {
    return doc.querySelector(`style[${PARITY_STYLE_ATTR}]`) != null;
  }
  function paintParityInstalled(doc) {
    const sheet = parityByDocument.get(doc);
    if (sheet !== void 0) {
      try {
        if (Array.from(doc.adoptedStyleSheets).includes(sheet)) return true;
      } catch {
      }
    }
    return hasParityStyleElement(doc);
  }
  function installScriptingOnPaintParity(doc) {
    if (installConstructableParity(doc)) return;
    installParityStyleElement(doc);
  }
  function installConstructableParity(doc) {
    const existing = parityByDocument.get(doc);
    if (existing !== void 0) {
      try {
        const list = Array.from(doc.adoptedStyleSheets);
        if (!list.includes(existing)) {
          doc.adoptedStyleSheets = [existing, ...list.filter((s) => s !== existing)];
        }
        return true;
      } catch {
        parityByDocument.delete(doc);
      }
    }
    const view = doc.defaultView;
    if (view === null || typeof view.CSSStyleSheet !== "function") return false;
    try {
      const sheet = new view.CSSStyleSheet();
      sheet.replaceSync(SCRIPTING_ON_PAINT_PARITY_CSS);
      const rest = Array.from(doc.adoptedStyleSheets).filter((s) => s !== sheet);
      doc.adoptedStyleSheets = [sheet, ...rest];
      parityByDocument.set(doc, sheet);
      return true;
    } catch {
      return false;
    }
  }
  function installParityStyleElement(doc) {
    if (hasParityStyleElement(doc)) return true;
    const head = doc.head;
    const host = head ?? doc.documentElement;
    if (host == null) return false;
    const el = doc.createElement("style");
    el.setAttribute(PARITY_STYLE_ATTR, "");
    el.textContent = SCRIPTING_ON_PAINT_PARITY_CSS;
    if (head != null) head.appendChild(el);
    else host.insertBefore(el, host.firstChild);
    return true;
  }
  function withScriptingOnPaintParity(doc, sheets) {
    if (installConstructableParity(doc)) {
      const parity = parityByDocument.get(doc);
      return [parity, ...sheets.filter((s) => s !== parity)];
    }
    installParityStyleElement(doc);
    return sheets;
  }

  // packages/page-projection/src/projected/projectedBlankIframe.ts
  var PROJECTED_SKELETON_META_NAME = "speculum-projected-skeleton";
  var PROJECTED_K5_CSP = "script-src 'none'; object-src 'none'";
  var PROJECTED_STANDARDS_SRCDOC = `<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="${PROJECTED_K5_CSP}"><meta name="${PROJECTED_SKELETON_META_NAME}" content="1"></head><body></body></html>`;
  var PROJECTED_STANDARDS_READY_TIMEOUT_MS = 5e3;
  function fault(errorCode, message) {
    const err = new Error(message);
    err.errorCode = errorCode;
    err.phase = "establish";
    return err;
  }
  function stampProjectedStandardsSrcdoc(iframe) {
    iframe.srcdoc = PROJECTED_STANDARDS_SRCDOC;
  }
  function stripProjectedSkeleton(doc) {
    while (doc.firstChild) doc.removeChild(doc.firstChild);
  }
  var PROJECTED_DOCUMENT_BASE_ATTR = "data-speculum-document-base";
  function constructedStyleSheetInit(pageUrl) {
    if (!pageUrl) return void 0;
    try {
      return { baseURL: new URL(pageUrl).href };
    } catch {
      return void 0;
    }
  }
  function ensureProjectedDocumentBase(doc, pageUrl) {
    if (!pageUrl) return;
    const head = doc.head;
    if (!head) return;
    let href;
    try {
      href = new URL(pageUrl).href;
    } catch {
      return;
    }
    const existing = head.querySelector(`base[${PROJECTED_DOCUMENT_BASE_ATTR}]`);
    if (existing) {
      if (existing.getAttribute("href") !== href) existing.setAttribute("href", href);
      return;
    }
    const base = doc.createElement("base");
    base.setAttribute(PROJECTED_DOCUMENT_BASE_ATTR, "1");
    base.href = href;
    head.insertBefore(base, head.firstChild);
  }
  function ensureProjectedK5Csp(doc) {
    let html = doc.documentElement;
    if (!html) {
      html = doc.createElement("html");
      doc.appendChild(html);
    }
    let head = doc.head;
    if (!head) {
      head = doc.createElement("head");
      html.insertBefore(head, html.firstChild);
    }
    const existing = head.querySelectorAll('meta[http-equiv="Content-Security-Policy"]');
    for (let i = 0; i < existing.length; i++) {
      if (existing[i].getAttribute("content") === PROJECTED_K5_CSP) return;
    }
    const meta = doc.createElement("meta");
    meta.httpEquiv = "Content-Security-Policy";
    meta.content = PROJECTED_K5_CSP;
    head.insertBefore(meta, head.firstChild);
  }
  function isProjectedStandardsSkeleton(doc) {
    if (doc == null || doc.defaultView == null) return false;
    const head = doc.head;
    if (!head) return false;
    const metas = head.getElementsByTagName("meta");
    for (let i = 0; i < metas.length; i++) {
      const m = metas[i];
      if (m.getAttribute("name") === PROJECTED_SKELETON_META_NAME && m.getAttribute("content") === "1") {
        return true;
      }
    }
    return false;
  }
  function whenProjectedStandardsReady(iframe, opts = {}) {
    const timeoutMs = opts.timeoutMs ?? PROJECTED_STANDARDS_READY_TIMEOUT_MS;
    const signal = opts.signal;
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer;
      let raf = 0;
      const settle = (fn) => {
        if (settled) return;
        settled = true;
        if (timer !== void 0) clearTimeout(timer);
        if (raf && typeof cancelAnimationFrame === "function") cancelAnimationFrame(raf);
        raf = 0;
        iframe.removeEventListener("load", onLoad);
        signal?.removeEventListener("abort", onAbort);
        fn();
      };
      const adopt = () => {
        const doc = iframe.contentDocument;
        if (!isProjectedStandardsSkeleton(doc)) return false;
        stripProjectedSkeleton(doc);
        settle(() => resolve(doc));
        return true;
      };
      const onLoad = () => {
        if (adopt()) return;
        if (iframe.srcdoc === PROJECTED_STANDARDS_SRCDOC) return;
        settle(
          () => reject(
            fault(
              "projected_standards_ready_invalid",
              "projected blank: load without stamped skeleton document"
            )
          )
        );
      };
      const onAbort = () => {
        settle(
          () => reject(
            fault(
              "projected_standards_ready_aborted",
              "projected blank: standards ready wait aborted"
            )
          )
        );
      };
      if (signal?.aborted) {
        onAbort();
        return;
      }
      if (adopt()) return;
      iframe.addEventListener("load", onLoad);
      signal?.addEventListener("abort", onAbort, { once: true });
      const poke = () => {
        if (settled) return;
        if (adopt()) return;
        if (typeof requestAnimationFrame === "function") {
          raf = requestAnimationFrame(poke);
        }
      };
      poke();
      timer = setTimeout(() => {
        settle(
          () => reject(
            fault(
              "projected_standards_ready_timeout",
              `projected blank: standards document not ready within ${timeoutMs}ms`
            )
          )
        );
      }, timeoutMs);
    });
  }

  // packages/page-projection/src/core/closedShadowLookup.ts
  var closedByHost = /* @__PURE__ */ new WeakMap();
  function registerClosedShadowRoot(host, root) {
    closedByHost.set(host, root);
  }
  function lookupClosedShadowRoot(host) {
    return closedByHost.get(host) ?? null;
  }
  function resolveShadowRoot(host) {
    const open = host.shadowRoot;
    if (open !== null) return open;
    return lookupClosedShadowRoot(host);
  }

  // packages/page-projection/src/projected/applyDom.ts
  var DomFrameApplier = class {
    queued = [];
    raf = null;
    doc;
    registry;
    options;
    table = new ReplicatedTable();
    propDirty = new FormPropDirty();
    sheets = /* @__PURE__ */ new Map();
    rules = /* @__PURE__ */ new Map();
    /** Sheet id → `hostNode` (0 = document adopted list). Survives phase-1 drop of the row. */
    sheetHost = /* @__PURE__ */ new Map();
    childScopes = /* @__PURE__ */ new Map();
    nestedHostIds = /* @__PURE__ */ new Set();
    paritySheet = null;
    applyingSequence = 0;
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
      applyFramesUntilDesync(batch, (frame) => {
        lastSequence = frame.sequence;
        return this.applyFrame(frame);
      });
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
      this.propDirty.reset();
      this.childScopes.clear();
      this.nestedHostIds.clear();
      this.clearCssom();
    }
    /**
     * End of this document install (runtime-redesign.md §7): a generation change destroys the
     * instance instead of enumerating what to clear. Everything the `tableHash` does not cover —
     * sheets, rules, parity sheet, prop-dirty, child scopes — dies with the object; only the
     * nested appliers the parent installed on our behalf need an explicit goodbye.
     */
    dispose() {
      if (this.raf != null) {
        cancelAnimationFrame(this.raf);
        this.raf = null;
      }
      this.queued = [];
      for (const childScopeId of this.childScopes.values()) {
        this.options.onNestedHostDrop?.(childScopeId);
      }
      this.childScopes.clear();
      this.nestedHostIds.clear();
    }
    /** Input plane marks this when the user is editing the control (§7.2). Unused in lab. */
    markPropDirty(id) {
      this.propDirty.mark(id);
    }
    /** Lab/diag — node id bound to a nested context on this applier. */
    nestedHostNodeForContext(contextId) {
      for (const [nodeId, ctx] of this.childScopes) {
        if (ctx === contextId) return nodeId;
      }
      return void 0;
    }
    /** Lab/diag — whether installNestedHost was triggered for this host row. */
    isNestedHostMarked(nodeId) {
      return this.nestedHostIds.has(nodeId);
    }
    /** iframe/object/embed rows materialized but not yet marked nested-host on this applier. */
    unmarkedNestedHostCandidateIds() {
      const out = [];
      this.registry.forEachId((id, node) => {
        if (this.nestedHostIds.has(id)) return;
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        const tag = node.localName.toLowerCase();
        if (tag !== "iframe" && tag !== "object" && tag !== "embed") return;
        out.push(id);
      });
      return out;
    }
    /** @returns `false` when a desync was reported — `flush` must not apply later frames in the batch. */
    applyFrame(frame) {
      this.applyingSequence = frame.sequence;
      const start = performance.now();
      if (!frame.resync && frame.preTableHash !== this.table.tableHash) {
        return this.fail("precondition", "preTableHash", frame.preTableHash, this.table.tableHash);
      }
      const result = applyFrameToTableChecked(this.table, frame.resync, frame.ops, frame.sequence);
      if (!result.ok) {
        if (result.opName === "check") {
          return this.fail("precondition", "check", result.expected, result.actual);
        }
        return this.failOp(result.reason, result.opName, result.id, result.message);
      }
      const documentBase = this.options.getDocumentBaseUrl?.() || this.options.documentBaseUrl || "";
      if (documentBase) ensureProjectedDocumentBase(this.doc, documentBase);
      for (let i = 0; i < frame.ops.length; i++) {
        const op = frame.ops[i];
        try {
          if (!this.applyOp(op)) return false;
        } catch (err) {
          const opLabel = op.op === 64 /* Insert */ ? `insert parent=${op.parent} before=${op.before} ids=[${op.ids.join(",")}]` : `op=${op.op}`;
          const errText = err instanceof Error ? `${err.name}: ${err.message}` : typeof err === "object" && err !== null && "name" in err ? `${String(err.name)}: ${String(err.message ?? err)}` : String(err);
          const message = `${errText} @op[${i}]=${op.op} ${opLabel}`;
          return this.failOp("malformed", "apply", "id" in op && typeof op.id === "number" ? op.id : 0, message);
        }
      }
      if (!this.cssomHandlesMatchTable()) return false;
      this.ensurePaintParity();
      this.options.onApplied?.(frame, performance.now() - start);
      return true;
    }
    fail(reason, opName, a, b) {
      if (typeof a === "bigint") {
        this.options.onDesync?.({
          reason,
          op: opName,
          id: 0,
          expected: a,
          actual: b,
          sequence: this.applyingSequence
        });
      } else {
        this.options.onDesync?.({ reason, op: opName, id: a, sequence: this.applyingSequence });
      }
      return false;
    }
    /** Phase-1 Pre / `MAX_ROWS` failures — `message` for diagnostics, explicit `phase`. */
    failOp(reason, opName, id, message) {
      this.options.onDesync?.({
        reason,
        op: opName,
        id,
        message,
        phase: "apply",
        sequence: this.applyingSequence
      });
      return false;
    }
    applyOp(op) {
      switch (op.op) {
        case 1 /* Check */:
          return true;
        // §4.1 — no DOM effect; already evaluated in phase 1
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
        case 99 /* PropSet */:
          return this.applyPropSet(op);
        case 160 /* SheetNew */:
          return this.applySheetNew(op);
        case 161 /* SheetDrop */:
          return this.applySheetDrop(op);
        case 162 /* SheetOrder */:
          return this.applySheetOrder(op);
        case 163 /* RuleNew */:
          return this.applyRuleNew(op);
        case 164 /* RuleDrop */:
          return this.applyRuleDrop(op);
        case 165 /* RuleSet */:
          return this.applyRuleSet(op);
        default:
          return true;
      }
    }
    clearCssom() {
      this.sheets.clear();
      this.rules.clear();
      this.sheetHost.clear();
      this.paritySheet = null;
      try {
        installScriptingOnPaintParity(this.doc);
        const sheet = paritySheetForDocument(this.doc);
        this.paritySheet = sheet ?? null;
        this.doc.adoptedStyleSheets = sheet != null ? [sheet] : [];
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        this.options.onWarn?.(`scriptingOnPaintParity: clearCssom failed: ${detail}`);
      }
    }
    /**
     * K5 CSP blocks page JS; hide `<noscript>` like Chromium with JS on.
     * Call after phase-2 materialize — `defaultView`/head can be gone mid-apply.
     */
    ensurePaintParity() {
      installScriptingOnPaintParity(this.doc);
      const sheet = paritySheetForDocument(this.doc);
      if (sheet != null) this.paritySheet = sheet;
      if (!paintParityInstalled(this.doc) && this.doc.documentElement != null) {
        this.options.onWarn?.(
          "scriptingOnPaintParity: install failed after apply (no adopted sheet and no style element)"
        );
      }
    }
    /**
     * After the frame: every table Sheet/Rule row must have a live handle in claimed sheet/order
     * (SEAL-CSSOM-P0-EOF / PP-CSSOM-A-3) — not sheet handles alone.
     */
    cssomHandlesMatchTable() {
      const tableSheetIds = allSheetIds(this.table);
      const liveSheetIdsPresent = /* @__PURE__ */ new Set();
      const tableRuleIdsBySheet = /* @__PURE__ */ new Map();
      const liveRuleIdsBySheet = /* @__PURE__ */ new Map();
      for (let i = 0; i < tableSheetIds.length; i++) {
        const sheetId = tableSheetIds[i];
        tableRuleIdsBySheet.set(sheetId, orderedRuleIds(this.table, sheetId));
        const sheet = this.sheets.get(sheetId);
        if (sheet === void 0) continue;
        liveSheetIdsPresent.add(sheetId);
        const liveRuleIds = [];
        for (let k = 0; k < sheet.cssRules.length; k++) {
          const live = sheet.cssRules.item(k);
          if (live === null) {
            return this.fail("address_miss", "ruleNew", sheetId);
          }
          let mapped;
          for (const [id, bound] of this.rules) {
            if (bound === live) {
              mapped = id;
              break;
            }
          }
          if (mapped === void 0) {
            return this.fail("address_miss", "ruleNew", sheetId);
          }
          liveRuleIds.push(mapped);
        }
        liveRuleIdsBySheet.set(sheetId, liveRuleIds);
      }
      const result = matchCssomEndOfFrame(
        tableSheetIds,
        tableRuleIdsBySheet,
        liveSheetIdsPresent,
        liveRuleIdsBySheet
      );
      if (!result.ok) return this.fail("address_miss", result.op, result.id);
      return true;
    }
    /** Iframe nodes fail `instanceof Element` from the parent realm — use this document's constructors. */
    isElement(node) {
      const view = this.doc.defaultView;
      return view !== null ? node instanceof view.Element : node.nodeType === Node.ELEMENT_NODE;
    }
    shadowRootOfHost(hostNode) {
      const node = this.registry.get(hostNode);
      if (!node) return null;
      if (this.isElement(node)) return node.shadowRoot;
      const view = this.doc.defaultView;
      if (view !== null && node instanceof view.ShadowRoot) return node;
      if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE && node.host != null) {
        return node;
      }
      const owned = this.table.shadowRootOf(hostNode);
      if (owned === 0) return null;
      const sr = this.registry.get(owned);
      if (!sr) return null;
      if (view !== null && sr instanceof view.ShadowRoot) return sr;
      if (sr.nodeType === Node.DOCUMENT_FRAGMENT_NODE) return sr;
      return null;
    }
    adoptedListOf(hostNode) {
      if (hostNode === 0) {
        try {
          return Array.from(this.doc.adoptedStyleSheets);
        } catch {
          return [];
        }
      }
      const root = this.shadowRootOfHost(hostNode);
      if (root == null) return [];
      try {
        return Array.from(root.adoptedStyleSheets);
      } catch {
        return [];
      }
    }
    setAdoptedOf(hostNode, next) {
      try {
        if (hostNode === 0) {
          this.doc.adoptedStyleSheets = withScriptingOnPaintParity(this.doc, next);
          return true;
        }
        const root = this.shadowRootOfHost(hostNode);
        if (root == null) {
          return this.fail("address_miss", "sheetNew", hostNode);
        }
        root.adoptedStyleSheets = next;
        return true;
      } catch {
        return this.fail("malformed", "sheetOrder", hostNode);
      }
    }
    adoptedList() {
      return this.adoptedListOf(0);
    }
    setAdopted(next) {
      return this.setAdoptedOf(0, next);
    }
    materializedSheetIdsOf(hostNode) {
      const list = this.adoptedListOf(hostNode);
      const ids = [];
      for (let i = 0; i < list.length; i++) {
        const sheet = list[i];
        for (const [id, bound] of this.sheets) {
          if (bound === sheet) {
            ids.push(id);
            break;
          }
        }
      }
      return ids;
    }
    materializedSheetIds() {
      return this.materializedSheetIdsOf(0);
    }
    applySheetNew(op) {
      const pierce = op.scope === CSSOM_SCOPE_PIERCE_HOST || op.hostNode !== 0;
      const hostNode = pierce ? op.hostNode : 0;
      if (pierce && this.shadowRootOfHost(hostNode) == null) {
        return this.fail("address_miss", "sheetNew", hostNode);
      }
      if (this.sheets.has(op.id)) return true;
      const view = this.doc.defaultView;
      if (view === null) return this.fail("bad_target", "sheetNew", op.id);
      let sheet;
      try {
        const init = constructedStyleSheetInit(
          this.options.getDocumentBaseUrl?.() || this.options.documentBaseUrl
        );
        sheet = init ? new view.CSSStyleSheet(init) : new view.CSSStyleSheet();
      } catch {
        return this.fail("malformed", "sheetNew", op.id);
      }
      const at = insertIndexFromBefore(this.materializedSheetIdsOf(hostNode), op.before);
      if (at < 0) return this.fail("address_miss", "sheetNew", op.before);
      const next = this.adoptedListOf(hostNode);
      next.splice(at, 0, sheet);
      if (!this.setAdoptedOf(hostNode, next)) return false;
      this.sheets.set(op.id, sheet);
      this.sheetHost.set(op.id, hostNode);
      return true;
    }
    applySheetDrop(op) {
      const dropByHost = /* @__PURE__ */ new Map();
      for (let i = 0; i < op.ids.length; i++) {
        const id = op.ids[i];
        const sheet = this.sheets.get(id);
        if (sheet === void 0) return this.fail("address_miss", "sheetDrop", id);
        const hostNode = this.sheetHost.get(id) ?? 0;
        let set = dropByHost.get(hostNode);
        if (set === void 0) {
          set = /* @__PURE__ */ new Set();
          dropByHost.set(hostNode, set);
        }
        set.add(sheet);
        for (const [ruleId, rule] of this.rules) {
          if (rule.parentStyleSheet === sheet) this.rules.delete(ruleId);
        }
        this.sheets.delete(id);
        this.sheetHost.delete(id);
      }
      for (const [hostNode, drop] of dropByHost) {
        const next = this.adoptedListOf(hostNode).filter((s) => !drop.has(s));
        if (!this.setAdoptedOf(hostNode, next)) return false;
      }
      return true;
    }
    applySheetOrder(op) {
      if (op.ids.length === 0) return true;
      const hostNode = this.sheetHost.get(op.ids[0]) ?? 0;
      const next = [];
      for (let i = 0; i < op.ids.length; i++) {
        const sheet = this.sheets.get(op.ids[i]);
        if (sheet === void 0) return this.fail("address_miss", "sheetOrder", op.ids[i]);
        next.push(sheet);
      }
      return this.setAdoptedOf(hostNode, next);
    }
    applyRuleNew(op) {
      const sheet = this.sheets.get(op.sheet);
      if (sheet === void 0) return this.fail("address_miss", "ruleNew", op.sheet);
      if (this.rules.has(op.id)) return this.fail("bad_target", "ruleNew", op.id);
      let index;
      if (op.before === INSERT_AT_END) {
        index = sheet.cssRules.length;
      } else {
        const beforeRule = this.rules.get(op.before);
        if (beforeRule === void 0) return this.fail("address_miss", "ruleNew", op.before);
        index = -1;
        for (let k = 0; k < sheet.cssRules.length; k++) {
          if (sheet.cssRules.item(k) === beforeRule) {
            index = k;
            break;
          }
        }
        if (index < 0) return this.fail("address_miss", "ruleNew", op.before);
      }
      let inserted;
      try {
        inserted = sheet.insertRule(this.options.stampCssText?.(op.text) ?? op.text, index);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        const text = (op.text || "").slice(0, 180);
        return this.failOp(
          "malformed",
          "ruleNew",
          op.id,
          `insertRule failed sheet=${op.sheet} before=${op.before}: ${detail} :: ${text}`
        );
      }
      const rule = sheet.cssRules.item(inserted);
      if (rule === null) return this.fail("address_miss", "ruleNew", op.id);
      this.rules.set(op.id, rule);
      return true;
    }
    applyRuleDrop(op) {
      const sheet = this.sheets.get(op.sheet);
      if (sheet === void 0) return this.fail("address_miss", "ruleDrop", op.sheet);
      for (let i = 0; i < op.ids.length; i++) {
        const id = op.ids[i];
        const rule = this.rules.get(id);
        if (rule === void 0) return this.fail("address_miss", "ruleDrop", id);
        let at = -1;
        for (let k = 0; k < sheet.cssRules.length; k++) {
          if (sheet.cssRules.item(k) === rule) {
            at = k;
            break;
          }
        }
        if (at < 0) return this.fail("address_miss", "ruleDrop", id);
        sheet.deleteRule(at);
        this.rules.delete(id);
      }
      return true;
    }
    applyRuleSet(op) {
      const rule = this.rules.get(op.id);
      if (rule === void 0) return this.fail("address_miss", "ruleSet", op.id);
      const view = this.doc.defaultView;
      const StyleRule = view !== null ? view.CSSStyleRule : void 0;
      const isStyle = StyleRule !== void 0 && rule instanceof StyleRule;
      if (planRuleSetApply(isStyle).mode === "desync") {
        return this.fail("bad_target", "ruleSet", op.id);
      }
      try {
        rule.style.cssText = declarationBlockFromRuleText(
          this.options.stampCssText?.(op.text) ?? op.text
        );
        return true;
      } catch {
        return this.fail("malformed", "ruleSet", op.id);
      }
    }
    /** §4.2 `NODE_DROP` `DOM` effect: "none — the subtree is already detached." Registry-only. */
    applyNodeDrop(op) {
      for (const hostId of [...this.childScopes.keys()]) {
        if (!this.table.has(hostId)) {
          const childScopeId = this.childScopes.get(hostId);
          this.childScopes.delete(hostId);
          this.nestedHostIds.delete(hostId);
          if (childScopeId !== void 0) this.options.onNestedHostDrop?.(childScopeId);
        }
      }
      for (let i = 0; i < op.ids.length; i++) {
        const id = op.ids[i];
        const node = this.registry.get(id);
        if (node !== void 0) this.registry.unregisterSubtree(node);
      }
      for (const id of [...this.sheets.keys()]) {
        if (this.table.has(id)) continue;
        const sheet = this.sheets.get(id);
        this.sheets.delete(id);
        this.sheetHost.delete(id);
        if (sheet === void 0) continue;
        for (const [ruleId, rule] of this.rules) {
          if (rule.parentStyleSheet === sheet) this.rules.delete(ruleId);
        }
      }
      return true;
    }
    applyNodeNew(op) {
      let node;
      if (op.kind === 1 /* Element */) {
        if (op.ns === 4 /* Custom */ && !(op.uri && op.uri.length > 0)) {
          return this.failOp("malformed", "nodeNew", op.id, "NODE_NEW Custom ns without uri");
        }
        const uri = elementNsUri(op.ns, op.uri);
        try {
          node = this.doc.createElementNS(uri, op.name);
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          return this.failOp(
            "malformed",
            "nodeNew",
            op.id,
            `createElementNS failed kind=${op.kind} name=${op.name} ns=${op.ns}: ${detail}`
          );
        }
        const attrs = op.nestedHost === true ? op.attrs.filter((a) => !isNestedHostNavAttr(a.name)) : op.attrs;
        if (!applyAttrs(node, attrs, this.options.stampUrl)) {
          const attrNames = attrs.map((a) => a.name).join(",");
          return this.failOp(
            "malformed",
            "nodeNew",
            op.id,
            `setAttribute failed on <${op.name}> attrs=[${attrNames}]`
          );
        }
        if (op.nestedHost === true && node.localName.toLowerCase() === "iframe") {
          const iframe = node;
          ensureNestedHostSandboxAccess(iframe);
          stampProjectedStandardsSrcdoc(iframe);
        }
        if (op.nestedHost === true && op.childScopeId != null) {
          this.childScopes.set(op.id, op.childScopeId);
          this.nestedHostIds.add(op.id);
        }
      } else if (op.kind === 2 /* Text */) {
        try {
          node = this.doc.createTextNode(op.value);
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          return this.failOp(
            "malformed",
            "nodeNew",
            op.id,
            `createTextNode failed len=${op.value?.length ?? -1}: ${detail}`
          );
        }
      } else if (op.kind === 3 /* Comment */) {
        try {
          node = this.doc.createComment(op.value);
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          return this.failOp(
            "malformed",
            "nodeNew",
            op.id,
            `createComment failed: ${detail}`
          );
        }
      } else if (op.kind === 6 /* Doctype */) {
        const want = op.name || "html";
        const existing = this.doc.doctype;
        if (existing && existing.name === want) {
          node = existing;
        } else {
          if (existing) existing.remove();
          const created = this.doc.implementation.createDocumentType(want, "", "");
          if (created == null) {
            return this.failOp(
              "malformed",
              "nodeNew",
              op.id,
              "createDocumentType returned null (document has no browsing context)"
            );
          }
          node = created;
        }
      } else if (op.kind === 7 /* ShadowRoot */) {
        const host = this.registry.get(op.host);
        if (!host || host.nodeType !== Node.ELEMENT_NODE) return this.fail("address_miss", "nodeNew", op.host);
        const el = host;
        if (el.shadowRoot) return this.fail("bad_target", "nodeNew", op.id);
        const init = { mode: op.mode === SHADOW_MODE_CLOSED ? "closed" : "open" };
        if ((op.initFlags & SHADOW_INIT_DELEGATES_FOCUS) !== 0) init.delegatesFocus = true;
        const extra = init;
        if ((op.initFlags & SHADOW_INIT_CLONABLE) !== 0) extra.clonable = true;
        if ((op.initFlags & SHADOW_INIT_SERIALIZABLE) !== 0) extra.serializable = true;
        try {
          node = el.attachShadow(init);
          if (init.mode === "closed") {
            registerClosedShadowRoot(el, node);
          }
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          return this.failOp(
            "malformed",
            "nodeNew",
            op.id,
            `attachShadow failed host=${op.host} mode=${op.mode} flags=${op.initFlags}: ${detail}`
          );
        }
      } else {
        return this.failOp(
          "malformed",
          "nodeNew",
          op.id,
          `NODE_NEW unsupported kind=${op.kind}`
        );
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
        if (isHtmlScriptElement(node)) {
          ensureProjectedK5Csp(this.doc);
          const documentBase = this.options.getDocumentBaseUrl?.() || this.options.documentBaseUrl || "";
          if (documentBase) ensureProjectedDocumentBase(this.doc, documentBase);
        }
        if (node.nodeType === Node.DOCUMENT_TYPE_NODE && parent === this.doc && this.doc.doctype === node) {
          continue;
        }
        parent.insertBefore(node, before);
        this.maybeInstallNestedHost(id, node);
      }
      this.pinDocumentBase();
      return true;
    }
    pinDocumentBase() {
      const documentBase = this.options.getDocumentBaseUrl?.() || this.options.documentBaseUrl || "";
      if (documentBase) ensureProjectedDocumentBase(this.doc, documentBase);
    }
    applyRemove(op) {
      const parent = this.registry.get(op.parent);
      if (!parent) return this.fail("address_miss", "remove", op.parent);
      for (let i = 0; i < op.ids.length; i++) {
        const id = op.ids[i];
        const node = this.registry.get(id);
        if (!node) return this.fail("address_miss", "remove", id);
        if (node.parentNode !== parent) {
          this.options.onDesync?.({
            reason: "bad_target",
            op: "remove",
            id,
            message: "REMOVE: node is not a child of the stated parent (phase 2 vs table)",
            phase: "apply"
          });
          return false;
        }
        parent.removeChild(node);
      }
      return true;
    }
    applyAttrSet(op) {
      const node = this.registry.get(op.node);
      if (!node || node.nodeType !== Node.ELEMENT_NODE) return this.fail("address_miss", "attrSet", op.node);
      if (isHtmlScriptElement(node) && op.attrs.some((a) => a.name === "src" && a.value.length > 0)) {
        ensureProjectedK5Csp(this.doc);
      }
      const attrs = this.nestedHostIds.has(op.node) ? op.attrs.filter((a) => !isNestedHostNavAttr(a.name)) : op.attrs;
      if (!applyAttrs(node, attrs, this.options.stampUrl)) {
        return this.fail("malformed", "attrSet", op.node);
      }
      if (this.nestedHostIds.has(op.node) && node.nodeType === Node.ELEMENT_NODE && node.localName.toLowerCase() === "iframe") {
        const iframe = node;
        ensureNestedHostSandboxAccess(iframe);
        stampProjectedStandardsSrcdoc(iframe);
      }
      this.maybeInstallNestedHost(op.node, node);
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
    applyPropSet(op) {
      if (this.propDirty.isDirty(op.node)) {
        this.propDirty.hold(op);
        return true;
      }
      const node = this.registry.get(op.node);
      if (!node || node.nodeType !== Node.ELEMENT_NODE) return this.fail("address_miss", "propSet", op.node);
      const el = node;
      if (op.propId === PROP_ID_VALUE && "value" in el) {
        el.value = String(op.value);
        return true;
      }
      if (op.propId === PROP_ID_CHECKED && "checked" in el) {
        el.checked = Boolean(op.value);
        return true;
      }
      if (op.propId === PROP_ID_SELECTED && el instanceof HTMLOptionElement) {
        el.selected = Boolean(op.value);
        return true;
      }
      return true;
    }
    /**
     * Arm nested apply when the row is a marked host. Stamp already happened on
     * NODE_NEW; wait for the skeleton **before** INSERT so `load` is not missed.
     * `contentWindow` is optional here — disconnected iframes have none yet.
     */
    maybeInstallNestedHost(id, node) {
      if (!this.nestedHostIds.has(id)) return;
      if (node.nodeType !== Node.ELEMENT_NODE || node.localName.toLowerCase() !== "iframe") {
        return;
      }
      const childScopeId = this.childScopes.get(id);
      if (childScopeId === void 0) return;
      this.options.onNestedHost?.(node, childScopeId);
    }
  };
  function isHtmlScriptElement(node) {
    return node.nodeType === Node.ELEMENT_NODE && node.localName === "script" && node.namespaceURI === "http://www.w3.org/1999/xhtml";
  }
  function applyAttrs(el, attrs, stampUrl) {
    return applyAttrPairs((name, value) => {
      const stamped = stampUrl ? stampUrl(name, value) : value;
      el.setAttribute(name, stamped);
    }, attrs);
  }

  // packages/page-projection/src/projected/pendingNestedHostAudit.ts
  function pendingNestedHostAuditMessage(pendingByContext, opts) {
    for (const [contextId, queueLen] of pendingByContext) {
      if (queueLen === 0) continue;
      if (opts.hasSession(contextId)) continue;
      const hostNodeId = opts.hostNodeForContext(contextId);
      if (hostNodeId === void 0) continue;
      if (!opts.isHostMarked(hostNodeId)) {
        return `pending nested frames ctx${contextId} host node ${hostNodeId} not marked (${queueLen} queued)`;
      }
      return `pending nested frames ctx${contextId} host node ${hostNodeId} never bound (${queueLen} queued)`;
    }
    return null;
  }

  // packages/page-projection/src/projected/input/projectedNativeGuard.ts
  function eventTargetElement(target) {
    if (!target || typeof target !== "object") return null;
    const node = target;
    if (node.nodeType === 1) return node;
    const parent = node.parentElement;
    return parent;
  }
  function isProjectedNavigable(target) {
    const el = eventTargetElement(target);
    if (el == null) return false;
    if (typeof el.closest !== "function") return false;
    return el.closest("a[href], area[href]") != null;
  }
  function suppressProjectedDefault(event) {
    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
  }
  function installProjectedTouchSurface(doc) {
    const touchAction = "manipulation";
    const root = doc.documentElement;
    if (root) root.style.touchAction = touchAction;
    if (doc.body) doc.body.style.touchAction = touchAction;
  }
  function attachProjectedNativeGuard(doc, opts) {
    installProjectedTouchSurface(doc);
    const onActivate = (event) => suppressProjectedDefault(event);
    const onPointerDown = (event) => {
      const pe = event;
      if (typeof pe.button === "number" && pe.button !== 0) return;
      if (isProjectedNavigable(event.target)) suppressProjectedDefault(event);
    };
    const onTouchStart = (_event) => {
      opts?.onTouchStartSeen?.();
    };
    const onTouchEnd = (event) => {
      if (isProjectedNavigable(event.target)) suppressProjectedDefault(event);
    };
    doc.addEventListener("click", onActivate, true);
    doc.addEventListener("auxclick", onActivate, true);
    doc.addEventListener("dblclick", onActivate, true);
    doc.addEventListener("submit", onActivate, true);
    doc.addEventListener("pointerdown", onPointerDown, true);
    doc.addEventListener("touchstart", onTouchStart, { capture: true, passive: true });
    doc.addEventListener("touchend", onTouchEnd, { capture: true, passive: false });
    return () => {
      doc.removeEventListener("click", onActivate, true);
      doc.removeEventListener("auxclick", onActivate, true);
      doc.removeEventListener("dblclick", onActivate, true);
      doc.removeEventListener("submit", onActivate, true);
      doc.removeEventListener("pointerdown", onPointerDown, true);
      doc.removeEventListener("touchstart", onTouchStart, true);
      doc.removeEventListener("touchend", onTouchEnd, true);
    };
  }

  // packages/page-projection/src/projected/nestedResyncSurface.ts
  function docOf(iframe) {
    const doc = iframe.contentDocument;
    if (!doc) throw new Error("nested surface: no contentDocument");
    return doc;
  }
  async function reseedHostDocument(iframe) {
    const live = iframe.contentDocument;
    if (isProjectedStandardsSkeleton(live)) {
      stripProjectedSkeleton(live);
      attachProjectedNativeGuard(live);
      return live;
    }
    stampProjectedStandardsSrcdoc(iframe);
    const doc = await whenProjectedStandardsReady(iframe);
    attachProjectedNativeGuard(doc);
    return doc;
  }
  function createNestedResyncSurface(primaryHost) {
    const primaryDoc = primaryHost.contentDocument;
    if (primaryDoc) attachProjectedNativeGuard(primaryDoc);
    let activeIframe = primaryHost;
    let standbyIframe = null;
    async function attachStandbySibling() {
      const parent = activeIframe.parentElement;
      if (!parent) throw new Error("nested surface: host has no parent");
      const iframe = document.createElement("iframe");
      iframe.title = "Nested projected resync build";
      iframe.style.cssText = activeIframe.style.cssText;
      iframe.style.visibility = "hidden";
      stampProjectedStandardsSrcdoc(iframe);
      parent.insertBefore(iframe, activeIframe.nextSibling);
      const doc = await whenProjectedStandardsReady(iframe);
      attachProjectedNativeGuard(doc);
      return iframe;
    }
    return {
      get document() {
        return docOf(activeIframe);
      },
      async beginResyncBuild() {
        if (standbyIframe !== null) standbyIframe.remove();
        standbyIframe = await attachStandbySibling();
        return docOf(standbyIframe);
      },
      commitSwap() {
        const built = standbyIframe;
        if (built === null) throw new Error("nested surface: commitSwap with no resync build");
        const outgoing = activeIframe;
        outgoing.style.visibility = "hidden";
        built.style.visibility = "";
        activeIframe = built;
        standbyIframe = null;
        if (outgoing !== primaryHost) outgoing.remove();
        return docOf(activeIframe);
      },
      discardBuild() {
        if (standbyIframe === null) return;
        standbyIframe.remove();
        standbyIframe = null;
      },
      async reset() {
        if (standbyIframe !== null) {
          standbyIframe.remove();
          standbyIframe = null;
        }
        if (activeIframe !== primaryHost) {
          activeIframe.remove();
          activeIframe = primaryHost;
        }
        await reseedHostDocument(activeIframe);
        activeIframe.style.visibility = "";
      }
    };
  }

  // packages/page-projection/src/projected/registry.ts
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
        cur = cur.parentNode ?? (cur.nodeType === Node.DOCUMENT_FRAGMENT_NODE && cur.host != null ? cur.host : null);
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
        if (node.nodeType === Node.ELEMENT_NODE) {
          const sr = resolveShadowRoot(node);
          if (sr) stack.push(sr);
        }
      }
    }
    /** Total registered ids — perf/soak signal. */
    get size() {
      return this.nodesById.size;
    }
    forEachId(fn) {
      for (const [id, node] of this.nodesById) fn(id, node);
    }
    /**
     * Drops every `id → node` entry. A new document install gets a brand-new registry instead
     * (runtime-redesign.md §7); this stays for callers that reuse one registry across a wholesale
     * replace, which re-register `DOCUMENT_ID` before any `NODE_NEW`/`INSERT` repopulates the rest.
     * Leaves the reverse `idsByNode` `WeakMap` alone — its entries key off
     * now-discarded nodes and fall out of scope for GC on their own; nothing reads a stale id back
     * out of it without first missing on `nodesById.get`, which this already empties.
     */
    clear() {
      this.nodesById.clear();
    }
  };

  // packages/page-projection/src/core/tableDigest.ts
  function digestReplicatedTable(table) {
    return { rowCount: table.size, tableHash: table.tableHash.toString() };
  }

  // packages/page-projection/src/core/telemetry.ts
  var TELEMETRY_WIRE_VERSION = 2;
  function desyncPhase(errorCode) {
    switch (errorCode) {
      case "malformed":
      case "unknown_version":
        return "decode";
      case "missing_part":
        return "assemble";
      case "sequence_gap":
        return "sequence";
      case "generation_mismatch":
        return "generation";
      default:
        return "apply";
    }
  }

  // packages/page-projection/src/projected/sessionBindingAuth.ts
  var SessionAuthQueryParam = "speculum-session-token";
  function isVirtualAssetUrl(url) {
    return url.startsWith("/w7s/virtual-") || url.includes("/virtual-");
  }
  function appendSessionAuth(url, token, assetBaseUrl = "") {
    if (!url || !token) return url;
    if (!isVirtualAssetUrl(url)) return url;
    const base = assetBaseUrl.replace(/\/$/, "");
    const absolute = url.startsWith("http") ? url : `${base}${url.startsWith("/") ? url : `/${url}`}`;
    return setReservedParam(absolute, SessionAuthQueryParam, token);
  }
  function setReservedParam(url, name, value) {
    const hashAt = url.indexOf("#");
    const fragment = hashAt >= 0 ? url.slice(hashAt) : "";
    const withoutFragment = hashAt >= 0 ? url.slice(0, hashAt) : url;
    const queryAt = withoutFragment.indexOf("?");
    const path = queryAt >= 0 ? withoutFragment.slice(0, queryAt) : withoutFragment;
    const rawQuery = queryAt >= 0 ? withoutFragment.slice(queryAt + 1) : "";
    const lowered = name.toLowerCase();
    const kept = rawQuery.split("&").filter((part) => part.length > 0).filter((part) => {
      const eq = part.indexOf("=");
      const key = eq >= 0 ? part.slice(0, eq) : part;
      return key.toLowerCase() !== lowered;
    });
    kept.push(`${name}=${encodeURIComponent(value)}`);
    return `${path}?${kept.join("&")}${fragment}`;
  }
  function stampSrcsetAuth(value, token, assetBaseUrl) {
    if (!token || !value) return value;
    return value.split(",").map((part) => {
      const trimmed = part.trim();
      if (!trimmed) return part;
      const bits = trimmed.split(/\s+/);
      const u = bits[0];
      const rest = bits.slice(1).join(" ");
      const stamped = appendSessionAuth(u, token, assetBaseUrl);
      return rest ? `${stamped} ${rest}` : stamped;
    }).join(", ");
  }
  function stampCssTextAuth(css, token, assetBaseUrl) {
    if (!token || !css) return css;
    let out = css.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (match, quote, raw) => {
      if (!isVirtualAssetUrl(raw)) return match;
      return `url(${quote}${appendSessionAuth(raw, token, assetBaseUrl)}${quote})`;
    });
    out = out.replace(/@import\s+(['"])([^'"]+)\1/gi, (match, quote, raw) => {
      if (!isVirtualAssetUrl(raw)) return match;
      return `@import ${quote}${appendSessionAuth(raw, token, assetBaseUrl)}${quote}`;
    });
    out = mapImageSetInners(
      out,
      (inner) => inner.replace(
        /(['"]?)(\/?w7s\/virtual-[^'")\s]+|https?:\/\/[^'")\s]*\/virtual-[^'")\s]+)\1/gi,
        (m, q, u) => {
          if (!isVirtualAssetUrl(u)) return m;
          return `${q}${appendSessionAuth(u, token, assetBaseUrl)}${q}`;
        }
      )
    );
    return out;
  }
  function mapImageSetInners(css, mapInner) {
    const needle = "image-set(";
    let out = "";
    let i = 0;
    const lower = css.toLowerCase();
    while (i < css.length) {
      const idx = lower.indexOf(needle, i);
      if (idx < 0) {
        out += css.slice(i);
        break;
      }
      out += css.slice(i, idx);
      const openKw = css.slice(idx, idx + needle.length);
      const start = idx + needle.length;
      let depth = 1;
      let j = start;
      while (j < css.length && depth > 0) {
        const c = css[j];
        if (c === "(") depth++;
        else if (c === ")") depth--;
        j++;
      }
      if (depth !== 0) {
        out += css.slice(idx);
        break;
      }
      const inner = css.slice(start, j - 1);
      out += `${openKw}${mapInner(inner)})`;
      i = j;
    }
    return out;
  }
  var URL_ATTR_STAMP = /* @__PURE__ */ new Set([
    "src",
    "href",
    "xlink:href",
    "data-src",
    "poster",
    "srcset",
    "imagesrcset",
    "style"
  ]);
  function stampAttrAuth(name, value, token, assetBaseUrl) {
    if (!token || !value) return value;
    const lower = name.toLowerCase();
    if (!URL_ATTR_STAMP.has(lower)) return value;
    if (lower === "srcset" || lower === "imagesrcset") {
      return stampSrcsetAuth(value, token, assetBaseUrl);
    }
    if (lower === "style") {
      return stampCssTextAuth(value, token, assetBaseUrl);
    }
    return appendSessionAuth(value, token, assetBaseUrl);
  }

  // packages/page-projection/src/projected/projectedApplyGate.ts
  var PROJECTED_APPLY_GATE_MAX_PENDING = 256;
  var PROJECTED_APPLY_GATE_MAX_OVERFLOW_STREAK = 3;
  var ProjectedApplyGate = class {
    flightDepth = 0;
    draining = false;
    pending = [];
    maxPending;
    onOverflow;
    onFlightEnd;
    flightStartMs = 0;
    maxDepth = 0;
    drained = 0;
    overflow = false;
    constructor(callbacks = {}) {
      this.maxPending = callbacks.maxPending ?? PROJECTED_APPLY_GATE_MAX_PENDING;
      this.onOverflow = callbacks.onOverflow;
      this.onFlightEnd = callbacks.onFlightEnd;
    }
    get blocked() {
      return this.flightDepth > 0 || this.draining;
    }
    begin() {
      if (this.flightDepth === 0) {
        this.flightStartMs = performance.now();
        this.maxDepth = this.pending.length;
        this.drained = 0;
        this.overflow = false;
      }
      this.flightDepth++;
    }
    push(frame) {
      if (this.pending.length >= this.maxPending) {
        this.overflow = true;
        const attemptedDepth = this.pending.length + 1;
        this.pending.length = 0;
        this.onOverflow?.({ cap: this.maxPending, attemptedDepth });
        return;
      }
      this.pending.push(frame);
      if (this.pending.length > this.maxDepth) {
        this.maxDepth = this.pending.length;
      }
    }
    /** Drop queued frames superseded by a generation bump — never apply stale headers. */
    discardPending() {
      this.pending.length = 0;
    }
    /** Full reset — client reset / dispose only. */
    clear() {
      this.flightDepth = 0;
      this.draining = false;
      this.pending.length = 0;
      this.flightStartMs = 0;
      this.maxDepth = 0;
      this.drained = 0;
      this.overflow = false;
    }
    finishFlight(drain) {
      if (this.flightDepth === 0) return;
      this.flightDepth--;
      if (this.flightDepth > 0) return;
      this.drainLoop(drain);
      if (this.flightStartMs > 0) {
        this.onFlightEnd?.({
          maxDepth: this.maxDepth,
          waitMs: performance.now() - this.flightStartMs,
          drained: this.drained,
          overflow: this.overflow
        });
      }
      this.flightStartMs = 0;
    }
    drainLoop(drain) {
      if (this.draining) return;
      this.draining = true;
      try {
        while (this.pending.length > 0 && this.flightDepth === 0) {
          const next = this.pending.shift();
          this.drained += 1;
          drain(next);
        }
      } finally {
        this.draining = false;
      }
      if (this.flightDepth === 0 && this.pending.length > 0) {
        this.drainLoop(drain);
      }
    }
  };

  // packages/page-projection/src/projected/nestedProjectedApply.ts
  var MAX_RESYNC_ATTEMPTS = 3;
  var RESYNC_BACKOFF_MS = 300;
  var RESYNC_RESPONSE_TIMEOUT_MS = 5e3;
  var NestedProjectedApply = class {
    contextId;
    hostIframe;
    surface;
    persistent = new PersistentStringTable();
    assembler = new FramePartAssembler();
    live;
    resync = null;
    resyncAttempts = 0;
    resyncExhausted = false;
    resyncBackoffTimer = null;
    resyncTimeoutTimer = null;
    generation = 1;
    lastSequence = 0;
    armed = false;
    everArmed = false;
    lastDesyncReason = null;
    lastDesyncMessage = null;
    surfaceEpoch = 0;
    applyGate;
    applyGateOverflowStreak = 0;
    onArmedCb;
    onNestedHostCb;
    onNestedHostDropCb;
    onTelemetry;
    onRequestResyncCb;
    getToken;
    getAssetBaseUrl;
    getDocumentBaseUrl;
    constructor(opts) {
      this.contextId = opts.contextId;
      this.hostIframe = opts.hostIframe;
      this.onArmedCb = opts.onArmed;
      this.onNestedHostCb = opts.onNestedHost;
      this.onNestedHostDropCb = opts.onNestedHostDrop;
      this.onTelemetry = opts.onTelemetry;
      this.onRequestResyncCb = opts.onRequestResync;
      this.getToken = opts.getToken;
      this.getAssetBaseUrl = opts.getAssetBaseUrl;
      this.getDocumentBaseUrl = opts.getDocumentBaseUrl;
      this.surface = createNestedResyncSurface(opts.hostIframe);
      const registry = new PageProjectionRegistry();
      registry.register(DOCUMENT_ID, opts.document);
      this.live = { applier: this.createApplier(opts.document, registry, true), registry };
      this.applyGate = new ProjectedApplyGate({
        onOverflow: (info) => this.handleApplyGateOverflow(info),
        onFlightEnd: (info) => this.handleApplyGateFlightEnd(info)
      });
    }
    get isArmed() {
      return this.armed;
    }
    get desynced() {
      return this.lastDesyncReason !== null;
    }
    get applyError() {
      if (this.lastDesyncReason === null) return null;
      return this.lastDesyncMessage ? `${this.lastDesyncReason} | ${this.lastDesyncMessage}` : this.lastDesyncReason;
    }
    get resyncInFlight() {
      return this.resync !== null;
    }
    getGeneration() {
      return this.generation;
    }
    get registry() {
      return this.live.registry;
    }
    markPropDirty(id) {
      this.live.applier.markPropDirty(id);
    }
    get document() {
      return this.surface.document;
    }
    ingest(bytes) {
      const decoded = decodeFramePart(bytes, this.persistent);
      if (!decoded.ok) {
        this.desync(decoded.reason, { message: decoded.message });
        return;
      }
      if (decoded.part.contextId !== this.contextId) return;
      const assembled = this.assembler.ingest(decoded.part);
      if (assembled === "missing_part" || assembled === "malformed") {
        this.desync(assembled);
        return;
      }
      if (assembled === null) return;
      this.applyAssembled(assembled);
      this.live.applier.flush();
      this.resync?.applier.flush();
    }
    flush() {
      this.live.applier.flush();
      this.resync?.applier.flush();
    }
    snapshotTable() {
      return {
        sequence: this.lastSequence,
        generation: this.generation,
        table: digestReplicatedTable(this.live.applier.replicatedTable)
      };
    }
    dispose() {
      this.abandonResyncAttempt();
      this.applyGate.clear();
      this.applyGateOverflowStreak = 0;
      void this.surface.reset();
      this.live.applier.dispose();
    }
    createApplier(doc, registry, initiallyLive) {
      const state = { swapped: initiallyLive };
      const token = () => this.getToken?.() || "";
      const base = () => this.getAssetBaseUrl?.() || "";
      return new DomFrameApplier(doc, registry, {
        stampUrl: (name, value) => stampAttrAuth(name, value, token(), base()),
        stampCssText: (text) => stampCssTextAuth(text, token(), base()),
        getDocumentBaseUrl: () => this.getDocumentBaseUrl?.() || "",
        onWarn: (message) => {
          this.onTelemetry?.({
            v: TELEMETRY_WIRE_VERSION,
            contextId: this.contextId,
            kind: "clientWarn",
            t: performance.now(),
            message
          });
        },
        onDesync: (info) => {
          if (state.swapped) {
            this.reportApplyResult({
              ok: false,
              sequence: this.lastSequence,
              opCount: 0,
              applyMs: 0,
              reason: info.reason
            });
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
        onNestedHost: (iframe, childScopeId) => this.onNestedHostCb?.(iframe, childScopeId),
        onNestedHostDrop: (childScopeId) => this.onNestedHostDropCb?.(childScopeId),
        onApplied: (frame, applyMs) => {
          if (state.swapped) {
            this.lastSequence = frame.sequence;
            this.reportApplyResult({ ok: true, sequence: frame.sequence, opCount: frame.ops.length, applyMs });
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
            v: TELEMETRY_WIRE_VERSION,
            contextId: this.contextId,
            kind: "applyOverrun",
            t: performance.now(),
            generation: this.generation,
            sequence: lastSequence,
            durationMs,
            budgetMs: 4
          });
        }
      });
    }
    applyAssembled(frame) {
      if (this.applyGate.blocked) {
        this.applyGate.push(frame);
        return;
      }
      this.applyAssembledNow(frame);
    }
    beginAsyncSurfaceApply(frame, run) {
      this.applyGate.begin();
      void run().finally(() => {
        this.applyGate.finishFlight((next) => this.applyAssembledNow(next));
      });
    }
    handleApplyGateOverflow(info) {
      this.applyGateOverflowStreak++;
      const streak = this.applyGateOverflowStreak;
      this.onTelemetry?.({
        v: TELEMETRY_WIRE_VERSION,
        contextId: this.contextId,
        kind: "applyGateOverflow",
        t: performance.now(),
        generation: this.generation,
        sequence: this.lastSequence,
        cap: info.cap,
        attemptedDepth: info.attemptedDepth,
        streak
      });
      if (streak >= PROJECTED_APPLY_GATE_MAX_OVERFLOW_STREAK) {
        this.resyncExhausted = true;
        this.onTelemetry?.({
          v: TELEMETRY_WIRE_VERSION,
          contextId: this.contextId,
          kind: "applyGateOverflowLoop",
          t: performance.now(),
          generation: this.generation,
          sequence: this.lastSequence,
          streak,
          cap: info.cap
        });
        this.desync("apply_gate_overflow_loop", { requestResync: false });
        return;
      }
      this.desync("apply_gate_overflow");
    }
    handleApplyGateFlightEnd(info) {
      if (info.drained > 0 && !info.overflow) {
        this.applyGateOverflowStreak = 0;
      }
      if (info.maxDepth === 0 && info.drained === 0 && !info.overflow) return;
      this.onTelemetry?.({
        v: TELEMETRY_WIRE_VERSION,
        contextId: this.contextId,
        kind: "applyGateDrain",
        t: performance.now(),
        generation: this.generation,
        sequence: this.lastSequence,
        maxDepth: info.maxDepth,
        waitMs: info.waitMs,
        drained: info.drained,
        overflow: info.overflow
      });
    }
    applyAssembledNow(frame) {
      if (frame.generation !== this.generation) {
        this.lastSequence = frame.sequence - 1;
        this.beginAsyncSurfaceApply(frame, () => this.recreateForGenerationAsync(frame));
        return;
      }
      if (frame.resync) {
        this.lastSequence = frame.sequence - 1;
        if (this.everArmed && frame.sequence === 1) {
          this.beginAsyncSurfaceApply(frame, () => this.recreateForGenerationAsync(frame));
          return;
        }
        if (this.everArmed) {
          this.beginAsyncSurfaceApply(frame, () => this.beginResyncTargetAsync(frame));
          return;
        }
      }
      if (!frame.resync && this.shouldHoldOrdinaryFrameWhileRecovering()) {
        return;
      }
      if (frame.sequence !== this.lastSequence + 1) {
        this.desync("sequence_gap", { expectedSequence: this.lastSequence + 1, gotSequence: frame.sequence });
        return;
      }
      this.lastSequence = frame.sequence;
      const target = this.resync ?? this.live;
      target.applier.enqueue(frame);
    }
    shouldHoldOrdinaryFrameWhileRecovering() {
      return this.lastDesyncReason !== null || this.resync !== null;
    }
    async recreateForGenerationAsync(frame) {
      if (frame.generation !== this.generation) {
        this.applyGate.discardPending();
      }
      this.abandonResyncAttempt();
      this.resyncAttempts = 0;
      this.resyncExhausted = false;
      this.generation = frame.generation;
      this.armed = false;
      this.everArmed = false;
      this.live.applier.dispose();
      const epoch = ++this.surfaceEpoch;
      await this.surface.reset();
      if (epoch !== this.surfaceEpoch) return;
      const registry = new PageProjectionRegistry();
      registry.register(DOCUMENT_ID, this.surface.document);
      this.live = { applier: this.createApplier(this.surface.document, registry, true), registry };
      if (frame.sequence !== this.lastSequence + 1) {
        this.desync("sequence_gap", { expectedSequence: this.lastSequence + 1, gotSequence: frame.sequence });
        return;
      }
      this.live.applier.enqueue(frame);
      this.live.applier.flush();
    }
    async beginResyncTargetAsync(frame) {
      if (this.resyncTimeoutTimer !== null) {
        clearTimeout(this.resyncTimeoutTimer);
        this.resyncTimeoutTimer = null;
      }
      if (this.resync !== null) {
        this.surface.discardBuild();
        this.resync = null;
      }
      const epoch = ++this.surfaceEpoch;
      const doc = await this.surface.beginResyncBuild();
      if (epoch !== this.surfaceEpoch) return;
      const registry = new PageProjectionRegistry();
      registry.register(DOCUMENT_ID, doc);
      const applier = this.createApplier(doc, registry, false);
      this.resync = { applier, registry, attempt: this.resyncAttempts };
      if (frame.sequence !== this.lastSequence + 1) {
        this.failResyncAttempt("sequence_gap");
        return;
      }
      applier.enqueue(frame);
      applier.flush();
    }
    commitResyncSwap(frame, applyMs) {
      const built = this.resync;
      if (built === null) return;
      this.surface.commitSwap();
      this.live = { applier: built.applier, registry: built.registry };
      this.resync = null;
      this.resyncAttempts = 0;
      this.resyncExhausted = false;
      this.lastDesyncReason = null;
      this.lastDesyncMessage = null;
      this.lastSequence = frame.sequence;
      this.onTelemetry?.({
        v: TELEMETRY_WIRE_VERSION,
        contextId: this.contextId,
        kind: "resyncCompleted",
        t: performance.now(),
        generation: this.generation,
        sequence: frame.sequence,
        attempt: built.attempt
      });
      this.reportApplyResult({ ok: true, sequence: frame.sequence, opCount: frame.ops.length, applyMs });
      if (!this.armed) {
        this.armed = true;
        this.everArmed = true;
        this.onArmedCb?.();
      }
    }
    failResyncAttempt(reason) {
      const attempt = this.resync?.attempt ?? this.resyncAttempts;
      if (this.resync !== null) {
        this.surface.discardBuild();
        this.resync = null;
      }
      this.onTelemetry?.({
        v: TELEMETRY_WIRE_VERSION,
        contextId: this.contextId,
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
    scheduleResyncAttempt(reason) {
      if (this.resyncExhausted) return;
      if (this.resyncBackoffTimer !== null || this.resyncTimeoutTimer !== null || this.resync !== null) return;
      const attempt = this.resyncAttempts + 1;
      if (attempt > MAX_RESYNC_ATTEMPTS) {
        this.resyncExhausted = true;
        this.onTelemetry?.({
          v: TELEMETRY_WIRE_VERSION,
          contextId: this.contextId,
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
          v: TELEMETRY_WIRE_VERSION,
          contextId: this.contextId,
          kind: "resyncRequested",
          t: performance.now(),
          generation: this.generation,
          sequence: this.lastSequence,
          reason,
          attempt
        });
        this.onRequestResyncCb?.({
          contextId: this.contextId,
          generation: this.generation,
          sequence: this.lastSequence,
          reason,
          attempt
        });
        this.resyncTimeoutTimer = setTimeout(() => {
          this.resyncTimeoutTimer = null;
          this.failResyncAttempt("resync_timeout");
        }, RESYNC_RESPONSE_TIMEOUT_MS);
      }, delay);
    }
    reportApplyResult(info) {
      this.onTelemetry?.({
        v: TELEMETRY_WIRE_VERSION,
        contextId: this.contextId,
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
      const firstInEpisode = this.lastDesyncReason === null;
      if (!firstInEpisode && reason === "precondition") {
        return;
      }
      if (firstInEpisode) {
        this.lastDesyncReason = extra?.op ? `${reason}:${extra.op}` : reason;
        this.lastDesyncMessage = extra?.message ?? null;
        this.assembler.reset();
        if (reason !== "sequence_gap") {
          this.armed = false;
          this.live.applier.reset();
        }
      }
      this.onTelemetry?.({
        v: TELEMETRY_WIRE_VERSION,
        contextId: this.contextId,
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
        expected: extra?.expected?.toString(),
        actual: extra?.actual?.toString()
      });
      if (extra?.requestResync === false) return;
      this.scheduleResyncAttempt(reason);
    }
  };

  // packages/page-projection/src/projected/surface.ts
  async function attachBareIframe(container) {
    const iframe = document.createElement("iframe");
    iframe.title = "Projected surface";
    iframe.style.cssText = "position:absolute;inset:0;width:100%;height:100%;border:0;background:#fff;touch-action:manipulation";
    stampProjectedStandardsSrcdoc(iframe);
    container.appendChild(iframe);
    await whenProjectedStandardsReady(iframe);
    return iframe;
  }
  function docOf2(iframe) {
    const doc = iframe.contentDocument;
    if (!doc) throw new Error("surface: no contentDocument");
    return doc;
  }
  async function createSurfaceHost(container, opts = { width: 1280, height: 720 }) {
    container.style.position = "relative";
    container.style.width = "100%";
    container.style.height = "100%";
    container.style.overflow = "hidden";
    container.replaceChildren();
    const stage = document.createElement("div");
    stage.setAttribute("data-pp-surface-stage", "");
    let cssW = Math.max(1, Math.round(opts.width));
    let cssH = Math.max(1, Math.round(opts.height));
    stage.style.cssText = `position:absolute;left:0;top:0;overflow:hidden;touch-action:manipulation;width:${cssW}px;height:${cssH}px`;
    container.appendChild(stage);
    let activeIframe = await attachBareIframe(stage);
    let standbyIframe = null;
    return {
      get document() {
        return docOf2(activeIframe);
      },
      async beginResyncBuild() {
        if (standbyIframe !== null) standbyIframe.remove();
        standbyIframe = await attachBareIframe(stage);
        standbyIframe.style.visibility = "hidden";
        return docOf2(standbyIframe);
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
        return docOf2(activeIframe);
      },
      discardBuild() {
        if (standbyIframe === null) return;
        standbyIframe.remove();
        standbyIframe = null;
      },
      async reset() {
        if (standbyIframe !== null) {
          standbyIframe.remove();
          standbyIframe = null;
        }
        stage.replaceChildren();
        activeIframe = await attachBareIframe(stage);
      },
      setCssSize(width, height) {
        cssW = Math.max(1, Math.round(width));
        cssH = Math.max(1, Math.round(height));
        stage.style.width = `${cssW}px`;
        stage.style.height = `${cssH}px`;
      },
      getCssSize() {
        return { width: cssW, height: cssH };
      }
    };
  }

  // packages/page-projection/src/projected/ProjectionClient.ts
  var MAX_RESYNC_ATTEMPTS2 = 3;
  var RESYNC_BACKOFF_MS2 = 300;
  var RESYNC_RESPONSE_TIMEOUT_MS2 = 5e3;
  var ProjectionClient = class _ProjectionClient {
    persistentStrings = new PersistentStringTable();
    assembler = new FramePartAssembler();
    surface;
    onTelemetry;
    onArmedCb;
    onDesyncCb;
    onRequestResyncCb;
    getToken;
    getAssetBaseUrl;
    getDocumentBaseUrl;
    token;
    assetBaseUrl;
    /** The currently-live target — reassigned wholesale on a successful resync swap. */
    live;
    /** Set only while a resync response is being built into the standby surface; `null` otherwise. */
    resync = null;
    resyncAttempts = 0;
    resyncExhausted = false;
    resyncBackoffTimer = null;
    resyncTimeoutTimer = null;
    lastSequence = 0;
    /** Highest sequence observed on the wire (including gate-queued / overflow-dropped). */
    highestSeenSequence = 0;
    /** Gate overflowed during a long rebuild — request another resync after swap, do not wipe live. */
    lagCatchUp = false;
    generation = 1;
    armed = false;
    /**
     * Stage 4 — distinguishes cold start from mid-session recovery. `resync: true` is not unique to
     * `emitResyncFrame`: bootstrap's own cold-start frame (`rebuildAndResync`) sets it too, for the
     * same reason (§2 — "no prior state to check against a wholesale replace", the *first* frame
     * has no prior state either). The double buffer exists to protect an already-good live surface
     * while a replacement is built off to the side; at cold start there is no live surface yet to
     * protect, so a resync-flagged frame is only routed into a standby build once this has been
     * `true` at least once — i.e. once the ordinary live target has actually shown something.
     */
    everArmed = false;
    /** Sticky until resetSurface — inject proofs must not lose the desync to a later resync. */
    lastDesyncReason = null;
    nested = /* @__PURE__ */ new Map();
    pendingNestedFrames = /* @__PURE__ */ new Map();
    /** contextId → host waiting for stamped srcdoc skeleton before nested apply binds. */
    nestedHostAwaitingLoad = /* @__PURE__ */ new Map();
    /** Supersedes in-flight async surface reset / resync standby birth. */
    surfaceEpoch = 0;
    /** Holds assembled frames while async recreate / resync build runs (apply overrun race). */
    applyGate;
    /** Consecutive apply-gate overflows — overflow→cold-resync can re-trigger itself. */
    applyGateOverflowStreak = 0;
    constructor(opts, surface) {
      this.surface = surface;
      this.onTelemetry = opts.onTelemetry;
      this.onArmedCb = opts.onArmed;
      this.onDesyncCb = opts.onDesync;
      this.onRequestResyncCb = opts.onRequestResync;
      this.getToken = opts.getToken;
      this.getAssetBaseUrl = opts.getAssetBaseUrl;
      this.getDocumentBaseUrl = opts.getDocumentBaseUrl;
      this.token = opts.token;
      this.assetBaseUrl = opts.assetBaseUrl;
      const registry = new PageProjectionRegistry();
      registry.register(DOCUMENT_ID, this.surface.document);
      this.live = { applier: this.createApplier(this.surface.document, registry, true), registry };
      this.applyGate = new ProjectedApplyGate({
        onOverflow: (info) => this.handleApplyGateOverflow(info),
        onFlightEnd: (info) => this.handleApplyGateFlightEnd(info)
      });
    }
    /** Composition-root entry — surface iframe is born with standards srcdoc before use. */
    static async create(opts) {
      const surface = await createSurfaceHost(opts.surfaceHost, {
        width: opts.width ?? 1280,
        height: opts.height ?? 720
      });
      return new _ProjectionClient(opts, surface);
    }
    installNestedHost(iframe, contextId) {
      const liveDoc = iframe.contentDocument;
      const existing = this.nested.get(contextId);
      if (existing) {
        try {
          if (existing.hostIframe === iframe && liveDoc != null && existing.registry.get(DOCUMENT_ID) === liveDoc && liveDoc.defaultView != null) {
            return;
          }
        } catch {
        }
        existing.dispose();
        this.nested.delete(contextId);
      }
      const pendingSameIframe = this.nestedHostAwaitingLoad.get(contextId);
      if (pendingSameIframe && pendingSameIframe.iframe === iframe) {
        return;
      }
      this.cancelPendingNestedHost(contextId);
      ensureNestedHostSandboxAccess(iframe);
      if (!isProjectedStandardsSkeleton(liveDoc) && iframe.srcdoc !== PROJECTED_STANDARDS_SRCDOC) {
        stampProjectedStandardsSrcdoc(iframe);
      }
      const abort = new AbortController();
      const pending = { iframe, abort };
      this.nestedHostAwaitingLoad.set(contextId, pending);
      void whenProjectedStandardsReady(iframe, { signal: abort.signal }).then((doc) => {
        if (this.nestedHostAwaitingLoad.get(contextId) !== pending) return;
        this.nestedHostAwaitingLoad.delete(contextId);
        if (abort.signal.aborted || !iframe.isConnected) return;
        if (iframe.contentDocument !== doc || doc.defaultView == null) {
          this.installNestedHost(iframe, contextId);
          return;
        }
        this.bindNestedHostSession(iframe, doc, contextId);
      }).catch((err) => {
        if (this.nestedHostAwaitingLoad.get(contextId) !== pending) return;
        this.nestedHostAwaitingLoad.delete(contextId);
        if (abort.signal.aborted) return;
        const errorCode = typeof err === "object" && err !== null && "errorCode" in err ? String(err.errorCode) : "projected_standards_ready_invalid";
        this.onTelemetry?.({
          kind: "nestedHostEstablishFailed",
          contextId,
          errorCode,
          message: err instanceof Error ? err.message : String(err)
        });
      });
    }
    bindNestedHostSession(iframe, doc, contextId) {
      const existing = this.nested.get(contextId);
      if (existing) {
        try {
          if (existing.hostIframe === iframe && existing.registry.get(DOCUMENT_ID) === doc) {
            return;
          }
        } catch {
        }
        existing.dispose();
        this.nested.delete(contextId);
      }
      const liveWin = iframe.contentWindow;
      if (!liveWin) return;
      const session = new NestedProjectedApply({
        hostIframe: iframe,
        document: doc,
        contextId,
        getToken: () => this.resolveToken(),
        getAssetBaseUrl: () => this.resolveAssetBaseUrl(),
        getDocumentBaseUrl: () => this.getDocumentBaseUrl?.() || "",
        onNestedHost: (childIframe, childScopeId) => this.installNestedHost(childIframe, childScopeId),
        onNestedHostDrop: (childScopeId) => this.dropNestedHost(childScopeId),
        onTelemetry: (msg) => this.onTelemetry?.(msg),
        onArmed: () => {
          try {
            liveWin.__speculumNestedApplyArmed = true;
          } catch {
          }
        },
        onRequestResync: (info) => this.onRequestResyncCb?.({
          generation: info.generation,
          sequence: info.sequence,
          reason: info.reason,
          contextId: info.contextId
        })
      });
      this.nested.set(contextId, session);
      const queued = this.pendingNestedFrames.get(contextId);
      if (queued) {
        this.pendingNestedFrames.delete(contextId);
        for (let i = 0; i < queued.length; i++) session.ingest(queued[i]);
      }
      session.flush();
    }
    cancelPendingNestedHost(contextId) {
      const pending = this.nestedHostAwaitingLoad.get(contextId);
      if (!pending) return;
      pending.abort.abort();
      this.nestedHostAwaitingLoad.delete(contextId);
    }
    dropNestedHost(contextId) {
      this.cancelPendingNestedHost(contextId);
      this.pendingNestedFrames.delete(contextId);
      const existing = this.nested.get(contextId);
      if (!existing) return;
      existing.dispose();
      this.nested.delete(contextId);
    }
    /**
     * Pending nested frames while the root surface is armed and the context is not bound —
     * host materialized without installNestedHost completing (silent divergence).
     */
    auditPendingNestedHostBindings(applier) {
      if (this.lastDesyncReason !== null || !this.armed) return;
      const pending = /* @__PURE__ */ new Map();
      for (const [contextId, queue] of this.pendingNestedFrames) {
        pending.set(contextId, queue.length);
      }
      const message = pendingNestedHostAuditMessage(pending, {
        hasSession: (contextId) => this.nested.has(contextId) || this.nestedHostAwaitingLoad.has(contextId),
        hostNodeForContext: (contextId) => applier.nestedHostNodeForContext(contextId),
        isHostMarked: (hostNodeId) => applier.isNestedHostMarked(hostNodeId)
      });
      if (message !== null) {
        this.desync("precondition", { phase: "apply", message });
      }
    }
    get isArmed() {
      return this.armed;
    }
    getGeneration() {
      return this.generation;
    }
    getLiveRegistry() {
      return this.live.registry;
    }
    markPropDirty(id) {
      this.live.applier.markPropDirty(id);
    }
    forEachNestedInputSurface(cb) {
      for (const [contextId, nested] of this.nested) {
        cb({
          contextId,
          surface: nested.hostIframe,
          registry: nested.registry,
          isArmed: () => nested.isArmed,
          getGeneration: () => nested.getGeneration(),
          markPropDirty: (id) => nested.markPropDirty(id)
        });
      }
    }
    /**
     * Last sequence accepted into the apply queue (may still be one `requestAnimationFrame` away
     * from actually hitting the DOM). Used by harness inject proofs and debug UIs.
     */
    get lastAcceptedSequence() {
      return this.lastSequence;
    }
    /**
     * Replay/capture harness only — devpath `projected-replay` when the file omits the first
     * resync frame (common on IPC captures). Same adoption rule as §5.8 resync / generation change.
     */
    adoptSequenceContext(nextSequence) {
      this.lastSequence = nextSequence - 1;
    }
    /** Surface's currently-*active* document — changes identity across a resync swap (Stage 4). */
    get document() {
      return this.surface.document;
    }
    /** Confirmed Virtual CSS size on the projected stage (lockstep). */
    setCssSize(width, height) {
      this.surface.setCssSize(width, height);
    }
    getCssSize() {
      return this.surface.getCssSize();
    }
    /** Digests of the live replicated table at the last applied sequence. */
    liveTableDigest() {
      return {
        sequence: this.lastSequence,
        generation: this.generation,
        table: digestReplicatedTable(this.live.applier.replicatedTable)
      };
    }
    /** Nested apply instance for harness / multi-context probes. */
    getNestedApply(contextId) {
      return this.nested.get(contextId);
    }
    /** Drain queued frames before a snapshot / inject. */
    flush() {
      this.live.applier.flush();
      this.resync?.applier.flush();
      for (const n of this.nested.values()) n.flush();
    }
    get desynced() {
      return this.lastDesyncReason !== null;
    }
    get applyError() {
      return this.lastDesyncReason;
    }
    /** Standby resync build in flight. */
    get resyncInFlight() {
      return this.resync !== null;
    }
    /** Empty the projected iframe and reset apply state. Does not touch Virtual. */
    async reset() {
      this.abandonResyncAttempt();
      this.resyncAttempts = 0;
      this.resyncExhausted = false;
      this.persistentStrings = new PersistentStringTable();
      this.assembler = new FramePartAssembler();
      this.lastSequence = 0;
      this.highestSeenSequence = 0;
      this.lagCatchUp = false;
      this.generation = 1;
      this.armed = false;
      this.everArmed = false;
      this.lastDesyncReason = null;
      for (const n of this.nested.values()) n.dispose();
      this.nested.clear();
      this.pendingNestedFrames.clear();
      for (const contextId of [...this.nestedHostAwaitingLoad.keys()]) {
        this.cancelPendingNestedHost(contextId);
      }
      this.applyGate.clear();
      this.applyGateOverflowStreak = 0;
      const epoch = ++this.surfaceEpoch;
      await this.surface.reset();
      if (epoch !== this.surfaceEpoch) return;
      const registry = new PageProjectionRegistry();
      registry.register(DOCUMENT_ID, this.surface.document);
      this.live = { applier: this.createApplier(this.surface.document, registry, true), registry };
    }
    ingest(bytes) {
      const hdr = peekFrameHeader(bytes);
      if (hdr && hdr.contextId !== CONTEXT_ID_ROOT && hdr.contextId !== 0) {
        const nested = this.nested.get(hdr.contextId);
        if (nested) {
          nested.ingest(bytes);
          return;
        }
        const q = this.pendingNestedFrames.get(hdr.contextId) ?? [];
        q.push(bytes.slice());
        this.pendingNestedFrames.set(hdr.contextId, q);
        return;
      }
      const decoded = decodeFramePart(bytes, this.persistentStrings);
      if (!decoded.ok) {
        this.desync(decoded.reason, { message: decoded.message });
        return;
      }
      const assembled = this.assembler.ingest(decoded.part);
      if (assembled === "missing_part" || assembled === "malformed") {
        this.desync(assembled);
        return;
      }
      if (assembled === null) return;
      this.applyAssembled(assembled);
    }
    applyAssembled(frame) {
      this.highestSeenSequence = Math.max(this.highestSeenSequence, frame.sequence);
      if (this.applyGate.blocked) {
        this.applyGate.push(frame);
        return;
      }
      this.applyAssembledNow(frame);
    }
    beginAsyncSurfaceApply(frame, run) {
      this.applyGate.begin();
      void run().finally(() => {
        this.applyGate.finishFlight((next) => this.applyAssembledNow(next));
      });
    }
    handleApplyGateOverflow(info) {
      this.applyGateOverflowStreak++;
      const streak = this.applyGateOverflowStreak;
      this.lagCatchUp = true;
      this.onTelemetry?.({
        v: TELEMETRY_WIRE_VERSION,
        contextId: CONTEXT_ID_ROOT,
        kind: "applyGateOverflow",
        t: performance.now(),
        generation: this.generation,
        sequence: this.lastSequence,
        cap: info.cap,
        attemptedDepth: info.attemptedDepth,
        streak
      });
      if (this.everArmed) {
        this.applyGateOverflowStreak = 0;
        return;
      }
      if (streak >= PROJECTED_APPLY_GATE_MAX_OVERFLOW_STREAK) {
        this.resyncExhausted = true;
        this.onTelemetry?.({
          v: TELEMETRY_WIRE_VERSION,
          contextId: CONTEXT_ID_ROOT,
          kind: "applyGateOverflowLoop",
          t: performance.now(),
          generation: this.generation,
          sequence: this.lastSequence,
          streak,
          cap: info.cap
        });
        this.desync("apply_gate_overflow_loop", { requestResync: false });
        return;
      }
      this.desync("apply_gate_overflow");
    }
    handleApplyGateFlightEnd(info) {
      if (info.drained > 0 && !info.overflow) {
        this.applyGateOverflowStreak = 0;
      }
      if (info.maxDepth === 0 && info.drained === 0 && !info.overflow) return;
      this.onTelemetry?.({
        v: TELEMETRY_WIRE_VERSION,
        contextId: CONTEXT_ID_ROOT,
        kind: "applyGateDrain",
        t: performance.now(),
        generation: this.generation,
        sequence: this.lastSequence,
        maxDepth: info.maxDepth,
        waitMs: info.waitMs,
        drained: info.drained,
        overflow: info.overflow
      });
    }
    applyAssembledNow(frame) {
      if (frame.generation !== this.generation) {
        this.lastSequence = frame.sequence - 1;
        this.beginAsyncSurfaceApply(frame, () => this.recreateForGenerationAsync(frame));
        return;
      }
      if (frame.resync) {
        this.lastSequence = frame.sequence - 1;
        if (this.everArmed && frame.sequence === 1) {
          this.beginAsyncSurfaceApply(frame, () => this.recreateForGenerationAsync(frame));
          return;
        }
        if (this.everArmed) {
          this.beginAsyncSurfaceApply(frame, () => this.beginResyncTargetAsync(frame));
          return;
        }
      }
      if (!frame.resync && this.shouldHoldOrdinaryFrameWhileRecovering()) {
        return;
      }
      if (frame.sequence !== this.lastSequence + 1) {
        this.desync("sequence_gap", { expectedSequence: this.lastSequence + 1, gotSequence: frame.sequence });
        return;
      }
      this.lastSequence = frame.sequence;
      const target = this.resync ?? this.live;
      target.applier.enqueue(frame);
    }
    /** Ordinary frames are dropped while the live table is corrupt — not for gap/lag catch-up. */
    shouldHoldOrdinaryFrameWhileRecovering() {
      if (this.resync !== null) return true;
      const reason = this.lastDesyncReason;
      if (reason === null) return false;
      if (reason === "sequence_gap" || reason === "lag") return false;
      return true;
    }
    /**
     * New document install (runtime-redesign.md §7): teardown by object lifetime. The previous
     * install's applier, registry, surface document and nested children are discarded, and the
     * client returns to its cold-start posture — the resync frame that carries the new generation
     * then builds the fresh live surface exactly like a first frame, instead of a standby build
     * racing a surface that no longer describes anything.
     */
    async recreateForGenerationAsync(frame) {
      if (frame.generation !== this.generation) {
        this.applyGate.discardPending();
      }
      this.abandonResyncAttempt();
      this.resyncAttempts = 0;
      this.resyncExhausted = false;
      this.generation = frame.generation;
      this.armed = false;
      this.everArmed = false;
      for (const contextId of [...this.nestedHostAwaitingLoad.keys()]) {
        this.cancelPendingNestedHost(contextId);
      }
      this.pendingNestedFrames.clear();
      this.live.applier.dispose();
      for (const n of this.nested.values()) n.dispose();
      this.nested.clear();
      const epoch = ++this.surfaceEpoch;
      await this.surface.reset();
      if (epoch !== this.surfaceEpoch) return;
      const registry = new PageProjectionRegistry();
      registry.register(DOCUMENT_ID, this.surface.document);
      this.live = { applier: this.createApplier(this.surface.document, registry, true), registry };
      if (frame.sequence !== this.lastSequence + 1) {
        this.desync("sequence_gap", { expectedSequence: this.lastSequence + 1, gotSequence: frame.sequence });
        return;
      }
      this.live.applier.enqueue(frame);
      this.live.applier.flush();
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
    resolveToken() {
      return this.getToken?.() || this.token || "";
    }
    resolveAssetBaseUrl() {
      return this.getAssetBaseUrl?.() || this.assetBaseUrl || "";
    }
    createApplier(doc, registry, initiallyLive) {
      const state = { swapped: initiallyLive };
      const applier = new DomFrameApplier(doc, registry, {
        stampUrl: (name, value) => stampAttrAuth(name, value, this.resolveToken(), this.resolveAssetBaseUrl()),
        stampCssText: (text) => stampCssTextAuth(text, this.resolveToken(), this.resolveAssetBaseUrl()),
        getDocumentBaseUrl: () => this.getDocumentBaseUrl?.() || "",
        onNestedHost: (iframe, childScopeId) => this.installNestedHost(iframe, childScopeId),
        onNestedHostDrop: (childScopeId) => this.dropNestedHost(childScopeId),
        onWarn: (message) => {
          this.onTelemetry?.({
            v: TELEMETRY_WIRE_VERSION,
            contextId: CONTEXT_ID_ROOT,
            kind: "clientWarn",
            t: performance.now(),
            message
          });
        },
        onDesync: (info) => {
          if (state.swapped) {
            this.reportApplyResult({
              ok: false,
              sequence: info.sequence ?? this.lastSequence,
              opCount: 0,
              applyMs: 0,
              reason: info.reason
            });
            this.desync(info.reason, {
              op: info.op,
              id: info.id,
              expected: info.expected,
              actual: info.actual,
              message: info.message,
              phase: info.phase
            });
          } else {
            this.failResyncAttempt(info.reason, {
              op: info.op,
              id: info.id,
              message: info.message,
              phase: info.phase,
              sequence: info.sequence
            });
          }
        },
        onApplied: (frame, applyMs) => {
          if (state.swapped) {
            this.lastSequence = frame.sequence;
            if (this.lastDesyncReason === "sequence_gap" || this.lastDesyncReason === "lag") {
              this.lastDesyncReason = null;
              this.lagCatchUp = false;
            }
            this.reportApplyResult({ ok: true, sequence: frame.sequence, opCount: frame.ops.length, applyMs });
            this.auditPendingNestedHostBindings(applier);
            if (!this.armed) this.notifyLiveSurfaceReady();
          } else {
            state.swapped = true;
            this.commitResyncSwap(frame, applyMs);
          }
        },
        onOverrun: (durationMs, lastSequence) => {
          this.onTelemetry?.({
            v: TELEMETRY_WIRE_VERSION,
            contextId: CONTEXT_ID_ROOT,
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
    async beginResyncTargetAsync(frame) {
      if (this.resyncTimeoutTimer !== null) {
        clearTimeout(this.resyncTimeoutTimer);
        this.resyncTimeoutTimer = null;
      }
      if (this.resync !== null) {
        this.surface.discardBuild();
        this.resync = null;
      }
      const epoch = ++this.surfaceEpoch;
      const doc = await this.surface.beginResyncBuild();
      if (epoch !== this.surfaceEpoch) return;
      const registry = new PageProjectionRegistry();
      registry.register(DOCUMENT_ID, doc);
      const applier = this.createApplier(doc, registry, false);
      this.resync = { applier, registry, attempt: this.resyncAttempts };
      if (frame.sequence !== this.lastSequence + 1) {
        this.failResyncAttempt("sequence_gap");
        return;
      }
      applier.enqueue(frame);
      applier.flush();
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
      this.lastDesyncReason = null;
      this.lastSequence = frame.sequence;
      this.onTelemetry?.({
        v: TELEMETRY_WIRE_VERSION,
        contextId: CONTEXT_ID_ROOT,
        kind: "resyncCompleted",
        t: performance.now(),
        generation: this.generation,
        sequence: frame.sequence,
        attempt: built.attempt
      });
      this.reportApplyResult({ ok: true, sequence: frame.sequence, opCount: frame.ops.length, applyMs });
      this.notifyLiveSurfaceReady();
      this.maybeRequestLagCatchUp();
    }
    /**
     * Producer kept ticking while a wholesale rebuild ran (or the apply gate overflowed). Live
     * surface still matches `lastSequence`; request another resync without wiping it.
     */
    maybeRequestLagCatchUp() {
      const behind = this.highestSeenSequence > this.lastSequence;
      if (!behind && !this.lagCatchUp) return;
      this.lagCatchUp = false;
      if (!behind) return;
      if (this.lastDesyncReason === null) {
        this.lastDesyncReason = "lag";
      }
      this.scheduleResyncAttempt("lag");
    }
    /** Live document is interactive (cold arm or post-swap). Idempotent armed flag; callback may re-fire. */
    notifyLiveSurfaceReady() {
      this.armed = true;
      this.everArmed = true;
      this.onArmedCb?.();
    }
    /**
     * A resync frame's own phase 1/2 failed (frame-protocol.md: "a resync frame whose closing CHECK
     * fails is a defect, not a recoverable state") or the producer never answered in time. Neither
     * touches the live surface — `this.live` is untouched, still showing whatever it showed before
     * this attempt, stale but not broken further. Retries (bounded) rather than giving up on one
     * failure, purely as defensive engineering against a transient blip, not because failure here
     * is expected to be routine.
     */
    failResyncAttempt(reason, detail) {
      const attempt = this.resync?.attempt ?? this.resyncAttempts;
      if (this.resync !== null) {
        this.surface.discardBuild();
        this.resync = null;
      }
      this.onTelemetry?.({
        v: TELEMETRY_WIRE_VERSION,
        contextId: CONTEXT_ID_ROOT,
        kind: "resyncFailed",
        t: performance.now(),
        generation: this.generation,
        sequence: detail?.sequence ?? this.lastSequence,
        attempt,
        reason,
        exhausted: false,
        op: detail?.op,
        id: detail?.id,
        message: detail?.message,
        phase: detail?.phase
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
    scheduleResyncAttempt(reason, contextId = CONTEXT_ID_ROOT) {
      if (this.resyncExhausted) return;
      if (this.resyncBackoffTimer !== null || this.resyncTimeoutTimer !== null || this.resync !== null) return;
      const attempt = this.resyncAttempts + 1;
      if (attempt > MAX_RESYNC_ATTEMPTS2) {
        this.resyncExhausted = true;
        this.onTelemetry?.({
          v: TELEMETRY_WIRE_VERSION,
          contextId,
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
      const delay = attempt === 1 ? 0 : RESYNC_BACKOFF_MS2 * (attempt - 1);
      this.resyncBackoffTimer = setTimeout(() => {
        this.resyncBackoffTimer = null;
        this.resyncAttempts = attempt;
        this.onTelemetry?.({
          v: TELEMETRY_WIRE_VERSION,
          contextId,
          kind: "resyncRequested",
          t: performance.now(),
          generation: this.generation,
          sequence: this.lastSequence,
          reason,
          attempt
        });
        this.onRequestResyncCb?.({
          generation: this.generation,
          sequence: this.lastSequence,
          reason,
          contextId,
          attempt
        });
        this.resyncTimeoutTimer = setTimeout(() => {
          this.resyncTimeoutTimer = null;
          this.failResyncAttempt("resync_timeout");
        }, RESYNC_RESPONSE_TIMEOUT_MS2);
      }, delay);
    }
    reportApplyResult(info) {
      this.onTelemetry?.({
        v: TELEMETRY_WIRE_VERSION,
        contextId: CONTEXT_ID_ROOT,
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
      const firstInEpisode = this.lastDesyncReason === null;
      if (!firstInEpisode && reason === "precondition") {
        return;
      }
      if (firstInEpisode) {
        this.lastDesyncReason = extra?.op ? `${reason}:${extra.op}` : reason;
        this.assembler.reset();
        if (reason !== "sequence_gap" && reason !== "lag") {
          this.armed = false;
          this.live.applier.reset();
        }
      }
      this.onTelemetry?.({
        v: TELEMETRY_WIRE_VERSION,
        contextId: CONTEXT_ID_ROOT,
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
      this.onDesyncCb?.(reason);
      if (extra?.requestResync === false) return;
      this.scheduleResyncAttempt(reason);
    }
  };
  async function createProjectionClient(opts) {
    return ProjectionClient.create(opts);
  }

  // gecko-engine/devpath/replay-entry.ts
  async function replayFrames(framesB64) {
    const host = document.body.appendChild(document.createElement("div"));
    host.style.cssText = "position:relative;width:1280px;height:720px";
    const errors = [];
    let applyOk = 0;
    let applyFail = 0;
    const client = await createProjectionClient({
      surfaceHost: host,
      onTelemetry: (m) => {
        const kind = m.kind;
        if (kind === "applyResult") {
          if (m.ok === true) applyOk += 1;
          else applyFail += 1;
        }
        if (kind === "desynced" || kind === "desync" || kind === "applyGateOverflow") {
          errors.push({ ...m });
        }
      }
    });
    let ingested = 0;
    let sequenceBootstrapped = false;
    for (const b64 of framesB64) {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      if (!sequenceBootstrapped) {
        const hdr = peekFrameHeader(bytes);
        if (hdr && hdr.sequence > 1 && !hdr.resync) {
          client.adoptSequenceContext(hdr.sequence);
        }
        sequenceBootstrapped = true;
      }
      client.ingest(bytes);
      client.flush();
      ingested++;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      if (client.desynced) break;
    }
    return {
      wire: framesB64.length,
      ingested,
      applyOk,
      applyFail,
      desynced: client.desynced,
      applyError: client.applyError,
      lastSeq: client.lastAcceptedSequence,
      generation: client.getGeneration(),
      armed: client.isArmed,
      bodyLen: client.document.body?.innerHTML?.length ?? 0,
      errors
    };
  }
  window.__speculumReplayFrames = replayFrames;
  window.SpeculumReplay = { replayFrames };
})();
