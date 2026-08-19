"use strict";
(() => {
  // browser/mirror/projection/models/elementNs.ts
  var ELEMENT_NS_HTML = "http://www.w3.org/1999/xhtml";
  var ELEMENT_NS_SVG = "http://www.w3.org/2000/svg";
  var ELEMENT_NS_MATHML = "http://www.w3.org/1998/Math/MathML";
  function classifyElementNs(namespaceURI) {
    if (namespaceURI === null) return { ns: 3 /* None */ };
    if (namespaceURI === ELEMENT_NS_HTML) return { ns: 0 /* Html */ };
    if (namespaceURI === ELEMENT_NS_SVG) return { ns: 1 /* Svg */ };
    if (namespaceURI === ELEMENT_NS_MATHML) return { ns: 2 /* Mathml */ };
    return { ns: 4 /* Custom */, uri: namespaceURI };
  }
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
  function elementNsSnapshotLabel(namespaceURI) {
    const { ns, uri } = classifyElementNs(namespaceURI);
    switch (ns) {
      case 0 /* Html */:
        return void 0;
      case 1 /* Svg */:
        return "svg";
      case 2 /* Mathml */:
        return "mathml";
      case 3 /* None */:
        return "none";
      case 4 /* Custom */:
        return uri;
    }
  }

  // browser/mirror/projection/models/propSet.ts
  var PROP_ID_VALUE = 1;
  var PROP_ID_CHECKED = 2;
  var PROP_ID_SELECTED = 3;
  var PROP_ID_DIALOG_MODAL = 4;
  var PROP_ID_POPOVER_OPEN = 5;
  var PROP_ID_MEDIA_PAUSED = 6;
  var PROP_ID_MEDIA_TIME = 7;
  var PROP_ID_MEDIA_MUTED = 8;
  var PROP_ID_MEDIA_VOLUME = 9;
  var PROP_ID_CUSTOM_VALIDITY = 10;
  function propValueKind(propId) {
    switch (propId) {
      case PROP_ID_VALUE:
      case PROP_ID_CUSTOM_VALIDITY:
        return "str";
      case PROP_ID_CHECKED:
      case PROP_ID_SELECTED:
      case PROP_ID_DIALOG_MODAL:
      case PROP_ID_POPOVER_OPEN:
      case PROP_ID_MEDIA_PAUSED:
      case PROP_ID_MEDIA_MUTED:
        return "bool";
      case PROP_ID_MEDIA_TIME:
      case PROP_ID_MEDIA_VOLUME:
        return "f32";
      default:
        return null;
    }
  }

  // browser/mirror/projection/models/frame.ts
  var FRAME_WIRE_VERSION = 2;
  var DOCUMENT_ID = 1;
  var INSERT_AT_END = 0;
  var SHADOW_MODE_OPEN = 0;
  var SHADOW_INIT_DELEGATES_FOCUS = 1;
  var SHADOW_INIT_CLONABLE = 2;
  var SHADOW_INIT_SERIALIZABLE = 4;
  var SHADOW_INIT_FLAGS_MASK = 7;
  var CHECK_SCOPE_TABLE = 0;
  var CHECK_SCOPE_RANGE = 1;
  var CSSOM_SCOPE_MAIN = 0;
  var CSSOM_SCOPE_PIERCE_HOST = 1;

  // browser/mirror/projection/models/limits.ts
  var MAX_STR_BYTES = 1 << 20;
  var MAX_ATTRS = 1024;
  var MAX_CHILDREN_PER_OP = 8192;
  var MAX_OPS_PER_FRAME = 65536;
  var MAX_ROWS = 2e5;

  // browser/mirror/projection/models/decode.ts
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
          const ns = r.u8();
          if (ns > 4 /* Custom */) {
            throw new Error(`NODE_NEW ns ${ns} out of range (frame-protocol.md \xA74.2)`);
          }
          let uri;
          if (ns === 4 /* Custom */) {
            uri = resolveStr(r.u32());
            if (uri.length === 0) {
              throw new Error("NODE_NEW custom ns empty uri (frame-protocol.md \xA74.2)");
            }
          }
          const name = resolveStr(r.u32());
          const attrs = decodeAttrs(r, resolveStr);
          return {
            op: 32 /* NodeNew */,
            id,
            kind: 1 /* Element */,
            ns,
            name,
            attrs,
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
          if (mode !== SHADOW_MODE_OPEN) {
            throw new Error(`NODE_NEW SHADOW_ROOT mode ${mode} is not open (frame-protocol.md \xA74.2)`);
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

  // browser/mirror/projection/models/applyBatch.ts
  function applyFramesUntilDesync(batch, applyOne) {
    for (let i = 0; i < batch.length; i++) {
      if (!applyOne(batch[i])) {
        return { lastIndex: i, stoppedEarly: true };
      }
    }
    return { lastIndex: batch.length - 1, stoppedEarly: false };
  }

  // browser/mirror/projection/models/formPropDirty.ts
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

  // browser/mirror/projection/models/attrApply.ts
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

  // browser/mirror/projection/models/cssomApplyIndex.ts
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

  // browser/mirror/projection/models/cssomRuleSet.ts
  function planRuleSetApply(isCssStyleRule) {
    if (isCssStyleRule) return { mode: "styleDeclarations" };
    return { mode: "desync" };
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

  // browser/mirror/projection/models/replicatedTable.ts
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
    /** Drops every row and derived index — `EPOCH_RESET` (§4.1) and resync's wholesale replace (§5.8). */
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
    collectSubtreeIds(id, out) {
      out.push(id);
      const seen = /* @__PURE__ */ new Set();
      let child = this.lastChildOf.get(id) ?? NONE;
      while (child !== NONE) {
        if (seen.has(child)) break;
        seen.add(child);
        this.collectSubtreeIds(child, out);
        const row = this.rows.get(child);
        child = row?.prevSibling ?? NONE;
      }
      const shadow = this.shadowRootByHost.get(id);
      if (shadow !== void 0 && shadow !== id) this.collectSubtreeIds(shadow, out);
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
        if (op.mode !== SHADOW_MODE_OPEN) {
          return failOp(
            i,
            "malformed",
            "nodeNew",
            op.id,
            "NODE_NEW SHADOW_ROOT mode must be 0 (open) (frame-protocol.md \xA74.2)"
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

  // browser/mirror/projection/client/applyDom.ts
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
      this.clearCssom();
    }
    /** Input plane marks this when the user is editing the control (§7.2). Unused in lab. */
    markPropDirty(id) {
      this.propDirty.mark(id);
    }
    /** @returns `false` when a desync was reported — `flush` must not apply later frames in the batch. */
    applyFrame(frame) {
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
      for (let i = 0; i < frame.ops.length; i++) {
        try {
          if (!this.applyOp(frame.ops[i])) return false;
        } catch {
          return this.fail("malformed", "apply", 0);
        }
      }
      if (!this.cssomHandlesMatchTable()) return false;
      this.options.onApplied?.(frame, performance.now() - start);
      return true;
    }
    fail(reason, opName, a, b) {
      if (typeof a === "bigint") {
        this.options.onDesync?.({ reason, op: opName, id: 0, expected: a, actual: b });
      } else {
        this.options.onDesync?.({ reason, op: opName, id: a });
      }
      return false;
    }
    /** Phase-1 Pre / `MAX_ROWS` failures — `message` for diagnostics, explicit `phase`. */
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
      this.propDirty.reset();
      this.clearCssom();
      return true;
    }
    clearCssom() {
      this.sheets.clear();
      this.rules.clear();
      this.sheetHost.clear();
      try {
        this.doc.adoptedStyleSheets = [];
      } catch {
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
          this.doc.adoptedStyleSheets = next;
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
        sheet = new view.CSSStyleSheet();
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
        inserted = sheet.insertRule(op.text, index);
      } catch {
        return this.fail("malformed", "ruleNew", op.id);
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
        rule.style.cssText = declarationBlockFromRuleText(op.text);
        return true;
      } catch {
        return this.fail("malformed", "ruleSet", op.id);
      }
    }
    /** §4.2 `NODE_DROP` `DOM` effect: "none — the subtree is already detached." Registry-only. */
    applyNodeDrop(op) {
      for (let i = 0; i < op.ids.length; i++) {
        const node = this.registry.get(op.ids[i]);
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
          return this.fail("malformed", "nodeNew", op.id);
        }
        const uri = elementNsUri(op.ns, op.uri);
        node = this.doc.createElementNS(uri, op.name);
        if (!applyAttrs(node, op.attrs)) {
          return this.fail("malformed", "nodeNew", op.id);
        }
      } else if (op.kind === 2 /* Text */) {
        node = this.doc.createTextNode(op.value);
      } else if (op.kind === 3 /* Comment */) {
        node = this.doc.createComment(op.value);
      } else if (op.kind === 6 /* Doctype */) {
        node = this.doc.implementation.createDocumentType(op.name || "html", "", "");
      } else if (op.kind === 7 /* ShadowRoot */) {
        const host = this.registry.get(op.host);
        if (!host || host.nodeType !== Node.ELEMENT_NODE) return this.fail("address_miss", "nodeNew", op.host);
        const el = host;
        if (el.shadowRoot) return this.fail("bad_target", "nodeNew", op.id);
        const init = { mode: "open" };
        if ((op.initFlags & SHADOW_INIT_DELEGATES_FOCUS) !== 0) init.delegatesFocus = true;
        const extra = init;
        if ((op.initFlags & SHADOW_INIT_CLONABLE) !== 0) extra.clonable = true;
        if ((op.initFlags & SHADOW_INIT_SERIALIZABLE) !== 0) extra.serializable = true;
        try {
          node = el.attachShadow(init);
        } catch {
          return this.fail("malformed", "nodeNew", op.id);
        }
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
      if (!applyAttrs(node, op.attrs)) {
        return this.fail("malformed", "attrSet", op.node);
      }
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
  };
  function applyAttrs(el, attrs) {
    return applyAttrPairs((name, value) => el.setAttribute(name, value), attrs);
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
          const sr = node.shadowRoot;
          if (sr) stack.push(sr);
        }
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
    iframe.style.cssText = "position:absolute;inset:0;width:100%;height:100%;border:0;background:#fff";
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
      },
      reset() {
        if (standbyIframe !== null) {
          standbyIframe.remove();
          standbyIframe = null;
        }
        container.replaceChildren();
        activeIframe = attachBareIframe(container);
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

  // browser/mirror/projection/models/telemetry.ts
  var LAB_TELEMETRY_DEFAULTS = {
    enabled: true,
    frameEmitted: true,
    transportDeferred: true,
    aggregate: true,
    applyResult: true,
    desync: true,
    applyOverrun: true,
    clock: true,
    cssomPoll: true,
    aggregateIntervalMs: 2e3
  };
  var TELEMETRY_BOOL_CAPS = [
    "enabled",
    "frameEmitted",
    "transportDeferred",
    "aggregate",
    "applyResult",
    "desync",
    "applyOverrun",
    "clock",
    "cssomPoll"
  ];
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
        generation: this.generation,
        table: digestReplicatedTable(this.live.applier.replicatedTable)
      };
    }
    /** Drain queued frames before a lab snapshot / inject. */
    flushNow() {
      this.live.applier.flush();
      this.resync?.applier.flush();
    }
    get desynced() {
      return this.lastDesyncReason !== null;
    }
    get applyError() {
      return this.lastDesyncReason;
    }
    /** Standby resync build in flight — lab inject must wait so the hostile frame hits live. */
    get resyncInFlight() {
      return this.resync !== null;
    }
    /**
     * Lab inject (SEAL-CSSOM-P0-EOF): extra live rule with no table row.
     * Honest producer never emits this; CHECK after this must desync at end-of-frame verify.
     * Only constructed/`adoptedStyleSheets` — author `document.styleSheets` is invisible to EOF verify.
     */
    tamperGhostCssRule() {
      const adopted = this.document.adoptedStyleSheets;
      const sheet = adopted.length > 0 ? adopted[adopted.length - 1] : void 0;
      if (!sheet) return { ok: false, reason: "tamper missed constructed sheet" };
      try {
        sheet.insertRule(".lab-ghost-eof{color:red}", 0);
        return { ok: true };
      } catch (err) {
        return { ok: false, reason: err instanceof Error ? err.message : String(err) };
      }
    }
    /** Lab UI: empty the projected iframe and reset apply state. Does not touch Virtual. */
    resetSurface() {
      this.abandonResyncAttempt();
      this.resyncAttempts = 0;
      this.resyncExhausted = false;
      this.persistentStrings = new PersistentStringTable();
      this.assembler = new FramePartAssembler();
      this.lastSequence = 0;
      this.generation = 1;
      this.armed = false;
      this.everArmed = false;
      this.lastDesyncReason = null;
      this.surface.reset();
      const registry = new PageProjectionRegistry();
      registry.register(DOCUMENT_ID, this.surface.document);
      this.live = { applier: this.createApplier(this.surface.document, registry, true), registry };
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
      if (this.lastDesyncReason === null) {
        this.lastDesyncReason = extra?.op ? `${reason}:${extra.op}` : reason;
      }
      this.armed = false;
      this.assembler.reset();
      this.live.applier.reset();
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
        const ns = elementNsSnapshotLabel(el.namespaceURI);
        if (ns !== void 0) result.ns = ns;
        if (attrs.length > 0) result.attrs = attrs;
        const children = mapChildren(node);
        if (children.length > 0) result.children = children;
        const sr = el.shadowRoot;
        if (sr !== null && sr.mode === "open" && sr.slotAssignment !== "manual") {
          const shadowKids = mapChildren(sr);
          result.shadow = { tag: "#shadow-root", ...shadowKids.length > 0 ? { children: shadowKids } : {} };
        }
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

  // browser/mirror/projection/client/formControlSnapshot.ts
  var SKIP_INPUT_TYPES = /* @__PURE__ */ new Set(["file", "button", "submit", "reset", "image"]);
  function snapshotFormControls(doc) {
    const out = [];
    const nodes = doc.querySelectorAll("input, textarea, option");
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i];
      const snap = snapshotOne(el);
      if (snap) out.push(snap);
    }
    out.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
    return out;
  }
  function snapshotOne(el) {
    const tag = el.tagName;
    if (tag === "TEXTAREA") {
      const key2 = el.id || null;
      if (!key2) return null;
      return { key: key2, value: el.value };
    }
    if (tag === "OPTION") {
      const select = el.closest("select");
      const selectId = select?.id || "";
      const value = el.value;
      if (!selectId && !value) return null;
      return { key: `option:${selectId}:${value}`, selected: el.selected };
    }
    if (tag !== "INPUT") return null;
    const input = el;
    const type = (input.type || "text").toLowerCase();
    if (SKIP_INPUT_TYPES.has(type)) return null;
    const key = el.id || null;
    if (!key) return null;
    if (type === "checkbox" || type === "radio") return { key, checked: input.checked };
    return { key, value: input.value };
  }

  // browser/mirror/projection/lab/client/main.ts
  function $(id) {
    const el = document.getElementById(id);
    if (!el) throw new Error(`#${id} missing`);
    return el;
  }
  function displayUrl(raw) {
    if (/^https?:\/\//i.test(raw)) return raw;
    const path = raw.replace(/^\/+/, "");
    return `${location.origin}/${path.startsWith("fixtures/") ? path : `fixtures/${path}`}`;
  }
  function shortDesc(text, max = 72) {
    const t = text.trim();
    return t.length <= max ? t : `${t.slice(0, max - 1)}\u2026`;
  }
  function probeCssomPaintBoundary(doc) {
    const authorEl = doc.getElementById("author-probe");
    const adoptedEl = doc.getElementById("adopted-probe");
    if (!authorEl || !adoptedEl) return null;
    const view = doc.defaultView;
    const authorColor = view ? view.getComputedStyle(authorEl).color : "";
    const adoptedColor = view ? view.getComputedStyle(adoptedEl).color : "";
    const adopted = doc.adoptedStyleSheets ? Array.from(doc.adoptedStyleSheets) : [];
    const styleEls = Array.from(doc.querySelectorAll("style"));
    const authorTexts = /* @__PURE__ */ new Set();
    const sheetText = (sheet) => {
      try {
        const parts = [];
        for (let i = 0; i < sheet.cssRules.length; i++) {
          const r = sheet.cssRules.item(i);
          if (r) parts.push(r.cssText);
        }
        return parts.join("\n");
      } catch {
        return "";
      }
    };
    for (let i = 0; i < styleEls.length; i++) {
      const el = styleEls[i];
      const sheet = el.sheet;
      if (sheet) authorTexts.add(sheetText(sheet));
      else if (el.textContent) authorTexts.add(el.textContent);
    }
    let doublePaint = false;
    for (let i = 0; i < adopted.length; i++) {
      const s = adopted[i];
      if (s.ownerNode) doublePaint = true;
      const text = sheetText(s);
      if (text.length > 0 && authorTexts.has(text)) doublePaint = true;
    }
    return {
      authorColor,
      adoptedColor,
      adoptedCount: adopted.length,
      styleSheetCount: doc.styleSheets.length,
      styleElCount: styleEls.length,
      doublePaint
    };
  }
  function logActivity(text) {
    const row = document.createElement("div");
    row.textContent = `${(/* @__PURE__ */ new Date()).toISOString().slice(11, 19)} ${text}`;
    const box = $("activity");
    box.prepend(row);
    while (box.childElementCount > 200) box.lastChild?.remove();
  }
  function readTelemetryFromUi() {
    const cfg = { ...LAB_TELEMETRY_DEFAULTS };
    for (const key of TELEMETRY_BOOL_CAPS) {
      const el = document.getElementById(`tel_${key}`);
      if (el) cfg[key] = el.checked;
    }
    const agg = document.getElementById("tel_aggregateIntervalMs");
    if (agg) cfg.aggregateIntervalMs = Number(agg.value) || 2e3;
    return cfg;
  }
  function setChip(id, text, kind) {
    const el = $(id);
    el.textContent = text;
    el.className = kind ? `chip ${kind}` : "chip";
    el.title = text;
    el.hidden = false;
  }
  function bootLabClient() {
    let ws = null;
    let projection = null;
    let mode = "browse";
    let runInFlight = false;
    let sessionLive = false;
    let sessionId = null;
    let phase = "idle";
    let frames = 0;
    let applyOk = 0;
    let desync = 0;
    let resyncCount = 0;
    let opsTotal = 0;
    const fixtureSelect = $("fixture");
    const urlInput = $("url");
    const blueprintSelect = $("blueprint");
    const soakOverrides = $("soakOverrides");
    const surfaceHost = $("surfaceHost");
    const surfaceWrap = $("surfaceWrap");
    const fixtureField = $("fixtureField");
    const blueprintField = $("blueprintField");
    const blueprintDesc = $("blueprintDesc");
    const urlLabel = $("urlLabel");
    const modeBlurb = $("modeBlurb");
    let blueprints = [];
    function setSurfaceEmpty(empty) {
      surfaceWrap.classList.toggle("is-empty", empty);
    }
    function measureHeader() {
      const h = $("labHeader").getBoundingClientRect().height;
      document.documentElement.style.setProperty("--hdr-h", `${Math.ceil(h)}px`);
    }
    function refreshStatus() {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        setChip("chipWs", "ws idle");
      } else {
        setChip("chipWs", "ws open", "ok");
      }
      const phaseText = phase === "idle" ? "idle" : phase === "connected" ? "connected \u2014 start Virtual or run" : phase === "live" ? `live ${mode}` : phase === "running" ? "run in flight" : phase === "complete" ? "run complete" : phase;
      const phaseKind = phase === "fault" ? "danger" : phase === "running" || phase === "live" ? "live" : phase === "complete" ? "ok" : "";
      setChip("chipPhase", phaseText, phaseKind);
      if (sessionId) {
        setChip("chipSession", `session ${sessionId.slice(0, 8)}\u2026`);
        $("chipSession").title = sessionId;
      } else {
        $("chipSession").hidden = true;
      }
    }
    function syncButtons() {
      const open = ws !== null && ws.readyState === WebSocket.OPEN;
      const connectBtn = $("connect");
      connectBtn.disabled = open;
      connectBtn.classList.toggle("primary", !open);
      $("disconnect").disabled = !open;
      $("browseStart").disabled = !open || mode !== "browse" || sessionLive || runInFlight;
      $("browseNavigate").disabled = !open || mode !== "browse" || !sessionLive || runInFlight;
      $("browseStop").disabled = !open || !sessionLive || mode !== "browse" || runInFlight;
      $("clearSurface").disabled = !open || runInFlight;
      $("runStart").disabled = !open || mode !== "run" || runInFlight;
      document.querySelectorAll("[data-mode]").forEach((btn) => {
        btn.disabled = runInFlight;
      });
      $("browseStart").classList.toggle("primary", open && mode === "browse" && !sessionLive);
      $("runStart").classList.toggle("primary", open && mode === "run" && !runInFlight);
      $("browseStart").title = !open ? "Connect first" : sessionLive ? "Virtual already live \u2014 Stop first" : "Cold-start Virtual at the URL";
      $("runStart").title = !open ? "Connect first" : runInFlight ? "Run in flight" : "Cold-boot blueprint DAG (URL comes from blueprint)";
      $("browseNavigate").title = sessionLive ? "Navigate live Virtual to the URL field" : "Start Virtual first";
      refreshStatus();
      measureHeader();
    }
    function selectedBlueprint() {
      return blueprints.find((b) => b.id === blueprintSelect.value);
    }
    function syncRunTarget() {
      const bp = selectedBlueprint();
      urlInput.value = bp?.defaultUrl ? displayUrl(bp.defaultUrl) : "";
      urlInput.readOnly = true;
      urlLabel.textContent = "Blueprint URL";
      urlInput.title = "Locked \u2014 comes from the selected blueprint";
      soakOverrides.hidden = !(bp?.acceptsSoakOverrides ?? false);
      blueprintDesc.hidden = !bp;
      blueprintDesc.textContent = bp ? bp.description : "";
    }
    function showMode(next) {
      if (runInFlight && next !== mode) return;
      mode = next;
      document.querySelectorAll("[data-mode]").forEach((btn) => {
        const on = btn.dataset.mode === next;
        btn.classList.toggle("active", on);
        btn.setAttribute("aria-selected", on ? "true" : "false");
      });
      $("browseControls").hidden = next !== "browse";
      $("runControls").hidden = next !== "run";
      fixtureField.hidden = next !== "browse";
      blueprintField.hidden = next !== "run";
      blueprintDesc.hidden = next !== "run";
      if (next === "browse") {
        modeBlurb.textContent = "Free navigation \u2014 pick a fixture or edit the URL, then Start Virtual.";
        urlInput.readOnly = false;
        urlLabel.textContent = "URL";
        urlInput.title = "Editable \u2014 free navigation target";
        if (fixtureSelect.value) {
          urlInput.value = `${location.origin}/fixtures/${fixtureSelect.value}`;
        }
      } else {
        modeBlurb.textContent = "Cold blueprint DAG \u2014 URL is locked to the blueprint; soak may override duration/probes.";
        syncRunTarget();
      }
      syncButtons();
    }
    function showTab(name) {
      $("panelStream").hidden = name !== "Stream";
      $("panelActivity").hidden = name !== "Activity";
      $("panelConfig").hidden = name !== "Config";
      $("panelProgress").hidden = name !== "Progress";
      document.querySelectorAll("[data-tab]").forEach((btn) => {
        const on = btn.dataset.tab === name;
        btn.classList.toggle("active", on);
        btn.setAttribute("aria-selected", on ? "true" : "false");
      });
    }
    function updateStream() {
      $("streamFrames").textContent = String(frames);
      $("streamApply").textContent = String(applyOk);
      $("streamDesync").textContent = String(desync);
      $("streamResync").textContent = String(resyncCount);
      $("streamOps").textContent = opsTotal > 0 ? String(opsTotal) : "\u2014";
      if (projection) {
        $("streamSeq").textContent = String(projection.lastAcceptedSequence);
      }
    }
    function resetStreamCounters() {
      frames = 0;
      applyOk = 0;
      desync = 0;
      resyncCount = 0;
      opsTotal = 0;
      $("streamGen").textContent = "\u2014";
      $("streamApplyMs").textContent = "\u2014";
      $("streamOps").textContent = "\u2014";
      updateStream();
    }
    function ensureProjection() {
      if (projection) return projection;
      projection = new LabProjectionClient({
        surfaceHost,
        onTelemetry: (msg) => {
          const m = msg;
          if (m.kind === "applyResult") {
            applyOk += 1;
            if (typeof m.generation === "number") $("streamGen").textContent = String(m.generation);
            if (typeof m.opCount === "number") {
              opsTotal += m.opCount;
              $("streamOps").textContent = String(m.opCount);
            }
            if (typeof m.applyMs === "number") $("streamApplyMs").textContent = m.applyMs.toFixed(1);
          }
          if (m.kind === "desynced" || m.kind === "desync") desync += 1;
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "client.telemetry", message: msg }));
          }
          updateStream();
        },
        onRequestResync: (info) => {
          resyncCount += 1;
          updateStream();
          logActivity(`resync requested reason=${info.reason}`);
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "client.requestResync", ...info }));
          }
        },
        onDesync: (reason) => {
          desync += 1;
          updateStream();
          logActivity(`desync ${reason}`);
        }
      });
      setSurfaceEmpty(false);
      return projection;
    }
    function appendProgress(msg) {
      const status = String(msg.status);
      const row = document.createElement("div");
      row.className = `tl-row ${status}`;
      const st = document.createElement("span");
      st.className = "tl-status";
      st.textContent = status;
      const id = document.createElement("span");
      id.className = "tl-id";
      id.textContent = String(msg.actionId);
      const q = document.createElement("span");
      q.className = "tl-queue";
      q.textContent = String(msg.queue);
      row.append(st, id, q);
      if (msg.detail) {
        const d = document.createElement("div");
        d.className = "tl-detail";
        d.textContent = String(msg.detail);
        row.append(d);
      }
      $("runTimeline").prepend(row);
    }
    function renderVerdictSummary(s) {
      const box = $("runVerdicts");
      box.innerHTML = "";
      for (const [k, v] of [
        ["pass", s.pass],
        ["fail", s.fail],
        ["skipped", s.skipped]
      ]) {
        const chip = document.createElement("span");
        chip.className = `verdict ${k}`;
        chip.textContent = `${k} ${v}`;
        box.appendChild(chip);
      }
    }
    async function loadFixtures() {
      try {
        const res = await fetch("/lab/fixtures");
        const list = await res.json();
        fixtureSelect.innerHTML = "";
        for (const f of list) {
          const opt = document.createElement("option");
          opt.value = f.path;
          opt.textContent = f.id;
          if (f.notes) opt.title = f.notes;
          fixtureSelect.appendChild(opt);
        }
        const demo = list.find((f) => f.id === "demo") ?? list[0];
        if (demo && mode === "browse") {
          fixtureSelect.value = demo.path;
          urlInput.value = `${location.origin}/fixtures/${demo.path}`;
        }
      } catch {
        if (mode === "browse") urlInput.value = `${location.origin}/fixtures/demo.html`;
      }
    }
    async function loadBlueprints() {
      try {
        const res = await fetch("/lab/blueprints");
        const data = await res.json();
        blueprints = data.blueprints;
        blueprintSelect.innerHTML = "";
        for (const bp of blueprints) {
          const opt = document.createElement("option");
          opt.value = bp.id;
          opt.textContent = `${bp.id} \u2014 ${shortDesc(bp.description, 48)}`;
          opt.title = bp.description;
          blueprintSelect.appendChild(opt);
        }
        if (blueprints.some((b) => b.id === "soak")) blueprintSelect.value = "soak";
      } catch {
        blueprints = [
          {
            id: "soak",
            description: "Timed soak",
            defaultUrl: "fixtures/demo.html",
            acceptsSoakOverrides: true
          }
        ];
        blueprintSelect.innerHTML = '<option value="soak">soak</option>';
      }
      if (mode === "run") syncRunTarget();
    }
    function connect() {
      if (ws) return;
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${location.host}/lab/session`);
      ws.binaryType = "arraybuffer";
      ws.addEventListener("open", () => {
        phase = "connected";
        logActivity("ws open");
        ws?.send(JSON.stringify({ type: "hello", protocolVersion: 1 }));
        syncButtons();
      });
      ws.addEventListener("close", () => {
        phase = "idle";
        sessionId = null;
        logActivity("ws close");
        ws = null;
        sessionLive = false;
        runInFlight = false;
        syncButtons();
      });
      ws.addEventListener("message", (ev) => {
        if (typeof ev.data !== "string") {
          const p = ensureProjection();
          p.ingest(new Uint8Array(ev.data));
          frames += 1;
          updateStream();
          return;
        }
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (msg.type === "requestSnapshot") {
          const p = ensureProjection();
          p.flushNow();
          const tree = snapshotTree(p.document);
          const tableSnap = p.snapshotTable();
          ws?.send(
            JSON.stringify({
              type: "client.snapshotResult",
              tree,
              table: tableSnap.table,
              sequence: tableSnap.sequence,
              generation: tableSnap.generation,
              desynced: p.desynced,
              applyError: p.applyError,
              armed: p.isArmed,
              resyncInFlight: p.resyncInFlight,
              cascade: probeCssomPaintBoundary(p.document),
              formProps: snapshotFormControls(p.document)
            })
          );
          return;
        }
        if (msg.type === "lab.injectFrame") {
          const p = ensureProjection();
          const b64 = typeof msg.bytes === "string" ? msg.bytes : "";
          try {
            const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
            p.ingest(bin);
            p.flushNow();
          } catch (err) {
            logActivity(`lab.injectFrame failed ${err instanceof Error ? err.message : String(err)}`);
          }
          const tableSnap = p.snapshotTable();
          logActivity(
            `lab.injectFrame seq=${tableSnap.sequence} desynced=${p.desynced} err=${p.applyError ?? "null"}`
          );
          ws?.send(
            JSON.stringify({
              type: "client.injectResult",
              sequence: tableSnap.sequence,
              generation: tableSnap.generation,
              desynced: p.desynced,
              applyError: p.applyError,
              tableHash: tableSnap.table.tableHash
            })
          );
          return;
        }
        if (msg.type === "lab.tamper") {
          const p = ensureProjection();
          p.flushNow();
          const r = p.tamperGhostCssRule();
          logActivity(`lab.tamper ghostRule ok=${r.ok}${r.reason ? ` ${r.reason}` : ""}`);
          ws?.send(
            JSON.stringify({
              type: "client.tamperResult",
              ok: r.ok,
              reason: r.reason ?? null
            })
          );
          return;
        }
        if (msg.type === "session.hello") {
          sessionId = String(msg.sessionId ?? "");
          logActivity(`session.hello ${sessionId}`);
          refreshStatus();
          return;
        }
        if (msg.type === "session.booted") {
          sessionLive = true;
          sessionId = String(msg.sessionId ?? sessionId ?? "");
          phase = "live";
          logActivity(`booted mode=${msg.mode} dossier=${msg.dossierDir}`);
          syncButtons();
          return;
        }
        if (msg.type === "session.stopped") {
          sessionLive = false;
          if (!runInFlight && phase !== "complete" && phase !== "fault") phase = "connected";
          logActivity(`stopped ${msg.reason}`);
          syncButtons();
          return;
        }
        if (msg.type === "session.fault") {
          phase = "fault";
          setChip("chipPhase", `fault ${msg.message}`, "danger");
          logActivity(`fault ${msg.message}`);
          sessionLive = false;
          runInFlight = false;
          syncButtons();
          return;
        }
        if (msg.type === "run.progress") {
          appendProgress(msg);
          return;
        }
        if (msg.type === "run.complete") {
          runInFlight = false;
          sessionLive = false;
          phase = "complete";
          const s = msg.verdictsSummary;
          renderVerdictSummary(s);
          $("runDossier").textContent = String(msg.dossierDir ?? "");
          $("progressHint").textContent = s.fail > 0 ? `Run finished with ${s.fail} fail(s).` : "Run finished \u2014 no fails in summary.";
          logActivity(`run.complete fail=${s.fail} ${msg.dossierDir}`);
          setChip(
            "chipPhase",
            s.fail > 0 ? `complete fail=${s.fail}` : `complete pass=${s.pass}`,
            s.fail > 0 ? "danger" : "ok"
          );
          syncButtons();
          return;
        }
        if (msg.type === "error") {
          logActivity(`error ${msg.message}`);
          phase = "fault";
          setChip("chipPhase", String(msg.message), "danger");
          runInFlight = false;
          syncButtons();
        }
      });
    }
    $("connect").addEventListener("click", () => connect());
    $("disconnect").addEventListener("click", () => {
      ws?.close();
      ws = null;
    });
    fixtureSelect.addEventListener("change", () => {
      if (mode !== "browse") return;
      urlInput.value = `${location.origin}/fixtures/${fixtureSelect.value}`;
    });
    blueprintSelect.addEventListener("change", () => {
      if (mode === "run") syncRunTarget();
    });
    document.querySelectorAll("[data-mode]").forEach((btn) => {
      btn.addEventListener("click", () => showMode(btn.dataset.mode ?? "browse"));
    });
    document.querySelectorAll("[data-tab]").forEach((btn) => {
      btn.addEventListener("click", () => showTab(btn.dataset.tab ?? "Stream"));
    });
    $("clearActivity").addEventListener("click", () => {
      $("activity").innerHTML = "";
    });
    $("browseStart").addEventListener("click", () => {
      const p = ensureProjection();
      p.resetSurface();
      resetStreamCounters();
      ws?.send(
        JSON.stringify({
          type: "browse.start",
          url: urlInput.value,
          frameRateHz: Number(document.getElementById("frameRateHz")?.value) || 60,
          telemetry: readTelemetryFromUi()
        })
      );
    });
    $("browseNavigate").addEventListener("click", () => {
      if (!sessionLive) return;
      ws?.send(JSON.stringify({ type: "browse.navigate", url: urlInput.value }));
      logActivity(`navigate ${urlInput.value}`);
    });
    $("browseStop").addEventListener("click", () => {
      ws?.send(JSON.stringify({ type: "browse.stop", exportDossier: true }));
    });
    $("clearSurface").addEventListener("click", () => {
      if (projection) {
        projection.resetSurface();
      } else {
        surfaceHost.innerHTML = "";
      }
      setSurfaceEmpty(true);
      resetStreamCounters();
      ws?.send(JSON.stringify({ type: "surface.clear" }));
    });
    $("runStart").addEventListener("click", () => {
      const p = ensureProjection();
      p.resetSurface();
      runInFlight = true;
      sessionLive = false;
      phase = "running";
      $("runTimeline").innerHTML = "";
      $("runVerdicts").innerHTML = "";
      $("runDossier").textContent = "";
      $("progressHint").textContent = "Run in flight\u2026";
      showTab("Progress");
      resetStreamCounters();
      syncButtons();
      const bp = selectedBlueprint();
      const overrides = {
        telemetry: readTelemetryFromUi()
      };
      if (bp?.acceptsSoakOverrides) {
        overrides.durationMs = Number(document.getElementById("runDurationMs")?.value) || 15e3;
        overrides.cpu = document.getElementById("runCpu")?.checked === true;
        overrides.iso = document.getElementById("runIso")?.checked === true;
      }
      ws?.send(
        JSON.stringify({
          type: "run.start",
          blueprintId: blueprintSelect.value || "soak",
          overrides
        })
      );
    });
    window.addEventListener("resize", measureHeader);
    void Promise.all([loadFixtures(), loadBlueprints()]).then(() => {
      showMode("browse");
      measureHeader();
    });
    showTab("Stream");
    refreshStatus();
    syncButtons();
  }
  bootLabClient();
})();
