"use strict";
(() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __esm = (fn, res) => function __init() {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  };
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));

  // ../packages/page-projection/dist/core/elementNs.js
  var require_elementNs = __commonJS({
    "../packages/page-projection/dist/core/elementNs.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.elementNsSnapshotLabel = exports.elementNsUri = exports.classifyElementNs = exports.ELEMENT_NS_MATHML = exports.ELEMENT_NS_SVG = exports.ELEMENT_NS_HTML = exports.resolveElementNestedHost = exports.assertNestedChildScopeId = exports.unpackElementNsWireByte = exports.packElementNsWireByte = exports.ELEMENT_NS_RESERVED_BITS = exports.ELEMENT_NS_NESTED_HOST_BIT = exports.ElementNs = void 0;
      var ElementNs;
      (function(ElementNs2) {
        ElementNs2[ElementNs2["Html"] = 0] = "Html";
        ElementNs2[ElementNs2["Svg"] = 1] = "Svg";
        ElementNs2[ElementNs2["Mathml"] = 2] = "Mathml";
        ElementNs2[ElementNs2["None"] = 3] = "None";
        ElementNs2[ElementNs2["Custom"] = 4] = "Custom";
      })(ElementNs || (exports.ElementNs = ElementNs = {}));
      exports.ELEMENT_NS_NESTED_HOST_BIT = 128;
      exports.ELEMENT_NS_RESERVED_BITS = 112;
      function packElementNsWireByte(ns, nestedHost) {
        if (ns > ElementNs.Custom) {
          throw new Error(`NODE_NEW ns ${ns} out of range (frame-protocol.md \xA74.2)`);
        }
        return (nestedHost ? exports.ELEMENT_NS_NESTED_HOST_BIT : 0) | ns;
      }
      exports.packElementNsWireByte = packElementNsWireByte;
      function unpackElementNsWireByte(byte) {
        if ((byte & exports.ELEMENT_NS_RESERVED_BITS) !== 0) {
          throw new Error(`NODE_NEW ns reserved bits 0x${(byte & exports.ELEMENT_NS_RESERVED_BITS).toString(16)} (frame-protocol.md \xA74.2)`);
        }
        const ns = byte & 15;
        if (ns > ElementNs.Custom) {
          throw new Error(`NODE_NEW ns ${ns} out of range (frame-protocol.md \xA74.2)`);
        }
        return { ns, nestedHost: (byte & exports.ELEMENT_NS_NESTED_HOST_BIT) !== 0 };
      }
      exports.unpackElementNsWireByte = unpackElementNsWireByte;
      function assertNestedChildScopeId(id) {
        if (!Number.isInteger(id) || id < 2 || id > 4294967295) {
          throw new Error(`NODE_NEW childScopeId ${id} is not a nested context (frame-protocol.md \xA74.2)`);
        }
      }
      exports.assertNestedChildScopeId = assertNestedChildScopeId;
      function resolveElementNestedHost(op) {
        const id = op.childScopeId ?? null;
        if (op.nestedHost === false && id != null) {
          throw new Error("NODE_NEW nestedHost=false with childScopeId (frame-protocol.md \xA74.2)");
        }
        if (op.nestedHost !== true && id == null)
          return { nestedHost: false, childScopeId: null };
        if (id == null) {
          throw new Error("NODE_NEW nestedHost without childScopeId (frame-protocol.md \xA74.2)");
        }
        assertNestedChildScopeId(id);
        return { nestedHost: true, childScopeId: id };
      }
      exports.resolveElementNestedHost = resolveElementNestedHost;
      exports.ELEMENT_NS_HTML = "http://www.w3.org/1999/xhtml";
      exports.ELEMENT_NS_SVG = "http://www.w3.org/2000/svg";
      exports.ELEMENT_NS_MATHML = "http://www.w3.org/1998/Math/MathML";
      function classifyElementNs(namespaceURI) {
        if (namespaceURI === null)
          return { ns: ElementNs.None };
        if (namespaceURI === exports.ELEMENT_NS_HTML)
          return { ns: ElementNs.Html };
        if (namespaceURI === exports.ELEMENT_NS_SVG)
          return { ns: ElementNs.Svg };
        if (namespaceURI === exports.ELEMENT_NS_MATHML)
          return { ns: ElementNs.Mathml };
        return { ns: ElementNs.Custom, uri: namespaceURI };
      }
      exports.classifyElementNs = classifyElementNs;
      function elementNsUri(ns, customUri) {
        switch (ns) {
          case ElementNs.Html:
            return exports.ELEMENT_NS_HTML;
          case ElementNs.Svg:
            return exports.ELEMENT_NS_SVG;
          case ElementNs.Mathml:
            return exports.ELEMENT_NS_MATHML;
          case ElementNs.None:
            return null;
          case ElementNs.Custom:
            return customUri ?? "";
        }
      }
      exports.elementNsUri = elementNsUri;
      function elementNsSnapshotLabel(namespaceURI) {
        const { ns, uri } = classifyElementNs(namespaceURI);
        switch (ns) {
          case ElementNs.Html:
            return void 0;
          case ElementNs.Svg:
            return "svg";
          case ElementNs.Mathml:
            return "mathml";
          case ElementNs.None:
            return "none";
          case ElementNs.Custom:
            return uri;
        }
      }
      exports.elementNsSnapshotLabel = elementNsSnapshotLabel;
    }
  });

  // ../packages/page-projection/dist/core/opcodes.js
  var require_opcodes = __commonJS({
    "../packages/page-projection/dist/core/opcodes.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.NodeKind = exports.opCodeName = exports.OpCode = void 0;
      var OpCode;
      (function(OpCode2) {
        OpCode2[OpCode2["Check"] = 1] = "Check";
        OpCode2[OpCode2["NodeNew"] = 32] = "NodeNew";
        OpCode2[OpCode2["NodeDrop"] = 33] = "NodeDrop";
        OpCode2[OpCode2["Insert"] = 64] = "Insert";
        OpCode2[OpCode2["Remove"] = 65] = "Remove";
        OpCode2[OpCode2["AttrSet"] = 96] = "AttrSet";
        OpCode2[OpCode2["AttrDel"] = 97] = "AttrDel";
        OpCode2[OpCode2["TextSet"] = 98] = "TextSet";
        OpCode2[OpCode2["PropSet"] = 99] = "PropSet";
        OpCode2[OpCode2["SheetNew"] = 160] = "SheetNew";
        OpCode2[OpCode2["SheetDrop"] = 161] = "SheetDrop";
        OpCode2[OpCode2["SheetOrder"] = 162] = "SheetOrder";
        OpCode2[OpCode2["RuleNew"] = 163] = "RuleNew";
        OpCode2[OpCode2["RuleDrop"] = 164] = "RuleDrop";
        OpCode2[OpCode2["RuleSet"] = 165] = "RuleSet";
      })(OpCode || (exports.OpCode = OpCode = {}));
      var NAMES = {
        [OpCode.Check]: "check",
        [OpCode.NodeNew]: "nodeNew",
        [OpCode.NodeDrop]: "nodeDrop",
        [OpCode.Insert]: "insert",
        [OpCode.Remove]: "remove",
        [OpCode.AttrSet]: "attrSet",
        [OpCode.AttrDel]: "attrDel",
        [OpCode.TextSet]: "textSet",
        [OpCode.PropSet]: "propSet",
        [OpCode.SheetNew]: "sheetNew",
        [OpCode.SheetDrop]: "sheetDrop",
        [OpCode.SheetOrder]: "sheetOrder",
        [OpCode.RuleNew]: "ruleNew",
        [OpCode.RuleDrop]: "ruleDrop",
        [OpCode.RuleSet]: "ruleSet"
      };
      function opCodeName(code) {
        return NAMES[code] ?? `unknown(${code})`;
      }
      exports.opCodeName = opCodeName;
      var NodeKind;
      (function(NodeKind2) {
        NodeKind2[NodeKind2["Element"] = 1] = "Element";
        NodeKind2[NodeKind2["Text"] = 2] = "Text";
        NodeKind2[NodeKind2["Comment"] = 3] = "Comment";
        NodeKind2[NodeKind2["Sheet"] = 4] = "Sheet";
        NodeKind2[NodeKind2["Rule"] = 5] = "Rule";
        NodeKind2[NodeKind2["Doctype"] = 6] = "Doctype";
        NodeKind2[NodeKind2["ShadowRoot"] = 7] = "ShadowRoot";
      })(NodeKind || (exports.NodeKind = NodeKind = {}));
    }
  });

  // ../packages/page-projection/dist/core/propSet.js
  var require_propSet = __commonJS({
    "../packages/page-projection/dist/core/propSet.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.propScalarsEqual = exports.propValueKind = exports.PROP_ID_SELECTED = exports.PROP_ID_CHECKED = exports.PROP_ID_VALUE = void 0;
      exports.PROP_ID_VALUE = 1;
      exports.PROP_ID_CHECKED = 2;
      exports.PROP_ID_SELECTED = 3;
      function propValueKind(propId) {
        switch (propId) {
          case exports.PROP_ID_VALUE:
            return "str";
          case exports.PROP_ID_CHECKED:
          case exports.PROP_ID_SELECTED:
            return "bool";
          default:
            return null;
        }
      }
      exports.propValueKind = propValueKind;
      function propScalarsEqual(a, b) {
        return a === b;
      }
      exports.propScalarsEqual = propScalarsEqual;
    }
  });

  // ../packages/page-projection/dist/core/frame.js
  var require_frame = __commonJS({
    "../packages/page-projection/dist/core/frame.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.spliceCssomBeforeCheck = exports.createFrame = exports.CSSOM_SCOPE_PIERCE_HOST = exports.CSSOM_SCOPE_MAIN = exports.CHECK_SCOPE_RANGE = exports.CHECK_SCOPE_TABLE = exports.SHADOW_INIT_FLAGS_MASK = exports.SHADOW_INIT_SERIALIZABLE = exports.SHADOW_INIT_CLONABLE = exports.SHADOW_INIT_DELEGATES_FOCUS = exports.SHADOW_MODE_CLOSED = exports.SHADOW_MODE_OPEN = exports.INSERT_AT_END = exports.CONTEXT_ID_ROOT = exports.DOCUMENT_ID = exports.FRAME_PREFIX_BYTES = exports.FRAME_WIRE_VERSION = exports.NodeKind = void 0;
      var opcodes_1 = require_opcodes();
      Object.defineProperty(exports, "NodeKind", { enumerable: true, get: function() {
        return opcodes_1.NodeKind;
      } });
      exports.FRAME_WIRE_VERSION = 2;
      exports.FRAME_PREFIX_BYTES = 2 + 1 + 1 + 4 + 4 + 4 + 2 + 2 + 8;
      exports.DOCUMENT_ID = 1;
      exports.CONTEXT_ID_ROOT = 1;
      exports.INSERT_AT_END = 0;
      exports.SHADOW_MODE_OPEN = 0;
      exports.SHADOW_MODE_CLOSED = 1;
      exports.SHADOW_INIT_DELEGATES_FOCUS = 1;
      exports.SHADOW_INIT_CLONABLE = 2;
      exports.SHADOW_INIT_SERIALIZABLE = 4;
      exports.SHADOW_INIT_FLAGS_MASK = 7;
      exports.CHECK_SCOPE_TABLE = 0;
      exports.CHECK_SCOPE_RANGE = 1;
      exports.CSSOM_SCOPE_MAIN = 0;
      exports.CSSOM_SCOPE_PIERCE_HOST = 1;
      function createFrame(args) {
        const contextId = args.contextId ?? exports.CONTEXT_ID_ROOT;
        if (contextId === 0)
          throw new Error("contextId 0 is invalid (frame-protocol.md \xA72)");
        return {
          version: exports.FRAME_WIRE_VERSION,
          flags: { resync: args.resync ?? false },
          contextId,
          generation: args.generation,
          sequence: args.sequence,
          preTableHash: args.preTableHash ?? 0n,
          ops: args.ops
        };
      }
      exports.createFrame = createFrame;
      function spliceCssomBeforeCheck(ops, cssom) {
        if (cssom.length === 0)
          return ops;
        const last = ops[ops.length - 1];
        if (last !== void 0 && last.op === opcodes_1.OpCode.Check) {
          return [...ops.slice(0, -1), ...cssom, last];
        }
        return [...ops, ...cssom];
      }
      exports.spliceCssomBeforeCheck = spliceCssomBeforeCheck;
    }
  });

  // ../packages/page-projection/dist/core/limits.js
  var require_limits = __commonJS({
    "../packages/page-projection/dist/core/limits.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.MAX_NODE_DROPS_PER_SWEEP = exports.NODE_DROP_AGE_SEQUENCES = exports.MAX_DIRTY_NODES = exports.MAX_ROWS = exports.MAX_OPS_PER_FRAME = exports.MAX_CHILDREN_PER_OP = exports.MAX_ATTRS = exports.MAX_STR_BYTES = void 0;
      exports.MAX_STR_BYTES = 1 << 20;
      exports.MAX_ATTRS = 1024;
      exports.MAX_CHILDREN_PER_OP = 8192;
      exports.MAX_OPS_PER_FRAME = 65536;
      exports.MAX_ROWS = 2e5;
      exports.MAX_DIRTY_NODES = 2e4;
      exports.NODE_DROP_AGE_SEQUENCES = 20;
      exports.MAX_NODE_DROPS_PER_SWEEP = 500;
    }
  });

  // ../packages/page-projection/dist/core/decode.js
  var require_decode = __commonJS({
    "../packages/page-projection/dist/core/decode.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.FramePartAssembler = exports.decodeFramePart = exports.PersistentStringTable = exports.peekFrameHeader = void 0;
      var elementNs_1 = require_elementNs();
      var opcodes_1 = require_opcodes();
      var propSet_1 = require_propSet();
      var frame_1 = require_frame();
      var limits_1 = require_limits();
      function peekFrameHeader3(bytes) {
        if (bytes.byteLength < frame_1.FRAME_PREFIX_BYTES)
          return null;
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        if (view.getUint16(0, true) !== 20560)
          return null;
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
      exports.peekFrameHeader = peekFrameHeader3;
      var WIRE_VERSION = frame_1.FRAME_WIRE_VERSION;
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
          if (len > limits_1.MAX_STR_BYTES) {
            throw new Error(`string byteLen ${len} exceeds MAX_STR_BYTES (${limits_1.MAX_STR_BYTES})`);
          }
          return textDecoder.decode(this.bytes_(len));
        }
      };
      var PersistentStringTable2 = class {
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
      exports.PersistentStringTable = PersistentStringTable2;
      function decodeFramePart2(input, persistent) {
        const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
        try {
          const r = new ByteReader(bytes);
          if (r.remaining < frame_1.FRAME_PREFIX_BYTES)
            return malformed("frame shorter than the fixed header");
          if (r.u16() !== WIRE_MAGIC)
            return malformed("bad magic");
          const version = r.u8();
          if (version !== WIRE_VERSION) {
            return { ok: false, reason: "unknown_version", message: `unsupported wire version ${version}` };
          }
          const flags = r.u8();
          const contextId = r.u32();
          if (contextId === 0)
            return malformed("contextId 0 is invalid");
          const generation = r.u32();
          const sequence = r.u32();
          const partIndex = r.u16();
          const partCount = r.u16();
          const preTableHash = r.u64();
          const strCount = r.u32();
          if (strCount > limits_1.MAX_OPS_PER_FRAME)
            return malformed(`strCount ${strCount} exceeds MAX_OPS_PER_FRAME`);
          const localStrings = new Array(strCount);
          for (let i = 0; i < strCount; i++)
            localStrings[i] = r.utf8(r.u32());
          const resolveStr = (ref) => {
            if ((ref & LOCAL_STR_BIT) !== 0)
              return localStrings[ref & 2147483647] ?? "";
            return persistent.resolve(ref) ?? "";
          };
          const opCount = r.u32();
          if (opCount > limits_1.MAX_OPS_PER_FRAME)
            return malformed(`opCount ${opCount} exceeds MAX_OPS_PER_FRAME`);
          const ops = new Array(opCount);
          for (let i = 0; i < opCount; i++) {
            const opCode = r.u8();
            const op = decodeOp(opCode, r, resolveStr, persistent);
            if (!op)
              return malformed(`unknown opcode ${opCode}`);
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
      exports.decodeFramePart = decodeFramePart2;
      function malformed(message) {
        return { ok: false, reason: "malformed", message };
      }
      function decodeAttrs(r, resolveStr) {
        const count = r.u16();
        if (count > limits_1.MAX_ATTRS)
          throw new Error(`attribute count ${count} exceeds MAX_ATTRS (${limits_1.MAX_ATTRS})`);
        const attrs = new Array(count);
        for (let i = 0; i < count; i++)
          attrs[i] = { name: resolveStr(r.u32()), value: resolveStr(r.u32()) };
        return attrs;
      }
      function checkChildCount(count) {
        if (count > limits_1.MAX_CHILDREN_PER_OP) {
          throw new Error(`child count ${count} exceeds MAX_CHILDREN_PER_OP (${limits_1.MAX_CHILDREN_PER_OP})`);
        }
      }
      function decodeOp(opCode, r, resolveStr, persistent) {
        switch (opCode) {
          case opcodes_1.OpCode.Check: {
            const scope = r.u8();
            const lo = r.u32();
            const hi = r.u32();
            const hash = r.u64();
            if (scope !== frame_1.CHECK_SCOPE_TABLE && scope !== frame_1.CHECK_SCOPE_RANGE)
              return null;
            return { op: opcodes_1.OpCode.Check, scope, lo, hi, hash };
          }
          case opcodes_1.OpCode.NodeDrop: {
            const count = r.u16();
            checkChildCount(count);
            const ids = new Array(count);
            for (let i = 0; i < count; i++)
              ids[i] = r.u32();
            return { op: opcodes_1.OpCode.NodeDrop, ids };
          }
          case opcodes_1.OpCode.NodeNew: {
            const id = r.u32();
            const kind = r.u8();
            if (kind === opcodes_1.NodeKind.Element) {
              const packed = (0, elementNs_1.unpackElementNsWireByte)(r.u8());
              let uri;
              if (packed.ns === elementNs_1.ElementNs.Custom) {
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
                (0, elementNs_1.assertNestedChildScopeId)(childScopeId);
                nestedHost = true;
              }
              return {
                op: opcodes_1.OpCode.NodeNew,
                id,
                kind: opcodes_1.NodeKind.Element,
                ns: packed.ns,
                name,
                attrs,
                nestedHost,
                childScopeId,
                ...uri !== void 0 ? { uri } : {}
              };
            }
            if (kind === opcodes_1.NodeKind.Doctype) {
              return { op: opcodes_1.OpCode.NodeNew, id, kind: opcodes_1.NodeKind.Doctype, name: resolveStr(r.u32()) };
            }
            if (kind === opcodes_1.NodeKind.Text || kind === opcodes_1.NodeKind.Comment) {
              return { op: opcodes_1.OpCode.NodeNew, id, kind, value: resolveStr(r.u32()) };
            }
            if (kind === opcodes_1.NodeKind.ShadowRoot) {
              const host = r.u32();
              const mode = r.u8();
              const initFlags = r.u8();
              if (mode !== frame_1.SHADOW_MODE_OPEN && mode !== frame_1.SHADOW_MODE_CLOSED) {
                throw new Error(`NODE_NEW SHADOW_ROOT mode ${mode} is invalid (frame-protocol.md \xA74.2)`);
              }
              if ((initFlags & ~frame_1.SHADOW_INIT_FLAGS_MASK) !== 0) {
                throw new Error(`NODE_NEW SHADOW_ROOT initFlags ${initFlags} has reserved bits (frame-protocol.md \xA74.2)`);
              }
              return { op: opcodes_1.OpCode.NodeNew, id, kind: opcodes_1.NodeKind.ShadowRoot, host, mode, initFlags };
            }
            throw new Error(`NODE_NEW kind ${kind} is not defined (frame-protocol.md \xA74.2)`);
          }
          case opcodes_1.OpCode.Insert: {
            const parent = r.u32();
            const before = r.u32();
            const count = r.u16();
            checkChildCount(count);
            const ids = new Array(count);
            for (let i = 0; i < count; i++)
              ids[i] = r.u32();
            return { op: opcodes_1.OpCode.Insert, parent, before: before === 0 ? frame_1.INSERT_AT_END : before, ids };
          }
          case opcodes_1.OpCode.Remove: {
            const parent = r.u32();
            const count = r.u16();
            checkChildCount(count);
            const ids = new Array(count);
            for (let i = 0; i < count; i++)
              ids[i] = r.u32();
            return { op: opcodes_1.OpCode.Remove, parent, ids };
          }
          case opcodes_1.OpCode.AttrSet: {
            const node = r.u32();
            const attrs = decodeAttrs(r, resolveStr);
            return { op: opcodes_1.OpCode.AttrSet, node, attrs };
          }
          case opcodes_1.OpCode.AttrDel: {
            const node = r.u32();
            const count = r.u16();
            if (count > limits_1.MAX_ATTRS)
              throw new Error(`attribute count ${count} exceeds MAX_ATTRS (${limits_1.MAX_ATTRS})`);
            const names = new Array(count);
            for (let i = 0; i < count; i++)
              names[i] = resolveStr(r.u32());
            return { op: opcodes_1.OpCode.AttrDel, node, names };
          }
          case opcodes_1.OpCode.TextSet: {
            const node = r.u32();
            return { op: opcodes_1.OpCode.TextSet, node, value: resolveStr(r.u32()) };
          }
          case opcodes_1.OpCode.PropSet: {
            const node = r.u32();
            const propId = r.u8();
            const kind = (0, propSet_1.propValueKind)(propId);
            if (kind === null) {
              throw new Error(`PROP_SET propId ${propId} is not defined (frame-protocol.md \xA74.4)`);
            }
            if (kind === "str") {
              return { op: opcodes_1.OpCode.PropSet, node, propId, value: resolveStr(r.u32()) };
            }
            if (kind === "bool") {
              const flag = r.u8();
              if (flag !== 0 && flag !== 1) {
                throw new Error(`PROP_SET bool operand ${flag} is not 0 or 1 (frame-protocol.md \xA74.4)`);
              }
              return { op: opcodes_1.OpCode.PropSet, node, propId, value: flag === 1 };
            }
            return { op: opcodes_1.OpCode.PropSet, node, propId, value: r.f32() };
          }
          case opcodes_1.OpCode.SheetNew: {
            const id = r.u32();
            const scope = r.u8();
            const hostNode = r.u32();
            const before = r.u32();
            if (scope !== frame_1.CSSOM_SCOPE_MAIN && scope !== frame_1.CSSOM_SCOPE_PIERCE_HOST)
              return null;
            return { op: opcodes_1.OpCode.SheetNew, id, scope, hostNode, before: before === 0 ? frame_1.INSERT_AT_END : before };
          }
          case opcodes_1.OpCode.SheetDrop: {
            const count = r.u16();
            checkChildCount(count);
            const ids = new Array(count);
            for (let i = 0; i < count; i++)
              ids[i] = r.u32();
            return { op: opcodes_1.OpCode.SheetDrop, ids };
          }
          case opcodes_1.OpCode.SheetOrder: {
            const count = r.u16();
            checkChildCount(count);
            const ids = new Array(count);
            for (let i = 0; i < count; i++)
              ids[i] = r.u32();
            return { op: opcodes_1.OpCode.SheetOrder, ids };
          }
          case opcodes_1.OpCode.RuleNew: {
            const sheet = r.u32();
            const id = r.u32();
            const before = r.u32();
            const text = resolveStr(r.u32());
            return { op: opcodes_1.OpCode.RuleNew, sheet, id, before: before === 0 ? frame_1.INSERT_AT_END : before, text };
          }
          case opcodes_1.OpCode.RuleDrop: {
            const sheet = r.u32();
            const count = r.u16();
            checkChildCount(count);
            const ids = new Array(count);
            for (let i = 0; i < count; i++)
              ids[i] = r.u32();
            return { op: opcodes_1.OpCode.RuleDrop, sheet, ids };
          }
          case opcodes_1.OpCode.RuleSet: {
            const id = r.u32();
            return { op: opcodes_1.OpCode.RuleSet, id, text: resolveStr(r.u32()) };
          }
          default:
            return null;
        }
      }
      var FramePartAssembler2 = class {
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
          if (!slot.parts[part.partIndex])
            slot.received += 1;
          slot.parts[part.partIndex] = part;
          if (part.partIndex !== part.partCount - 1)
            return null;
          this.pending.delete(key);
          if (slot.received !== part.partCount)
            return "missing_part";
          const assembled = assemble(part, slot.parts);
          if (assembled === "malformed")
            return "malformed";
          return assembled;
        }
        /** Drops every in-flight partial assembly (desync / generation bump). */
        reset() {
          this.pending.clear();
        }
      };
      exports.FramePartAssembler = FramePartAssembler2;
      function assemble(last, parts) {
        const ops = [];
        for (const part of parts) {
          if (part.contextId !== last.contextId)
            return "malformed";
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
    }
  });

  // ../packages/page-projection/dist/core/applyBatch.js
  var require_applyBatch = __commonJS({
    "../packages/page-projection/dist/core/applyBatch.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.applyFramesUntilDesync = void 0;
      function applyFramesUntilDesync(batch, applyOne) {
        for (let i = 0; i < batch.length; i++) {
          if (!applyOne(batch[i])) {
            return { lastIndex: i, stoppedEarly: true };
          }
        }
        return { lastIndex: batch.length - 1, stoppedEarly: false };
      }
      exports.applyFramesUntilDesync = applyFramesUntilDesync;
    }
  });

  // ../packages/page-projection/dist/core/formPropDirty.js
  var require_formPropDirty = __commonJS({
    "../packages/page-projection/dist/core/formPropDirty.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.FormPropDirty = void 0;
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
      exports.FormPropDirty = FormPropDirty;
    }
  });

  // ../packages/page-projection/dist/core/attrApply.js
  var require_attrApply = __commonJS({
    "../packages/page-projection/dist/core/attrApply.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.applyAttrPairs = void 0;
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
      exports.applyAttrPairs = applyAttrPairs;
    }
  });

  // ../packages/page-projection/dist/core/cssomApplyIndex.js
  var require_cssomApplyIndex = __commonJS({
    "../packages/page-projection/dist/core/cssomApplyIndex.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.declarationBlockFromRuleText = exports.insertIndexFromBefore = exports.matchCssomEndOfFrame = exports.orderedRuleIds = exports.allSheetIds = exports.orderedSheetIds = void 0;
      var frame_1 = require_frame();
      var opcodes_1 = require_opcodes();
      function orderedSheetIds(table, parent = frame_1.DOCUMENT_ID) {
        const all = table.orderedChildIds(parent);
        const out = [];
        for (let i = 0; i < all.length; i++) {
          const id = all[i];
          const row = table.getRow(id);
          if (row !== void 0 && row.kind === opcodes_1.NodeKind.Sheet)
            out.push(id);
        }
        return out;
      }
      exports.orderedSheetIds = orderedSheetIds;
      function allSheetIds(table) {
        const parents = [frame_1.DOCUMENT_ID];
        const seen = /* @__PURE__ */ new Set([frame_1.DOCUMENT_ID]);
        table.forEachRow((_id, row) => {
          if (row.kind !== opcodes_1.NodeKind.Sheet)
            return;
          const parent = row.parent === 0 ? frame_1.DOCUMENT_ID : row.parent;
          if (!seen.has(parent)) {
            seen.add(parent);
            parents.push(parent);
          }
        });
        const out = [];
        for (let i = 0; i < parents.length; i++)
          out.push(...orderedSheetIds(table, parents[i]));
        return out;
      }
      exports.allSheetIds = allSheetIds;
      function orderedRuleIds(table, sheetId) {
        const all = table.orderedChildIds(sheetId);
        const out = [];
        for (let i = 0; i < all.length; i++) {
          const id = all[i];
          const row = table.getRow(id);
          if (row !== void 0 && row.kind === opcodes_1.NodeKind.Rule)
            out.push(id);
        }
        return out;
      }
      exports.orderedRuleIds = orderedRuleIds;
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
      exports.matchCssomEndOfFrame = matchCssomEndOfFrame;
      function insertIndexFromBefore(materializedIds, before) {
        if (before === frame_1.INSERT_AT_END)
          return materializedIds.length;
        for (let i = 0; i < materializedIds.length; i++) {
          if (materializedIds[i] === before)
            return i;
        }
        return -1;
      }
      exports.insertIndexFromBefore = insertIndexFromBefore;
      function declarationBlockFromRuleText(cssText) {
        const open = cssText.indexOf("{");
        const close = cssText.lastIndexOf("}");
        if (open < 0 || close <= open)
          return cssText.trim();
        return cssText.slice(open + 1, close).trim();
      }
      exports.declarationBlockFromRuleText = declarationBlockFromRuleText;
    }
  });

  // ../packages/page-projection/dist/core/cssomRuleSet.js
  var require_cssomRuleSet = __commonJS({
    "../packages/page-projection/dist/core/cssomRuleSet.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.ruleAcceptsInPlaceSet = exports.planRuleSetApply = void 0;
      function planRuleSetApply(isCssStyleRule) {
        if (isCssStyleRule)
          return { mode: "styleDeclarations" };
        return { mode: "desync" };
      }
      exports.planRuleSetApply = planRuleSetApply;
      function ruleAcceptsInPlaceSet(rule) {
        return rule.constructor.name === "CSSStyleRule";
      }
      exports.ruleAcceptsInPlaceSet = ruleAcceptsInPlaceSet;
    }
  });

  // ../packages/page-projection/dist/core/rowHash.js
  var require_rowHash = __commonJS({
    "../packages/page-projection/dist/core/rowHash.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.TableHashTracker = exports.computeRowHash = exports.hashShadowInit = exports.hashNs = exports.hashProp = exports.hashAttr = exports.hashValue = exports.hashName = exports.subMod64 = exports.addMod64 = exports.h64U32 = exports.h64Str = exports.h64Bytes = exports.MASK64 = void 0;
      var elementNs_1 = require_elementNs();
      var FNV_OFFSET_BASIS = 14695981039346656037n;
      var FNV_PRIME = 1099511628211n;
      exports.MASK64 = 0xffffffffffffffffn;
      var sharedEncoder = new TextEncoder();
      function h64Bytes(bytes, seed = FNV_OFFSET_BASIS) {
        let h = seed;
        for (let i = 0; i < bytes.length; i++) {
          h ^= BigInt(bytes[i]);
          h = h * FNV_PRIME & exports.MASK64;
        }
        return h;
      }
      exports.h64Bytes = h64Bytes;
      function h64Str(value, seed = FNV_OFFSET_BASIS) {
        return h64Bytes(sharedEncoder.encode(value), seed);
      }
      exports.h64Str = h64Str;
      function h64U32(value, seed = FNV_OFFSET_BASIS) {
        let h = seed;
        h ^= BigInt(value & 255);
        h = h * FNV_PRIME & exports.MASK64;
        h ^= BigInt(value >>> 8 & 255);
        h = h * FNV_PRIME & exports.MASK64;
        h ^= BigInt(value >>> 16 & 255);
        h = h * FNV_PRIME & exports.MASK64;
        h ^= BigInt(value >>> 24 & 255);
        h = h * FNV_PRIME & exports.MASK64;
        return h;
      }
      exports.h64U32 = h64U32;
      function addMod64(a, b) {
        return a + b & exports.MASK64;
      }
      exports.addMod64 = addMod64;
      function subMod64(a, b) {
        return a - b & exports.MASK64;
      }
      exports.subMod64 = subMod64;
      function hashName(name) {
        return h64Str(`\0N${name}`);
      }
      exports.hashName = hashName;
      function hashValue(value) {
        return h64Str(`\0V${value}`);
      }
      exports.hashValue = hashValue;
      function hashAttr(name, value) {
        return h64Str(`\0A${name}${value}`);
      }
      exports.hashAttr = hashAttr;
      function hashProp(propId, value) {
        if (typeof value === "boolean")
          return h64Str(`\0P${propId}B${value ? "1" : "0"}`);
        if (typeof value === "number")
          return h64Str(`\0P${propId}F${value}`);
        return h64Str(`\0P${propId}S${value}`);
      }
      exports.hashProp = hashProp;
      function hashNs(ns, uri) {
        if (ns === elementNs_1.ElementNs.Custom)
          return h64Str(`\0U${uri ?? ""}`);
        return h64Bytes(Uint8Array.of(0, 83, ns & 255));
      }
      exports.hashNs = hashNs;
      function hashShadowInit(mode, initFlags) {
        return h64Bytes(Uint8Array.of(0, 72, mode & 255, initFlags & 255));
      }
      exports.hashShadowInit = hashShadowInit;
      function computeRowHash(id, kind, parent, prevSibling, contentHash) {
        let h = h64U32(id);
        h = h64U32(kind, h);
        h = h64U32(parent, h);
        h = h64U32(prevSibling, h);
        h ^= contentHash;
        h = h * FNV_PRIME & exports.MASK64;
        return h;
      }
      exports.computeRowHash = computeRowHash;
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
          if (old !== void 0)
            this.total = subMod64(this.total, old);
          this.rowHashes.set(id, newRowHash);
          this.total = addMod64(this.total, newRowHash);
        }
        remove(id) {
          const old = this.rowHashes.get(id);
          if (old === void 0)
            return;
          this.total = subMod64(this.total, old);
          this.rowHashes.delete(id);
        }
        clear() {
          this.total = 0n;
          this.rowHashes.clear();
        }
      };
      exports.TableHashTracker = TableHashTracker;
    }
  });

  // ../packages/page-projection/dist/core/replicatedTable.js
  var require_replicatedTable = __commonJS({
    "../packages/page-projection/dist/core/replicatedTable.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.ReplicatedTable = void 0;
      var elementNs_1 = require_elementNs();
      var opcodes_1 = require_opcodes();
      var rowHash_1 = require_rowHash();
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
        tracker = new rowHash_1.TableHashTracker();
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
            if (id >= lo && id <= hi)
              sum = (0, rowHash_1.addMod64)(sum, row.rowHash);
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
            if (seen.has(child))
              break;
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
            if (row.parent === parent && row.kind !== opcodes_1.NodeKind.ShadowRoot)
              n += 1;
          }
          return n;
        }
        /** Owned `SHADOW_ROOT` id of `host`, or 0. */
        shadowRootOf(host) {
          return this.shadowRootByHost.get(host) ?? NONE;
        }
        /** Every stored row id (excludes implicit Document `1`). */
        forEachRow(fn) {
          for (const [id, row] of this.rows)
            fn(id, row);
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
        createElementRow(id, tagName, attrs, ns = elementNs_1.ElementNs.Html, uri) {
          const attrMap = /* @__PURE__ */ new Map();
          let sum = (0, rowHash_1.addMod64)((0, rowHash_1.hashName)(tagName), (0, rowHash_1.hashNs)(ns, uri));
          for (let i = 0; i < attrs.length; i++) {
            const { name, value } = attrs[i];
            const h = (0, rowHash_1.hashAttr)(name, value);
            attrMap.set(name, h);
            sum = (0, rowHash_1.addMod64)(sum, h);
          }
          this.attrHashes.set(id, attrMap);
          this.propHashes.set(id, /* @__PURE__ */ new Map());
          this.propValues.set(id, /* @__PURE__ */ new Map());
          this.setRow(id, opcodes_1.NodeKind.Element, NONE, NONE, sum);
        }
        /** TEXT/COMMENT (`value`) or DOCTYPE (`name`) — both a single content-carrying string field. */
        createLeafRow(id, kind, contentField) {
          this.setRow(id, kind, NONE, NONE, (0, rowHash_1.hashValue)(contentField));
        }
        /**
         * `SHADOW_ROOT` — `parent = host` immediately, not linked into the host's light chain.
         * `prevSibling` stays 0.
         */
        createShadowRootRow(id, host, mode, initFlags) {
          this.setRow(id, opcodes_1.NodeKind.ShadowRoot, host, NONE, (0, rowHash_1.hashShadowInit)(mode, initFlags));
          this.shadowRootByHost.set(host, id);
          this.hostOfShadowRoot.set(id, host);
        }
        // ---- ATTR_SET / ATTR_DEL / TEXT_SET (§4.4) — content-only, topology untouched. ----
        setAttrs(id, attrs) {
          const row = this.rows.get(id);
          if (row === void 0)
            return;
          const attrMap = this.attrHashes.get(id) ?? /* @__PURE__ */ new Map();
          let sum = row.contentHash;
          for (let i = 0; i < attrs.length; i++) {
            const { name, value } = attrs[i];
            const old = attrMap.get(name);
            if (old !== void 0)
              sum = (0, rowHash_1.subMod64)(sum, old);
            const h = (0, rowHash_1.hashAttr)(name, value);
            attrMap.set(name, h);
            sum = (0, rowHash_1.addMod64)(sum, h);
          }
          this.attrHashes.set(id, attrMap);
          this.setRow(id, row.kind, row.parent, row.prevSibling, sum);
        }
        delAttrs(id, names) {
          const row = this.rows.get(id);
          if (row === void 0)
            return;
          const attrMap = this.attrHashes.get(id);
          if (attrMap === void 0)
            return;
          let sum = row.contentHash;
          for (let i = 0; i < names.length; i++) {
            const old = attrMap.get(names[i]);
            if (old === void 0)
              continue;
            sum = (0, rowHash_1.subMod64)(sum, old);
            attrMap.delete(names[i]);
          }
          this.setRow(id, row.kind, row.parent, row.prevSibling, sum);
        }
        setValue(id, value) {
          const row = this.rows.get(id);
          if (row === void 0)
            return;
          this.setRow(id, row.kind, row.parent, row.prevSibling, (0, rowHash_1.hashValue)(value));
        }
        setProp(id, propId, value) {
          const row = this.rows.get(id);
          if (row === void 0)
            return;
          const hashMap = this.propHashes.get(id) ?? /* @__PURE__ */ new Map();
          const valueMap = this.propValues.get(id) ?? /* @__PURE__ */ new Map();
          let sum = row.contentHash;
          const old = hashMap.get(propId);
          if (old !== void 0)
            sum = (0, rowHash_1.subMod64)(sum, old);
          const h = (0, rowHash_1.hashProp)(propId, value);
          hashMap.set(propId, h);
          valueMap.set(propId, value);
          this.propHashes.set(id, hashMap);
          this.propValues.set(id, valueMap);
          this.setRow(id, row.kind, row.parent, row.prevSibling, (0, rowHash_1.addMod64)(sum, h));
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
            if (existing !== void 0 && existing.parent !== NONE)
              this.unlink(id, existing);
            this.linkAfter(id, parent, prev);
            prev = id;
          }
          if (before !== NONE) {
            this.relinkPrevSibling(before, prev);
            if (prev !== NONE)
              this.nextSiblingOf.set(prev, before);
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
            if (row === void 0)
              continue;
            this.unlink(id, row);
            this.setRow(id, row.kind, NONE, NONE, row.contentHash);
          }
        }
        /** `NODE_DROP` (§4.2, OPEN-1/OPEN-2, Stage 3) — permanently removes one row's contract state. */
        dropRow(id) {
          const owned = this.shadowRootByHost.get(id);
          if (owned !== void 0)
            this.hostOfShadowRoot.delete(owned);
          this.shadowRootByHost.delete(id);
          const host = this.hostOfShadowRoot.get(id);
          if (host !== void 0)
            this.shadowRootByHost.delete(host);
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
          for (let i = 0; i < ids.length; i++)
            this.dropRow(ids[i]);
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
            if (out.length >= limit)
              break;
            if (row.parent !== NONE)
              continue;
            if (currentSequence - row.lms >= maxAge)
              out.push(id);
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
          const rowHash = (0, rowHash_1.computeRowHash)(id, kind, parent, prevSibling, contentHash);
          this.rows.set(id, { kind, parent, prevSibling, contentHash, rowHash, lms: this.currentSequence });
          this.tracker.upsert(id, rowHash);
        }
        relinkPrevSibling(id, prevSibling) {
          const row = this.rows.get(id);
          if (row === void 0)
            return;
          this.setRow(id, row.kind, row.parent, prevSibling, row.contentHash);
        }
        linkAfter(id, parent, prevId) {
          const row = this.rows.get(id);
          const kind = row?.kind ?? opcodes_1.NodeKind.Element;
          const contentHash = row?.contentHash ?? 0n;
          this.setRow(id, kind, parent, prevId, contentHash);
          if (prevId !== NONE)
            this.nextSiblingOf.set(prevId, id);
        }
        /** Removes `id` from its current position, repairing its neighbor's `prevSibling`/`lastChildOf`. */
        unlink(id, row) {
          if (row.parent === NONE)
            return;
          const nextId = this.nextSiblingOf.get(id) ?? NONE;
          this.nextSiblingOf.delete(id);
          if (nextId !== NONE) {
            this.relinkPrevSibling(nextId, row.prevSibling);
            if (row.prevSibling !== NONE)
              this.nextSiblingOf.set(row.prevSibling, nextId);
          } else if (this.lastChildOf.get(row.parent) === id) {
            this.lastChildOf.set(row.parent, row.prevSibling);
            if (row.prevSibling !== NONE)
              this.nextSiblingOf.delete(row.prevSibling);
          }
        }
      };
      exports.ReplicatedTable = ReplicatedTable;
    }
  });

  // ../packages/page-projection/dist/core/replicatedTableApply.js
  var require_replicatedTableApply = __commonJS({
    "../packages/page-projection/dist/core/replicatedTableApply.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.applyFrameToTableChecked = exports.applyFrameToTable = exports.applyOpsToTable = exports.applyOpToTable = void 0;
      var frame_1 = require_frame();
      var limits_1 = require_limits();
      var opcodes_1 = require_opcodes();
      function applyOpToTable(table, op) {
        switch (op.op) {
          case opcodes_1.OpCode.Check:
            return;
          case opcodes_1.OpCode.NodeNew:
            if (op.kind === opcodes_1.NodeKind.Element)
              table.createElementRow(op.id, op.name, op.attrs, op.ns, op.uri);
            else if (op.kind === opcodes_1.NodeKind.Doctype)
              table.createLeafRow(op.id, op.kind, op.name);
            else if (op.kind === opcodes_1.NodeKind.ShadowRoot)
              table.createShadowRootRow(op.id, op.host, op.mode, op.initFlags);
            else
              table.createLeafRow(op.id, op.kind, op.value);
            return;
          case opcodes_1.OpCode.NodeDrop:
            for (let i = 0; i < op.ids.length; i++)
              table.dropSubtree(op.ids[i]);
            return;
          case opcodes_1.OpCode.Insert:
            table.insertBatch(op.parent, op.before, op.ids);
            return;
          case opcodes_1.OpCode.Remove:
            table.removeBatch(op.parent, op.ids);
            return;
          case opcodes_1.OpCode.AttrSet:
            table.setAttrs(op.node, op.attrs);
            return;
          case opcodes_1.OpCode.AttrDel:
            table.delAttrs(op.node, op.names);
            return;
          case opcodes_1.OpCode.TextSet:
            table.setValue(op.node, op.value);
            return;
          case opcodes_1.OpCode.PropSet:
            table.setProp(op.node, op.propId, op.value);
            return;
          case opcodes_1.OpCode.SheetNew: {
            const parent = op.hostNode === 0 ? frame_1.DOCUMENT_ID : op.hostNode;
            if (!table.has(op.id))
              table.createLeafRow(op.id, opcodes_1.NodeKind.Sheet, "");
            table.insertBatch(parent, op.before, [op.id]);
            return;
          }
          case opcodes_1.OpCode.SheetDrop:
            for (let i = 0; i < op.ids.length; i++) {
              const id = op.ids[i];
              const row = table.getRow(id);
              if (row !== void 0 && row.parent !== 0)
                table.removeBatch(row.parent, [id]);
              table.dropSubtree(id);
            }
            return;
          case opcodes_1.OpCode.SheetOrder:
            if (op.ids.length === 0)
              return;
            {
              const first = table.getRow(op.ids[0]);
              const parent = first === void 0 || first.parent === 0 ? frame_1.DOCUMENT_ID : first.parent;
              table.removeBatch(parent, op.ids);
              table.insertBatch(parent, 0, op.ids);
            }
            return;
          case opcodes_1.OpCode.RuleNew:
            if (!table.has(op.id))
              table.createLeafRow(op.id, opcodes_1.NodeKind.Rule, op.text);
            else
              table.setValue(op.id, op.text);
            table.insertBatch(op.sheet, op.before, [op.id]);
            return;
          case opcodes_1.OpCode.RuleDrop:
            for (let i = 0; i < op.ids.length; i++) {
              const id = op.ids[i];
              const row = table.getRow(id);
              if (row !== void 0 && row.parent !== 0)
                table.removeBatch(row.parent, [id]);
              table.dropSubtree(id);
            }
            return;
          case opcodes_1.OpCode.RuleSet:
            table.setValue(op.id, op.text);
            return;
          default:
            return;
        }
      }
      exports.applyOpToTable = applyOpToTable;
      function applyOpsToTable(table, ops) {
        for (let i = 0; i < ops.length; i++)
          applyOpToTable(table, ops[i]);
      }
      exports.applyOpsToTable = applyOpsToTable;
      function applyFrameToTable(table, resync, ops, sequence = 0) {
        if (resync)
          table.reset();
        table.setSequence(sequence);
        applyOpsToTable(table, ops);
      }
      exports.applyFrameToTable = applyFrameToTable;
      function evaluateCheck(table, op) {
        return op.scope === frame_1.CHECK_SCOPE_RANGE ? table.hashRange(op.lo, op.hi) : table.tableHash;
      }
      function failOp(i, reason, opName, id, message) {
        return { ok: false, reason, failedOpIndex: i, opName, id, message };
      }
      function addressExists(table, id) {
        return id === frame_1.DOCUMENT_ID || table.has(id);
      }
      function isInsertParent(table, parent) {
        if (parent === frame_1.DOCUMENT_ID)
          return true;
        const row = table.getRow(parent);
        return row !== void 0 && (row.kind === opcodes_1.NodeKind.Element || row.kind === opcodes_1.NodeKind.ShadowRoot);
      }
      function isShadowRootId(table, id) {
        return table.getRow(id)?.kind === opcodes_1.NodeKind.ShadowRoot;
      }
      function isSelfOrAncestorOf(table, id, ofId) {
        if (id === ofId)
          return true;
        let cur = ofId;
        const seen = /* @__PURE__ */ new Set();
        while (cur !== 0 && cur !== frame_1.DOCUMENT_ID) {
          if (seen.has(cur))
            return false;
          seen.add(cur);
          const row = table.getRow(cur);
          if (row === void 0)
            return false;
          if (row.parent === id)
            return true;
          cur = row.parent;
        }
        return false;
      }
      function validateOpPre(table, op, i) {
        switch (op.op) {
          case opcodes_1.OpCode.NodeNew: {
            if (op.kind !== opcodes_1.NodeKind.ShadowRoot)
              return null;
            if (op.mode !== frame_1.SHADOW_MODE_OPEN && op.mode !== frame_1.SHADOW_MODE_CLOSED) {
              return failOp(i, "malformed", "nodeNew", op.id, "NODE_NEW SHADOW_ROOT mode must be 0 (open) or 1 (closed) (frame-protocol.md \xA74.2)");
            }
            if ((op.initFlags & ~frame_1.SHADOW_INIT_FLAGS_MASK) !== 0) {
              return failOp(i, "malformed", "nodeNew", op.id, "NODE_NEW SHADOW_ROOT reserved initFlags (frame-protocol.md \xA74.2)");
            }
            const host = table.getRow(op.host);
            if (host === void 0 || host.kind !== opcodes_1.NodeKind.Element) {
              return failOp(i, "precondition", "nodeNew", op.host, "NODE_NEW SHADOW_ROOT host missing or not ELEMENT (frame-protocol.md \xA74.2)");
            }
            if (table.shadowRootOf(op.host) !== 0) {
              return failOp(i, "malformed", "nodeNew", op.id, "NODE_NEW SHADOW_ROOT host already owns a root (frame-protocol.md \xA74.2)");
            }
            return null;
          }
          case opcodes_1.OpCode.Insert: {
            if (op.ids.length > limits_1.MAX_CHILDREN_PER_OP) {
              return failOp(i, "malformed", "insert", op.parent, `INSERT count > MAX_CHILDREN_PER_OP (${limits_1.MAX_CHILDREN_PER_OP}) (frame-protocol.md \xA74.3)`);
            }
            if (!isInsertParent(table, op.parent)) {
              return failOp(i, "precondition", "insert", op.parent, "INSERT parent missing or not ELEMENT/SHADOW_ROOT/Document (frame-protocol.md \xA74.3)");
            }
            if (op.before !== 0) {
              const beforeRow = table.getRow(op.before);
              if (beforeRow === void 0 || beforeRow.parent !== op.parent) {
                return failOp(i, "precondition", "insert", op.before, "INSERT before must be 0 or a child of parent (frame-protocol.md \xA74.3)");
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
                return failOp(i, "precondition", "insert", id, "INSERT of a SHADOW_ROOT id (frame-protocol.md \xA74.3)");
              }
              if (isSelfOrAncestorOf(table, id, op.parent)) {
                return failOp(i, "precondition", "insert", id, "INSERT would create a cycle (frame-protocol.md \xA74.3)");
              }
            }
            return null;
          }
          case opcodes_1.OpCode.Remove: {
            if (op.ids.length > limits_1.MAX_CHILDREN_PER_OP) {
              return failOp(i, "malformed", "remove", op.parent, `REMOVE count > MAX_CHILDREN_PER_OP (${limits_1.MAX_CHILDREN_PER_OP}) (frame-protocol.md \xA74.3)`);
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
                return failOp(i, "precondition", "remove", id, "REMOVE id parent mismatch (frame-protocol.md \xA74.3)");
              }
              if (row.kind === opcodes_1.NodeKind.ShadowRoot) {
                return failOp(i, "precondition", "remove", id, "REMOVE of a SHADOW_ROOT id (frame-protocol.md \xA74.3)");
              }
            }
            return null;
          }
          case opcodes_1.OpCode.AttrSet: {
            const row = table.getRow(op.node);
            if (row === void 0 || row.kind !== opcodes_1.NodeKind.Element) {
              return failOp(i, "precondition", "attrSet", op.node, "ATTR_SET requires an ELEMENT row (frame-protocol.md \xA74.4)");
            }
            return null;
          }
          case opcodes_1.OpCode.AttrDel: {
            const row = table.getRow(op.node);
            if (row === void 0 || row.kind !== opcodes_1.NodeKind.Element) {
              return failOp(i, "precondition", "attrDel", op.node, "ATTR_DEL requires an ELEMENT row (frame-protocol.md \xA74.4)");
            }
            return null;
          }
          case opcodes_1.OpCode.TextSet: {
            const row = table.getRow(op.node);
            if (row === void 0 || row.kind !== opcodes_1.NodeKind.Text && row.kind !== opcodes_1.NodeKind.Comment) {
              return failOp(i, "precondition", "textSet", op.node, "TEXT_SET requires TEXT or COMMENT (frame-protocol.md \xA74.4)");
            }
            return null;
          }
          case opcodes_1.OpCode.PropSet: {
            const row = table.getRow(op.node);
            if (row === void 0 || row.kind !== opcodes_1.NodeKind.Element) {
              return failOp(i, "precondition", "propSet", op.node, "PROP_SET requires an ELEMENT row (frame-protocol.md \xA74.4)");
            }
            return null;
          }
          case opcodes_1.OpCode.SheetNew: {
            if (table.has(op.id) && table.getRow(op.id).kind !== opcodes_1.NodeKind.Sheet) {
              return failOp(i, "malformed", "sheetNew", op.id, "SHEET_NEW id exists with a non-SHEET kind (frame-protocol.md \xA74.6)");
            }
            if (op.scope === frame_1.CSSOM_SCOPE_PIERCE_HOST && !addressExists(table, op.hostNode)) {
              return failOp(i, "precondition", "sheetNew", op.hostNode, "SHEET_NEW PIERCE_HOST hostNode missing (frame-protocol.md \xA74.6)");
            }
            const parent = op.hostNode === 0 ? frame_1.DOCUMENT_ID : op.hostNode;
            if (op.before !== 0) {
              const beforeRow = table.getRow(op.before);
              if (beforeRow === void 0 || beforeRow.parent !== parent) {
                return failOp(i, "precondition", "sheetNew", op.before, "SHEET_NEW before must be 0 or a child of the sheet parent (frame-protocol.md \xA74.6)");
              }
            }
            return null;
          }
          case opcodes_1.OpCode.SheetDrop: {
            for (let j = 0; j < op.ids.length; j++) {
              const id = op.ids[j];
              const row = table.getRow(id);
              if (row === void 0 || row.kind !== opcodes_1.NodeKind.Sheet) {
                return failOp(i, "precondition", "sheetDrop", id, "SHEET_DROP requires SHEET ids (frame-protocol.md \xA74.6)");
              }
            }
            return null;
          }
          case opcodes_1.OpCode.SheetOrder: {
            for (let j = 0; j < op.ids.length; j++) {
              const id = op.ids[j];
              const row = table.getRow(id);
              if (row === void 0 || row.kind !== opcodes_1.NodeKind.Sheet) {
                return failOp(i, "precondition", "sheetOrder", id, "SHEET_ORDER requires SHEET ids (frame-protocol.md \xA74.6)");
              }
            }
            return null;
          }
          case opcodes_1.OpCode.RuleNew: {
            const sheet = table.getRow(op.sheet);
            if (sheet === void 0 || sheet.kind !== opcodes_1.NodeKind.Sheet) {
              return failOp(i, "precondition", "ruleNew", op.sheet, "RULE_NEW sheet missing or not SHEET (frame-protocol.md \xA74.6)");
            }
            if (table.has(op.id) && table.getRow(op.id).kind !== opcodes_1.NodeKind.Rule) {
              return failOp(i, "malformed", "ruleNew", op.id, "RULE_NEW id exists with a non-RULE kind (frame-protocol.md \xA74.6)");
            }
            if (op.before !== 0) {
              const beforeRow = table.getRow(op.before);
              if (beforeRow === void 0 || beforeRow.kind !== opcodes_1.NodeKind.Rule || beforeRow.parent !== op.sheet) {
                return failOp(i, "precondition", "ruleNew", op.before, "RULE_NEW before must be 0 or a rule of that sheet (frame-protocol.md \xA74.6)");
              }
            }
            return null;
          }
          case opcodes_1.OpCode.RuleDrop: {
            for (let j = 0; j < op.ids.length; j++) {
              const id = op.ids[j];
              const row = table.getRow(id);
              if (row === void 0 || row.kind !== opcodes_1.NodeKind.Rule || row.parent !== op.sheet) {
                return failOp(i, "precondition", "ruleDrop", id, "RULE_DROP requires RULE ids parented to sheet (frame-protocol.md \xA74.6)");
              }
            }
            return null;
          }
          case opcodes_1.OpCode.RuleSet: {
            const row = table.getRow(op.id);
            if (row === void 0 || row.kind !== opcodes_1.NodeKind.Rule) {
              return failOp(i, "precondition", "ruleSet", op.id, "RULE_SET requires a RULE row (frame-protocol.md \xA74.6)");
            }
            return null;
          }
          default:
            return null;
        }
      }
      function applyFrameToTableChecked(table, resync, ops, sequence = 0) {
        if (resync)
          table.reset();
        table.setSequence(sequence);
        for (let i = 0; i < ops.length; i++) {
          const op = ops[i];
          if (op.op === opcodes_1.OpCode.Check) {
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
          if (op.op === opcodes_1.OpCode.NodeDrop) {
            for (let j = 0; j < op.ids.length; j++) {
              const id = op.ids[j];
              if (!table.has(id)) {
                return failOp(i, "malformed", "nodeDrop", id, "NODE_DROP of an absent id (frame-protocol.md \xA74.2 / OPEN-1 CLOSED)");
              }
              if (table.getRow(id).parent !== 0) {
                return failOp(i, "precondition", "nodeDrop", id, "NODE_DROP of an attached row (frame-protocol.md \xA74.2)");
              }
            }
            for (let j = 0; j < op.ids.length; j++)
              table.dropSubtree(op.ids[j]);
            continue;
          }
          if ((op.op === opcodes_1.OpCode.NodeNew || op.op === opcodes_1.OpCode.SheetNew || op.op === opcodes_1.OpCode.RuleNew) && !table.has(op.id) && table.size >= limits_1.MAX_ROWS) {
            return failOp(i, "precondition", "nodeNew", op.id, `MAX_ROWS (${limits_1.MAX_ROWS}) exceeded (frame-protocol.md \xA78)`);
          }
          const pre = validateOpPre(table, op, i);
          if (pre !== null)
            return pre;
          applyOpToTable(table, op);
        }
        return { ok: true };
      }
      exports.applyFrameToTableChecked = applyFrameToTableChecked;
    }
  });

  // ../packages/page-projection/dist/core/nestedNav.js
  var require_nestedNav = __commonJS({
    "../packages/page-projection/dist/core/nestedNav.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.ensureNestedHostSandboxAccess = exports.isNestedHostNavAttr = void 0;
      function isNestedHostNavAttr(name) {
        const n = name.toLowerCase();
        return n === "src" || n === "srcdoc";
      }
      exports.isNestedHostNavAttr = isNestedHostNavAttr;
      function ensureNestedHostSandboxAccess(iframe) {
        if (iframe.localName.toLowerCase() !== "iframe")
          return;
        const raw = iframe.getAttribute("sandbox");
        if (raw === null)
          return;
        const tokens = raw.split(/\s+/).map((t) => t.trim().toLowerCase()).filter((t) => t.length > 0 && t !== "allow-scripts");
        if (!tokens.includes("allow-same-origin")) {
          tokens.push("allow-same-origin");
        }
        iframe.setAttribute("sandbox", tokens.join(" "));
      }
      exports.ensureNestedHostSandboxAccess = ensureNestedHostSandboxAccess;
    }
  });

  // ../packages/page-projection/dist/projected/scriptingOnPaintParity.js
  var require_scriptingOnPaintParity = __commonJS({
    "../packages/page-projection/dist/projected/scriptingOnPaintParity.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.withScriptingOnPaintParity = exports.installScriptingOnPaintParity = exports.paintParityInstalled = exports.hasParityStyleElement = exports.paritySheetForDocument = exports.PARITY_STYLE_ATTR = exports.SCRIPTING_ON_PAINT_PARITY_CSS = void 0;
      exports.SCRIPTING_ON_PAINT_PARITY_CSS = "noscript{display:none!important}";
      exports.PARITY_STYLE_ATTR = "data-speculum-scripting-on-paint-parity";
      var parityByDocument = /* @__PURE__ */ new WeakMap();
      function paritySheetForDocument(doc) {
        return parityByDocument.get(doc);
      }
      exports.paritySheetForDocument = paritySheetForDocument;
      function hasParityStyleElement(doc) {
        return doc.querySelector(`style[${exports.PARITY_STYLE_ATTR}]`) != null;
      }
      exports.hasParityStyleElement = hasParityStyleElement;
      function paintParityInstalled(doc) {
        const sheet = parityByDocument.get(doc);
        if (sheet !== void 0) {
          try {
            if (Array.from(doc.adoptedStyleSheets).includes(sheet))
              return true;
          } catch {
          }
        }
        return hasParityStyleElement(doc);
      }
      exports.paintParityInstalled = paintParityInstalled;
      function installScriptingOnPaintParity(doc) {
        if (installConstructableParity(doc))
          return;
        installParityStyleElement(doc);
      }
      exports.installScriptingOnPaintParity = installScriptingOnPaintParity;
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
        if (view === null || typeof view.CSSStyleSheet !== "function")
          return false;
        try {
          const sheet = new view.CSSStyleSheet();
          sheet.replaceSync(exports.SCRIPTING_ON_PAINT_PARITY_CSS);
          const rest = Array.from(doc.adoptedStyleSheets).filter((s) => s !== sheet);
          doc.adoptedStyleSheets = [sheet, ...rest];
          parityByDocument.set(doc, sheet);
          return true;
        } catch {
          return false;
        }
      }
      function installParityStyleElement(doc) {
        if (hasParityStyleElement(doc))
          return true;
        const head = doc.head;
        const host = head ?? doc.documentElement;
        if (host == null)
          return false;
        const el2 = doc.createElement("style");
        el2.setAttribute(exports.PARITY_STYLE_ATTR, "");
        el2.textContent = exports.SCRIPTING_ON_PAINT_PARITY_CSS;
        if (head != null)
          head.appendChild(el2);
        else
          host.insertBefore(el2, host.firstChild);
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
      exports.withScriptingOnPaintParity = withScriptingOnPaintParity;
    }
  });

  // ../packages/page-projection/dist/projected/projectedBlankIframe.js
  var require_projectedBlankIframe = __commonJS({
    "../packages/page-projection/dist/projected/projectedBlankIframe.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.whenProjectedStandardsReady = exports.isProjectedStandardsDocument = exports.isProjectedStandardsSkeleton = exports.ensureProjectedK5Csp = exports.ensureProjectedDocumentBase = exports.constructedStyleSheetInit = exports.stripProjectedSkeleton = exports.stampProjectedStandardsSrcdoc = exports.PROJECTED_STANDARDS_READY_TIMEOUT_MS = exports.PROJECTED_STANDARDS_SRCDOC = exports.PROJECTED_K5_CSP = exports.PROJECTED_SKELETON_META_NAME = void 0;
      exports.PROJECTED_SKELETON_META_NAME = "speculum-projected-skeleton";
      exports.PROJECTED_K5_CSP = "script-src 'none'; object-src 'none'";
      exports.PROJECTED_STANDARDS_SRCDOC = `<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="${exports.PROJECTED_K5_CSP}"><meta name="${exports.PROJECTED_SKELETON_META_NAME}" content="1"></head><body></body></html>`;
      exports.PROJECTED_STANDARDS_READY_TIMEOUT_MS = 5e3;
      function fault(errorCode, message) {
        const err = new Error(message);
        err.errorCode = errorCode;
        err.phase = "establish";
        return err;
      }
      function stampProjectedStandardsSrcdoc2(iframe) {
        iframe.srcdoc = exports.PROJECTED_STANDARDS_SRCDOC;
      }
      exports.stampProjectedStandardsSrcdoc = stampProjectedStandardsSrcdoc2;
      function stripProjectedSkeleton(doc) {
        while (doc.firstChild)
          doc.removeChild(doc.firstChild);
      }
      exports.stripProjectedSkeleton = stripProjectedSkeleton;
      var PROJECTED_DOCUMENT_BASE_ATTR = "data-speculum-document-base";
      function constructedStyleSheetInit(pageUrl) {
        if (!pageUrl)
          return void 0;
        try {
          return { baseURL: new URL(pageUrl).href };
        } catch {
          return void 0;
        }
      }
      exports.constructedStyleSheetInit = constructedStyleSheetInit;
      function ensureProjectedDocumentBase(doc, pageUrl) {
        if (!pageUrl)
          return;
        const head = doc.head;
        if (!head)
          return;
        let href;
        try {
          href = new URL(pageUrl).href;
        } catch {
          return;
        }
        const existing = head.querySelector(`base[${PROJECTED_DOCUMENT_BASE_ATTR}]`);
        if (existing) {
          if (existing.getAttribute("href") !== href)
            existing.setAttribute("href", href);
          return;
        }
        const base = doc.createElement("base");
        base.setAttribute(PROJECTED_DOCUMENT_BASE_ATTR, "1");
        base.href = href;
        head.insertBefore(base, head.firstChild);
      }
      exports.ensureProjectedDocumentBase = ensureProjectedDocumentBase;
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
          if (existing[i].getAttribute("content") === exports.PROJECTED_K5_CSP)
            return;
        }
        const meta = doc.createElement("meta");
        meta.httpEquiv = "Content-Security-Policy";
        meta.content = exports.PROJECTED_K5_CSP;
        head.insertBefore(meta, head.firstChild);
      }
      exports.ensureProjectedK5Csp = ensureProjectedK5Csp;
      function isProjectedStandardsSkeleton(doc) {
        if (doc == null || doc.defaultView == null)
          return false;
        const head = doc.head;
        if (!head)
          return false;
        const metas = head.getElementsByTagName("meta");
        for (let i = 0; i < metas.length; i++) {
          const m = metas[i];
          if (m.getAttribute("name") === exports.PROJECTED_SKELETON_META_NAME && m.getAttribute("content") === "1") {
            return true;
          }
        }
        return false;
      }
      exports.isProjectedStandardsSkeleton = isProjectedStandardsSkeleton;
      function isProjectedStandardsDocument(doc) {
        return isProjectedStandardsSkeleton(doc);
      }
      exports.isProjectedStandardsDocument = isProjectedStandardsDocument;
      function whenProjectedStandardsReady2(iframe, opts = {}) {
        const timeoutMs = opts.timeoutMs ?? exports.PROJECTED_STANDARDS_READY_TIMEOUT_MS;
        const signal = opts.signal;
        return new Promise((resolve, reject) => {
          let settled = false;
          let timer;
          let raf = 0;
          const settle = (fn) => {
            if (settled)
              return;
            settled = true;
            if (timer !== void 0)
              clearTimeout(timer);
            if (raf && typeof cancelAnimationFrame === "function")
              cancelAnimationFrame(raf);
            raf = 0;
            iframe.removeEventListener("load", onLoad);
            signal?.removeEventListener("abort", onAbort);
            fn();
          };
          const adopt = () => {
            const doc = iframe.contentDocument;
            if (!isProjectedStandardsSkeleton(doc))
              return false;
            stripProjectedSkeleton(doc);
            settle(() => resolve(doc));
            return true;
          };
          const onLoad = () => {
            if (adopt())
              return;
            if (iframe.srcdoc === exports.PROJECTED_STANDARDS_SRCDOC)
              return;
            settle(() => reject(fault("projected_standards_ready_invalid", "projected blank: load without stamped skeleton document")));
          };
          const onAbort = () => {
            settle(() => reject(fault("projected_standards_ready_aborted", "projected blank: standards ready wait aborted")));
          };
          if (signal?.aborted) {
            onAbort();
            return;
          }
          if (adopt())
            return;
          iframe.addEventListener("load", onLoad);
          signal?.addEventListener("abort", onAbort, { once: true });
          const poke = () => {
            if (settled)
              return;
            if (adopt())
              return;
            if (typeof requestAnimationFrame === "function") {
              raf = requestAnimationFrame(poke);
            }
          };
          poke();
          timer = setTimeout(() => {
            settle(() => reject(fault("projected_standards_ready_timeout", `projected blank: standards document not ready within ${timeoutMs}ms`)));
          }, timeoutMs);
        });
      }
      exports.whenProjectedStandardsReady = whenProjectedStandardsReady2;
    }
  });

  // ../packages/page-projection/dist/core/closedShadowLookup.js
  var require_closedShadowLookup = __commonJS({
    "../packages/page-projection/dist/core/closedShadowLookup.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.resolveShadowRoot = exports.lookupClosedShadowRoot = exports.registerClosedShadowRoot = void 0;
      var closedByHost = /* @__PURE__ */ new WeakMap();
      function registerClosedShadowRoot(host, root) {
        closedByHost.set(host, root);
      }
      exports.registerClosedShadowRoot = registerClosedShadowRoot;
      function lookupClosedShadowRoot(host) {
        return closedByHost.get(host) ?? null;
      }
      exports.lookupClosedShadowRoot = lookupClosedShadowRoot;
      function resolveShadowRoot3(host) {
        const open = host.shadowRoot;
        if (open !== null)
          return open;
        return lookupClosedShadowRoot(host);
      }
      exports.resolveShadowRoot = resolveShadowRoot3;
    }
  });

  // ../packages/page-projection/dist/projected/applyDom.js
  var require_applyDom = __commonJS({
    "../packages/page-projection/dist/projected/applyDom.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.DomFrameApplier = void 0;
      var opcodes_1 = require_opcodes();
      var elementNs_1 = require_elementNs();
      var applyBatch_1 = require_applyBatch();
      var frame_1 = require_frame();
      var formPropDirty_1 = require_formPropDirty();
      var propSet_1 = require_propSet();
      var attrApply_1 = require_attrApply();
      var cssomApplyIndex_1 = require_cssomApplyIndex();
      var cssomRuleSet_1 = require_cssomRuleSet();
      var replicatedTable_1 = require_replicatedTable();
      var replicatedTableApply_1 = require_replicatedTableApply();
      var nestedNav_1 = require_nestedNav();
      var scriptingOnPaintParity_1 = require_scriptingOnPaintParity();
      var projectedBlankIframe_1 = require_projectedBlankIframe();
      var closedShadowLookup_1 = require_closedShadowLookup();
      var DomFrameApplier2 = class {
        queued = [];
        raf = null;
        doc;
        registry;
        options;
        table = new replicatedTable_1.ReplicatedTable();
        propDirty = new formPropDirty_1.FormPropDirty();
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
          if (this.raf != null)
            return;
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
          if (batch.length === 0)
            return;
          const start = performance.now();
          let lastSequence = 0;
          (0, applyBatch_1.applyFramesUntilDesync)(batch, (frame) => {
            lastSequence = frame.sequence;
            return this.applyFrame(frame);
          });
          const duration = performance.now() - start;
          const budget = this.options.applyBudgetMs ?? 4;
          if (duration > budget)
            this.options.onOverrun?.(duration, lastSequence);
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
            if (ctx === contextId)
              return nodeId;
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
            if (this.nestedHostIds.has(id))
              return;
            if (node.nodeType !== Node.ELEMENT_NODE)
              return;
            const tag = node.localName.toLowerCase();
            if (tag !== "iframe" && tag !== "object" && tag !== "embed")
              return;
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
          const result = (0, replicatedTableApply_1.applyFrameToTableChecked)(this.table, frame.resync, frame.ops, frame.sequence);
          if (!result.ok) {
            if (result.opName === "check") {
              return this.fail("precondition", "check", result.expected, result.actual);
            }
            return this.failOp(result.reason, result.opName, result.id, result.message);
          }
          const documentBase = this.options.getDocumentBaseUrl?.() || this.options.documentBaseUrl || "";
          if (documentBase)
            (0, projectedBlankIframe_1.ensureProjectedDocumentBase)(this.doc, documentBase);
          for (let i = 0; i < frame.ops.length; i++) {
            const op = frame.ops[i];
            try {
              if (!this.applyOp(op))
                return false;
            } catch (err) {
              const opLabel = op.op === opcodes_1.OpCode.Insert ? `insert parent=${op.parent} before=${op.before} ids=[${op.ids.join(",")}]` : `op=${op.op}`;
              const errText = err instanceof Error ? `${err.name}: ${err.message}` : typeof err === "object" && err !== null && "name" in err ? `${String(err.name)}: ${String(err.message ?? err)}` : String(err);
              const message = `${errText} @op[${i}]=${op.op} ${opLabel}`;
              return this.failOp("malformed", "apply", "id" in op && typeof op.id === "number" ? op.id : 0, message);
            }
          }
          if (!this.cssomHandlesMatchTable())
            return false;
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
            case opcodes_1.OpCode.Check:
              return true;
            // §4.1 — no DOM effect; already evaluated in phase 1
            case opcodes_1.OpCode.NodeNew:
              return this.applyNodeNew(op);
            case opcodes_1.OpCode.NodeDrop:
              return this.applyNodeDrop(op);
            case opcodes_1.OpCode.Insert:
              return this.applyInsert(op);
            case opcodes_1.OpCode.Remove:
              return this.applyRemove(op);
            case opcodes_1.OpCode.AttrSet:
              return this.applyAttrSet(op);
            case opcodes_1.OpCode.AttrDel:
              return this.applyAttrDel(op);
            case opcodes_1.OpCode.TextSet:
              return this.applyTextSet(op);
            case opcodes_1.OpCode.PropSet:
              return this.applyPropSet(op);
            case opcodes_1.OpCode.SheetNew:
              return this.applySheetNew(op);
            case opcodes_1.OpCode.SheetDrop:
              return this.applySheetDrop(op);
            case opcodes_1.OpCode.SheetOrder:
              return this.applySheetOrder(op);
            case opcodes_1.OpCode.RuleNew:
              return this.applyRuleNew(op);
            case opcodes_1.OpCode.RuleDrop:
              return this.applyRuleDrop(op);
            case opcodes_1.OpCode.RuleSet:
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
            (0, scriptingOnPaintParity_1.installScriptingOnPaintParity)(this.doc);
            const sheet = (0, scriptingOnPaintParity_1.paritySheetForDocument)(this.doc);
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
          (0, scriptingOnPaintParity_1.installScriptingOnPaintParity)(this.doc);
          const sheet = (0, scriptingOnPaintParity_1.paritySheetForDocument)(this.doc);
          if (sheet != null)
            this.paritySheet = sheet;
          if (!(0, scriptingOnPaintParity_1.paintParityInstalled)(this.doc) && this.doc.documentElement != null) {
            this.options.onWarn?.("scriptingOnPaintParity: install failed after apply (no adopted sheet and no style element)");
          }
        }
        /**
         * After the frame: every table Sheet/Rule row must have a live handle in claimed sheet/order
         * (SEAL-CSSOM-P0-EOF / PP-CSSOM-A-3) — not sheet handles alone.
         */
        cssomHandlesMatchTable() {
          const tableSheetIds = (0, cssomApplyIndex_1.allSheetIds)(this.table);
          const liveSheetIdsPresent = /* @__PURE__ */ new Set();
          const tableRuleIdsBySheet = /* @__PURE__ */ new Map();
          const liveRuleIdsBySheet = /* @__PURE__ */ new Map();
          for (let i = 0; i < tableSheetIds.length; i++) {
            const sheetId = tableSheetIds[i];
            tableRuleIdsBySheet.set(sheetId, (0, cssomApplyIndex_1.orderedRuleIds)(this.table, sheetId));
            const sheet = this.sheets.get(sheetId);
            if (sheet === void 0)
              continue;
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
          const result = (0, cssomApplyIndex_1.matchCssomEndOfFrame)(tableSheetIds, tableRuleIdsBySheet, liveSheetIdsPresent, liveRuleIdsBySheet);
          if (!result.ok)
            return this.fail("address_miss", result.op, result.id);
          return true;
        }
        /** Iframe nodes fail `instanceof Element` from the parent realm — use this document's constructors. */
        isElement(node) {
          const view = this.doc.defaultView;
          return view !== null ? node instanceof view.Element : node.nodeType === Node.ELEMENT_NODE;
        }
        shadowRootOfHost(hostNode) {
          const node = this.registry.get(hostNode);
          if (!node)
            return null;
          if (this.isElement(node))
            return node.shadowRoot;
          const view = this.doc.defaultView;
          if (view !== null && node instanceof view.ShadowRoot)
            return node;
          if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE && node.host != null) {
            return node;
          }
          const owned = this.table.shadowRootOf(hostNode);
          if (owned === 0)
            return null;
          const sr = this.registry.get(owned);
          if (!sr)
            return null;
          if (view !== null && sr instanceof view.ShadowRoot)
            return sr;
          if (sr.nodeType === Node.DOCUMENT_FRAGMENT_NODE)
            return sr;
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
          if (root == null)
            return [];
          try {
            return Array.from(root.adoptedStyleSheets);
          } catch {
            return [];
          }
        }
        setAdoptedOf(hostNode, next) {
          try {
            if (hostNode === 0) {
              this.doc.adoptedStyleSheets = (0, scriptingOnPaintParity_1.withScriptingOnPaintParity)(this.doc, next);
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
          const pierce = op.scope === frame_1.CSSOM_SCOPE_PIERCE_HOST || op.hostNode !== 0;
          const hostNode = pierce ? op.hostNode : 0;
          if (pierce && this.shadowRootOfHost(hostNode) == null) {
            return this.fail("address_miss", "sheetNew", hostNode);
          }
          if (this.sheets.has(op.id))
            return true;
          const view = this.doc.defaultView;
          if (view === null)
            return this.fail("bad_target", "sheetNew", op.id);
          let sheet;
          try {
            const init = (0, projectedBlankIframe_1.constructedStyleSheetInit)(this.options.getDocumentBaseUrl?.() || this.options.documentBaseUrl);
            sheet = init ? new view.CSSStyleSheet(init) : new view.CSSStyleSheet();
          } catch {
            return this.fail("malformed", "sheetNew", op.id);
          }
          const at = (0, cssomApplyIndex_1.insertIndexFromBefore)(this.materializedSheetIdsOf(hostNode), op.before);
          if (at < 0)
            return this.fail("address_miss", "sheetNew", op.before);
          const next = this.adoptedListOf(hostNode);
          next.splice(at, 0, sheet);
          if (!this.setAdoptedOf(hostNode, next))
            return false;
          this.sheets.set(op.id, sheet);
          this.sheetHost.set(op.id, hostNode);
          return true;
        }
        applySheetDrop(op) {
          const dropByHost = /* @__PURE__ */ new Map();
          for (let i = 0; i < op.ids.length; i++) {
            const id = op.ids[i];
            const sheet = this.sheets.get(id);
            if (sheet === void 0)
              return this.fail("address_miss", "sheetDrop", id);
            const hostNode = this.sheetHost.get(id) ?? 0;
            let set = dropByHost.get(hostNode);
            if (set === void 0) {
              set = /* @__PURE__ */ new Set();
              dropByHost.set(hostNode, set);
            }
            set.add(sheet);
            for (const [ruleId, rule] of this.rules) {
              if (rule.parentStyleSheet === sheet)
                this.rules.delete(ruleId);
            }
            this.sheets.delete(id);
            this.sheetHost.delete(id);
          }
          for (const [hostNode, drop] of dropByHost) {
            const next = this.adoptedListOf(hostNode).filter((s) => !drop.has(s));
            if (!this.setAdoptedOf(hostNode, next))
              return false;
          }
          return true;
        }
        applySheetOrder(op) {
          if (op.ids.length === 0)
            return true;
          const hostNode = this.sheetHost.get(op.ids[0]) ?? 0;
          const next = [];
          for (let i = 0; i < op.ids.length; i++) {
            const sheet = this.sheets.get(op.ids[i]);
            if (sheet === void 0)
              return this.fail("address_miss", "sheetOrder", op.ids[i]);
            next.push(sheet);
          }
          return this.setAdoptedOf(hostNode, next);
        }
        applyRuleNew(op) {
          const sheet = this.sheets.get(op.sheet);
          if (sheet === void 0)
            return this.fail("address_miss", "ruleNew", op.sheet);
          if (this.rules.has(op.id))
            return this.fail("bad_target", "ruleNew", op.id);
          let index;
          if (op.before === frame_1.INSERT_AT_END) {
            index = sheet.cssRules.length;
          } else {
            const beforeRule = this.rules.get(op.before);
            if (beforeRule === void 0)
              return this.fail("address_miss", "ruleNew", op.before);
            index = -1;
            for (let k = 0; k < sheet.cssRules.length; k++) {
              if (sheet.cssRules.item(k) === beforeRule) {
                index = k;
                break;
              }
            }
            if (index < 0)
              return this.fail("address_miss", "ruleNew", op.before);
          }
          let inserted;
          try {
            inserted = sheet.insertRule(this.options.stampCssText?.(op.text) ?? op.text, index);
          } catch (err) {
            const detail = err instanceof Error ? err.message : String(err);
            const text = (op.text || "").slice(0, 180);
            return this.failOp("malformed", "ruleNew", op.id, `insertRule failed sheet=${op.sheet} before=${op.before}: ${detail} :: ${text}`);
          }
          const rule = sheet.cssRules.item(inserted);
          if (rule === null)
            return this.fail("address_miss", "ruleNew", op.id);
          this.rules.set(op.id, rule);
          return true;
        }
        applyRuleDrop(op) {
          const sheet = this.sheets.get(op.sheet);
          if (sheet === void 0)
            return this.fail("address_miss", "ruleDrop", op.sheet);
          for (let i = 0; i < op.ids.length; i++) {
            const id = op.ids[i];
            const rule = this.rules.get(id);
            if (rule === void 0)
              return this.fail("address_miss", "ruleDrop", id);
            let at = -1;
            for (let k = 0; k < sheet.cssRules.length; k++) {
              if (sheet.cssRules.item(k) === rule) {
                at = k;
                break;
              }
            }
            if (at < 0)
              return this.fail("address_miss", "ruleDrop", id);
            sheet.deleteRule(at);
            this.rules.delete(id);
          }
          return true;
        }
        applyRuleSet(op) {
          const rule = this.rules.get(op.id);
          if (rule === void 0)
            return this.fail("address_miss", "ruleSet", op.id);
          const view = this.doc.defaultView;
          const StyleRule = view !== null ? view.CSSStyleRule : void 0;
          const isStyle = StyleRule !== void 0 && rule instanceof StyleRule;
          if ((0, cssomRuleSet_1.planRuleSetApply)(isStyle).mode === "desync") {
            return this.fail("bad_target", "ruleSet", op.id);
          }
          try {
            rule.style.cssText = (0, cssomApplyIndex_1.declarationBlockFromRuleText)(this.options.stampCssText?.(op.text) ?? op.text);
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
              if (childScopeId !== void 0)
                this.options.onNestedHostDrop?.(childScopeId);
            }
          }
          for (let i = 0; i < op.ids.length; i++) {
            const id = op.ids[i];
            const node = this.registry.get(id);
            if (node !== void 0)
              this.registry.unregisterSubtree(node);
          }
          for (const id of [...this.sheets.keys()]) {
            if (this.table.has(id))
              continue;
            const sheet = this.sheets.get(id);
            this.sheets.delete(id);
            this.sheetHost.delete(id);
            if (sheet === void 0)
              continue;
            for (const [ruleId, rule] of this.rules) {
              if (rule.parentStyleSheet === sheet)
                this.rules.delete(ruleId);
            }
          }
          return true;
        }
        applyNodeNew(op) {
          let node;
          if (op.kind === opcodes_1.NodeKind.Element) {
            if (op.ns === elementNs_1.ElementNs.Custom && !(op.uri && op.uri.length > 0)) {
              return this.failOp("malformed", "nodeNew", op.id, "NODE_NEW Custom ns without uri");
            }
            const uri = (0, elementNs_1.elementNsUri)(op.ns, op.uri);
            try {
              node = this.doc.createElementNS(uri, op.name);
            } catch (err) {
              const detail = err instanceof Error ? err.message : String(err);
              return this.failOp("malformed", "nodeNew", op.id, `createElementNS failed kind=${op.kind} name=${op.name} ns=${op.ns}: ${detail}`);
            }
            const attrs = op.nestedHost === true ? op.attrs.filter((a) => !(0, nestedNav_1.isNestedHostNavAttr)(a.name)) : op.attrs;
            if (!applyAttrs(node, attrs, this.options.stampUrl)) {
              const attrNames = attrs.map((a) => a.name).join(",");
              return this.failOp("malformed", "nodeNew", op.id, `setAttribute failed on <${op.name}> attrs=[${attrNames}]`);
            }
            if (op.nestedHost === true && node.localName.toLowerCase() === "iframe") {
              const iframe = node;
              (0, nestedNav_1.ensureNestedHostSandboxAccess)(iframe);
              (0, projectedBlankIframe_1.stampProjectedStandardsSrcdoc)(iframe);
            }
            if (op.nestedHost === true && op.childScopeId != null) {
              this.childScopes.set(op.id, op.childScopeId);
              this.nestedHostIds.add(op.id);
            }
          } else if (op.kind === opcodes_1.NodeKind.Text) {
            try {
              node = this.doc.createTextNode(op.value);
            } catch (err) {
              const detail = err instanceof Error ? err.message : String(err);
              return this.failOp("malformed", "nodeNew", op.id, `createTextNode failed len=${op.value?.length ?? -1}: ${detail}`);
            }
          } else if (op.kind === opcodes_1.NodeKind.Comment) {
            try {
              node = this.doc.createComment(op.value);
            } catch (err) {
              const detail = err instanceof Error ? err.message : String(err);
              return this.failOp("malformed", "nodeNew", op.id, `createComment failed: ${detail}`);
            }
          } else if (op.kind === opcodes_1.NodeKind.Doctype) {
            const want = op.name || "html";
            const existing = this.doc.doctype;
            if (existing && existing.name === want) {
              node = existing;
            } else {
              if (existing)
                existing.remove();
              const created = this.doc.implementation.createDocumentType(want, "", "");
              if (created == null) {
                return this.failOp("malformed", "nodeNew", op.id, "createDocumentType returned null (document has no browsing context)");
              }
              node = created;
            }
          } else if (op.kind === opcodes_1.NodeKind.ShadowRoot) {
            const host = this.registry.get(op.host);
            if (!host || host.nodeType !== Node.ELEMENT_NODE)
              return this.fail("address_miss", "nodeNew", op.host);
            const el2 = host;
            if (el2.shadowRoot)
              return this.fail("bad_target", "nodeNew", op.id);
            const init = { mode: op.mode === frame_1.SHADOW_MODE_CLOSED ? "closed" : "open" };
            if ((op.initFlags & frame_1.SHADOW_INIT_DELEGATES_FOCUS) !== 0)
              init.delegatesFocus = true;
            const extra = init;
            if ((op.initFlags & frame_1.SHADOW_INIT_CLONABLE) !== 0)
              extra.clonable = true;
            if ((op.initFlags & frame_1.SHADOW_INIT_SERIALIZABLE) !== 0)
              extra.serializable = true;
            try {
              node = el2.attachShadow(init);
              if (init.mode === "closed") {
                (0, closedShadowLookup_1.registerClosedShadowRoot)(el2, node);
              }
            } catch (err) {
              const detail = err instanceof Error ? err.message : String(err);
              return this.failOp("malformed", "nodeNew", op.id, `attachShadow failed host=${op.host} mode=${op.mode} flags=${op.initFlags}: ${detail}`);
            }
          } else {
            return this.failOp("malformed", "nodeNew", op.id, `NODE_NEW unsupported kind=${op.kind}`);
          }
          this.registry.register(op.id, node);
          return true;
        }
        applyInsert(op) {
          const parent = this.registry.get(op.parent);
          if (!parent)
            return this.fail("address_miss", "insert", op.parent);
          let before = null;
          if (op.before !== frame_1.INSERT_AT_END) {
            before = this.registry.get(op.before) ?? null;
            if (before === null)
              return this.fail("address_miss", "insert", op.before);
          }
          for (let i = 0; i < op.ids.length; i++) {
            const id = op.ids[i];
            const node = this.registry.get(id);
            if (!node)
              return this.fail("address_miss", "insert", id);
            if (isHtmlScriptElement(node)) {
              (0, projectedBlankIframe_1.ensureProjectedK5Csp)(this.doc);
              const documentBase = this.options.getDocumentBaseUrl?.() || this.options.documentBaseUrl || "";
              if (documentBase)
                (0, projectedBlankIframe_1.ensureProjectedDocumentBase)(this.doc, documentBase);
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
          if (documentBase)
            (0, projectedBlankIframe_1.ensureProjectedDocumentBase)(this.doc, documentBase);
        }
        applyRemove(op) {
          const parent = this.registry.get(op.parent);
          if (!parent)
            return this.fail("address_miss", "remove", op.parent);
          for (let i = 0; i < op.ids.length; i++) {
            const id = op.ids[i];
            const node = this.registry.get(id);
            if (!node)
              return this.fail("address_miss", "remove", id);
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
          if (!node || node.nodeType !== Node.ELEMENT_NODE)
            return this.fail("address_miss", "attrSet", op.node);
          if (isHtmlScriptElement(node) && op.attrs.some((a) => a.name === "src" && a.value.length > 0)) {
            (0, projectedBlankIframe_1.ensureProjectedK5Csp)(this.doc);
          }
          const attrs = this.nestedHostIds.has(op.node) ? op.attrs.filter((a) => !(0, nestedNav_1.isNestedHostNavAttr)(a.name)) : op.attrs;
          if (!applyAttrs(node, attrs, this.options.stampUrl)) {
            return this.fail("malformed", "attrSet", op.node);
          }
          if (this.nestedHostIds.has(op.node) && node.nodeType === Node.ELEMENT_NODE && node.localName.toLowerCase() === "iframe") {
            const iframe = node;
            (0, nestedNav_1.ensureNestedHostSandboxAccess)(iframe);
            (0, projectedBlankIframe_1.stampProjectedStandardsSrcdoc)(iframe);
          }
          this.maybeInstallNestedHost(op.node, node);
          return true;
        }
        applyAttrDel(op) {
          const node = this.registry.get(op.node);
          if (!node || node.nodeType !== Node.ELEMENT_NODE)
            return this.fail("address_miss", "attrDel", op.node);
          const el2 = node;
          for (let i = 0; i < op.names.length; i++)
            el2.removeAttribute(op.names[i]);
          return true;
        }
        applyTextSet(op) {
          const node = this.registry.get(op.node);
          if (!node)
            return this.fail("address_miss", "textSet", op.node);
          node.textContent = op.value;
          return true;
        }
        applyPropSet(op) {
          if (this.propDirty.isDirty(op.node)) {
            this.propDirty.hold(op);
            return true;
          }
          const node = this.registry.get(op.node);
          if (!node || node.nodeType !== Node.ELEMENT_NODE)
            return this.fail("address_miss", "propSet", op.node);
          const el2 = node;
          if (op.propId === propSet_1.PROP_ID_VALUE && "value" in el2) {
            el2.value = String(op.value);
            return true;
          }
          if (op.propId === propSet_1.PROP_ID_CHECKED && "checked" in el2) {
            el2.checked = Boolean(op.value);
            return true;
          }
          if (op.propId === propSet_1.PROP_ID_SELECTED && el2 instanceof HTMLOptionElement) {
            el2.selected = Boolean(op.value);
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
          if (!this.nestedHostIds.has(id))
            return;
          if (node.nodeType !== Node.ELEMENT_NODE || node.localName.toLowerCase() !== "iframe") {
            return;
          }
          const childScopeId = this.childScopes.get(id);
          if (childScopeId === void 0)
            return;
          this.options.onNestedHost?.(node, childScopeId);
        }
      };
      exports.DomFrameApplier = DomFrameApplier2;
      function isHtmlScriptElement(node) {
        return node.nodeType === Node.ELEMENT_NODE && node.localName === "script" && node.namespaceURI === "http://www.w3.org/1999/xhtml";
      }
      function applyAttrs(el2, attrs, stampUrl) {
        return (0, attrApply_1.applyAttrPairs)((name, value) => {
          const stamped = stampUrl ? stampUrl(name, value) : value;
          el2.setAttribute(name, stamped);
        }, attrs);
      }
    }
  });

  // ../packages/page-projection/dist/projected/pendingNestedHostAudit.js
  var require_pendingNestedHostAudit = __commonJS({
    "../packages/page-projection/dist/projected/pendingNestedHostAudit.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.pendingNestedHostAuditMessage = void 0;
      function pendingNestedHostAuditMessage(pendingByContext, opts) {
        for (const [contextId, queueLen] of pendingByContext) {
          if (queueLen === 0)
            continue;
          if (opts.hasSession(contextId))
            continue;
          const hostNodeId = opts.hostNodeForContext(contextId);
          if (hostNodeId === void 0)
            continue;
          if (!opts.isHostMarked(hostNodeId)) {
            return `pending nested frames ctx${contextId} host node ${hostNodeId} not marked (${queueLen} queued)`;
          }
          return `pending nested frames ctx${contextId} host node ${hostNodeId} never bound (${queueLen} queued)`;
        }
        return null;
      }
      exports.pendingNestedHostAuditMessage = pendingNestedHostAuditMessage;
    }
  });

  // ../packages/page-projection/dist/projected/input/projectedNativeGuard.js
  var require_projectedNativeGuard = __commonJS({
    "../packages/page-projection/dist/projected/input/projectedNativeGuard.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.attachProjectedNativeGuard = exports.layoutViewportSize = exports.suppressProjectedDefault = exports.isProjectedNavigable = exports.eventTargetElement = void 0;
      function eventTargetElement(target) {
        if (!target || typeof target !== "object")
          return null;
        const node = target;
        if (node.nodeType === 1)
          return node;
        const parent = node.parentElement;
        return parent;
      }
      exports.eventTargetElement = eventTargetElement;
      function isProjectedNavigable(target) {
        const el2 = eventTargetElement(target);
        if (el2 == null)
          return false;
        if (typeof el2.closest !== "function")
          return false;
        return el2.closest("a[href], area[href]") != null;
      }
      exports.isProjectedNavigable = isProjectedNavigable;
      function suppressProjectedDefault(event) {
        if (event.cancelable)
          event.preventDefault();
        event.stopPropagation();
      }
      exports.suppressProjectedDefault = suppressProjectedDefault;
      function layoutViewportSize(win) {
        const el2 = win.document?.documentElement;
        const width = el2?.clientWidth || win.innerWidth;
        const height = el2?.clientHeight || win.innerHeight;
        return { width, height };
      }
      exports.layoutViewportSize = layoutViewportSize;
      function installProjectedTouchSurface(doc) {
        const touchAction = "manipulation";
        const root = doc.documentElement;
        if (root)
          root.style.touchAction = touchAction;
        if (doc.body)
          doc.body.style.touchAction = touchAction;
      }
      function attachProjectedNativeGuard(doc, opts) {
        installProjectedTouchSurface(doc);
        const onActivate = (event) => suppressProjectedDefault(event);
        const onPointerDown = (event) => {
          const pe = event;
          if (typeof pe.button === "number" && pe.button !== 0)
            return;
          if (isProjectedNavigable(event.target))
            suppressProjectedDefault(event);
        };
        const onTouchStart = (_event) => {
          opts?.onTouchStartSeen?.();
        };
        const onTouchEnd = (event) => {
          if (isProjectedNavigable(event.target))
            suppressProjectedDefault(event);
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
      exports.attachProjectedNativeGuard = attachProjectedNativeGuard;
    }
  });

  // ../packages/page-projection/dist/projected/nestedResyncSurface.js
  var require_nestedResyncSurface = __commonJS({
    "../packages/page-projection/dist/projected/nestedResyncSurface.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.createNestedResyncSurface = void 0;
      var projectedNativeGuard_1 = require_projectedNativeGuard();
      var projectedBlankIframe_1 = require_projectedBlankIframe();
      function docOf(iframe) {
        const doc = iframe.contentDocument;
        if (!doc)
          throw new Error("nested surface: no contentDocument");
        return doc;
      }
      async function reseedHostDocument(iframe) {
        const live = iframe.contentDocument;
        if ((0, projectedBlankIframe_1.isProjectedStandardsSkeleton)(live)) {
          (0, projectedBlankIframe_1.stripProjectedSkeleton)(live);
          (0, projectedNativeGuard_1.attachProjectedNativeGuard)(live);
          return live;
        }
        (0, projectedBlankIframe_1.stampProjectedStandardsSrcdoc)(iframe);
        const doc = await (0, projectedBlankIframe_1.whenProjectedStandardsReady)(iframe);
        (0, projectedNativeGuard_1.attachProjectedNativeGuard)(doc);
        return doc;
      }
      function createNestedResyncSurface(primaryHost) {
        const primaryDoc = primaryHost.contentDocument;
        if (primaryDoc)
          (0, projectedNativeGuard_1.attachProjectedNativeGuard)(primaryDoc);
        let activeIframe = primaryHost;
        let standbyIframe = null;
        async function attachStandbySibling() {
          const parent = activeIframe.parentElement;
          if (!parent)
            throw new Error("nested surface: host has no parent");
          const iframe = document.createElement("iframe");
          iframe.title = "Nested projected resync build";
          iframe.style.cssText = activeIframe.style.cssText;
          iframe.style.visibility = "hidden";
          (0, projectedBlankIframe_1.stampProjectedStandardsSrcdoc)(iframe);
          parent.insertBefore(iframe, activeIframe.nextSibling);
          const doc = await (0, projectedBlankIframe_1.whenProjectedStandardsReady)(iframe);
          (0, projectedNativeGuard_1.attachProjectedNativeGuard)(doc);
          return iframe;
        }
        return {
          get document() {
            return docOf(activeIframe);
          },
          async beginResyncBuild() {
            if (standbyIframe !== null)
              standbyIframe.remove();
            standbyIframe = await attachStandbySibling();
            return docOf(standbyIframe);
          },
          commitSwap() {
            const built = standbyIframe;
            if (built === null)
              throw new Error("nested surface: commitSwap with no resync build");
            const outgoing = activeIframe;
            outgoing.style.visibility = "hidden";
            built.style.visibility = "";
            activeIframe = built;
            standbyIframe = null;
            if (outgoing !== primaryHost)
              outgoing.remove();
            return docOf(activeIframe);
          },
          discardBuild() {
            if (standbyIframe === null)
              return;
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
      exports.createNestedResyncSurface = createNestedResyncSurface;
    }
  });

  // ../packages/page-projection/dist/projected/registry.js
  var require_registry = __commonJS({
    "../packages/page-projection/dist/projected/registry.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.PageProjectionRegistry = void 0;
      var closedShadowLookup_1 = require_closedShadowLookup();
      var PageProjectionRegistry2 = class {
        nodesById = /* @__PURE__ */ new Map();
        idsByNode = /* @__PURE__ */ new WeakMap();
        /** Registers (or re-registers) one node under `id`. O(1). */
        register(id, node) {
          if (id <= 0)
            return;
          const existing = this.nodesById.get(id);
          if (existing && existing !== node)
            this.idsByNode.delete(existing);
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
            if (id != null)
              return id;
            cur = cur.parentNode ?? (cur.nodeType === Node.DOCUMENT_FRAGMENT_NODE && cur.host != null ? cur.host : null);
          }
          return void 0;
        }
        /** Removes exactly one id, without touching its node's descendants. */
        unregister(id) {
          const node = this.nodesById.get(id);
          if (!node)
            return;
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
            for (const child of Array.from(node.childNodes))
              stack.push(child);
            if (node.nodeType === Node.ELEMENT_NODE) {
              const sr = (0, closedShadowLookup_1.resolveShadowRoot)(node);
              if (sr)
                stack.push(sr);
            }
          }
        }
        /** Total registered ids — perf/soak signal. */
        get size() {
          return this.nodesById.size;
        }
        forEachId(fn) {
          for (const [id, node] of this.nodesById)
            fn(id, node);
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
      exports.PageProjectionRegistry = PageProjectionRegistry2;
    }
  });

  // ../packages/page-projection/dist/core/tableDigest.js
  var require_tableDigest = __commonJS({
    "../packages/page-projection/dist/core/tableDigest.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.tableDigestsEqual = exports.digestReplicatedTable = void 0;
      function digestReplicatedTable2(table) {
        return { rowCount: table.size, tableHash: table.tableHash.toString() };
      }
      exports.digestReplicatedTable = digestReplicatedTable2;
      function tableDigestsEqual(a, b) {
        return a.rowCount === b.rowCount && a.tableHash === b.tableHash;
      }
      exports.tableDigestsEqual = tableDigestsEqual;
    }
  });

  // ../packages/page-projection/dist/core/telemetry.js
  var require_telemetry = __commonJS({
    "../packages/page-projection/dist/core/telemetry.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.desyncPhase = exports.isProjectionTelemetryMessage = exports.stampCssomPoll = exports.countCssomOps = exports.emptyCssomPollStats = exports.CSSOM_POLL_STAT_KEYS = exports.TELEMETRY_BOOL_CAPS = exports.LAB_TELEMETRY_DEFAULTS = exports.DEFAULT_TELEMETRY_CONFIG = exports.TELEMETRY_WIRE_VERSION = void 0;
      var opcodes_1 = require_opcodes();
      exports.TELEMETRY_WIRE_VERSION = 2;
      exports.DEFAULT_TELEMETRY_CONFIG = {
        enabled: false,
        frameEmitted: true,
        transportDeferred: true,
        aggregate: true,
        applyResult: true,
        desync: true,
        applyOverrun: true,
        clock: true,
        cssomPoll: false,
        aggregateIntervalMs: 1e4
      };
      exports.LAB_TELEMETRY_DEFAULTS = {
        enabled: true,
        frameEmitted: true,
        transportDeferred: true,
        aggregate: true,
        applyResult: true,
        desync: true,
        applyOverrun: true,
        clock: true,
        cssomPoll: false,
        aggregateIntervalMs: 2e3
      };
      exports.TELEMETRY_BOOL_CAPS = [
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
      exports.CSSOM_POLL_STAT_KEYS = [
        "source",
        "sequence",
        "pollMs",
        "identityWalkMs",
        "cssTextSerializeMs",
        "readableSheetCount",
        "unreadableSheetCount",
        "topLevelRulesVisited",
        "topLevelRulesSerialized",
        "styleTagTextUnchangedSheets",
        "rulesAppeared",
        "rulesDisappeared",
        "rulesTextChangedInPlace",
        "sheetsWithRuleListChanged",
        "sheetsAborted",
        "slotsSkipped",
        "idleSlices",
        "opCount",
        "opSheetNew",
        "opSheetDrop",
        "opSheetOrder",
        "opRuleNew",
        "opRuleDrop",
        "opRuleSet"
      ];
      function emptyCssomPollStats() {
        return {
          source: "idle",
          sequence: 0,
          pollMs: 0,
          identityWalkMs: 0,
          cssTextSerializeMs: 0,
          readableSheetCount: 0,
          unreadableSheetCount: 0,
          topLevelRulesVisited: 0,
          topLevelRulesSerialized: 0,
          styleTagTextUnchangedSheets: 0,
          rulesAppeared: 0,
          rulesDisappeared: 0,
          rulesTextChangedInPlace: 0,
          sheetsWithRuleListChanged: 0,
          sheetsAborted: 0,
          slotsSkipped: 0,
          idleSlices: 0,
          opCount: 0,
          opSheetNew: 0,
          opSheetDrop: 0,
          opSheetOrder: 0,
          opRuleNew: 0,
          opRuleDrop: 0,
          opRuleSet: 0
        };
      }
      exports.emptyCssomPollStats = emptyCssomPollStats;
      function countCssomOps(ops) {
        let opSheetNew = 0;
        let opSheetDrop = 0;
        let opSheetOrder = 0;
        let opRuleNew = 0;
        let opRuleDrop = 0;
        let opRuleSet = 0;
        for (let i = 0; i < ops.length; i++) {
          switch (ops[i].op) {
            case opcodes_1.OpCode.SheetNew:
              opSheetNew += 1;
              break;
            case opcodes_1.OpCode.SheetDrop:
              opSheetDrop += 1;
              break;
            case opcodes_1.OpCode.SheetOrder:
              opSheetOrder += 1;
              break;
            case opcodes_1.OpCode.RuleNew:
              opRuleNew += 1;
              break;
            case opcodes_1.OpCode.RuleDrop:
              opRuleDrop += 1;
              break;
            case opcodes_1.OpCode.RuleSet:
              opRuleSet += 1;
              break;
            default:
              break;
          }
        }
        return {
          opCount: opSheetNew + opSheetDrop + opSheetOrder + opRuleNew + opRuleDrop + opRuleSet,
          opSheetNew,
          opSheetDrop,
          opSheetOrder,
          opRuleNew,
          opRuleDrop,
          opRuleSet
        };
      }
      exports.countCssomOps = countCssomOps;
      function stampCssomPoll(stats, patch) {
        return { ...stats, ...patch };
      }
      exports.stampCssomPoll = stampCssomPoll;
      function isProjectionTelemetryMessage(value) {
        if (typeof value !== "object" || value === null)
          return false;
        const v = value;
        if (v.v !== exports.TELEMETRY_WIRE_VERSION || typeof v.kind !== "string")
          return false;
        return typeof v.contextId === "number" && Number.isInteger(v.contextId) && v.contextId >= 1;
      }
      exports.isProjectionTelemetryMessage = isProjectionTelemetryMessage;
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
      exports.desyncPhase = desyncPhase;
    }
  });

  // ../packages/page-projection/dist/projected/srcsetParse.js
  var require_srcsetParse = __commonJS({
    "../packages/page-projection/dist/projected/srcsetParse.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.mapSrcset = exports.parseSrcset = void 0;
      function isAsciiWhitespace(c) {
        return c === " " || c === "	" || c === "\n" || c === "\r" || c === "\f";
      }
      function parseSrcset(input) {
        const candidates = [];
        let pos = 0;
        const len = input.length;
        while (pos < len) {
          while (pos < len && (input[pos] === "," || isAsciiWhitespace(input[pos])))
            pos += 1;
          if (pos >= len)
            break;
          const urlStart = pos;
          while (pos < len && !isAsciiWhitespace(input[pos]))
            pos += 1;
          let url = input.slice(urlStart, pos);
          if (url.endsWith(",")) {
            url = url.replace(/,+$/, "");
            if (url)
              candidates.push({ url, descriptor: "" });
            continue;
          }
          while (pos < len && isAsciiWhitespace(input[pos]))
            pos += 1;
          const descParts = [];
          let current = "";
          let state = "in";
          while (pos < len) {
            const c = input[pos];
            if (state === "in") {
              if (isAsciiWhitespace(c)) {
                if (current) {
                  descParts.push(current);
                  current = "";
                  state = "after";
                }
                pos += 1;
              } else if (c === ",") {
                if (current)
                  descParts.push(current);
                current = "";
                pos += 1;
                break;
              } else if (c === "(") {
                current += c;
                state = "parens";
                pos += 1;
              } else {
                current += c;
                pos += 1;
              }
            } else if (state === "parens") {
              current += c;
              if (c === ")")
                state = "in";
              pos += 1;
            } else if (isAsciiWhitespace(c)) {
              pos += 1;
            } else {
              state = "in";
            }
          }
          if (current)
            descParts.push(current);
          if (url)
            candidates.push({ url, descriptor: descParts.join(" ") });
        }
        return candidates;
      }
      exports.parseSrcset = parseSrcset;
      function mapSrcset(input, mapUrl) {
        return parseSrcset(input).map((c) => {
          const u = mapUrl(c.url);
          return c.descriptor ? `${u} ${c.descriptor}` : u;
        }).join(", ");
      }
      exports.mapSrcset = mapSrcset;
    }
  });

  // ../packages/page-projection/dist/projected/sessionBindingAuth.js
  var require_sessionBindingAuth = __commonJS({
    "../packages/page-projection/dist/projected/sessionBindingAuth.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.stampAttrAuth = exports.stampAuthInServedBody = exports.stampCssTextAuth = exports.stampSrcsetAuth = exports.appendSessionBindingQuery = exports.appendCacheBust = exports.appendSessionAuth = exports.isVirtualAssetUrl = exports.SessionCacheBustQueryParam = exports.SessionAuthQueryParam = void 0;
      var srcsetParse_1 = require_srcsetParse();
      exports.SessionAuthQueryParam = "speculum-session-token";
      exports.SessionCacheBustQueryParam = "speculum-cache-bust";
      function isVirtualAssetUrl(url) {
        return url.startsWith("/w7s/virtual-") || url.includes("/virtual-");
      }
      exports.isVirtualAssetUrl = isVirtualAssetUrl;
      function appendSessionAuth(url, token, assetBaseUrl = "") {
        if (!url || !token)
          return url;
        if (!isVirtualAssetUrl(url))
          return url;
        const base = assetBaseUrl.replace(/\/$/, "");
        const absolute = url.startsWith("http") ? url : `${base}${url.startsWith("/") ? url : `/${url}`}`;
        return setReservedParam(absolute, exports.SessionAuthQueryParam, token);
      }
      exports.appendSessionAuth = appendSessionAuth;
      function appendCacheBust(url, value) {
        if (!url)
          return url;
        return setReservedParam(url, exports.SessionCacheBustQueryParam, String(value));
      }
      exports.appendCacheBust = appendCacheBust;
      function appendSessionBindingQuery(url, sessionId, token) {
        url.searchParams.set("sessionId", sessionId);
        url.searchParams.set(exports.SessionAuthQueryParam, token);
        return url;
      }
      exports.appendSessionBindingQuery = appendSessionBindingQuery;
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
        if (!token || !value)
          return value;
        return (0, srcsetParse_1.mapSrcset)(value, (u) => appendSessionAuth(u, token, assetBaseUrl));
      }
      exports.stampSrcsetAuth = stampSrcsetAuth;
      function stampCssTextAuth(css, token, assetBaseUrl) {
        if (!token || !css)
          return css;
        let out = css.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (match, quote, raw) => {
          if (!isVirtualAssetUrl(raw))
            return match;
          return `url(${quote}${appendSessionAuth(raw, token, assetBaseUrl)}${quote})`;
        });
        out = out.replace(/@import\s+(['"])([^'"]+)\1/gi, (match, quote, raw) => {
          if (!isVirtualAssetUrl(raw))
            return match;
          return `@import ${quote}${appendSessionAuth(raw, token, assetBaseUrl)}${quote}`;
        });
        out = mapImageSetInners(out, (inner) => inner.replace(/(['"]?)(\/?w7s\/virtual-[^'")\s]+|https?:\/\/[^'")\s]*\/virtual-[^'")\s]+)\1/gi, (m, q, u) => {
          if (!isVirtualAssetUrl(u))
            return m;
          return `${q}${appendSessionAuth(u, token, assetBaseUrl)}${q}`;
        }));
        return out;
      }
      exports.stampCssTextAuth = stampCssTextAuth;
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
            if (c === "(")
              depth++;
            else if (c === ")")
              depth--;
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
      function stampAuthInServedBody(body, contentType, token) {
        if (!token || !body)
          return body;
        const ct = contentType.toLowerCase();
        if (ct.includes("text/css"))
          return stampCssTextAuth(body, token, "");
        if (ct.includes("mpegurl") || ct.includes("dash+xml") || ct.includes("x-mpegurl") || ct.includes("apple.mpegurl")) {
          return stampManifestAuth(body, token);
        }
        return body;
      }
      exports.stampAuthInServedBody = stampAuthInServedBody;
      function stampManifestAuth(body, token) {
        return body.split("\n").map((line) => {
          const trimmed = line.trim();
          if (!trimmed)
            return line;
          if (trimmed.startsWith("#")) {
            return line.replace(/URI="([^"]+)"/gi, (_m, raw) => {
              if (!isVirtualAssetUrl(raw))
                return _m;
              return `URI="${appendSessionAuth(raw, token, "")}"`;
            });
          }
          if (!isVirtualAssetUrl(trimmed))
            return line;
          const lead = line.match(/^\s*/)?.[0] ?? "";
          return lead + appendSessionAuth(trimmed, token, "");
        }).join("\n");
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
        if (!token || !value)
          return value;
        const lower = name.toLowerCase();
        if (!URL_ATTR_STAMP.has(lower))
          return value;
        if (lower === "srcset" || lower === "imagesrcset") {
          return stampSrcsetAuth(value, token, assetBaseUrl);
        }
        if (lower === "style") {
          return stampCssTextAuth(value, token, assetBaseUrl);
        }
        return appendSessionAuth(value, token, assetBaseUrl);
      }
      exports.stampAttrAuth = stampAttrAuth;
    }
  });

  // ../packages/page-projection/dist/projected/projectedApplyGate.js
  var require_projectedApplyGate = __commonJS({
    "../packages/page-projection/dist/projected/projectedApplyGate.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.ProjectedApplyGate = exports.PROJECTED_APPLY_GATE_MAX_OVERFLOW_STREAK = exports.PROJECTED_APPLY_GATE_MAX_PENDING = void 0;
      exports.PROJECTED_APPLY_GATE_MAX_PENDING = 256;
      exports.PROJECTED_APPLY_GATE_MAX_OVERFLOW_STREAK = 3;
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
          this.maxPending = callbacks.maxPending ?? exports.PROJECTED_APPLY_GATE_MAX_PENDING;
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
          if (this.flightDepth === 0)
            return;
          this.flightDepth--;
          if (this.flightDepth > 0)
            return;
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
          if (this.draining)
            return;
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
      exports.ProjectedApplyGate = ProjectedApplyGate;
    }
  });

  // ../packages/page-projection/dist/projected/nestedProjectedApply.js
  var require_nestedProjectedApply = __commonJS({
    "../packages/page-projection/dist/projected/nestedProjectedApply.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.NestedProjectedApply = void 0;
      var decode_1 = require_decode();
      var applyDom_1 = require_applyDom();
      var nestedResyncSurface_1 = require_nestedResyncSurface();
      var registry_1 = require_registry();
      var frame_1 = require_frame();
      var tableDigest_1 = require_tableDigest();
      var telemetry_1 = require_telemetry();
      var sessionBindingAuth_1 = require_sessionBindingAuth();
      var projectedApplyGate_1 = require_projectedApplyGate();
      var MAX_RESYNC_ATTEMPTS = 3;
      var RESYNC_BACKOFF_MS = 300;
      var RESYNC_RESPONSE_TIMEOUT_MS = 5e3;
      var NestedProjectedApply = class {
        contextId;
        hostIframe;
        surface;
        persistent = new decode_1.PersistentStringTable();
        assembler = new decode_1.FramePartAssembler();
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
          this.surface = (0, nestedResyncSurface_1.createNestedResyncSurface)(opts.hostIframe);
          const registry = new registry_1.PageProjectionRegistry();
          registry.register(frame_1.DOCUMENT_ID, opts.document);
          this.live = { applier: this.createApplier(opts.document, registry, true), registry };
          this.applyGate = new projectedApplyGate_1.ProjectedApplyGate({
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
          if (this.lastDesyncReason === null)
            return null;
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
          const decoded = (0, decode_1.decodeFramePart)(bytes, this.persistent);
          if (!decoded.ok) {
            this.desync(decoded.reason, { message: decoded.message });
            return;
          }
          if (decoded.part.contextId !== this.contextId)
            return;
          const assembled = this.assembler.ingest(decoded.part);
          if (assembled === "missing_part" || assembled === "malformed") {
            this.desync(assembled);
            return;
          }
          if (assembled === null)
            return;
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
            table: (0, tableDigest_1.digestReplicatedTable)(this.live.applier.replicatedTable)
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
          return new applyDom_1.DomFrameApplier(doc, registry, {
            stampUrl: (name, value) => (0, sessionBindingAuth_1.stampAttrAuth)(name, value, token(), base()),
            stampCssText: (text) => (0, sessionBindingAuth_1.stampCssTextAuth)(text, token(), base()),
            getDocumentBaseUrl: () => this.getDocumentBaseUrl?.() || "",
            onWarn: (message) => {
              this.onTelemetry?.({
                v: telemetry_1.TELEMETRY_WIRE_VERSION,
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
            onOverrun: (durationMs2, lastSequence) => {
              this.onTelemetry?.({
                v: telemetry_1.TELEMETRY_WIRE_VERSION,
                contextId: this.contextId,
                kind: "applyOverrun",
                t: performance.now(),
                generation: this.generation,
                sequence: lastSequence,
                durationMs: durationMs2,
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
            v: telemetry_1.TELEMETRY_WIRE_VERSION,
            contextId: this.contextId,
            kind: "applyGateOverflow",
            t: performance.now(),
            generation: this.generation,
            sequence: this.lastSequence,
            cap: info.cap,
            attemptedDepth: info.attemptedDepth,
            streak
          });
          if (streak >= projectedApplyGate_1.PROJECTED_APPLY_GATE_MAX_OVERFLOW_STREAK) {
            this.resyncExhausted = true;
            this.onTelemetry?.({
              v: telemetry_1.TELEMETRY_WIRE_VERSION,
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
          if (info.maxDepth === 0 && info.drained === 0 && !info.overflow)
            return;
          this.onTelemetry?.({
            v: telemetry_1.TELEMETRY_WIRE_VERSION,
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
          if (epoch !== this.surfaceEpoch)
            return;
          const registry = new registry_1.PageProjectionRegistry();
          registry.register(frame_1.DOCUMENT_ID, this.surface.document);
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
          if (epoch !== this.surfaceEpoch)
            return;
          const registry = new registry_1.PageProjectionRegistry();
          registry.register(frame_1.DOCUMENT_ID, doc);
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
          if (built === null)
            return;
          this.surface.commitSwap();
          this.live = { applier: built.applier, registry: built.registry };
          this.resync = null;
          this.resyncAttempts = 0;
          this.resyncExhausted = false;
          this.lastDesyncReason = null;
          this.lastDesyncMessage = null;
          this.lastSequence = frame.sequence;
          this.onTelemetry?.({
            v: telemetry_1.TELEMETRY_WIRE_VERSION,
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
            v: telemetry_1.TELEMETRY_WIRE_VERSION,
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
          if (this.resyncExhausted)
            return;
          if (this.resyncBackoffTimer !== null || this.resyncTimeoutTimer !== null || this.resync !== null)
            return;
          const attempt = this.resyncAttempts + 1;
          if (attempt > MAX_RESYNC_ATTEMPTS) {
            this.resyncExhausted = true;
            this.onTelemetry?.({
              v: telemetry_1.TELEMETRY_WIRE_VERSION,
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
              v: telemetry_1.TELEMETRY_WIRE_VERSION,
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
            v: telemetry_1.TELEMETRY_WIRE_VERSION,
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
            v: telemetry_1.TELEMETRY_WIRE_VERSION,
            contextId: this.contextId,
            kind: "desynced",
            t: performance.now(),
            generation: this.generation,
            sequence: extra?.gotSequence ?? this.lastSequence,
            errorCode: reason,
            phase: extra?.phase ?? (0, telemetry_1.desyncPhase)(reason),
            expectedSequence: extra?.expectedSequence,
            op: extra?.op,
            id: extra?.id,
            message: extra?.message,
            expected: extra?.expected?.toString(),
            actual: extra?.actual?.toString()
          });
          if (extra?.requestResync === false)
            return;
          this.scheduleResyncAttempt(reason);
        }
      };
      exports.NestedProjectedApply = NestedProjectedApply;
    }
  });

  // ../packages/page-projection/dist/projected/surface.js
  var require_surface = __commonJS({
    "../packages/page-projection/dist/projected/surface.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.createSurfaceHost = void 0;
      var projectedBlankIframe_1 = require_projectedBlankIframe();
      async function attachBareIframe(container) {
        const iframe = document.createElement("iframe");
        iframe.title = "Projected surface";
        iframe.style.cssText = "position:absolute;inset:0;width:100%;height:100%;border:0;background:#fff;touch-action:manipulation";
        (0, projectedBlankIframe_1.stampProjectedStandardsSrcdoc)(iframe);
        container.appendChild(iframe);
        await (0, projectedBlankIframe_1.whenProjectedStandardsReady)(iframe);
        return iframe;
      }
      function docOf(iframe) {
        const doc = iframe.contentDocument;
        if (!doc)
          throw new Error("surface: no contentDocument");
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
            return docOf(activeIframe);
          },
          async beginResyncBuild() {
            if (standbyIframe !== null)
              standbyIframe.remove();
            standbyIframe = await attachBareIframe(stage);
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
            if (standbyIframe === null)
              return;
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
      exports.createSurfaceHost = createSurfaceHost;
    }
  });

  // ../packages/page-projection/dist/projected/ProjectionClient.js
  var require_ProjectionClient = __commonJS({
    "../packages/page-projection/dist/projected/ProjectionClient.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.createProjectionClient = exports.ProjectionClient = void 0;
      var decode_1 = require_decode();
      var applyDom_1 = require_applyDom();
      var pendingNestedHostAudit_1 = require_pendingNestedHostAudit();
      var nestedProjectedApply_1 = require_nestedProjectedApply();
      var registry_1 = require_registry();
      var surface_1 = require_surface();
      var tableDigest_1 = require_tableDigest();
      var frame_1 = require_frame();
      var telemetry_1 = require_telemetry();
      var sessionBindingAuth_1 = require_sessionBindingAuth();
      var projectedBlankIframe_1 = require_projectedBlankIframe();
      var nestedNav_1 = require_nestedNav();
      var projectedApplyGate_1 = require_projectedApplyGate();
      var MAX_RESYNC_ATTEMPTS = 3;
      var RESYNC_BACKOFF_MS = 300;
      var RESYNC_RESPONSE_TIMEOUT_MS = 5e3;
      var ProjectionClient = class _ProjectionClient {
        persistentStrings = new decode_1.PersistentStringTable();
        assembler = new decode_1.FramePartAssembler();
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
          const registry = new registry_1.PageProjectionRegistry();
          registry.register(frame_1.DOCUMENT_ID, this.surface.document);
          this.live = { applier: this.createApplier(this.surface.document, registry, true), registry };
          this.applyGate = new projectedApplyGate_1.ProjectedApplyGate({
            onOverflow: (info) => this.handleApplyGateOverflow(info),
            onFlightEnd: (info) => this.handleApplyGateFlightEnd(info)
          });
        }
        /** Composition-root entry — surface iframe is born with standards srcdoc before use. */
        static async create(opts) {
          const surface = await (0, surface_1.createSurfaceHost)(opts.surfaceHost, {
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
              if (existing.hostIframe === iframe && liveDoc != null && existing.registry.get(frame_1.DOCUMENT_ID) === liveDoc && liveDoc.defaultView != null) {
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
          (0, nestedNav_1.ensureNestedHostSandboxAccess)(iframe);
          if (!(0, projectedBlankIframe_1.isProjectedStandardsSkeleton)(liveDoc) && iframe.srcdoc !== projectedBlankIframe_1.PROJECTED_STANDARDS_SRCDOC) {
            (0, projectedBlankIframe_1.stampProjectedStandardsSrcdoc)(iframe);
          }
          const abort = new AbortController();
          const pending = { iframe, abort };
          this.nestedHostAwaitingLoad.set(contextId, pending);
          void (0, projectedBlankIframe_1.whenProjectedStandardsReady)(iframe, { signal: abort.signal }).then((doc) => {
            if (this.nestedHostAwaitingLoad.get(contextId) !== pending)
              return;
            this.nestedHostAwaitingLoad.delete(contextId);
            if (abort.signal.aborted || !iframe.isConnected)
              return;
            if (iframe.contentDocument !== doc || doc.defaultView == null) {
              this.installNestedHost(iframe, contextId);
              return;
            }
            this.bindNestedHostSession(iframe, doc, contextId);
          }).catch((err) => {
            if (this.nestedHostAwaitingLoad.get(contextId) !== pending)
              return;
            this.nestedHostAwaitingLoad.delete(contextId);
            if (abort.signal.aborted)
              return;
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
              if (existing.hostIframe === iframe && existing.registry.get(frame_1.DOCUMENT_ID) === doc) {
                return;
              }
            } catch {
            }
            existing.dispose();
            this.nested.delete(contextId);
          }
          const liveWin = iframe.contentWindow;
          if (!liveWin)
            return;
          const session = new nestedProjectedApply_1.NestedProjectedApply({
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
            for (let i = 0; i < queued.length; i++)
              session.ingest(queued[i]);
          }
          session.flush();
        }
        cancelPendingNestedHost(contextId) {
          const pending = this.nestedHostAwaitingLoad.get(contextId);
          if (!pending)
            return;
          pending.abort.abort();
          this.nestedHostAwaitingLoad.delete(contextId);
        }
        dropNestedHost(contextId) {
          this.cancelPendingNestedHost(contextId);
          this.pendingNestedFrames.delete(contextId);
          const existing = this.nested.get(contextId);
          if (!existing)
            return;
          existing.dispose();
          this.nested.delete(contextId);
        }
        /**
         * Pending nested frames while the root surface is armed and the context is not bound —
         * host materialized without installNestedHost completing (silent divergence).
         */
        auditPendingNestedHostBindings(applier) {
          if (this.lastDesyncReason !== null || !this.armed)
            return;
          const pending = /* @__PURE__ */ new Map();
          for (const [contextId, queue] of this.pendingNestedFrames) {
            pending.set(contextId, queue.length);
          }
          const message = (0, pendingNestedHostAudit_1.pendingNestedHostAuditMessage)(pending, {
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
            table: (0, tableDigest_1.digestReplicatedTable)(this.live.applier.replicatedTable)
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
          for (const n of this.nested.values())
            n.flush();
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
          this.persistentStrings = new decode_1.PersistentStringTable();
          this.assembler = new decode_1.FramePartAssembler();
          this.lastSequence = 0;
          this.highestSeenSequence = 0;
          this.lagCatchUp = false;
          this.generation = 1;
          this.armed = false;
          this.everArmed = false;
          this.lastDesyncReason = null;
          for (const n of this.nested.values())
            n.dispose();
          this.nested.clear();
          this.pendingNestedFrames.clear();
          for (const contextId of [...this.nestedHostAwaitingLoad.keys()]) {
            this.cancelPendingNestedHost(contextId);
          }
          this.applyGate.clear();
          this.applyGateOverflowStreak = 0;
          const epoch = ++this.surfaceEpoch;
          await this.surface.reset();
          if (epoch !== this.surfaceEpoch)
            return;
          const registry = new registry_1.PageProjectionRegistry();
          registry.register(frame_1.DOCUMENT_ID, this.surface.document);
          this.live = { applier: this.createApplier(this.surface.document, registry, true), registry };
        }
        ingest(bytes) {
          const hdr = (0, decode_1.peekFrameHeader)(bytes);
          if (hdr && hdr.contextId !== frame_1.CONTEXT_ID_ROOT && hdr.contextId !== 0) {
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
          const decoded = (0, decode_1.decodeFramePart)(bytes, this.persistentStrings);
          if (!decoded.ok) {
            this.desync(decoded.reason, { message: decoded.message });
            return;
          }
          const assembled = this.assembler.ingest(decoded.part);
          if (assembled === "missing_part" || assembled === "malformed") {
            this.desync(assembled);
            return;
          }
          if (assembled === null)
            return;
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
            v: telemetry_1.TELEMETRY_WIRE_VERSION,
            contextId: frame_1.CONTEXT_ID_ROOT,
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
          if (streak >= projectedApplyGate_1.PROJECTED_APPLY_GATE_MAX_OVERFLOW_STREAK) {
            this.resyncExhausted = true;
            this.onTelemetry?.({
              v: telemetry_1.TELEMETRY_WIRE_VERSION,
              contextId: frame_1.CONTEXT_ID_ROOT,
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
          if (info.maxDepth === 0 && info.drained === 0 && !info.overflow)
            return;
          this.onTelemetry?.({
            v: telemetry_1.TELEMETRY_WIRE_VERSION,
            contextId: frame_1.CONTEXT_ID_ROOT,
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
          if (this.resync !== null)
            return true;
          const reason = this.lastDesyncReason;
          if (reason === null)
            return false;
          if (reason === "sequence_gap" || reason === "lag")
            return false;
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
          for (const n of this.nested.values())
            n.dispose();
          this.nested.clear();
          const epoch = ++this.surfaceEpoch;
          await this.surface.reset();
          if (epoch !== this.surfaceEpoch)
            return;
          const registry = new registry_1.PageProjectionRegistry();
          registry.register(frame_1.DOCUMENT_ID, this.surface.document);
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
          const applier = new applyDom_1.DomFrameApplier(doc, registry, {
            stampUrl: (name, value) => (0, sessionBindingAuth_1.stampAttrAuth)(name, value, this.resolveToken(), this.resolveAssetBaseUrl()),
            stampCssText: (text) => (0, sessionBindingAuth_1.stampCssTextAuth)(text, this.resolveToken(), this.resolveAssetBaseUrl()),
            getDocumentBaseUrl: () => this.getDocumentBaseUrl?.() || "",
            onNestedHost: (iframe, childScopeId) => this.installNestedHost(iframe, childScopeId),
            onNestedHostDrop: (childScopeId) => this.dropNestedHost(childScopeId),
            onWarn: (message) => {
              this.onTelemetry?.({
                v: telemetry_1.TELEMETRY_WIRE_VERSION,
                contextId: frame_1.CONTEXT_ID_ROOT,
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
                if (!this.armed)
                  this.notifyLiveSurfaceReady();
              } else {
                state.swapped = true;
                this.commitResyncSwap(frame, applyMs);
              }
            },
            onOverrun: (durationMs2, lastSequence) => {
              this.onTelemetry?.({
                v: telemetry_1.TELEMETRY_WIRE_VERSION,
                contextId: frame_1.CONTEXT_ID_ROOT,
                kind: "applyOverrun",
                t: performance.now(),
                generation: this.generation,
                sequence: lastSequence,
                durationMs: durationMs2,
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
          if (epoch !== this.surfaceEpoch)
            return;
          const registry = new registry_1.PageProjectionRegistry();
          registry.register(frame_1.DOCUMENT_ID, doc);
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
          if (built === null)
            return;
          this.surface.commitSwap();
          this.live = { applier: built.applier, registry: built.registry };
          this.resync = null;
          this.resyncAttempts = 0;
          this.resyncExhausted = false;
          this.lastDesyncReason = null;
          this.lastSequence = frame.sequence;
          this.onTelemetry?.({
            v: telemetry_1.TELEMETRY_WIRE_VERSION,
            contextId: frame_1.CONTEXT_ID_ROOT,
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
          if (!behind && !this.lagCatchUp)
            return;
          this.lagCatchUp = false;
          if (!behind)
            return;
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
            v: telemetry_1.TELEMETRY_WIRE_VERSION,
            contextId: frame_1.CONTEXT_ID_ROOT,
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
        scheduleResyncAttempt(reason, contextId = frame_1.CONTEXT_ID_ROOT) {
          if (this.resyncExhausted)
            return;
          if (this.resyncBackoffTimer !== null || this.resyncTimeoutTimer !== null || this.resync !== null)
            return;
          const attempt = this.resyncAttempts + 1;
          if (attempt > MAX_RESYNC_ATTEMPTS) {
            this.resyncExhausted = true;
            this.onTelemetry?.({
              v: telemetry_1.TELEMETRY_WIRE_VERSION,
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
          const delay = attempt === 1 ? 0 : RESYNC_BACKOFF_MS * (attempt - 1);
          this.resyncBackoffTimer = setTimeout(() => {
            this.resyncBackoffTimer = null;
            this.resyncAttempts = attempt;
            this.onTelemetry?.({
              v: telemetry_1.TELEMETRY_WIRE_VERSION,
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
            }, RESYNC_RESPONSE_TIMEOUT_MS);
          }, delay);
        }
        reportApplyResult(info) {
          this.onTelemetry?.({
            v: telemetry_1.TELEMETRY_WIRE_VERSION,
            contextId: frame_1.CONTEXT_ID_ROOT,
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
            v: telemetry_1.TELEMETRY_WIRE_VERSION,
            contextId: frame_1.CONTEXT_ID_ROOT,
            kind: "desynced",
            t: performance.now(),
            generation: this.generation,
            sequence: extra?.gotSequence ?? this.lastSequence,
            errorCode: reason,
            phase: extra?.phase ?? (0, telemetry_1.desyncPhase)(reason),
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
          if (extra?.requestResync === false)
            return;
          this.scheduleResyncAttempt(reason);
        }
      };
      exports.ProjectionClient = ProjectionClient;
      async function createProjectionClient2(opts) {
        return ProjectionClient.create(opts);
      }
      exports.createProjectionClient = createProjectionClient2;
    }
  });

  // ../packages/page-projection/dist/core/input/unifiedIntentTypes.js
  var require_unifiedIntentTypes = __commonJS({
    "../packages/page-projection/dist/core/input/unifiedIntentTypes.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.UNIFIED_INTENT_SCHEMA_VERSION = void 0;
      exports.UNIFIED_INTENT_SCHEMA_VERSION = 2;
    }
  });

  // ../packages/page-projection/dist/projected/input/ClientBuffer.js
  var require_ClientBuffer = __commonJS({
    "../packages/page-projection/dist/projected/input/ClientBuffer.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.ClientBuffer = void 0;
      var NEVER_DROP = /* @__PURE__ */ new Set(["down", "up"]);
      var ClientBuffer = class {
        moveTimer = null;
        pendingMove = null;
        scrollTimers = /* @__PURE__ */ new Map();
        pendingScroll = /* @__PURE__ */ new Map();
        enqueue(intent, flush) {
          if (intent.type === "move") {
            this.pendingMove = intent;
            if (this.moveTimer)
              clearTimeout(this.moveTimer);
            this.moveTimer = setTimeout(() => {
              if (this.pendingMove)
                flush(this.pendingMove);
              this.pendingMove = null;
              this.moveTimer = null;
            }, 50);
            return;
          }
          if (intent.type === "scrollSet") {
            const key = `${intent.contextId}:${intent.nodeId ?? "v"}`;
            this.pendingScroll.set(key, intent);
            const prev = this.scrollTimers.get(key);
            if (prev)
              clearTimeout(prev);
            this.scrollTimers.set(key, setTimeout(() => {
              const pending = this.pendingScroll.get(key);
              this.pendingScroll.delete(key);
              this.scrollTimers.delete(key);
              if (pending)
                flush(pending);
            }, 100));
            return;
          }
          if (NEVER_DROP.has(intent.type)) {
            flush(intent);
            return;
          }
          flush(intent);
        }
        dispose() {
          if (this.moveTimer)
            clearTimeout(this.moveTimer);
          this.moveTimer = null;
          this.pendingMove = null;
          for (const t of this.scrollTimers.values())
            clearTimeout(t);
          this.scrollTimers.clear();
          this.pendingScroll.clear();
        }
      };
      exports.ClientBuffer = ClientBuffer;
    }
  });

  // ../packages/page-projection/dist/projected/input/projectedInputCapture.js
  var require_projectedInputCapture = __commonJS({
    "../packages/page-projection/dist/projected/input/projectedInputCapture.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.attachNestedProjectedInputCapture = exports.attachProjectedInputCapture = void 0;
      var unifiedIntentTypes_1 = require_unifiedIntentTypes();
      var ClientBuffer_1 = require_ClientBuffer();
      var projectedNativeGuard_1 = require_projectedNativeGuard();
      function isElement(node) {
        return !!node && typeof node === "object" && node.nodeType === 1;
      }
      function tagName(node) {
        return isElement(node) ? node.tagName.toUpperCase() : "";
      }
      function isEditableTarget(target) {
        if (!isElement(target))
          return false;
        const tag = target.tagName.toUpperCase();
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT")
          return true;
        return target.isContentEditable;
      }
      function buttonFromEvent(button) {
        if (button === 1)
          return "middle";
        if (button === 2)
          return "right";
        return "left";
      }
      var EDGE_SWIPE_PX = 24;
      var EDGE_SWIPE_MIN_DX = 72;
      var TOUCH_CLICK_POINTER_ID = 1;
      var NAVIGABLE_TAP_SLOP_PX = 8;
      function historyNavFromKeyboard(event) {
        if (isEditableTarget(event.target))
          return null;
        if (event.altKey && event.key === "ArrowLeft")
          return "back";
        if (event.altKey && event.key === "ArrowRight")
          return "forward";
        if (event.metaKey && event.key === "[")
          return "back";
        if (event.metaKey && event.key === "]")
          return "forward";
        return null;
      }
      function attachProjectedInputCapture2(surface, registry, send, opts) {
        const doc = surface.ownerDocument;
        const win = doc.defaultView;
        const buffer = new ClientBuffer_1.ClientBuffer();
        let edgeSwipe = null;
        const pendingPointers = /* @__PURE__ */ new Set();
        let lastPointerType = null;
        let touchGesture = null;
        const tempDiagState = {
          pointerMoves: 0,
          tapEmitted: false,
          cancelled: false,
          lastScrollAt: 0,
          scrollOrigins: /* @__PURE__ */ new Map()
        };
        const fireHistoryNav = (direction) => {
          enqueue({
            schemaVersion: unifiedIntentTypes_1.UNIFIED_INTENT_SCHEMA_VERSION,
            type: "historyNav",
            timestampClient: performance.now(),
            direction
          });
        };
        const trapProjectedHistory = () => {
          if (!win)
            return () => void 0;
          try {
            history.pushState({ speculumHistoryTrap: true }, "", win.location.href);
          } catch {
            return () => void 0;
          }
          const onPopState = () => {
            try {
              history.pushState({ speculumHistoryTrap: true }, "", win.location.href);
            } catch {
            }
            if (!opts.isArmed()) {
              opts.metrics?.noteSkip("disarmed");
              return;
            }
            fireHistoryNav("back");
          };
          win.addEventListener("popstate", onPopState);
          return () => win.removeEventListener("popstate", onPopState);
        };
        const detachHistoryTrap = trapProjectedHistory();
        const fire = (intent) => {
          if (!opts.isArmed()) {
            opts.metrics?.noteSkip("disarmed");
            return;
          }
          opts.metrics?.noteEmit(intent.type);
          void Promise.resolve(send(intent)).catch(() => void 0);
        };
        const enqueue = (intent) => {
          buffer.enqueue(intent, fire);
        };
        const viewportStamp = () => {
          const { width, height } = opts.getViewportSize();
          return { viewportW: width, viewportH: height };
        };
        const surfaceCoordsFromClient = (clientX, clientY) => {
          if (!win)
            return null;
          let x = clientX;
          let y = clientY;
          const rootWin = opts.getRootWindow?.() ?? win;
          if (!rootWin)
            return null;
          let walk = win;
          while (walk && walk !== rootWin) {
            let frameEl = null;
            try {
              frameEl = walk.frameElement;
            } catch {
              break;
            }
            if (!frameEl)
              break;
            const rect = frameEl.getBoundingClientRect();
            x += rect.left;
            y += rect.top;
            try {
              walk = walk.parent;
            } catch {
              break;
            }
          }
          const vis = (0, projectedNativeGuard_1.layoutViewportSize)(rootWin);
          const visW = vis.width;
          const visH = vis.height;
          if (visW <= 0 || visH <= 0)
            return null;
          const { width: vw, height: vh } = opts.getViewportSize();
          if (vw <= 0 || vh <= 0)
            return null;
          const sx = x * (vw / visW);
          const sy = y * (vh / visH);
          return { x: Math.min(Math.max(sx, 0), vw - 1e-6), y: Math.min(Math.max(sy, 0), vh - 1e-6) };
        };
        const resolvePointerGeometry = (event) => {
          if (!opts.isArmed()) {
            opts.metrics?.noteSkip("disarmed");
            return null;
          }
          const target = event.target;
          if (!target || typeof target !== "object" || !("nodeType" in target)) {
            opts.metrics?.noteSkip("no_node");
            return null;
          }
          const el2 = target;
          if (el2.nodeType !== 1) {
            opts.metrics?.noteSkip("no_node");
            return null;
          }
          const nodeId = registry.idOf(el2);
          if (nodeId == null) {
            opts.metrics?.noteSkip("no_node");
            return null;
          }
          const box = el2.getBoundingClientRect();
          if (box.width <= 0 || box.height <= 0) {
            opts.metrics?.noteSkip("no_coords");
            return null;
          }
          const rawLocalX = (event.clientX - box.left) / box.width;
          const rawLocalY = (event.clientY - box.top) / box.height;
          const localX = Math.min(1, Math.max(0, rawLocalX));
          const localY = Math.min(1, Math.max(0, rawLocalY));
          const coords = surfaceCoordsFromClient(event.clientX, event.clientY);
          if (!coords) {
            opts.metrics?.noteSkip("no_coords");
            return null;
          }
          return {
            nodeId,
            localX,
            localY,
            x: coords.x,
            y: coords.y,
            button: buttonFromEvent(event.button)
          };
        };
        const emitPointerEdge = (type, geometry, pointerId) => {
          const stamp = viewportStamp();
          enqueue({
            schemaVersion: unifiedIntentTypes_1.UNIFIED_INTENT_SCHEMA_VERSION,
            type,
            timestampClient: performance.now(),
            ...stamp,
            x: geometry.x,
            y: geometry.y,
            localX: geometry.localX,
            localY: geometry.localY,
            button: geometry.button,
            contextId: opts.contextId,
            nodeId: geometry.nodeId
          });
          if (type === "down")
            pendingPointers.add(pointerId);
          else
            pendingPointers.delete(pointerId);
        };
        const runPointerEdge = (event, type) => {
          const geometry = resolvePointerGeometry(event);
          if (!geometry)
            return;
          emitPointerEdge(type, geometry, event.pointerId);
        };
        const onPointerEdge = (event, type) => {
          runPointerEdge(event, type);
        };
        const emitTouchTap = (target, clientX, clientY) => {
          const geometry = resolvePointerGeometry({
            target,
            clientX,
            clientY,
            button: 0
          });
          if (!geometry)
            return false;
          tempDiagState.tapEmitted = true;
          emitPointerEdge("down", geometry, TOUCH_CLICK_POINTER_ID);
          emitPointerEdge("up", geometry, TOUCH_CLICK_POINTER_ID);
          return true;
        };
        const onClick = (event) => {
          if (event.detail === 0)
            return;
          if (lastPointerType !== "touch")
            return;
          touchGesture = null;
          if (!emitTouchTap(event.target, event.clientX, event.clientY)) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          event.preventDefault();
          event.stopPropagation();
        };
        const beginTouchGesture = (clientX, clientY) => {
          lastPointerType = "touch";
          touchGesture = {
            scrolled: false,
            startX: clientX,
            startY: clientY,
            maxDist: 0
          };
        };
        const trackTouchMove = (clientX, clientY) => {
          if (!touchGesture)
            return;
          const dist = Math.hypot(clientX - touchGesture.startX, clientY - touchGesture.startY);
          touchGesture.maxDist = Math.max(touchGesture.maxDist, dist);
        };
        const touchTargetAt = (clientX, clientY, fallback) => {
          if (typeof doc.elementFromPoint === "function") {
            return doc.elementFromPoint(clientX, clientY) ?? fallback;
          }
          return fallback;
        };
        const onTouchStartTrack = (event) => {
          const touch = event.changedTouches[0] ?? event.touches[0];
          if (!touch)
            return;
          beginTouchGesture(touch.clientX, touch.clientY);
        };
        const onTouchMoveTrack = (event) => {
          const touch = event.touches[0] ?? event.changedTouches[0];
          if (!touch)
            return;
          trackTouchMove(touch.clientX, touch.clientY);
        };
        const onNavigableTouchEnd = (event) => {
          const gesture = touchGesture;
          touchGesture = null;
          if (lastPointerType !== "touch" || !gesture)
            return;
          const touch = event.changedTouches[0];
          if (!touch)
            return;
          const target = touchTargetAt(touch.clientX, touch.clientY, event.target);
          if (!(0, projectedNativeGuard_1.isProjectedNavigable)(target))
            return;
          if (gesture.scrolled)
            return;
          if (gesture.maxDist > NAVIGABLE_TAP_SLOP_PX)
            return;
          emitTouchTap(target, touch.clientX, touch.clientY);
        };
        const onSubmit = (event) => {
          event.preventDefault();
          event.stopPropagation();
        };
        const onContextMenu = (event) => event.preventDefault();
        const onWheel = (_event) => {
        };
        const onKey = (event) => {
          if (!opts.isArmed()) {
            opts.metrics?.noteSkip("disarmed");
            return;
          }
          const historyDir = historyNavFromKeyboard(event);
          if (historyDir) {
            event.preventDefault();
            event.stopPropagation();
            fireHistoryNav(historyDir);
            return;
          }
          if (isEditableTarget(event.target)) {
            event.preventDefault();
            event.stopPropagation();
          }
          const tag = tagName(event.target);
          const type = tag === "INPUT" ? event.target.type : tag === "BUTTON" ? event.target.type : "";
          if (event.key === "Enter" && (tag === "A" || tag === "BUTTON" && type === "submit" || tag === "INPUT" && (type === "submit" || type === "image"))) {
            event.preventDefault();
            event.stopPropagation();
          }
          enqueue({
            schemaVersion: unifiedIntentTypes_1.UNIFIED_INTENT_SCHEMA_VERSION,
            type: event.type === "keyup" ? "keyUp" : "keyDown",
            timestampClient: performance.now(),
            contextId: opts.contextId,
            key: event.key,
            code: event.code,
            modifiers: {
              alt: event.altKey,
              ctrl: event.ctrlKey,
              meta: event.metaKey,
              shift: event.shiftKey
            }
          });
        };
        const onScroll = (event) => {
          if (touchGesture)
            touchGesture.scrolled = true;
          if (!opts.isArmed()) {
            opts.metrics?.noteSkip("disarmed");
            return;
          }
          const el2 = event.target;
          if (el2 === doc || el2 === win || isElement(el2) && el2 === doc.scrollingElement) {
            if (!win)
              return;
            const se = doc.scrollingElement;
            const top2 = win.scrollY || se?.scrollTop || 0;
            const left2 = win.scrollX || se?.scrollLeft || 0;
            const rangeY2 = se ? se.scrollHeight - se.clientHeight : 0;
            const rangeX2 = se ? se.scrollWidth - se.clientWidth : 0;
            if (rangeY2 === 0 && rangeX2 === 0)
              return;
            if (opts.consumeScrollEcho?.("viewport", { top: top2, left: left2 })) {
              opts.onProgrammaticScrollSuppress?.("viewport");
              return;
            }
            opts.metrics?.noteScrollCoalesce();
            enqueue({
              schemaVersion: unifiedIntentTypes_1.UNIFIED_INTENT_SCHEMA_VERSION,
              type: "scrollSet",
              timestampClient: performance.now(),
              contextId: opts.contextId,
              nodeId: null,
              scrollFracX: rangeX2 === 0 ? 0 : left2 / rangeX2,
              scrollFracY: rangeY2 === 0 ? 0 : top2 / rangeY2
            });
            return;
          }
          if (!isElement(el2))
            return;
          const nodeId = registry.idOfNearest(el2);
          if (nodeId == null) {
            opts.metrics?.noteSkip("no_node");
            return;
          }
          const top = el2.scrollTop;
          const left = el2.scrollLeft;
          const rangeY = el2.scrollHeight - el2.clientHeight;
          const rangeX = el2.scrollWidth - el2.clientWidth;
          if (rangeY === 0 && rangeX === 0)
            return;
          if (opts.consumeScrollEcho?.(nodeId, { top, left })) {
            opts.onProgrammaticScrollSuppress?.(nodeId);
            return;
          }
          opts.metrics?.noteScrollCoalesce();
          enqueue({
            schemaVersion: unifiedIntentTypes_1.UNIFIED_INTENT_SCHEMA_VERSION,
            type: "scrollSet",
            timestampClient: performance.now(),
            contextId: opts.contextId,
            nodeId,
            scrollFracX: rangeX === 0 ? 0 : left / rangeX,
            scrollFracY: rangeY === 0 ? 0 : top / rangeY
          });
        };
        const onInput = (event) => {
          if (!opts.isArmed())
            return;
          const target = event.target;
          if (!isElement(target))
            return;
          const nodeId = registry.idOfNearest(target);
          if (nodeId == null)
            return;
          opts.onMarkPropDirty?.(nodeId);
        };
        const pointerOpts = { capture: true, passive: false };
        const onPointerDown = (event) => {
          if (event.pointerType === "touch" && win) {
            const rootWin = opts.getRootWindow?.() ?? win;
            const vw = (0, projectedNativeGuard_1.layoutViewportSize)(rootWin).width;
            if (event.clientX <= EDGE_SWIPE_PX) {
              edgeSwipe = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                edge: "left"
              };
              event.preventDefault();
              event.stopPropagation();
              return;
            }
            if (event.clientX >= vw - EDGE_SWIPE_PX) {
              edgeSwipe = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                edge: "right"
              };
              event.preventDefault();
              event.stopPropagation();
              return;
            }
            lastPointerType = "touch";
            beginTouchGesture(event.clientX, event.clientY);
            return;
          }
          lastPointerType = event.pointerType;
          touchGesture = null;
          onPointerEdge(event, "down");
        };
        const onPointerMove = (event) => {
          if (event.pointerType === "touch") {
            tempDiagState.pointerMoves += 1;
            trackTouchMove(event.clientX, event.clientY);
          }
          if (!edgeSwipe || event.pointerId !== edgeSwipe.pointerId)
            return;
          event.preventDefault();
          event.stopPropagation();
        };
        const clearEdgeSwipe = (event) => {
          if (!edgeSwipe || event.pointerId !== edgeSwipe.pointerId)
            return false;
          edgeSwipe = null;
          event.preventDefault();
          event.stopPropagation();
          return true;
        };
        const finishPendingPointer = (event) => {
          if (!pendingPointers.delete(event.pointerId))
            return;
          runPointerEdge(event, "up");
        };
        const onPointerUp = (event) => {
          if (edgeSwipe && event.pointerId === edgeSwipe.pointerId) {
            const track = edgeSwipe;
            edgeSwipe = null;
            event.preventDefault();
            event.stopPropagation();
            const dx = event.clientX - track.startX;
            const dy = event.clientY - track.startY;
            if (Math.abs(dy) > EDGE_SWIPE_MIN_DX * 0.75)
              return;
            if (track.edge === "left" && dx >= EDGE_SWIPE_MIN_DX) {
              fireHistoryNav("back");
              return;
            }
            if (track.edge === "right" && dx <= -EDGE_SWIPE_MIN_DX) {
              fireHistoryNav("forward");
              return;
            }
            return;
          }
          if (event.pointerType === "touch")
            return;
          onPointerEdge(event, "up");
        };
        const onPointerCancel = (event) => {
          if (clearEdgeSwipe(event))
            return;
          if (event.pointerType === "touch")
            return;
          finishPendingPointer(event);
        };
        const onLostPointerCapture = (event) => {
          if (edgeSwipe?.pointerId === event.pointerId) {
            edgeSwipe = null;
            return;
          }
          finishPendingPointer(event);
        };
        doc.addEventListener("pointerdown", onPointerDown, pointerOpts);
        doc.addEventListener("pointermove", onPointerMove, pointerOpts);
        doc.addEventListener("pointerup", onPointerUp, pointerOpts);
        doc.addEventListener("pointercancel", onPointerCancel, pointerOpts);
        doc.addEventListener("lostpointercapture", onLostPointerCapture, pointerOpts);
        const navigableTouchEndOpts = { capture: true, passive: false };
        const touchTrackOpts = { capture: true, passive: true };
        doc.addEventListener("touchstart", onTouchStartTrack, touchTrackOpts);
        doc.addEventListener("touchmove", onTouchMoveTrack, touchTrackOpts);
        doc.addEventListener("touchend", onNavigableTouchEnd, navigableTouchEndOpts);
        const detachNativeGuard = (0, projectedNativeGuard_1.attachProjectedNativeGuard)(doc, {
          onTouchStartSeen: () => opts.metrics?.noteTouchStartSeen()
        });
        doc.addEventListener("click", onClick, true);
        doc.addEventListener("submit", onSubmit, true);
        doc.addEventListener("contextmenu", onContextMenu, true);
        doc.addEventListener("wheel", onWheel, { capture: true, passive: true });
        doc.addEventListener("input", onInput, true);
        doc.addEventListener("change", onInput, true);
        doc.addEventListener("keydown", onKey, true);
        doc.addEventListener("keyup", onKey, true);
        doc.addEventListener("scroll", onScroll, true);
        win?.addEventListener("scroll", onScroll, true);
        let tempDiagTouch = null;
        const tempDiagLog = [];
        const tempDiagTag = (el2) => {
          const id = el2.id ? `#${el2.id}` : "";
          const cls = String(el2.className || "").trim().split(/\s+/).filter(Boolean).slice(0, 2).join(".");
          return `${el2.tagName}${id}${cls ? `.${cls}` : ""}`.slice(0, 60);
        };
        const tempDiagChain = (x, y) => {
          const rows = [];
          let el2 = doc.elementFromPoint(x, y);
          let depth = 0;
          while (el2 && depth < 24) {
            const he = el2;
            const cs = win?.getComputedStyle(he);
            rows.push({
              depth,
              tag: tempDiagTag(el2),
              touchAction: cs?.touchAction ?? null,
              overflowX: cs?.overflowX ?? null,
              overflowY: cs?.overflowY ?? null,
              overscrollX: cs?.overscrollBehaviorX ?? null,
              overscrollY: cs?.overscrollBehaviorY ?? null,
              rangeX: he.scrollWidth - he.clientWidth,
              rangeY: he.scrollHeight - he.clientHeight
            });
            el2 = el2.parentElement;
            depth += 1;
          }
          return rows;
        };
        const tempDiagViewport = () => {
          if (!win)
            return null;
          const de = doc.documentElement;
          const vv = win.visualViewport;
          return {
            clientW: de?.clientWidth ?? 0,
            clientH: de?.clientHeight ?? 0,
            innerW: win.innerWidth,
            innerH: win.innerHeight,
            visualW: vv?.width ?? null,
            visualH: vv?.height ?? null,
            visualScale: vv?.scale ?? null,
            dpr: win.devicePixelRatio,
            surfaceW: opts.getViewportSize().width,
            surfaceH: opts.getViewportSize().height
          };
        };
        const tempDiagLabel = () => win.__SCROLL_DIAG_LABEL ?? null;
        const tempDiagOnTouchStart = (event) => {
          const t = event.changedTouches[0];
          if (!t)
            return;
          tempDiagTouch = {
            id: t.identifier,
            x0: t.clientX,
            y0: t.clientY,
            dx: 0,
            dy: 0,
            maxDist: 0,
            moves: 0,
            preventedMoves: 0,
            msSincePrevScroll: tempDiagState.lastScrollAt === 0 ? null : Math.round(performance.now() - tempDiagState.lastScrollAt),
            scrolled: {},
            chain: tempDiagChain(t.clientX, t.clientY),
            viewport: tempDiagViewport(),
            t0: performance.now()
          };
          tempDiagState.pointerMoves = 0;
          tempDiagState.tapEmitted = false;
          tempDiagState.cancelled = false;
          tempDiagState.scrollOrigins.clear();
        };
        const tempDiagOnTouchMove = (event) => {
          if (!tempDiagTouch)
            return;
          const t = Array.from(event.changedTouches).find((c) => c.identifier === tempDiagTouch.id) ?? event.touches[0];
          if (!t)
            return;
          tempDiagTouch.dx = t.clientX - tempDiagTouch.x0;
          tempDiagTouch.dy = t.clientY - tempDiagTouch.y0;
          tempDiagTouch.maxDist = Math.max(tempDiagTouch.maxDist, Math.hypot(tempDiagTouch.dx, tempDiagTouch.dy));
          tempDiagTouch.moves += 1;
          if (event.defaultPrevented)
            tempDiagTouch.preventedMoves += 1;
        };
        const tempDiagEmitGesture = (event, ended) => {
          if (!tempDiagTouch)
            return;
          const rec = {
            phase: "gesture",
            ended,
            ...tempDiagTouch,
            dx: Math.round(tempDiagTouch.dx),
            dy: Math.round(tempDiagTouch.dy),
            maxDist: Math.round(tempDiagTouch.maxDist),
            /** Endpoint displacement — what a slop test would compare. */
            endDist: Math.round(Math.hypot(tempDiagTouch.dx, tempDiagTouch.dy)),
            touchMoves: tempDiagTouch.moves,
            pointerMoves: tempDiagState.pointerMoves,
            tapEmitted: tempDiagState.tapEmitted,
            pointerCancelled: tempDiagState.cancelled,
            durationMs: Math.round(performance.now() - tempDiagTouch.t0),
            docUrl: (() => {
              try {
                return win?.location.href ?? null;
              } catch {
                return null;
              }
            })(),
            defaultPrevented: event.defaultPrevented,
            label: tempDiagLabel()
          };
          tempDiagLog.push(rec);
          console.log("[TEMP-DIAG gesture]", JSON.stringify(rec));
          tempDiagTouch = null;
        };
        const tempDiagOnTouchEnd = (event) => tempDiagEmitGesture(event, "touchend");
        const tempDiagOnTouchCancel = (event) => tempDiagEmitGesture(event, "touchcancel");
        const tempDiagOnScroll = (event) => {
          const t = event.target;
          if (!t || typeof t !== "object")
            return;
          const el2 = "tagName" in t ? t : doc.scrollingElement;
          if (!el2)
            return;
          tempDiagState.lastScrollAt = performance.now();
          if (!tempDiagTouch)
            return;
          const key = tempDiagTag(el2);
          const origin = tempDiagState.scrollOrigins.get(key);
          if (!origin) {
            tempDiagState.scrollOrigins.set(key, { left: el2.scrollLeft, top: el2.scrollTop });
            tempDiagTouch.scrolled[key] = { dLeft: 0, dTop: 0 };
            return;
          }
          tempDiagTouch.scrolled[key] = {
            dLeft: Math.round(el2.scrollLeft - origin.left),
            dTop: Math.round(el2.scrollTop - origin.top)
          };
        };
        const tempDiagOnPointerCancel = (event) => {
          if (event.pointerType === "touch")
            tempDiagState.cancelled = true;
        };
        const tempDiagOpts = { capture: true, passive: true };
        doc.addEventListener("touchstart", tempDiagOnTouchStart, tempDiagOpts);
        doc.addEventListener("touchmove", tempDiagOnTouchMove, tempDiagOpts);
        doc.addEventListener("touchend", tempDiagOnTouchEnd, tempDiagOpts);
        doc.addEventListener("touchcancel", tempDiagOnTouchCancel, tempDiagOpts);
        doc.addEventListener("scroll", tempDiagOnScroll, tempDiagOpts);
        doc.addEventListener("pointercancel", tempDiagOnPointerCancel, tempDiagOpts);
        if (win) {
          win.__SCROLL_DIAG_LOG = tempDiagLog;
          win.__SCROLL_DIAG_CLEAR = () => {
            tempDiagLog.length = 0;
            tempDiagTouch = null;
          };
        }
        return () => {
          buffer.dispose();
          detachHistoryTrap();
          doc.removeEventListener("pointerdown", onPointerDown, pointerOpts);
          doc.removeEventListener("pointermove", onPointerMove, pointerOpts);
          doc.removeEventListener("pointerup", onPointerUp, pointerOpts);
          doc.removeEventListener("pointercancel", onPointerCancel, pointerOpts);
          doc.removeEventListener("lostpointercapture", onLostPointerCapture, pointerOpts);
          doc.removeEventListener("touchstart", onTouchStartTrack, touchTrackOpts);
          doc.removeEventListener("touchmove", onTouchMoveTrack, touchTrackOpts);
          doc.removeEventListener("touchend", onNavigableTouchEnd, navigableTouchEndOpts);
          detachNativeGuard();
          pendingPointers.clear();
          touchGesture = null;
          doc.removeEventListener("click", onClick, true);
          doc.removeEventListener("submit", onSubmit, true);
          doc.removeEventListener("contextmenu", onContextMenu, true);
          doc.removeEventListener("wheel", onWheel, true);
          doc.removeEventListener("input", onInput, true);
          doc.removeEventListener("change", onInput, true);
          doc.removeEventListener("keydown", onKey, true);
          doc.removeEventListener("keyup", onKey, true);
          doc.removeEventListener("scroll", onScroll, true);
          win?.removeEventListener("scroll", onScroll, true);
          doc.removeEventListener("touchstart", tempDiagOnTouchStart, tempDiagOpts);
          doc.removeEventListener("touchmove", tempDiagOnTouchMove, tempDiagOpts);
          doc.removeEventListener("touchend", tempDiagOnTouchEnd, tempDiagOpts);
          doc.removeEventListener("touchcancel", tempDiagOnTouchCancel, tempDiagOpts);
          doc.removeEventListener("scroll", tempDiagOnScroll, tempDiagOpts);
          doc.removeEventListener("pointercancel", tempDiagOnPointerCancel, tempDiagOpts);
        };
      }
      exports.attachProjectedInputCapture = attachProjectedInputCapture2;
      function attachNestedProjectedInputCapture(surface, registry, send, opts) {
        return attachProjectedInputCapture2(surface, registry, send, opts);
      }
      exports.attachNestedProjectedInputCapture = attachNestedProjectedInputCapture;
    }
  });

  // ../packages/page-projection/dist/projected/input/inputCaptureMetrics.js
  var require_inputCaptureMetrics = __commonJS({
    "../packages/page-projection/dist/projected/input/inputCaptureMetrics.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.ProjectedInputCaptureMetrics = void 0;
      var SAMPLE_CAP = 256;
      function emptyStats() {
        return { count: 0, min: 0, avg: 0, p95: 0, max: 0 };
      }
      function latencyStats(samples) {
        if (samples.length === 0)
          return emptyStats();
        const sorted = [...samples].sort((a, b) => a - b);
        const sum = sorted.reduce((a, b) => a + b, 0);
        const p95Idx = Math.min(sorted.length - 1, Math.floor(0.95 * sorted.length));
        return {
          count: sorted.length,
          min: sorted[0],
          avg: sum / sorted.length,
          p95: sorted[p95Idx],
          max: sorted[sorted.length - 1]
        };
      }
      var ProjectedInputCaptureMetrics2 = class {
        emitted = 0;
        emittedByType = {};
        moveCoalesced = 0;
        scrollCoalesced = 0;
        skippedDisarmed = 0;
        skippedNoCoords = 0;
        skippedNoNodeId = 0;
        touchstartSeen = 0;
        lastEmitWallMs = null;
        intervalSamples = [];
        noteEmit(type) {
          this.emitted += 1;
          const key = type || "unknown";
          this.emittedByType[key] = (this.emittedByType[key] ?? 0) + 1;
          const now2 = Date.now();
          if (this.lastEmitWallMs != null) {
            const gap = now2 - this.lastEmitWallMs;
            if (Number.isFinite(gap) && gap >= 0) {
              this.intervalSamples.push(gap);
              if (this.intervalSamples.length > SAMPLE_CAP)
                this.intervalSamples.shift();
            }
          }
          this.lastEmitWallMs = now2;
        }
        noteMoveCoalesce() {
          this.moveCoalesced += 1;
        }
        noteScrollCoalesce() {
          this.scrollCoalesced += 1;
        }
        noteSkip(reason) {
          if (reason === "disarmed")
            this.skippedDisarmed += 1;
          else if (reason === "no_coords")
            this.skippedNoCoords += 1;
          else
            this.skippedNoNodeId += 1;
        }
        noteTouchStartSeen() {
          this.touchstartSeen += 1;
        }
        snapshot() {
          return {
            emitted: this.emitted,
            emittedByType: { ...this.emittedByType },
            moveCoalesced: this.moveCoalesced,
            scrollCoalesced: this.scrollCoalesced,
            skippedDisarmed: this.skippedDisarmed,
            skippedNoCoords: this.skippedNoCoords,
            skippedNoNodeId: this.skippedNoNodeId,
            touchstartSeen: this.touchstartSeen,
            emitIntervalMs: latencyStats(this.intervalSamples),
            lastEmitWallMs: this.lastEmitWallMs
          };
        }
      };
      exports.ProjectedInputCaptureMetrics = ProjectedInputCaptureMetrics2;
    }
  });

  // ../packages/page-projection/dist/projected/input/scrollEchoGate.js
  var require_scrollEchoGate = __commonJS({
    "../packages/page-projection/dist/projected/input/scrollEchoGate.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.ScrollEchoGate = void 0;
      var DEFAULT_TOLERANCE_PX = 2;
      var DEFAULT_TTL_MS = 400;
      var ScrollEchoGate2 = class {
        pending = /* @__PURE__ */ new Map();
        tolerancePx;
        ttlMs;
        constructor(opts) {
          this.tolerancePx = opts?.tolerancePx ?? DEFAULT_TOLERANCE_PX;
          this.ttlMs = opts?.ttlMs ?? DEFAULT_TTL_MS;
        }
        key(target) {
          return target === "viewport" ? "viewport" : `el:${target}`;
        }
        /** Mark an upcoming programmatic scroll so the next matching sensor is swallowed. */
        expect(target, pos) {
          this.pending.set(this.key(target), {
            top: pos.top,
            left: pos.left,
            expiresAt: Date.now() + this.ttlMs
          });
        }
        /**
         * @returns true when the observed scroll matches a pending expect (caller should not send intent).
         */
        consume(target, observed) {
          const k = this.key(target);
          const p = this.pending.get(k);
          if (!p)
            return false;
          if (Date.now() > p.expiresAt) {
            this.pending.delete(k);
            return false;
          }
          const close = Math.abs(p.top - observed.top) <= this.tolerancePx && Math.abs(p.left - observed.left) <= this.tolerancePx;
          if (!close)
            return false;
          this.pending.delete(k);
          return true;
        }
        clear() {
          this.pending.clear();
        }
      };
      exports.ScrollEchoGate = ScrollEchoGate2;
    }
  });

  // ../packages/page-projection/dist/projected/formControlSnapshot.js
  var require_formControlSnapshot = __commonJS({
    "../packages/page-projection/dist/projected/formControlSnapshot.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.snapshotFormControls = void 0;
      var SKIP_INPUT_TYPES = /* @__PURE__ */ new Set(["file", "button", "submit", "reset", "image"]);
      function snapshotFormControls2(doc) {
        const out = [];
        const nodes = doc.querySelectorAll("input, textarea, option");
        for (let i = 0; i < nodes.length; i++) {
          const el2 = nodes[i];
          const snap = snapshotOne(el2);
          if (snap)
            out.push(snap);
        }
        out.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
        return out;
      }
      exports.snapshotFormControls = snapshotFormControls2;
      function snapshotOne(el2) {
        const tag = el2.tagName;
        if (tag === "TEXTAREA") {
          const key2 = el2.id || null;
          if (!key2)
            return null;
          return { key: key2, value: el2.value };
        }
        if (tag === "OPTION") {
          const select = el2.closest("select");
          const selectId = select?.id || "";
          const value = el2.value;
          if (!selectId && !value)
            return null;
          return { key: `option:${selectId}:${value}`, selected: el2.selected };
        }
        if (tag !== "INPUT")
          return null;
        const input = el2;
        const type = (input.type || "text").toLowerCase();
        if (SKIP_INPUT_TYPES.has(type))
          return null;
        const key = el2.id || null;
        if (!key)
          return null;
        if (type === "checkbox" || type === "radio")
          return { key, checked: input.checked };
        return { key, value: input.value };
      }
    }
  });

  // ../packages/page-projection/dist/projected/viewportPolicy.js
  var require_viewportPolicy = __commonJS({
    "../packages/page-projection/dist/projected/viewportPolicy.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.measureHostElement = exports.validateResizeViewport = exports.normalizeSessionViewport = exports.viewportSizesClose = exports.VIEWPORT_SIZE_EPSILON = exports.LAB_VIEWPORT_POLICY = exports.VIEWPORT_POLICY_BASELINE = void 0;
      exports.VIEWPORT_POLICY_BASELINE = {
        minWidth: 100,
        minHeight: 100,
        maxWidth: 4096,
        maxHeight: 2160,
        defaultWidth: 1280,
        defaultHeight: 720
      };
      exports.LAB_VIEWPORT_POLICY = {
        ...exports.VIEWPORT_POLICY_BASELINE
      };
      exports.VIEWPORT_SIZE_EPSILON = 2;
      function viewportSizesClose(aW, aH, bW, bH, epsilon = exports.VIEWPORT_SIZE_EPSILON) {
        return Math.abs(aW - bW) <= epsilon && Math.abs(aH - bH) <= epsilon;
      }
      exports.viewportSizesClose = viewportSizesClose;
      function normalizeSessionViewport2(width, height, policy) {
        const defaultW = policy.defaultWidth ?? policy.minWidth;
        const defaultH = policy.defaultHeight ?? policy.minHeight;
        let w = width > 0 ? Math.round(width) : defaultW;
        let h = height > 0 ? Math.round(height) : defaultH;
        w = Math.min(policy.maxWidth, Math.max(policy.minWidth, w));
        h = Math.min(policy.maxHeight, Math.max(policy.minHeight, h));
        return { width: w, height: h };
      }
      exports.normalizeSessionViewport = normalizeSessionViewport2;
      function validateResizeViewport(width, height, policy) {
        const w = Math.round(width);
        const h = Math.round(height);
        if (!Number.isFinite(w) || !Number.isFinite(h) || w < policy.minWidth || h < policy.minHeight) {
          return {
            ok: false,
            message: `viewport ${w}\xD7${h} below minimum ${policy.minWidth}\xD7${policy.minHeight}`
          };
        }
        if (w > policy.maxWidth || h > policy.maxHeight) {
          return {
            ok: false,
            message: `viewport ${w}\xD7${h} above maximum ${policy.maxWidth}\xD7${policy.maxHeight}`
          };
        }
        return { ok: true, width: w, height: h };
      }
      exports.validateResizeViewport = validateResizeViewport;
      function measureHostElement2(el2) {
        if (!el2) {
          return { width: 0, height: 0 };
        }
        return {
          width: Math.round(el2.clientWidth),
          height: Math.round(el2.clientHeight)
        };
      }
      exports.measureHostElement = measureHostElement2;
    }
  });

  // ../packages/page-projection/dist/projected/viewportDevice.js
  var require_viewportDevice = __commonJS({
    "../packages/page-projection/dist/projected/viewportDevice.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.detectViewportDeviceProfile = exports.deviceProfilesEqual = void 0;
      function deviceProfilesEqual(a, b) {
        return a.mobile === b.mobile && a.touch === b.touch && a.deviceScaleFactor === b.deviceScaleFactor && a.maxTouchPoints === b.maxTouchPoints && a.userAgentProfile === b.userAgentProfile && a.deviceCategory === b.deviceCategory && a.screenOrientation === b.screenOrientation;
      }
      exports.deviceProfilesEqual = deviceProfilesEqual;
      function detectViewportDeviceProfile2() {
        const coarse = typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
        const hoverNone = typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(hover: none)").matches;
        const maxTouch = typeof navigator !== "undefined" ? navigator.maxTouchPoints || 0 : 0;
        const touchCapable = coarse || maxTouch > 0;
        let uaMobile = false;
        let uaTablet = false;
        try {
          const uaData = navigator.userAgentData;
          const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
          if (typeof uaData?.mobile === "boolean")
            uaMobile = uaData.mobile;
          else
            uaMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
          uaTablet = /iPad|Tablet|Android(?!.*Mobile)/i.test(ua) || uaMobile === false && touchCapable && Math.min(window.screen?.width ?? 0, window.screen?.height ?? 0) >= 600 && Math.max(window.screen?.width ?? 0, window.screen?.height ?? 0) >= 900;
        } catch {
        }
        const phone = uaMobile && !uaTablet || coarse && hoverNone && !uaTablet;
        const tablet = uaTablet || !phone && coarse && hoverNone && maxTouch > 0;
        const mobile = phone || tablet;
        const touch = touchCapable || mobile;
        let dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
        if (!Number.isFinite(dpr) || dpr < 1)
          dpr = 1;
        if (dpr > 2)
          dpr = 2;
        let orientation;
        try {
          orientation = window.screen?.orientation?.type;
        } catch {
        }
        const deviceCategory = phone ? "phone" : tablet ? "tablet" : "pc";
        return {
          mobile,
          touch,
          deviceScaleFactor: dpr,
          maxTouchPoints: maxTouch,
          userAgentProfile: phone ? "mobile" : tablet ? "tablet" : "desktop",
          deviceCategory,
          screenOrientation: orientation
        };
      }
      exports.detectViewportDeviceProfile = detectViewportDeviceProfile2;
    }
  });

  // ../packages/page-projection/dist/projected/viewportSyncProbe.js
  var require_viewportSyncProbe = __commonJS({
    "../packages/page-projection/dist/projected/viewportSyncProbe.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.viewportSyncProbeStartSampler = exports.viewportSyncProbeEmit = exports.viewportSyncProbeActive = void 0;
      function viewportSyncProbeActive() {
        if (typeof window === "undefined") {
          return false;
        }
        if (window.__VIEWPORT_SYNC_PROBE__ === true) {
          return true;
        }
        try {
          return new URLSearchParams(window.location.search).has("viewportSyncProbe");
        } catch {
          return false;
        }
      }
      exports.viewportSyncProbeActive = viewportSyncProbeActive;
      function viewportSyncProbeEmit(record) {
        if (!viewportSyncProbeActive()) {
          return;
        }
        const log = window.__viewportSyncProbeLog ?? [];
        log.push(record);
        window.__viewportSyncProbeLog = log;
        console.log("[viewportSyncProbe]", JSON.stringify(record));
      }
      exports.viewportSyncProbeEmit = viewportSyncProbeEmit;
      function viewportSyncProbeStartSampler(measure, remote, intervalMs = 250) {
        if (!viewportSyncProbeActive()) {
          return () => {
          };
        }
        const id = setInterval(() => {
          viewportSyncProbeEmit({
            kind: "tick",
            t: performance.now(),
            measure: measure(),
            remote: remote()
          });
        }, intervalMs);
        return () => clearInterval(id);
      }
      exports.viewportSyncProbeStartSampler = viewportSyncProbeStartSampler;
    }
  });

  // ../packages/page-projection/dist/projected/viewportSync.js
  var require_viewportSync = __commonJS({
    "../packages/page-projection/dist/projected/viewportSync.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.measureHostElement = exports.ViewportSync = void 0;
      var viewportPolicy_1 = require_viewportPolicy();
      Object.defineProperty(exports, "measureHostElement", { enumerable: true, get: function() {
        return viewportPolicy_1.measureHostElement;
      } });
      var viewportDevice_1 = require_viewportDevice();
      var viewportSyncProbe_1 = require_viewportSyncProbe();
      var ViewportSync2 = class _ViewportSync {
        measure;
        resize;
        viewportPolicy;
        debounceMs;
        isDeferred;
        onApplied;
        onRejected;
        detectDevice;
        remoteW = 0;
        remoteH = 0;
        deviceProfile = (0, viewportDevice_1.detectViewportDeviceProfile)();
        resizeTimer = null;
        resizeInFlight = false;
        pending = false;
        consecutiveRejects = 0;
        observer = null;
        viewportListenersAttached = false;
        disposed = false;
        stopProbeSampler = null;
        /** Cap automatic retries after applied:false / throw so permanent faults do not spin. */
        static MAX_REJECT_RETRIES = 5;
        constructor(options) {
          this.measure = options.measure;
          this.resize = options.resize;
          this.viewportPolicy = options.viewportPolicy;
          this.debounceMs = options.debounceMs ?? 320;
          this.isDeferred = options.isDeferred ?? (() => false);
          this.onApplied = options.onApplied;
          this.onRejected = options.onRejected;
          this.detectDevice = options.detectDevice ?? viewportDevice_1.detectViewportDeviceProfile;
          this.stopProbeSampler = (0, viewportSyncProbe_1.viewportSyncProbeStartSampler)(() => this.measure(), () => this.remoteSize);
        }
        /** Last confirmed remote viewport (after applied resize / seed from start). */
        get remoteSize() {
          return { width: this.remoteW, height: this.remoteH };
        }
        get remoteDevice() {
          return this.deviceProfile;
        }
        /** Seed confirmed size after Start / boot (already measured for launch). */
        seedRemote(width, height, device) {
          this.remoteW = width;
          this.remoteH = height;
          this.consecutiveRejects = 0;
          if (device) {
            this.deviceProfile = device;
          }
          this.onApplied?.({ width: this.remoteW, height: this.remoteH }, this.deviceProfile);
        }
        /** Observe the CSS layout host — never the inner surface stage / iframe. */
        observe(element) {
          this.observer?.disconnect();
          this.observer = new ResizeObserver(() => {
            const size = this.measure();
            this.schedule(size.width, size.height);
          });
          this.observer.observe(element);
          this.attachViewportListeners();
        }
        /**
         * Debounced remote resize. Coalesces while in flight; flushes latest on complete.
         * No-ops when within ε of the confirmed remote size and device is unchanged.
         */
        schedule(rawW, rawH) {
          if (this.disposed) {
            return;
          }
          if (this.isDeferred()) {
            this.pending = true;
            return;
          }
          if (this.resizeInFlight) {
            this.pending = true;
            return;
          }
          const validated = (0, viewportPolicy_1.validateResizeViewport)(rawW, rawH, this.viewportPolicy);
          if (!validated.ok) {
            (0, viewportSyncProbe_1.viewportSyncProbeEmit)({
              kind: "schedule_skip",
              t: performance.now(),
              reason: validated.message,
              measure: this.measure(),
              remote: this.remoteSize,
              rawW,
              rawH
            });
            return;
          }
          const { width: w, height: h } = validated;
          const nextProfile = this.detectDevice();
          if ((0, viewportPolicy_1.viewportSizesClose)(w, h, this.remoteW, this.remoteH) && (0, viewportDevice_1.deviceProfilesEqual)(this.deviceProfile, nextProfile)) {
            (0, viewportSyncProbe_1.viewportSyncProbeEmit)({
              kind: "schedule_skip",
              t: performance.now(),
              reason: "viewportSizesClose",
              measure: { width: w, height: h },
              remote: this.remoteSize,
              rawW,
              rawH
            });
            return;
          }
          if (this.resizeTimer) {
            clearTimeout(this.resizeTimer);
          }
          const delay = this.rejectBackoffMs();
          this.resizeTimer = setTimeout(() => {
            void this.invoke();
          }, delay);
        }
        /** After IME closes (or deferral clears), apply any layout change deferred. */
        flushPending() {
          if (!this.pending || this.isDeferred() || this.disposed) {
            return;
          }
          this.pending = false;
          const size = this.measure();
          this.schedule(size.width, size.height);
        }
        dispose() {
          this.disposed = true;
          this.stopProbeSampler?.();
          this.stopProbeSampler = null;
          if (this.resizeTimer) {
            clearTimeout(this.resizeTimer);
            this.resizeTimer = null;
          }
          this.observer?.disconnect();
          this.observer = null;
          this.detachViewportListeners();
        }
        onViewportEnvChange = () => {
          const size = this.measure();
          this.schedule(size.width, size.height);
        };
        attachViewportListeners() {
          if (this.viewportListenersAttached || typeof window === "undefined") {
            return;
          }
          this.viewportListenersAttached = true;
          window.addEventListener("resize", this.onViewportEnvChange);
          const vv = window.visualViewport;
          if (vv) {
            vv.addEventListener("resize", this.onViewportEnvChange);
            vv.addEventListener("scroll", this.onViewportEnvChange);
          }
        }
        detachViewportListeners() {
          if (!this.viewportListenersAttached || typeof window === "undefined") {
            return;
          }
          this.viewportListenersAttached = false;
          window.removeEventListener("resize", this.onViewportEnvChange);
          const vv = window.visualViewport;
          if (vv) {
            vv.removeEventListener("resize", this.onViewportEnvChange);
            vv.removeEventListener("scroll", this.onViewportEnvChange);
          }
        }
        rejectBackoffMs() {
          if (this.consecutiveRejects <= 0) {
            return this.debounceMs;
          }
          const factor = Math.min(8, 2 ** Math.min(this.consecutiveRejects, 3));
          return Math.min(2e3, this.debounceMs * factor);
        }
        async invoke() {
          if (this.disposed || this.resizeInFlight) {
            return;
          }
          if (this.isDeferred()) {
            this.pending = true;
            return;
          }
          const latest = this.measure();
          const validated = (0, viewportPolicy_1.validateResizeViewport)(latest.width, latest.height, this.viewportPolicy);
          if (!validated.ok) {
            (0, viewportSyncProbe_1.viewportSyncProbeEmit)({
              kind: "schedule_skip",
              t: performance.now(),
              reason: validated.message,
              measure: latest,
              remote: this.remoteSize,
              rawW: latest.width,
              rawH: latest.height
            });
            return;
          }
          const targetW = validated.width;
          const targetH = validated.height;
          const profile = this.detectDevice();
          if ((0, viewportPolicy_1.viewportSizesClose)(targetW, targetH, this.remoteW, this.remoteH) && (0, viewportDevice_1.deviceProfilesEqual)(this.deviceProfile, profile)) {
            this.consecutiveRejects = 0;
            (0, viewportSyncProbe_1.viewportSyncProbeEmit)({
              kind: "schedule_skip",
              t: performance.now(),
              reason: "invoke_viewportSizesClose",
              measure: { width: targetW, height: targetH },
              remote: this.remoteSize,
              rawW: latest.width,
              rawH: latest.height
            });
            return;
          }
          this.resizeInFlight = true;
          try {
            const result = await this.resize({ width: targetW, height: targetH }, profile);
            (0, viewportSyncProbe_1.viewportSyncProbeEmit)({
              kind: "resize",
              t: performance.now(),
              target: { width: targetW, height: targetH },
              result
            });
            if (this.disposed) {
              return;
            }
            if (result.applied) {
              this.remoteW = targetW;
              this.remoteH = targetH;
              this.deviceProfile = profile;
              this.consecutiveRejects = 0;
              this.onApplied?.({ width: targetW, height: targetH }, profile);
            } else {
              const detail = result.message || result.errorCode || "resize rejected";
              (0, viewportSyncProbe_1.viewportSyncProbeEmit)({
                kind: "resize_reject",
                t: performance.now(),
                detail: String(detail)
              });
              this.onRejected?.(String(detail));
              this.consecutiveRejects++;
              if (this.consecutiveRejects <= _ViewportSync.MAX_REJECT_RETRIES) {
                this.pending = true;
              }
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            (0, viewportSyncProbe_1.viewportSyncProbeEmit)({
              kind: "resize_reject",
              t: performance.now(),
              detail: message
            });
            this.onRejected?.(message);
            this.consecutiveRejects++;
            if (this.consecutiveRejects <= _ViewportSync.MAX_REJECT_RETRIES) {
              this.pending = true;
            }
          } finally {
            this.resizeInFlight = false;
            if (this.pending && !this.isDeferred() && !this.disposed) {
              this.pending = false;
              const size = this.measure();
              this.schedule(size.width, size.height);
            }
          }
        }
      };
      exports.ViewportSync = ViewportSync2;
    }
  });

  // ../packages/page-projection/dist/projected/index.js
  var require_projected = __commonJS({
    "../packages/page-projection/dist/projected/index.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.stampAuthInServedBody = exports.stampSrcsetAuth = exports.stampCssTextAuth = exports.stampAttrAuth = exports.appendSessionBindingQuery = exports.appendCacheBust = exports.appendSessionAuth = exports.isVirtualAssetUrl = exports.SessionCacheBustQueryParam = exports.SessionAuthQueryParam = exports.deviceProfilesEqual = exports.detectViewportDeviceProfile = exports.viewportSizesClose = exports.validateResizeViewport = exports.normalizeSessionViewport = exports.VIEWPORT_SIZE_EPSILON = exports.LAB_VIEWPORT_POLICY = exports.VIEWPORT_POLICY_BASELINE = exports.measureHostElement = exports.ViewportSync = exports.snapshotFormControls = exports.ScrollEchoGate = exports.ProjectedInputCaptureMetrics = exports.attachProjectedInputCapture = exports.NestedProjectedApply = exports.whenProjectedStandardsReady = exports.isProjectedStandardsDocument = exports.isProjectedStandardsSkeleton = exports.ensureProjectedK5Csp = exports.ensureProjectedDocumentBase = exports.constructedStyleSheetInit = exports.stripProjectedSkeleton = exports.stampProjectedStandardsSrcdoc = exports.PROJECTED_K5_CSP = exports.PROJECTED_SKELETON_META_NAME = exports.PROJECTED_STANDARDS_READY_TIMEOUT_MS = exports.PROJECTED_STANDARDS_SRCDOC = exports.createSurfaceHost = exports.PageProjectionRegistry = exports.DomFrameApplier = exports.createProjectionClient = exports.ProjectionClient = void 0;
      var ProjectionClient_1 = require_ProjectionClient();
      Object.defineProperty(exports, "ProjectionClient", { enumerable: true, get: function() {
        return ProjectionClient_1.ProjectionClient;
      } });
      Object.defineProperty(exports, "createProjectionClient", { enumerable: true, get: function() {
        return ProjectionClient_1.createProjectionClient;
      } });
      var applyDom_1 = require_applyDom();
      Object.defineProperty(exports, "DomFrameApplier", { enumerable: true, get: function() {
        return applyDom_1.DomFrameApplier;
      } });
      var registry_1 = require_registry();
      Object.defineProperty(exports, "PageProjectionRegistry", { enumerable: true, get: function() {
        return registry_1.PageProjectionRegistry;
      } });
      var surface_1 = require_surface();
      Object.defineProperty(exports, "createSurfaceHost", { enumerable: true, get: function() {
        return surface_1.createSurfaceHost;
      } });
      var projectedBlankIframe_1 = require_projectedBlankIframe();
      Object.defineProperty(exports, "PROJECTED_STANDARDS_SRCDOC", { enumerable: true, get: function() {
        return projectedBlankIframe_1.PROJECTED_STANDARDS_SRCDOC;
      } });
      Object.defineProperty(exports, "PROJECTED_STANDARDS_READY_TIMEOUT_MS", { enumerable: true, get: function() {
        return projectedBlankIframe_1.PROJECTED_STANDARDS_READY_TIMEOUT_MS;
      } });
      Object.defineProperty(exports, "PROJECTED_SKELETON_META_NAME", { enumerable: true, get: function() {
        return projectedBlankIframe_1.PROJECTED_SKELETON_META_NAME;
      } });
      Object.defineProperty(exports, "PROJECTED_K5_CSP", { enumerable: true, get: function() {
        return projectedBlankIframe_1.PROJECTED_K5_CSP;
      } });
      Object.defineProperty(exports, "stampProjectedStandardsSrcdoc", { enumerable: true, get: function() {
        return projectedBlankIframe_1.stampProjectedStandardsSrcdoc;
      } });
      Object.defineProperty(exports, "stripProjectedSkeleton", { enumerable: true, get: function() {
        return projectedBlankIframe_1.stripProjectedSkeleton;
      } });
      Object.defineProperty(exports, "constructedStyleSheetInit", { enumerable: true, get: function() {
        return projectedBlankIframe_1.constructedStyleSheetInit;
      } });
      Object.defineProperty(exports, "ensureProjectedDocumentBase", { enumerable: true, get: function() {
        return projectedBlankIframe_1.ensureProjectedDocumentBase;
      } });
      Object.defineProperty(exports, "ensureProjectedK5Csp", { enumerable: true, get: function() {
        return projectedBlankIframe_1.ensureProjectedK5Csp;
      } });
      Object.defineProperty(exports, "isProjectedStandardsSkeleton", { enumerable: true, get: function() {
        return projectedBlankIframe_1.isProjectedStandardsSkeleton;
      } });
      Object.defineProperty(exports, "isProjectedStandardsDocument", { enumerable: true, get: function() {
        return projectedBlankIframe_1.isProjectedStandardsDocument;
      } });
      Object.defineProperty(exports, "whenProjectedStandardsReady", { enumerable: true, get: function() {
        return projectedBlankIframe_1.whenProjectedStandardsReady;
      } });
      var nestedProjectedApply_1 = require_nestedProjectedApply();
      Object.defineProperty(exports, "NestedProjectedApply", { enumerable: true, get: function() {
        return nestedProjectedApply_1.NestedProjectedApply;
      } });
      var projectedInputCapture_1 = require_projectedInputCapture();
      Object.defineProperty(exports, "attachProjectedInputCapture", { enumerable: true, get: function() {
        return projectedInputCapture_1.attachProjectedInputCapture;
      } });
      var inputCaptureMetrics_1 = require_inputCaptureMetrics();
      Object.defineProperty(exports, "ProjectedInputCaptureMetrics", { enumerable: true, get: function() {
        return inputCaptureMetrics_1.ProjectedInputCaptureMetrics;
      } });
      var scrollEchoGate_1 = require_scrollEchoGate();
      Object.defineProperty(exports, "ScrollEchoGate", { enumerable: true, get: function() {
        return scrollEchoGate_1.ScrollEchoGate;
      } });
      var formControlSnapshot_1 = require_formControlSnapshot();
      Object.defineProperty(exports, "snapshotFormControls", { enumerable: true, get: function() {
        return formControlSnapshot_1.snapshotFormControls;
      } });
      var viewportSync_1 = require_viewportSync();
      Object.defineProperty(exports, "ViewportSync", { enumerable: true, get: function() {
        return viewportSync_1.ViewportSync;
      } });
      Object.defineProperty(exports, "measureHostElement", { enumerable: true, get: function() {
        return viewportSync_1.measureHostElement;
      } });
      var viewportPolicy_1 = require_viewportPolicy();
      Object.defineProperty(exports, "VIEWPORT_POLICY_BASELINE", { enumerable: true, get: function() {
        return viewportPolicy_1.VIEWPORT_POLICY_BASELINE;
      } });
      Object.defineProperty(exports, "LAB_VIEWPORT_POLICY", { enumerable: true, get: function() {
        return viewportPolicy_1.LAB_VIEWPORT_POLICY;
      } });
      Object.defineProperty(exports, "VIEWPORT_SIZE_EPSILON", { enumerable: true, get: function() {
        return viewportPolicy_1.VIEWPORT_SIZE_EPSILON;
      } });
      Object.defineProperty(exports, "normalizeSessionViewport", { enumerable: true, get: function() {
        return viewportPolicy_1.normalizeSessionViewport;
      } });
      Object.defineProperty(exports, "validateResizeViewport", { enumerable: true, get: function() {
        return viewportPolicy_1.validateResizeViewport;
      } });
      Object.defineProperty(exports, "viewportSizesClose", { enumerable: true, get: function() {
        return viewportPolicy_1.viewportSizesClose;
      } });
      var viewportDevice_1 = require_viewportDevice();
      Object.defineProperty(exports, "detectViewportDeviceProfile", { enumerable: true, get: function() {
        return viewportDevice_1.detectViewportDeviceProfile;
      } });
      Object.defineProperty(exports, "deviceProfilesEqual", { enumerable: true, get: function() {
        return viewportDevice_1.deviceProfilesEqual;
      } });
      var sessionBindingAuth_1 = require_sessionBindingAuth();
      Object.defineProperty(exports, "SessionAuthQueryParam", { enumerable: true, get: function() {
        return sessionBindingAuth_1.SessionAuthQueryParam;
      } });
      Object.defineProperty(exports, "SessionCacheBustQueryParam", { enumerable: true, get: function() {
        return sessionBindingAuth_1.SessionCacheBustQueryParam;
      } });
      Object.defineProperty(exports, "isVirtualAssetUrl", { enumerable: true, get: function() {
        return sessionBindingAuth_1.isVirtualAssetUrl;
      } });
      Object.defineProperty(exports, "appendSessionAuth", { enumerable: true, get: function() {
        return sessionBindingAuth_1.appendSessionAuth;
      } });
      Object.defineProperty(exports, "appendCacheBust", { enumerable: true, get: function() {
        return sessionBindingAuth_1.appendCacheBust;
      } });
      Object.defineProperty(exports, "appendSessionBindingQuery", { enumerable: true, get: function() {
        return sessionBindingAuth_1.appendSessionBindingQuery;
      } });
      Object.defineProperty(exports, "stampAttrAuth", { enumerable: true, get: function() {
        return sessionBindingAuth_1.stampAttrAuth;
      } });
      Object.defineProperty(exports, "stampCssTextAuth", { enumerable: true, get: function() {
        return sessionBindingAuth_1.stampCssTextAuth;
      } });
      Object.defineProperty(exports, "stampSrcsetAuth", { enumerable: true, get: function() {
        return sessionBindingAuth_1.stampSrcsetAuth;
      } });
      Object.defineProperty(exports, "stampAuthInServedBody", { enumerable: true, get: function() {
        return sessionBindingAuth_1.stampAuthInServedBody;
      } });
    }
  });

  // ../packages/page-projection/dist/core/snapshot/domTreeSnapshot.js
  var require_domTreeSnapshot = __commonJS({
    "../packages/page-projection/dist/core/snapshot/domTreeSnapshot.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.snapshotTree = void 0;
      var elementNs_1 = require_elementNs();
      var closedShadowLookup_1 = require_closedShadowLookup();
      function snapshotTree2(root) {
        return walkNode(root ?? document);
      }
      exports.snapshotTree = snapshotTree2;
      function walkNode(node) {
        switch (node.nodeType) {
          case 9:
            return { tag: "#document", children: mapChildren(node) };
          case 10: {
            const dt = node;
            return { tag: "#doctype", text: dt.name };
          }
          case 1: {
            const el2 = node;
            const attrs = [];
            const host = el2.contentWindow != null;
            for (let i = 0; i < el2.attributes.length; i++) {
              const a = el2.attributes[i];
              if (host && (a.name === "src" || a.name === "srcdoc"))
                continue;
              attrs.push([a.name, a.value]);
            }
            attrs.sort((x, y) => x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0);
            const result = { tag: el2.tagName.toLowerCase() };
            const ns = (0, elementNs_1.elementNsSnapshotLabel)(el2.namespaceURI);
            if (ns !== void 0)
              result.ns = ns;
            if (attrs.length > 0)
              result.attrs = attrs;
            const children = mapChildren(node);
            if (children.length > 0)
              result.children = children;
            const sr = (0, closedShadowLookup_1.resolveShadowRoot)(el2);
            if (sr !== null && sr.slotAssignment !== "manual") {
              const shadowKids = mapChildren(sr);
              result.shadow = { tag: "#shadow-root", ...shadowKids.length > 0 ? { children: shadowKids } : {} };
            }
            if (host) {
              try {
                const iframe = el2;
                const win = iframe.contentWindow;
                if (win)
                  result.frameHref = win.location.href;
                const inner = iframe.contentDocument;
                if (inner)
                  result.nested = walkNode(inner);
              } catch {
              }
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
        for (let i = 0; i < children.length; i++)
          out.push(walkNode(children[i]));
        return out;
      }
    }
  });

  // ../packages/page-projection/dist/core/domNodeKey.js
  var require_domNodeKey = __commonJS({
    "../packages/page-projection/dist/core/domNodeKey.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.NONE_DOM_NODE_KEY = void 0;
      exports.NONE_DOM_NODE_KEY = 0;
    }
  });

  // ../packages/page-projection/dist/core/contextBusConstants.js
  var require_contextBusConstants = __commonJS({
    "../packages/page-projection/dist/core/contextBusConstants.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.CONTEXT_BUS_CHANNEL = exports.CONTEXT_ID_PROVISIONAL = exports.CONTEXT_ID_MAX_DOCUMENT = exports.CONTEXT_BUS_RUNTIME = void 0;
      exports.CONTEXT_BUS_RUNTIME = 4294967295;
      exports.CONTEXT_ID_MAX_DOCUMENT = 4294967294;
      exports.CONTEXT_ID_PROVISIONAL = 0;
      exports.CONTEXT_BUS_CHANNEL = "speculum.context.bus";
    }
  });

  // ../packages/page-projection/dist/core/contextIdMint.js
  var require_contextIdMint = __commonJS({
    "../packages/page-projection/dist/core/contextIdMint.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.ContextIdMint = void 0;
      var contextBusConstants_1 = require_contextBusConstants();
      var ContextIdMint = class {
        next = 2;
        mint() {
          const id = this.next;
          if (id > contextBusConstants_1.CONTEXT_ID_MAX_DOCUMENT)
            throw new Error("contextId space exhausted");
          this.next = id + 1;
          return id >>> 0;
        }
        /** True for root (1) or any id already returned by {@link mint}. */
        hasMinted(id) {
          if (id === 1)
            return true;
          return Number.isInteger(id) && id >= 2 && id < this.next;
        }
      };
      exports.ContextIdMint = ContextIdMint;
    }
  });

  // ../packages/page-projection/dist/core/plane/channels.js
  var require_channels = __commonJS({
    "../packages/page-projection/dist/core/plane/channels.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.planeChannelName = exports.PlaneChannel = void 0;
      var PlaneChannel;
      (function(PlaneChannel2) {
        PlaneChannel2[PlaneChannel2["Frame"] = 1] = "Frame";
        PlaneChannel2[PlaneChannel2["Control"] = 2] = "Control";
        PlaneChannel2[PlaneChannel2["Telemetry"] = 3] = "Telemetry";
      })(PlaneChannel || (exports.PlaneChannel = PlaneChannel = {}));
      function planeChannelName(ch) {
        switch (ch) {
          case PlaneChannel.Frame:
            return "frame";
          case PlaneChannel.Control:
            return "control";
          case PlaneChannel.Telemetry:
            return "telemetry";
          default:
            return `channel(${ch})`;
        }
      }
      exports.planeChannelName = planeChannelName;
    }
  });

  // ../packages/page-projection/dist/core/loopback/envelope.js
  var require_envelope = __commonJS({
    "../packages/page-projection/dist/core/loopback/envelope.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.isLoopbackWireMessage = exports.decodeLoopbackToPlane = exports.encodeLoopbackFromPlane = exports.encodeLoopbackInvokeHeartbeat = exports.encodeLoopbackInvokeStarted = exports.encodeLoopbackInvokeResult = exports.encodeLoopbackInvoke = exports.encodeLoopbackHelloReject = exports.encodeLoopbackHelloAck = exports.encodeLoopbackHello = exports.decodeLoopbackEnvelope = exports.encodeLoopbackEnvelope = exports.LOOPBACK_GENERATION_SUPERSEDED_REASON = exports.LOOPBACK_GENERATION_SUPERSEDED_CODE = exports.LOOPBACK_WAIT_ESTABLISHED_DEFAULT_MS = exports.LOOPBACK_HELLO_ACK_TIMEOUT_MS = exports.LOOPBACK_WS_OPEN_TIMEOUT_MS = exports.LOOPBACK_INVOKE_HEARTBEAT_MS = exports.LOOPBACK_INVOKE_IDLE_MS = exports.LOOPBACK_CONTROL_INVOKE_NAME = exports.VIRTUAL_LOOPBACK_CHANNEL = void 0;
      var channels_1 = require_channels();
      exports.VIRTUAL_LOOPBACK_CHANNEL = "speculum.virtual.loopback";
      exports.LOOPBACK_CONTROL_INVOKE_NAME = "__control";
      exports.LOOPBACK_INVOKE_IDLE_MS = 2e3;
      exports.LOOPBACK_INVOKE_HEARTBEAT_MS = 500;
      exports.LOOPBACK_WS_OPEN_TIMEOUT_MS = 15e3;
      exports.LOOPBACK_HELLO_ACK_TIMEOUT_MS = 5e3;
      exports.LOOPBACK_WAIT_ESTABLISHED_DEFAULT_MS = 2e4;
      exports.LOOPBACK_GENERATION_SUPERSEDED_CODE = 4e3;
      exports.LOOPBACK_GENERATION_SUPERSEDED_REASON = "speculum:generation_superseded";
      function encodeLoopbackEnvelope(env) {
        return new TextEncoder().encode(JSON.stringify(env));
      }
      exports.encodeLoopbackEnvelope = encodeLoopbackEnvelope;
      function decodeLoopbackEnvelope(message) {
        let parsed;
        try {
          parsed = JSON.parse(new TextDecoder().decode(message));
        } catch {
          return null;
        }
        if (typeof parsed !== "object" || parsed === null)
          return null;
        const env = parsed;
        if (env.channel !== exports.VIRTUAL_LOOPBACK_CHANNEL || typeof env.kind !== "string")
          return null;
        switch (env.kind) {
          case "hello": {
            const h = env;
            if (typeof h.sessionId !== "string" || typeof h.generation !== "number")
              return null;
            if (h.role !== "virtual-root")
              return null;
            return {
              channel: exports.VIRTUAL_LOOPBACK_CHANNEL,
              kind: "hello",
              sessionId: h.sessionId,
              generation: h.generation >>> 0,
              role: "virtual-root"
            };
          }
          case "hello-ack": {
            const ack = env;
            if (typeof ack.sessionId !== "string" || typeof ack.generation !== "number")
              return null;
            if (ack.ok !== true)
              return null;
            return {
              channel: exports.VIRTUAL_LOOPBACK_CHANNEL,
              kind: "hello-ack",
              sessionId: ack.sessionId,
              generation: ack.generation >>> 0,
              ok: true
            };
          }
          case "hello-reject": {
            const rej = env;
            if (typeof rej.sessionId !== "string" || typeof rej.generation !== "number")
              return null;
            if (rej.ok !== false)
              return null;
            const reason = rej.reason;
            if (reason !== "generation_mismatch" && reason !== "session_mismatch" && reason !== "already_established" && reason !== "protocol_unsupported" && reason !== "server_shutting_down") {
              return null;
            }
            return {
              channel: exports.VIRTUAL_LOOPBACK_CHANNEL,
              kind: "hello-reject",
              sessionId: rej.sessionId,
              generation: rej.generation >>> 0,
              ok: false,
              reason
            };
          }
          case "frame": {
            const bytes = env.bytes;
            if (!Array.isArray(bytes))
              return null;
            return {
              channel: exports.VIRTUAL_LOOPBACK_CHANNEL,
              kind: "frame",
              bytes
            };
          }
          case "telemetry":
            return {
              channel: exports.VIRTUAL_LOOPBACK_CHANNEL,
              kind: "telemetry",
              message: env.message
            };
          case "invoke": {
            const inv = env;
            if (typeof inv.correlationId !== "number" || typeof inv.name !== "string")
              return null;
            return {
              channel: exports.VIRTUAL_LOOPBACK_CHANNEL,
              kind: "invoke",
              correlationId: inv.correlationId >>> 0,
              name: inv.name,
              args: inv.args
            };
          }
          case "invoke-started":
          case "invoke-heartbeat": {
            const hb = env;
            if (typeof hb.correlationId !== "number")
              return null;
            return {
              channel: exports.VIRTUAL_LOOPBACK_CHANNEL,
              kind: env.kind,
              correlationId: hb.correlationId >>> 0
            };
          }
          case "invoke-result": {
            const res = env;
            if (typeof res.correlationId !== "number" || typeof res.ok !== "boolean")
              return null;
            return {
              channel: exports.VIRTUAL_LOOPBACK_CHANNEL,
              kind: "invoke-result",
              correlationId: res.correlationId >>> 0,
              ok: res.ok,
              value: res.value,
              error: res.error && typeof res.error.message === "string" ? { message: res.error.message, name: res.error.name } : void 0
            };
          }
          default:
            return null;
        }
      }
      exports.decodeLoopbackEnvelope = decodeLoopbackEnvelope;
      function encodeLoopbackHello(sessionId, generation, role = "virtual-root") {
        return encodeLoopbackEnvelope({
          channel: exports.VIRTUAL_LOOPBACK_CHANNEL,
          kind: "hello",
          sessionId,
          generation: generation >>> 0,
          role
        });
      }
      exports.encodeLoopbackHello = encodeLoopbackHello;
      function encodeLoopbackHelloAck(sessionId, generation) {
        return encodeLoopbackEnvelope({
          channel: exports.VIRTUAL_LOOPBACK_CHANNEL,
          kind: "hello-ack",
          sessionId,
          generation: generation >>> 0,
          ok: true
        });
      }
      exports.encodeLoopbackHelloAck = encodeLoopbackHelloAck;
      function encodeLoopbackHelloReject(sessionId, generation, reason) {
        return encodeLoopbackEnvelope({
          channel: exports.VIRTUAL_LOOPBACK_CHANNEL,
          kind: "hello-reject",
          sessionId,
          generation: generation >>> 0,
          ok: false,
          reason
        });
      }
      exports.encodeLoopbackHelloReject = encodeLoopbackHelloReject;
      function encodeLoopbackInvoke(correlationId, name, args) {
        return encodeLoopbackEnvelope({
          channel: exports.VIRTUAL_LOOPBACK_CHANNEL,
          kind: "invoke",
          correlationId: correlationId >>> 0,
          name,
          args
        });
      }
      exports.encodeLoopbackInvoke = encodeLoopbackInvoke;
      function encodeLoopbackInvokeResult(correlationId, result) {
        return encodeLoopbackEnvelope({
          channel: exports.VIRTUAL_LOOPBACK_CHANNEL,
          kind: "invoke-result",
          correlationId: correlationId >>> 0,
          ok: result.ok,
          value: result.value,
          error: result.error
        });
      }
      exports.encodeLoopbackInvokeResult = encodeLoopbackInvokeResult;
      function encodeLoopbackInvokeStarted(correlationId) {
        return encodeLoopbackEnvelope({
          channel: exports.VIRTUAL_LOOPBACK_CHANNEL,
          kind: "invoke-started",
          correlationId: correlationId >>> 0
        });
      }
      exports.encodeLoopbackInvokeStarted = encodeLoopbackInvokeStarted;
      function encodeLoopbackInvokeHeartbeat(correlationId) {
        return encodeLoopbackEnvelope({
          channel: exports.VIRTUAL_LOOPBACK_CHANNEL,
          kind: "invoke-heartbeat",
          correlationId: correlationId >>> 0
        });
      }
      exports.encodeLoopbackInvokeHeartbeat = encodeLoopbackInvokeHeartbeat;
      function encodeLoopbackFromPlane(channel, payload) {
        if (channel === channels_1.PlaneChannel.Frame) {
          return encodeLoopbackEnvelope({
            channel: exports.VIRTUAL_LOOPBACK_CHANNEL,
            kind: "frame",
            bytes: Array.from(payload)
          });
        }
        if (channel === channels_1.PlaneChannel.Telemetry) {
          return encodeLoopbackEnvelope({
            channel: exports.VIRTUAL_LOOPBACK_CHANNEL,
            kind: "telemetry",
            message: JSON.parse(new TextDecoder().decode(payload))
          });
        }
        return encodeLoopbackInvoke(0, exports.LOOPBACK_CONTROL_INVOKE_NAME, JSON.parse(new TextDecoder().decode(payload)));
      }
      exports.encodeLoopbackFromPlane = encodeLoopbackFromPlane;
      function decodeLoopbackToPlane(message) {
        const env = decodeLoopbackEnvelope(message);
        if (env === null)
          return null;
        switch (env.kind) {
          case "frame":
            return { channel: channels_1.PlaneChannel.Frame, payload: Uint8Array.from(env.bytes) };
          case "telemetry":
            return {
              channel: channels_1.PlaneChannel.Telemetry,
              payload: new TextEncoder().encode(JSON.stringify(env.message ?? null))
            };
          case "invoke":
            if (env.name === exports.LOOPBACK_CONTROL_INVOKE_NAME) {
              return {
                channel: channels_1.PlaneChannel.Control,
                payload: new TextEncoder().encode(JSON.stringify(env.args ?? {}))
              };
            }
            return null;
          default:
            return null;
        }
      }
      exports.decodeLoopbackToPlane = decodeLoopbackToPlane;
      function isLoopbackWireMessage(message) {
        if (message.length < 2 || message[0] !== 123)
          return false;
        try {
          const parsed = JSON.parse(new TextDecoder().decode(message));
          return parsed.channel === exports.VIRTUAL_LOOPBACK_CHANNEL;
        } catch {
          return false;
        }
      }
      exports.isLoopbackWireMessage = isLoopbackWireMessage;
    }
  });

  // ../packages/page-projection/dist/core/plane/envelope.js
  var require_envelope2 = __commonJS({
    "../packages/page-projection/dist/core/plane/envelope.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.isPlaneEnvelope = exports.decodePlaneEnvelope = exports.encodePlaneEnvelope = exports.PLANE_HEADER_SIZE = exports.PLANE_VERSION = exports.PLANE_MAGIC = void 0;
      var envelope_1 = require_envelope();
      exports.PLANE_MAGIC = 20563;
      exports.PLANE_VERSION = 1;
      exports.PLANE_HEADER_SIZE = 5;
      function encodePlaneEnvelope(channel, payload, _flags = 0) {
        void _flags;
        return (0, envelope_1.encodeLoopbackFromPlane)(channel, payload);
      }
      exports.encodePlaneEnvelope = encodePlaneEnvelope;
      function decodePlaneEnvelope(message) {
        if ((0, envelope_1.isLoopbackWireMessage)(message)) {
          const mapped = (0, envelope_1.decodeLoopbackToPlane)(message);
          if (mapped === null)
            return null;
          return { channel: mapped.channel, flags: 0, payload: mapped.payload };
        }
        if (message.length < exports.PLANE_HEADER_SIZE)
          return null;
        const view = new DataView(message.buffer, message.byteOffset, message.byteLength);
        if (view.getUint16(0, true) !== exports.PLANE_MAGIC)
          return null;
        if (message[2] !== exports.PLANE_VERSION)
          return null;
        const channel = message[3];
        const flags = message[4];
        return {
          channel,
          flags,
          payload: message.subarray(exports.PLANE_HEADER_SIZE)
        };
      }
      exports.decodePlaneEnvelope = decodePlaneEnvelope;
      function isPlaneEnvelope(message) {
        return (0, envelope_1.isLoopbackWireMessage)(message) || decodePlaneEnvelope(message) !== null;
      }
      exports.isPlaneEnvelope = isPlaneEnvelope;
    }
  });

  // ../packages/page-projection/dist/core/plane/index.js
  var require_plane = __commonJS({
    "../packages/page-projection/dist/core/plane/index.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.isPlaneEnvelope = exports.decodePlaneEnvelope = exports.encodePlaneEnvelope = exports.PLANE_HEADER_SIZE = exports.PLANE_VERSION = exports.PLANE_MAGIC = exports.planeChannelName = exports.PlaneChannel = void 0;
      var channels_1 = require_channels();
      Object.defineProperty(exports, "PlaneChannel", { enumerable: true, get: function() {
        return channels_1.PlaneChannel;
      } });
      Object.defineProperty(exports, "planeChannelName", { enumerable: true, get: function() {
        return channels_1.planeChannelName;
      } });
      var envelope_1 = require_envelope2();
      Object.defineProperty(exports, "PLANE_MAGIC", { enumerable: true, get: function() {
        return envelope_1.PLANE_MAGIC;
      } });
      Object.defineProperty(exports, "PLANE_VERSION", { enumerable: true, get: function() {
        return envelope_1.PLANE_VERSION;
      } });
      Object.defineProperty(exports, "PLANE_HEADER_SIZE", { enumerable: true, get: function() {
        return envelope_1.PLANE_HEADER_SIZE;
      } });
      Object.defineProperty(exports, "encodePlaneEnvelope", { enumerable: true, get: function() {
        return envelope_1.encodePlaneEnvelope;
      } });
      Object.defineProperty(exports, "decodePlaneEnvelope", { enumerable: true, get: function() {
        return envelope_1.decodePlaneEnvelope;
      } });
      Object.defineProperty(exports, "isPlaneEnvelope", { enumerable: true, get: function() {
        return envelope_1.isPlaneEnvelope;
      } });
    }
  });

  // ../packages/page-projection/dist/core/loopback/socket.js
  var require_socket = __commonJS({
    "../packages/page-projection/dist/core/loopback/socket.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.LOOPBACK_SOCKET_CLOSED = exports.LOOPBACK_SOCKET_CLOSING = exports.LOOPBACK_SOCKET_OPEN = exports.LOOPBACK_SOCKET_CONNECTING = void 0;
      exports.LOOPBACK_SOCKET_CONNECTING = 0;
      exports.LOOPBACK_SOCKET_OPEN = 1;
      exports.LOOPBACK_SOCKET_CLOSING = 2;
      exports.LOOPBACK_SOCKET_CLOSED = 3;
    }
  });

  // ../packages/page-projection/dist/core/extensionPlane/envelope.js
  var require_envelope3 = __commonJS({
    "../packages/page-projection/dist/core/extensionPlane/envelope.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.decodeExtensionPlaneEnvelope = exports.isExtensionPlaneWireMessage = exports.EXTENSION_PLANE_CHANNEL = void 0;
      exports.EXTENSION_PLANE_CHANNEL = "speculum.extension.plane";
      function asUint8Array(value) {
        if (value instanceof Uint8Array)
          return value;
        if (ArrayBuffer.isView(value)) {
          const view = value;
          return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
        }
        if (value instanceof ArrayBuffer)
          return new Uint8Array(value);
        if (Array.isArray(value) && value.every((x) => typeof x === "number")) {
          return Uint8Array.from(value);
        }
        return null;
      }
      function isExtensionPlaneWireMessage(value) {
        return decodeExtensionPlaneEnvelope(value) !== null;
      }
      exports.isExtensionPlaneWireMessage = isExtensionPlaneWireMessage;
      function decodeExtensionPlaneEnvelope(value) {
        if (typeof value !== "object" || value === null)
          return null;
        const raw = value;
        if (raw.channel !== exports.EXTENSION_PLANE_CHANNEL)
          return null;
        if (typeof raw.token !== "string" || raw.token.length === 0)
          return null;
        if (typeof raw.kind !== "string")
          return null;
        const token = raw.token;
        switch (raw.kind) {
          case "bind":
          case "bind-ack":
            return { channel: exports.EXTENSION_PLANE_CHANNEL, token, kind: raw.kind };
          case "open": {
            if (typeof raw.url !== "string" || typeof raw.socketId !== "number")
              return null;
            return {
              channel: exports.EXTENSION_PLANE_CHANNEL,
              token,
              kind: "open",
              url: raw.url,
              socketId: raw.socketId >>> 0
            };
          }
          case "open-ok":
          case "open-fail": {
            if (typeof raw.socketId !== "number")
              return null;
            if (raw.kind === "open-ok") {
              return { channel: exports.EXTENSION_PLANE_CHANNEL, token, kind: "open-ok", socketId: raw.socketId >>> 0 };
            }
            if (typeof raw.message !== "string")
              return null;
            return {
              channel: exports.EXTENSION_PLANE_CHANNEL,
              token,
              kind: "open-fail",
              socketId: raw.socketId >>> 0,
              message: raw.message
            };
          }
          case "send":
          case "message": {
            if (typeof raw.socketId !== "number")
              return null;
            const bytes = asUint8Array(raw.bytes);
            if (bytes === null)
              return null;
            return {
              channel: exports.EXTENSION_PLANE_CHANNEL,
              token,
              kind: raw.kind,
              socketId: raw.socketId >>> 0,
              bytes
            };
          }
          case "close": {
            if (typeof raw.socketId !== "number")
              return null;
            const code = raw.code === void 0 ? void 0 : Number(raw.code);
            const reason = raw.reason === void 0 ? void 0 : String(raw.reason);
            return {
              channel: exports.EXTENSION_PLANE_CHANNEL,
              token,
              kind: "close",
              socketId: raw.socketId >>> 0,
              code: code !== void 0 && Number.isFinite(code) ? code : void 0,
              reason
            };
          }
          case "error": {
            if (typeof raw.socketId !== "number" || typeof raw.message !== "string")
              return null;
            return {
              channel: exports.EXTENSION_PLANE_CHANNEL,
              token,
              kind: "error",
              socketId: raw.socketId >>> 0,
              message: raw.message
            };
          }
          default:
            return null;
        }
      }
      exports.decodeExtensionPlaneEnvelope = decodeExtensionPlaneEnvelope;
    }
  });

  // ../packages/page-projection/dist/core/input/intentTypes.js
  var require_intentTypes = __commonJS({
    "../packages/page-projection/dist/core/input/intentTypes.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.INTENT_SCHEMA_VERSION = void 0;
      exports.INTENT_SCHEMA_VERSION = 1;
    }
  });

  // ../packages/page-projection/dist/core/input/geckoControlInput.js
  var require_geckoControlInput = __commonJS({
    "../packages/page-projection/dist/core/input/geckoControlInput.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.encodeControlFromIntent = exports.bytesToBase64 = exports.encodeAssetRequest = exports.encodeDownloadRespond = exports.encodePermissionRespond = exports.encodeBoolRespond = exports.encodeDialogRespond = exports.encodeViewportSet = exports.encodeHistoryGo = exports.encodeInputScroll = exports.encodeInputKey = exports.encodeInputPointer = exports.modsToU8 = exports.buttonToU8 = exports.fracToU16 = exports.GECKO_INPUT_SCROLL_SET = exports.GECKO_INPUT_KEY_UP = exports.GECKO_INPUT_KEY_DOWN = exports.GECKO_INPUT_UP = exports.GECKO_INPUT_DOWN = exports.GECKO_OP_DOWNLOAD_RESPOND = exports.GECKO_OP_PERMISSION_RESPOND = exports.GECKO_OP_DIALOG_RESPOND = exports.GECKO_OP_VIEWPORT_SET = exports.GECKO_OP_HISTORY_GO = exports.GECKO_OP_INPUT = void 0;
      exports.GECKO_OP_INPUT = 264;
      exports.GECKO_OP_HISTORY_GO = 262;
      exports.GECKO_OP_VIEWPORT_SET = 263;
      exports.GECKO_OP_DIALOG_RESPOND = 266;
      exports.GECKO_OP_PERMISSION_RESPOND = 267;
      exports.GECKO_OP_DOWNLOAD_RESPOND = 268;
      exports.GECKO_INPUT_DOWN = 1;
      exports.GECKO_INPUT_UP = 2;
      exports.GECKO_INPUT_KEY_DOWN = 3;
      exports.GECKO_INPUT_KEY_UP = 4;
      exports.GECKO_INPUT_SCROLL_SET = 5;
      var HEADER = 6;
      function writeU8(buf, off, v) {
        buf[off] = v & 255;
        return off + 1;
      }
      function writeU16(buf, off, v) {
        buf[off] = v & 255;
        buf[off + 1] = v >>> 8 & 255;
        return off + 2;
      }
      function writeU32(buf, off, v) {
        buf[off] = v & 255;
        buf[off + 1] = v >>> 8 & 255;
        buf[off + 2] = v >>> 16 & 255;
        buf[off + 3] = v >>> 24 & 255;
        return off + 4;
      }
      function writeU64(buf, off, v) {
        const lo = v >>> 0;
        const hi = Math.floor(v / 4294967296) >>> 0;
        off = writeU32(buf, off, lo);
        return writeU32(buf, off, hi);
      }
      function writeI32(buf, off, v) {
        return writeU32(buf, off, v | 0);
      }
      function writeStr(buf, off, value) {
        const bytes = new TextEncoder().encode(value);
        off = writeU32(buf, off, bytes.length);
        buf.set(bytes, off);
        return off + bytes.length;
      }
      function strSize(value) {
        return 4 + new TextEncoder().encode(value).length;
      }
      function header(buf, op, corr2) {
        let off = 0;
        off = writeU16(buf, off, op);
        return writeU32(buf, off, corr2);
      }
      function fracToU16(f) {
        if (f == null || Number.isNaN(f)) {
          return 32768;
        }
        if (f <= 0) {
          return 0;
        }
        if (f >= 1) {
          return 65535;
        }
        return Math.round(f * 65535);
      }
      exports.fracToU16 = fracToU16;
      function buttonToU8(button) {
        if (button === "middle") {
          return 1;
        }
        if (button === "right") {
          return 2;
        }
        return 0;
      }
      exports.buttonToU8 = buttonToU8;
      function modsToU8(mods) {
        let v = 0;
        if (mods?.ctrl)
          v |= 1;
        if (mods?.shift)
          v |= 2;
        if (mods?.alt)
          v |= 4;
        if (mods?.meta)
          v |= 8;
        return v;
      }
      exports.modsToU8 = modsToU8;
      function encodeInputPointer(corr2, ctx, type, nodeId, localX, localY, button) {
        const buf = new Uint8Array(HEADER + 4 + 1 + 4 + 2 + 2 + 1);
        let off = header(buf, exports.GECKO_OP_INPUT, corr2);
        off = writeU32(buf, off, ctx);
        off = writeU8(buf, off, type);
        off = writeU32(buf, off, nodeId);
        off = writeU16(buf, off, localX);
        off = writeU16(buf, off, localY);
        writeU8(buf, off, button);
        return buf;
      }
      exports.encodeInputPointer = encodeInputPointer;
      function encodeInputKey(corr2, ctx, type, key, code, mods) {
        const buf = new Uint8Array(HEADER + 4 + 1 + strSize(key) + strSize(code) + 1);
        let off = header(buf, exports.GECKO_OP_INPUT, corr2);
        off = writeU32(buf, off, ctx);
        off = writeU8(buf, off, type);
        off = writeStr(buf, off, key);
        off = writeStr(buf, off, code);
        writeU8(buf, off, mods);
        return buf;
      }
      exports.encodeInputKey = encodeInputKey;
      function encodeInputScroll(corr2, ctx, nodeId, fracX, fracY) {
        const buf = new Uint8Array(HEADER + 4 + 1 + 4 + 2 + 2);
        let off = header(buf, exports.GECKO_OP_INPUT, corr2);
        off = writeU32(buf, off, ctx);
        off = writeU8(buf, off, exports.GECKO_INPUT_SCROLL_SET);
        off = writeU32(buf, off, nodeId);
        off = writeU16(buf, off, fracX);
        writeU16(buf, off, fracY);
        return buf;
      }
      exports.encodeInputScroll = encodeInputScroll;
      function encodeHistoryGo(corr2, ctx, delta) {
        const buf = new Uint8Array(HEADER + 4 + 4);
        let off = header(buf, exports.GECKO_OP_HISTORY_GO, corr2);
        off = writeU32(buf, off, ctx);
        writeI32(buf, off, delta);
        return buf;
      }
      exports.encodeHistoryGo = encodeHistoryGo;
      function encodeViewportSet2(corr2, ctx, width, height) {
        const buf = new Uint8Array(HEADER + 4 + 4 + 4);
        let off = header(buf, exports.GECKO_OP_VIEWPORT_SET, corr2);
        off = writeU32(buf, off, ctx);
        off = writeI32(buf, off, width);
        writeI32(buf, off, height);
        return buf;
      }
      exports.encodeViewportSet = encodeViewportSet2;
      function encodeDialogRespond2(corr2, ctx, requestId, answer) {
        const buf = new Uint8Array(HEADER + 4 + 4 + strSize(answer));
        let off = header(buf, exports.GECKO_OP_DIALOG_RESPOND, corr2);
        off = writeU32(buf, off, ctx);
        off = writeU32(buf, off, requestId);
        writeStr(buf, off, answer);
        return buf;
      }
      exports.encodeDialogRespond = encodeDialogRespond2;
      function encodeBoolRespond(op, corr2, ctx, requestId, yes) {
        const buf = new Uint8Array(HEADER + 4 + 4 + 1);
        let off = header(buf, op, corr2);
        off = writeU32(buf, off, ctx);
        off = writeU32(buf, off, requestId);
        writeU8(buf, off, yes ? 1 : 0);
        return buf;
      }
      exports.encodeBoolRespond = encodeBoolRespond;
      function encodePermissionRespond2(corr2, ctx, requestId, granted) {
        return encodeBoolRespond(exports.GECKO_OP_PERMISSION_RESPOND, corr2, ctx, requestId, granted);
      }
      exports.encodePermissionRespond = encodePermissionRespond2;
      function encodeDownloadRespond2(corr2, ctx, requestId, accepted) {
        return encodeBoolRespond(exports.GECKO_OP_DOWNLOAD_RESPOND, corr2, ctx, requestId, accepted);
      }
      exports.encodeDownloadRespond = encodeDownloadRespond2;
      function encodeAssetRequest2(streamId, dest, url, range, offset) {
        const urlBytes = new TextEncoder().encode(url);
        const rangeBytes = new TextEncoder().encode(range);
        const inner = 1 + 4 + urlBytes.length + 4 + rangeBytes.length;
        const buf = new Uint8Array(4 + 1 + 8 + 4 + inner);
        let off = writeU32(buf, 0, streamId);
        off = writeU8(buf, off, 0);
        off = writeU64(buf, off, offset);
        off = writeU32(buf, off, inner);
        off = writeU8(buf, off, dest & 255);
        off = writeU32(buf, off, urlBytes.length);
        buf.set(urlBytes, off);
        off += urlBytes.length;
        off = writeU32(buf, off, rangeBytes.length);
        buf.set(rangeBytes, off);
        return buf;
      }
      exports.encodeAssetRequest = encodeAssetRequest2;
      function bytesToBase642(bytes) {
        let s = "";
        for (let i = 0; i < bytes.length; i++) {
          s += String.fromCharCode(bytes[i]);
        }
        return btoa(s);
      }
      exports.bytesToBase64 = bytesToBase642;
      function encodeControlFromIntent3(corr2, ctx, intent) {
        if (intent.type === "down" || intent.type === "up") {
          const nodeId = intent.nodeId ?? 0;
          return encodeInputPointer(corr2, intent.contextId ?? ctx, intent.type === "down" ? exports.GECKO_INPUT_DOWN : exports.GECKO_INPUT_UP, nodeId, fracToU16(intent.localX), fracToU16(intent.localY), buttonToU8(intent.button));
        }
        if (intent.type === "keyDown" || intent.type === "keyUp") {
          return encodeInputKey(corr2, intent.contextId ?? ctx, intent.type === "keyDown" ? exports.GECKO_INPUT_KEY_DOWN : exports.GECKO_INPUT_KEY_UP, intent.key, intent.code, modsToU8(intent.modifiers));
        }
        if (intent.type === "scrollSet") {
          return encodeInputScroll(corr2, intent.contextId ?? ctx, intent.nodeId ?? 0, fracToU16(intent.scrollFracX), fracToU16(intent.scrollFracY));
        }
        if (intent.type === "historyNav") {
          return encodeHistoryGo(corr2, ctx, intent.direction === "back" ? -1 : 1);
        }
        return null;
      }
      exports.encodeControlFromIntent = encodeControlFromIntent3;
    }
  });

  // ../packages/page-projection/dist/core/tableLiveOracle.js
  var require_tableLiveOracle = __commonJS({
    "../packages/page-projection/dist/core/tableLiveOracle.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.compareTableToLiveOrder = void 0;
      var frame_1 = require_frame();
      var opcodes_1 = require_opcodes();
      var MAX_DIVERGENCES = 50;
      var NONE = 0;
      function isSkippedKind(kind) {
        return kind === opcodes_1.NodeKind.Sheet || kind === opcodes_1.NodeKind.Rule || kind === opcodes_1.NodeKind.ShadowRoot;
      }
      function orderedDomChildIds(table, parent) {
        const all = table.orderedChildIds(parent);
        const out = [];
        for (let i = 0; i < all.length; i++) {
          const id = all[i];
          const row = table.getRow(id);
          if (row !== void 0 && isSkippedKind(row.kind))
            continue;
          out.push(id);
        }
        return out;
      }
      function idsEqual(a, b) {
        if (a.length !== b.length)
          return false;
        for (let i = 0; i < a.length; i++) {
          if (a[i] !== b[i])
            return false;
        }
        return true;
      }
      function compareTableToLiveOrder(table, liveChildren) {
        const divergences = [];
        let count = 0;
        const record = (path, kind, details) => {
          count += 1;
          if (divergences.length < MAX_DIVERGENCES)
            divergences.push({ path, kind, details });
        };
        const liveIds = /* @__PURE__ */ new Set();
        for (const kids of liveChildren.values()) {
          for (let i = 0; i < kids.length; i++)
            liveIds.add(kids[i]);
        }
        const parents = /* @__PURE__ */ new Set([frame_1.DOCUMENT_ID]);
        for (const parent of liveChildren.keys())
          parents.add(parent);
        for (const parent of parents) {
          const tableOrder = orderedDomChildIds(table, parent);
          const liveOrder = liveChildren.get(parent) ?? [];
          if (!idsEqual(tableOrder, liveOrder)) {
            const hashed = table.countAttachedChildren(parent);
            const lastWalk = tableOrder.length > 0 ? tableOrder[tableOrder.length - 1] : 0;
            const lastRow = lastWalk !== 0 ? table.getRow(lastWalk) : void 0;
            record(`#${parent}`, "child_order_mismatch", `walkLen=${tableOrder.length} hashedAttached=${hashed} liveLen=${liveOrder.length} tableHead=[${tableOrder.slice(0, 8).join(",")}] liveHead=[${liveOrder.slice(0, 8).join(",")}] lastWalk=#${lastWalk} lastRow=${lastRow ? `parent=${lastRow.parent} prev=${lastRow.prevSibling}` : "missing"}`);
          }
        }
        for (const id of liveIds) {
          const row = table.getRow(id);
          if (row === void 0) {
            record(`#${id}`, "missing_in_table", "connected mapped id has no table row");
          } else if (row.parent === NONE) {
            record(`#${id}`, "detached_but_connected", "table parent=0 but id appears in live child order");
          }
        }
        table.forEachRow((id, row) => {
          if (row.parent === NONE)
            return;
          if (isSkippedKind(row.kind))
            return;
          const parentIsLive = row.parent === frame_1.DOCUMENT_ID || liveIds.has(row.parent) || liveChildren.has(row.parent);
          if (!parentIsLive)
            return;
          if (!liveIds.has(id)) {
            record(`#${id}`, "extra_attached_in_table", `attached under ${row.parent} but absent from live walk`);
          }
        });
        return { kind: "table_live", identical: count === 0, divergenceCount: count, divergences };
      }
      exports.compareTableToLiveOrder = compareTableToLiveOrder;
    }
  });

  // ../packages/page-projection/dist/core/cssomTableLiveOracle.js
  var require_cssomTableLiveOracle = __commonJS({
    "../packages/page-projection/dist/core/cssomTableLiveOracle.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.compareTableToLiveCssom = exports.emptyCssomTableLiveOracleResult = void 0;
      var frame_1 = require_frame();
      var opcodes_1 = require_opcodes();
      var MAX_DIVERGENCES = 50;
      function idsEqual(a, b) {
        if (a.length !== b.length)
          return false;
        for (let i = 0; i < a.length; i++) {
          if (a[i] !== b[i])
            return false;
        }
        return true;
      }
      function orderedKindChildIds(table, parent, kind) {
        const all = table.orderedChildIds(parent);
        const out = [];
        for (let i = 0; i < all.length; i++) {
          const id = all[i];
          const row = table.getRow(id);
          if (row !== void 0 && row.kind === kind)
            out.push(id);
        }
        return out;
      }
      function emptyCssomTableLiveOracleResult() {
        return { kind: "cssom_table_live", identical: true, divergenceCount: 0, divergences: [] };
      }
      exports.emptyCssomTableLiveOracleResult = emptyCssomTableLiveOracleResult;
      function compareTableToLiveCssom(table, liveSheets) {
        const divergences = [];
        let count = 0;
        const record = (path, kind, details) => {
          count += 1;
          if (divergences.length < MAX_DIVERGENCES)
            divergences.push({ path, kind, details });
        };
        const byParent = /* @__PURE__ */ new Map();
        for (const live of liveSheets) {
          const parent = live.hostNode ?? frame_1.DOCUMENT_ID;
          const key = parent === 0 ? frame_1.DOCUMENT_ID : parent;
          let group = byParent.get(key);
          if (group === void 0) {
            group = [];
            byParent.set(key, group);
          }
          group.push(live);
        }
        const tableParents = /* @__PURE__ */ new Set([frame_1.DOCUMENT_ID, ...byParent.keys()]);
        table.forEachRow((_id, row) => {
          if (row.kind === opcodes_1.NodeKind.Sheet) {
            tableParents.add(row.parent === 0 ? frame_1.DOCUMENT_ID : row.parent);
          }
        });
        for (const parent of tableParents) {
          const tableSheets = orderedKindChildIds(table, parent, opcodes_1.NodeKind.Sheet);
          const liveGroup = byParent.get(parent) ?? [];
          const liveSheetIds = liveGroup.map((s) => s.id);
          if (!idsEqual(tableSheets, liveSheetIds)) {
            record(parent === frame_1.DOCUMENT_ID ? "#sheets" : `#${parent}/sheets`, "sheet_order_mismatch", `table=[${tableSheets.slice(0, 8).join(",")}] live=[${liveSheetIds.slice(0, 8).join(",")}]`);
          }
          const liveSheetSet = new Set(liveSheetIds);
          for (const id of tableSheets) {
            if (!liveSheetSet.has(id))
              record(`#${id}`, "extra_in_table", "Sheet row not in live readable list");
          }
          for (const live of liveGroup) {
            if (table.getRow(live.id) === void 0) {
              record(`#${live.id}`, "missing_in_table", "live readable sheet has no table row");
              continue;
            }
            const tableRules = orderedKindChildIds(table, live.id, opcodes_1.NodeKind.Rule);
            if (!idsEqual(tableRules, live.ruleIds)) {
              record(`#${live.id}`, "rule_order_mismatch", `table=[${tableRules.slice(0, 8).join(",")}] live=[${live.ruleIds.slice(0, 8).join(",")}]`);
            }
            const n = Math.min(tableRules.length, live.ruleIds.length, live.ruleHashes.length);
            for (let i = 0; i < n; i++) {
              const rid = live.ruleIds[i];
              if (tableRules[i] !== rid)
                continue;
              const row = table.getRow(rid);
              if (row === void 0) {
                record(`#${rid}`, "missing_in_table", "live rule has no table row");
                continue;
              }
              if (row.contentHash !== live.ruleHashes[i]) {
                record(`#${rid}`, "rule_content_mismatch", `sheet=#${live.id} contentHash diverged`);
              }
            }
            for (const rid of live.ruleIds) {
              if (table.getRow(rid) === void 0)
                record(`#${rid}`, "missing_in_table", "live rule has no table row");
            }
            for (const rid of tableRules) {
              if (!live.ruleIds.includes(rid))
                record(`#${rid}`, "extra_in_table", `Rule row not in live cssRules of sheet #${live.id}`);
            }
          }
        }
        return { kind: "cssom_table_live", identical: count === 0, divergenceCount: count, divergences };
      }
      exports.compareTableToLiveCssom = compareTableToLiveCssom;
    }
  });

  // ../packages/page-projection/dist/core/formControlSnap.js
  var require_formControlSnap = __commonJS({
    "../packages/page-projection/dist/core/formControlSnap.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.formControlSnapsEqual = void 0;
      function formControlSnapsEqual(a, b) {
        if (a == null || b == null) {
          return { identical: false, reason: "formProps missing" };
        }
        if (a.length !== b.length) {
          return { identical: false, reason: `count virtual=${a.length} projected=${b.length}` };
        }
        for (let i = 0; i < a.length; i++) {
          const left = a[i];
          const right = b[i];
          if (left.key !== right.key) {
            return { identical: false, reason: `key ${left.key} vs ${right.key}` };
          }
          if (left.value !== right.value || left.checked !== right.checked || left.selected !== right.selected) {
            return {
              identical: false,
              reason: `${left.key} virtual=${JSON.stringify(left)} projected=${JSON.stringify(right)}`
            };
          }
        }
        return { identical: true, reason: `${a.length} controls` };
      }
      exports.formControlSnapsEqual = formControlSnapsEqual;
    }
  });

  // ../packages/page-projection/dist/core/index.js
  var require_core = __commonJS({
    "../packages/page-projection/dist/core/index.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.LOOPBACK_GENERATION_SUPERSEDED_REASON = exports.LOOPBACK_GENERATION_SUPERSEDED_CODE = exports.LOOPBACK_WAIT_ESTABLISHED_DEFAULT_MS = exports.LOOPBACK_HELLO_ACK_TIMEOUT_MS = exports.LOOPBACK_WS_OPEN_TIMEOUT_MS = exports.LOOPBACK_INVOKE_HEARTBEAT_MS = exports.LOOPBACK_INVOKE_IDLE_MS = exports.LOOPBACK_CONTROL_INVOKE_NAME = exports.VIRTUAL_LOOPBACK_CHANNEL = exports.isPlaneEnvelope = exports.decodePlaneEnvelope = exports.encodePlaneEnvelope = exports.PLANE_HEADER_SIZE = exports.PLANE_VERSION = exports.PLANE_MAGIC = exports.planeChannelName = exports.PlaneChannel = exports.desyncPhase = exports.isProjectionTelemetryMessage = exports.TELEMETRY_BOOL_CAPS = exports.LAB_TELEMETRY_DEFAULTS = exports.DEFAULT_TELEMETRY_CONFIG = exports.TELEMETRY_WIRE_VERSION = exports.PersistentStringTable = exports.FramePartAssembler = exports.peekFrameHeader = exports.decodeFramePart = exports.isNestedHostNavAttr = exports.ensureNestedHostSandboxAccess = exports.ContextIdMint = exports.createFrame = exports.INSERT_AT_END = exports.CONTEXT_ID_ROOT = exports.DOCUMENT_ID = exports.FRAME_PREFIX_BYTES = exports.FRAME_WIRE_VERSION = exports.unpackElementNsWireByte = exports.packElementNsWireByte = exports.elementNsSnapshotLabel = exports.elementNsUri = exports.classifyElementNs = exports.ELEMENT_NS_NESTED_HOST_BIT = exports.ELEMENT_NS_MATHML = exports.ELEMENT_NS_SVG = exports.ELEMENT_NS_HTML = exports.ElementNs = exports.NodeKind = exports.opCodeName = exports.OpCode = exports.NONE_DOM_NODE_KEY = void 0;
      exports.compareTableToLiveCssom = exports.compareTableToLiveOrder = exports.applyFrameToTableChecked = exports.applyOpsToTable = exports.ReplicatedTable = exports.tableDigestsEqual = exports.digestReplicatedTable = exports.snapshotTree = exports.bytesToBase64 = exports.encodeAssetRequest = exports.encodeControlFromIntent = exports.encodeDownloadRespond = exports.encodePermissionRespond = exports.encodeDialogRespond = exports.encodeViewportSet = exports.encodeHistoryGo = exports.encodeInputScroll = exports.encodeInputKey = exports.encodeInputPointer = exports.modsToU8 = exports.buttonToU8 = exports.fracToU16 = exports.GECKO_INPUT_SCROLL_SET = exports.GECKO_INPUT_KEY_UP = exports.GECKO_INPUT_KEY_DOWN = exports.GECKO_INPUT_UP = exports.GECKO_INPUT_DOWN = exports.GECKO_OP_VIEWPORT_SET = exports.GECKO_OP_HISTORY_GO = exports.GECKO_OP_INPUT = exports.INTENT_SCHEMA_VERSION = exports.isExtensionPlaneWireMessage = exports.decodeExtensionPlaneEnvelope = exports.EXTENSION_PLANE_CHANNEL = exports.LOOPBACK_SOCKET_CLOSED = exports.LOOPBACK_SOCKET_CLOSING = exports.LOOPBACK_SOCKET_OPEN = exports.LOOPBACK_SOCKET_CONNECTING = exports.isLoopbackWireMessage = exports.decodeLoopbackToPlane = exports.encodeLoopbackFromPlane = exports.encodeLoopbackInvokeHeartbeat = exports.encodeLoopbackInvokeStarted = exports.encodeLoopbackInvokeResult = exports.encodeLoopbackInvoke = exports.encodeLoopbackHelloReject = exports.encodeLoopbackHelloAck = exports.encodeLoopbackHello = exports.decodeLoopbackEnvelope = exports.encodeLoopbackEnvelope = void 0;
      exports.formControlSnapsEqual = void 0;
      var domNodeKey_1 = require_domNodeKey();
      Object.defineProperty(exports, "NONE_DOM_NODE_KEY", { enumerable: true, get: function() {
        return domNodeKey_1.NONE_DOM_NODE_KEY;
      } });
      var opcodes_1 = require_opcodes();
      Object.defineProperty(exports, "OpCode", { enumerable: true, get: function() {
        return opcodes_1.OpCode;
      } });
      Object.defineProperty(exports, "opCodeName", { enumerable: true, get: function() {
        return opcodes_1.opCodeName;
      } });
      Object.defineProperty(exports, "NodeKind", { enumerable: true, get: function() {
        return opcodes_1.NodeKind;
      } });
      var elementNs_1 = require_elementNs();
      Object.defineProperty(exports, "ElementNs", { enumerable: true, get: function() {
        return elementNs_1.ElementNs;
      } });
      Object.defineProperty(exports, "ELEMENT_NS_HTML", { enumerable: true, get: function() {
        return elementNs_1.ELEMENT_NS_HTML;
      } });
      Object.defineProperty(exports, "ELEMENT_NS_SVG", { enumerable: true, get: function() {
        return elementNs_1.ELEMENT_NS_SVG;
      } });
      Object.defineProperty(exports, "ELEMENT_NS_MATHML", { enumerable: true, get: function() {
        return elementNs_1.ELEMENT_NS_MATHML;
      } });
      Object.defineProperty(exports, "ELEMENT_NS_NESTED_HOST_BIT", { enumerable: true, get: function() {
        return elementNs_1.ELEMENT_NS_NESTED_HOST_BIT;
      } });
      Object.defineProperty(exports, "classifyElementNs", { enumerable: true, get: function() {
        return elementNs_1.classifyElementNs;
      } });
      Object.defineProperty(exports, "elementNsUri", { enumerable: true, get: function() {
        return elementNs_1.elementNsUri;
      } });
      Object.defineProperty(exports, "elementNsSnapshotLabel", { enumerable: true, get: function() {
        return elementNs_1.elementNsSnapshotLabel;
      } });
      Object.defineProperty(exports, "packElementNsWireByte", { enumerable: true, get: function() {
        return elementNs_1.packElementNsWireByte;
      } });
      Object.defineProperty(exports, "unpackElementNsWireByte", { enumerable: true, get: function() {
        return elementNs_1.unpackElementNsWireByte;
      } });
      var frame_1 = require_frame();
      Object.defineProperty(exports, "FRAME_WIRE_VERSION", { enumerable: true, get: function() {
        return frame_1.FRAME_WIRE_VERSION;
      } });
      Object.defineProperty(exports, "FRAME_PREFIX_BYTES", { enumerable: true, get: function() {
        return frame_1.FRAME_PREFIX_BYTES;
      } });
      Object.defineProperty(exports, "DOCUMENT_ID", { enumerable: true, get: function() {
        return frame_1.DOCUMENT_ID;
      } });
      Object.defineProperty(exports, "CONTEXT_ID_ROOT", { enumerable: true, get: function() {
        return frame_1.CONTEXT_ID_ROOT;
      } });
      Object.defineProperty(exports, "INSERT_AT_END", { enumerable: true, get: function() {
        return frame_1.INSERT_AT_END;
      } });
      Object.defineProperty(exports, "createFrame", { enumerable: true, get: function() {
        return frame_1.createFrame;
      } });
      var contextIdMint_1 = require_contextIdMint();
      Object.defineProperty(exports, "ContextIdMint", { enumerable: true, get: function() {
        return contextIdMint_1.ContextIdMint;
      } });
      var nestedNav_1 = require_nestedNav();
      Object.defineProperty(exports, "ensureNestedHostSandboxAccess", { enumerable: true, get: function() {
        return nestedNav_1.ensureNestedHostSandboxAccess;
      } });
      Object.defineProperty(exports, "isNestedHostNavAttr", { enumerable: true, get: function() {
        return nestedNav_1.isNestedHostNavAttr;
      } });
      var decode_1 = require_decode();
      Object.defineProperty(exports, "decodeFramePart", { enumerable: true, get: function() {
        return decode_1.decodeFramePart;
      } });
      Object.defineProperty(exports, "peekFrameHeader", { enumerable: true, get: function() {
        return decode_1.peekFrameHeader;
      } });
      Object.defineProperty(exports, "FramePartAssembler", { enumerable: true, get: function() {
        return decode_1.FramePartAssembler;
      } });
      Object.defineProperty(exports, "PersistentStringTable", { enumerable: true, get: function() {
        return decode_1.PersistentStringTable;
      } });
      var telemetry_1 = require_telemetry();
      Object.defineProperty(exports, "TELEMETRY_WIRE_VERSION", { enumerable: true, get: function() {
        return telemetry_1.TELEMETRY_WIRE_VERSION;
      } });
      Object.defineProperty(exports, "DEFAULT_TELEMETRY_CONFIG", { enumerable: true, get: function() {
        return telemetry_1.DEFAULT_TELEMETRY_CONFIG;
      } });
      Object.defineProperty(exports, "LAB_TELEMETRY_DEFAULTS", { enumerable: true, get: function() {
        return telemetry_1.LAB_TELEMETRY_DEFAULTS;
      } });
      Object.defineProperty(exports, "TELEMETRY_BOOL_CAPS", { enumerable: true, get: function() {
        return telemetry_1.TELEMETRY_BOOL_CAPS;
      } });
      Object.defineProperty(exports, "isProjectionTelemetryMessage", { enumerable: true, get: function() {
        return telemetry_1.isProjectionTelemetryMessage;
      } });
      Object.defineProperty(exports, "desyncPhase", { enumerable: true, get: function() {
        return telemetry_1.desyncPhase;
      } });
      var plane_1 = require_plane();
      Object.defineProperty(exports, "PlaneChannel", { enumerable: true, get: function() {
        return plane_1.PlaneChannel;
      } });
      Object.defineProperty(exports, "planeChannelName", { enumerable: true, get: function() {
        return plane_1.planeChannelName;
      } });
      Object.defineProperty(exports, "PLANE_MAGIC", { enumerable: true, get: function() {
        return plane_1.PLANE_MAGIC;
      } });
      Object.defineProperty(exports, "PLANE_VERSION", { enumerable: true, get: function() {
        return plane_1.PLANE_VERSION;
      } });
      Object.defineProperty(exports, "PLANE_HEADER_SIZE", { enumerable: true, get: function() {
        return plane_1.PLANE_HEADER_SIZE;
      } });
      Object.defineProperty(exports, "encodePlaneEnvelope", { enumerable: true, get: function() {
        return plane_1.encodePlaneEnvelope;
      } });
      Object.defineProperty(exports, "decodePlaneEnvelope", { enumerable: true, get: function() {
        return plane_1.decodePlaneEnvelope;
      } });
      Object.defineProperty(exports, "isPlaneEnvelope", { enumerable: true, get: function() {
        return plane_1.isPlaneEnvelope;
      } });
      var envelope_1 = require_envelope();
      Object.defineProperty(exports, "VIRTUAL_LOOPBACK_CHANNEL", { enumerable: true, get: function() {
        return envelope_1.VIRTUAL_LOOPBACK_CHANNEL;
      } });
      Object.defineProperty(exports, "LOOPBACK_CONTROL_INVOKE_NAME", { enumerable: true, get: function() {
        return envelope_1.LOOPBACK_CONTROL_INVOKE_NAME;
      } });
      Object.defineProperty(exports, "LOOPBACK_INVOKE_IDLE_MS", { enumerable: true, get: function() {
        return envelope_1.LOOPBACK_INVOKE_IDLE_MS;
      } });
      Object.defineProperty(exports, "LOOPBACK_INVOKE_HEARTBEAT_MS", { enumerable: true, get: function() {
        return envelope_1.LOOPBACK_INVOKE_HEARTBEAT_MS;
      } });
      Object.defineProperty(exports, "LOOPBACK_WS_OPEN_TIMEOUT_MS", { enumerable: true, get: function() {
        return envelope_1.LOOPBACK_WS_OPEN_TIMEOUT_MS;
      } });
      Object.defineProperty(exports, "LOOPBACK_HELLO_ACK_TIMEOUT_MS", { enumerable: true, get: function() {
        return envelope_1.LOOPBACK_HELLO_ACK_TIMEOUT_MS;
      } });
      Object.defineProperty(exports, "LOOPBACK_WAIT_ESTABLISHED_DEFAULT_MS", { enumerable: true, get: function() {
        return envelope_1.LOOPBACK_WAIT_ESTABLISHED_DEFAULT_MS;
      } });
      Object.defineProperty(exports, "LOOPBACK_GENERATION_SUPERSEDED_CODE", { enumerable: true, get: function() {
        return envelope_1.LOOPBACK_GENERATION_SUPERSEDED_CODE;
      } });
      Object.defineProperty(exports, "LOOPBACK_GENERATION_SUPERSEDED_REASON", { enumerable: true, get: function() {
        return envelope_1.LOOPBACK_GENERATION_SUPERSEDED_REASON;
      } });
      Object.defineProperty(exports, "encodeLoopbackEnvelope", { enumerable: true, get: function() {
        return envelope_1.encodeLoopbackEnvelope;
      } });
      Object.defineProperty(exports, "decodeLoopbackEnvelope", { enumerable: true, get: function() {
        return envelope_1.decodeLoopbackEnvelope;
      } });
      Object.defineProperty(exports, "encodeLoopbackHello", { enumerable: true, get: function() {
        return envelope_1.encodeLoopbackHello;
      } });
      Object.defineProperty(exports, "encodeLoopbackHelloAck", { enumerable: true, get: function() {
        return envelope_1.encodeLoopbackHelloAck;
      } });
      Object.defineProperty(exports, "encodeLoopbackHelloReject", { enumerable: true, get: function() {
        return envelope_1.encodeLoopbackHelloReject;
      } });
      Object.defineProperty(exports, "encodeLoopbackInvoke", { enumerable: true, get: function() {
        return envelope_1.encodeLoopbackInvoke;
      } });
      Object.defineProperty(exports, "encodeLoopbackInvokeResult", { enumerable: true, get: function() {
        return envelope_1.encodeLoopbackInvokeResult;
      } });
      Object.defineProperty(exports, "encodeLoopbackInvokeStarted", { enumerable: true, get: function() {
        return envelope_1.encodeLoopbackInvokeStarted;
      } });
      Object.defineProperty(exports, "encodeLoopbackInvokeHeartbeat", { enumerable: true, get: function() {
        return envelope_1.encodeLoopbackInvokeHeartbeat;
      } });
      Object.defineProperty(exports, "encodeLoopbackFromPlane", { enumerable: true, get: function() {
        return envelope_1.encodeLoopbackFromPlane;
      } });
      Object.defineProperty(exports, "decodeLoopbackToPlane", { enumerable: true, get: function() {
        return envelope_1.decodeLoopbackToPlane;
      } });
      Object.defineProperty(exports, "isLoopbackWireMessage", { enumerable: true, get: function() {
        return envelope_1.isLoopbackWireMessage;
      } });
      var socket_1 = require_socket();
      Object.defineProperty(exports, "LOOPBACK_SOCKET_CONNECTING", { enumerable: true, get: function() {
        return socket_1.LOOPBACK_SOCKET_CONNECTING;
      } });
      Object.defineProperty(exports, "LOOPBACK_SOCKET_OPEN", { enumerable: true, get: function() {
        return socket_1.LOOPBACK_SOCKET_OPEN;
      } });
      Object.defineProperty(exports, "LOOPBACK_SOCKET_CLOSING", { enumerable: true, get: function() {
        return socket_1.LOOPBACK_SOCKET_CLOSING;
      } });
      Object.defineProperty(exports, "LOOPBACK_SOCKET_CLOSED", { enumerable: true, get: function() {
        return socket_1.LOOPBACK_SOCKET_CLOSED;
      } });
      var envelope_2 = require_envelope3();
      Object.defineProperty(exports, "EXTENSION_PLANE_CHANNEL", { enumerable: true, get: function() {
        return envelope_2.EXTENSION_PLANE_CHANNEL;
      } });
      Object.defineProperty(exports, "decodeExtensionPlaneEnvelope", { enumerable: true, get: function() {
        return envelope_2.decodeExtensionPlaneEnvelope;
      } });
      Object.defineProperty(exports, "isExtensionPlaneWireMessage", { enumerable: true, get: function() {
        return envelope_2.isExtensionPlaneWireMessage;
      } });
      var intentTypes_1 = require_intentTypes();
      Object.defineProperty(exports, "INTENT_SCHEMA_VERSION", { enumerable: true, get: function() {
        return intentTypes_1.INTENT_SCHEMA_VERSION;
      } });
      var geckoControlInput_1 = require_geckoControlInput();
      Object.defineProperty(exports, "GECKO_OP_INPUT", { enumerable: true, get: function() {
        return geckoControlInput_1.GECKO_OP_INPUT;
      } });
      Object.defineProperty(exports, "GECKO_OP_HISTORY_GO", { enumerable: true, get: function() {
        return geckoControlInput_1.GECKO_OP_HISTORY_GO;
      } });
      Object.defineProperty(exports, "GECKO_OP_VIEWPORT_SET", { enumerable: true, get: function() {
        return geckoControlInput_1.GECKO_OP_VIEWPORT_SET;
      } });
      Object.defineProperty(exports, "GECKO_INPUT_DOWN", { enumerable: true, get: function() {
        return geckoControlInput_1.GECKO_INPUT_DOWN;
      } });
      Object.defineProperty(exports, "GECKO_INPUT_UP", { enumerable: true, get: function() {
        return geckoControlInput_1.GECKO_INPUT_UP;
      } });
      Object.defineProperty(exports, "GECKO_INPUT_KEY_DOWN", { enumerable: true, get: function() {
        return geckoControlInput_1.GECKO_INPUT_KEY_DOWN;
      } });
      Object.defineProperty(exports, "GECKO_INPUT_KEY_UP", { enumerable: true, get: function() {
        return geckoControlInput_1.GECKO_INPUT_KEY_UP;
      } });
      Object.defineProperty(exports, "GECKO_INPUT_SCROLL_SET", { enumerable: true, get: function() {
        return geckoControlInput_1.GECKO_INPUT_SCROLL_SET;
      } });
      Object.defineProperty(exports, "fracToU16", { enumerable: true, get: function() {
        return geckoControlInput_1.fracToU16;
      } });
      Object.defineProperty(exports, "buttonToU8", { enumerable: true, get: function() {
        return geckoControlInput_1.buttonToU8;
      } });
      Object.defineProperty(exports, "modsToU8", { enumerable: true, get: function() {
        return geckoControlInput_1.modsToU8;
      } });
      Object.defineProperty(exports, "encodeInputPointer", { enumerable: true, get: function() {
        return geckoControlInput_1.encodeInputPointer;
      } });
      Object.defineProperty(exports, "encodeInputKey", { enumerable: true, get: function() {
        return geckoControlInput_1.encodeInputKey;
      } });
      Object.defineProperty(exports, "encodeInputScroll", { enumerable: true, get: function() {
        return geckoControlInput_1.encodeInputScroll;
      } });
      Object.defineProperty(exports, "encodeHistoryGo", { enumerable: true, get: function() {
        return geckoControlInput_1.encodeHistoryGo;
      } });
      Object.defineProperty(exports, "encodeViewportSet", { enumerable: true, get: function() {
        return geckoControlInput_1.encodeViewportSet;
      } });
      Object.defineProperty(exports, "encodeDialogRespond", { enumerable: true, get: function() {
        return geckoControlInput_1.encodeDialogRespond;
      } });
      Object.defineProperty(exports, "encodePermissionRespond", { enumerable: true, get: function() {
        return geckoControlInput_1.encodePermissionRespond;
      } });
      Object.defineProperty(exports, "encodeDownloadRespond", { enumerable: true, get: function() {
        return geckoControlInput_1.encodeDownloadRespond;
      } });
      Object.defineProperty(exports, "encodeControlFromIntent", { enumerable: true, get: function() {
        return geckoControlInput_1.encodeControlFromIntent;
      } });
      Object.defineProperty(exports, "encodeAssetRequest", { enumerable: true, get: function() {
        return geckoControlInput_1.encodeAssetRequest;
      } });
      Object.defineProperty(exports, "bytesToBase64", { enumerable: true, get: function() {
        return geckoControlInput_1.bytesToBase64;
      } });
      var domTreeSnapshot_1 = require_domTreeSnapshot();
      Object.defineProperty(exports, "snapshotTree", { enumerable: true, get: function() {
        return domTreeSnapshot_1.snapshotTree;
      } });
      var tableDigest_1 = require_tableDigest();
      Object.defineProperty(exports, "digestReplicatedTable", { enumerable: true, get: function() {
        return tableDigest_1.digestReplicatedTable;
      } });
      Object.defineProperty(exports, "tableDigestsEqual", { enumerable: true, get: function() {
        return tableDigest_1.tableDigestsEqual;
      } });
      var replicatedTable_1 = require_replicatedTable();
      Object.defineProperty(exports, "ReplicatedTable", { enumerable: true, get: function() {
        return replicatedTable_1.ReplicatedTable;
      } });
      var replicatedTableApply_1 = require_replicatedTableApply();
      Object.defineProperty(exports, "applyOpsToTable", { enumerable: true, get: function() {
        return replicatedTableApply_1.applyOpsToTable;
      } });
      Object.defineProperty(exports, "applyFrameToTableChecked", { enumerable: true, get: function() {
        return replicatedTableApply_1.applyFrameToTableChecked;
      } });
      var tableLiveOracle_1 = require_tableLiveOracle();
      Object.defineProperty(exports, "compareTableToLiveOrder", { enumerable: true, get: function() {
        return tableLiveOracle_1.compareTableToLiveOrder;
      } });
      var cssomTableLiveOracle_1 = require_cssomTableLiveOracle();
      Object.defineProperty(exports, "compareTableToLiveCssom", { enumerable: true, get: function() {
        return cssomTableLiveOracle_1.compareTableToLiveCssom;
      } });
      var formControlSnap_1 = require_formControlSnap();
      Object.defineProperty(exports, "formControlSnapsEqual", { enumerable: true, get: function() {
        return formControlSnap_1.formControlSnapsEqual;
      } });
    }
  });

  // browser/mirror/projection/lab/client/diagDomApply.ts
  var diagDomApply_exports = {};
  __export(diagDomApply_exports, {
    diagDomApplyFrameUrls: () => diagDomApplyFrameUrls
  });
  async function diagDomApplyFrameUrls(urls) {
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;left:-10000px;top:0;width:800px;height:600px;";
    document.body.appendChild(host);
    const iframe = document.createElement("iframe");
    iframe.style.cssText = "width:100%;height:100%;border:0";
    (0, import_projected.stampProjectedStandardsSrcdoc)(iframe);
    host.appendChild(iframe);
    try {
      await (0, import_projected.whenProjectedStandardsReady)(iframe);
      const doc = iframe.contentDocument;
      if (!doc) return { ok: false, frames: 0, lastSequence: null, desync: null, registrySize: 0, htmlLen: 0, error: "no contentDocument" };
      const registry = new import_projected.PageProjectionRegistry();
      registry.register(import_frame3.DOCUMENT_ID, doc);
      let desync = null;
      let lastSequence = null;
      const applier = new import_projected.DomFrameApplier(doc, registry, {
        onDesync: (info) => {
          desync = {
            reason: info.reason,
            op: info.op,
            id: info.id,
            message: info.message,
            sequence: info.sequence
          };
        },
        onApplied: (frame) => {
          lastSequence = frame.sequence;
        },
        applyBudgetMs: 6e4
      });
      const strings = new import_decode.PersistentStringTable();
      const assembler = new import_decode.FramePartAssembler();
      let frames = 0;
      for (const url of urls) {
        const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
        const hdr = (0, import_decode.peekFrameHeader)(buf);
        if (hdr && hdr.contextId !== import_frame3.CONTEXT_ID_ROOT && hdr.contextId !== 0) continue;
        const decoded = (0, import_decode.decodeFramePart)(buf, strings);
        if (!decoded.ok) {
          return {
            ok: false,
            frames,
            lastSequence,
            desync: { reason: decoded.reason, message: decoded.message },
            registrySize: registry.size,
            htmlLen: doc.documentElement?.outerHTML?.length ?? 0
          };
        }
        const assembled = assembler.ingest(decoded.part);
        if (assembled === "missing_part" || assembled === "malformed") {
          return {
            ok: false,
            frames,
            lastSequence,
            desync: { reason: assembled },
            registrySize: registry.size,
            htmlLen: doc.documentElement?.outerHTML?.length ?? 0
          };
        }
        if (assembled === null) continue;
        frames += 1;
        applier.enqueue(assembled);
        applier.flush();
        if (desync) {
          return {
            ok: false,
            frames,
            lastSequence,
            desync,
            registrySize: registry.size,
            htmlLen: doc.documentElement?.outerHTML?.length ?? 0
          };
        }
      }
      return {
        ok: true,
        frames,
        lastSequence,
        desync: null,
        registrySize: registry.size,
        htmlLen: doc.documentElement?.outerHTML?.length ?? 0
      };
    } catch (err) {
      return {
        ok: false,
        frames: 0,
        lastSequence: null,
        desync: null,
        registrySize: 0,
        htmlLen: 0,
        error: err instanceof Error ? err.message : String(err)
      };
    } finally {
      host.remove();
    }
  }
  var import_decode, import_frame3, import_projected;
  var init_diagDomApply = __esm({
    "browser/mirror/projection/lab/client/diagDomApply.ts"() {
      "use strict";
      import_decode = __toESM(require_decode());
      import_frame3 = __toESM(require_frame());
      import_projected = __toESM(require_projected());
    }
  });

  // browser/mirror/projection/lab/client/LabProjectedHarness.ts
  var import_ProjectionClient = __toESM(require_ProjectionClient());
  var import_frame = __toESM(require_frame());
  var import_closedShadowLookup2 = __toESM(require_closedShadowLookup());
  var import_tableDigest = __toESM(require_tableDigest());

  // browser/mirror/projection/lab/probes/turnstilePierce.ts
  var import_closedShadowLookup = __toESM(require_closedShadowLookup());

  // browser/mirror/projection/lab/probes/labPierce.ts
  function sampleElement(el2, name) {
    if (!el2) return { name, ok: false, reason: "missing" };
    const r = el2.getBoundingClientRect();
    const win = el2.ownerDocument.defaultView;
    const cs = win ? win.getComputedStyle(el2) : null;
    const html = el2;
    const isIframe = el2.tagName === "IFRAME";
    return {
      name,
      ok: true,
      tagName: el2.tagName.toLowerCase(),
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      offsetWidth: html.offsetWidth,
      offsetHeight: html.offsetHeight,
      display: cs?.display ?? null,
      visibility: cs?.visibility ?? null,
      hasSrcAttr: isIframe ? el2.hasAttribute("src") : null,
      src: isIframe ? el2.getAttribute("src") : null
    };
  }
  function samplePaint(el2) {
    if (!el2) return null;
    const win = el2.ownerDocument.defaultView;
    const cs = win ? win.getComputedStyle(el2) : null;
    if (!cs) return null;
    return {
      backgroundColor: cs.backgroundColor,
      color: cs.color,
      opacity: cs.opacity,
      visibility: cs.visibility,
      display: cs.display,
      borderTopWidth: cs.borderTopWidth,
      borderTopColor: cs.borderTopColor,
      borderTopStyle: cs.borderTopStyle,
      width: cs.width,
      height: cs.height
    };
  }

  // browser/mirror/projection/lab/probes/turnstilePierce.ts
  function findCfTurnstileWithHost(doc) {
    const root = doc.documentElement;
    if (!root) return { iframe: null, shadowHost: null };
    const queue = [{ node: root, shadowHost: null }];
    while (queue.length > 0) {
      const { node: n, shadowHost } = queue.shift();
      if (n.nodeType !== Node.ELEMENT_NODE) continue;
      const el2 = n;
      if (el2.tagName === "IFRAME") {
        const id = el2.id || "";
        const src = el2.getAttribute("src") || "";
        if (id.startsWith("cf-chl") || /challenges\.cloudflare\.com|turnstile/i.test(src)) {
          const hostFromRoot = shadowHost ?? (el2.getRootNode() instanceof ShadowRoot ? el2.getRootNode().host : null);
          return { iframe: el2, shadowHost: hostFromRoot };
        }
      }
      const sr = (0, import_closedShadowLookup.resolveShadowRoot)(el2);
      if (sr) {
        for (const c of Array.from(sr.childNodes)) queue.push({ node: c, shadowHost: el2 });
      }
      for (const c of Array.from(el2.childNodes)) queue.push({ node: c, shadowHost });
    }
    return { iframe: null, shadowHost: null };
  }
  function measureTurnstileRootRectsFromDocument(doc) {
    const { iframe, shadowHost } = findCfTurnstileWithHost(doc);
    return [
      sampleElement(iframe, "nested_host_iframe_in_root"),
      sampleElement(shadowHost, "root_shadow_host"),
      sampleElement(doc.documentElement, "root_documentElement")
    ];
  }

  // browser/mirror/projection/lab/probes/cssomSheetDump.ts
  function dumpSheetList(list, scope, hostId) {
    const out = [];
    if (!list) return out;
    const len = list.length;
    for (let i = 0; i < len; i++) {
      const s = list[i];
      if (!s) continue;
      let rules = "<<ERROR>>";
      let ruleCount = 0;
      try {
        const arr = [];
        for (let j = 0; j < s.cssRules.length; j++) {
          arr.push(s.cssRules.item(j)?.cssText ?? "");
        }
        rules = arr;
        ruleCount = arr.length;
      } catch {
        rules = "<<CROSS-ORIGIN>>";
      }
      const owner = s.ownerNode;
      const dataClass = owner && "dataset" in owner && owner.dataset?.class ? String(owner.dataset.class) : null;
      out.push({
        href: s.href || null,
        ownerNode: owner ? owner.tagName + (owner.id ? "#" + owner.id : "") : null,
        dataClass,
        ruleCount,
        rules,
        adopted: scope === "shadow" || !owner,
        scope,
        shadowHostId: hostId || null
      });
    }
    return out;
  }
  function collectShadowSheets(root, hostEl) {
    const hostId = hostEl.id || hostEl.tagName.toLowerCase();
    const out = [];
    try {
      out.push(...dumpSheetList(root.adoptedStyleSheets, "shadow", hostId));
    } catch {
    }
    const queue = [root];
    while (queue.length) {
      const n = queue.shift();
      const children = "childNodes" in n ? n.childNodes : [];
      for (let i = 0; i < children.length; i++) {
        const c = children.item(i);
        if (!c || c.nodeType !== 1) continue;
        const el2 = c;
        if (el2.shadowRoot) {
          out.push(
            ...dumpSheetList(
              el2.shadowRoot.adoptedStyleSheets,
              "shadow",
              el2.id || el2.tagName
            )
          );
          queue.push(el2.shadowRoot);
        }
        queue.push(el2);
      }
    }
    return out;
  }
  function dumpCssomSheets(doc) {
    try {
      const entries = dumpSheetList(doc.styleSheets, "document", null);
      try {
        if (doc.adoptedStyleSheets?.length) {
          const adopted = dumpSheetList(
            doc.adoptedStyleSheets,
            "document",
            null
          );
          for (const e of adopted) {
            e.adopted = true;
            entries.push(e);
          }
        }
      } catch {
      }
      const g = globalThis;
      const closedFixture = g.__speculumClosedRoot;
      if (closedFixture) {
        try {
          entries.push(
            ...dumpSheetList(
              closedFixture.styleSheets,
              "shadow",
              "shadow-host"
            )
          );
        } catch {
        }
        try {
          entries.push(
            ...dumpSheetList(
              closedFixture.adoptedStyleSheets,
              "shadow",
              "shadow-host"
            )
          );
        } catch {
        }
      }
      const hosts = doc.querySelectorAll("*");
      for (let i = 0; i < hosts.length; i++) {
        const h = hosts[i];
        const sr = h.shadowRoot || (g.__speculumResolveShadowRoot ? g.__speculumResolveShadowRoot(h) : null);
        if (sr) entries.push(...collectShadowSheets(sr, h));
      }
      let totalRules = 0;
      for (const e of entries) {
        if (Array.isArray(e.rules)) totalRules += e.rules.length;
      }
      return {
        ok: true,
        documentUrl: doc.URL,
        entries,
        styleSheetCount: entries.filter((e) => !e.adopted).length,
        adoptedCount: entries.filter((e) => e.adopted).length,
        totalRules
      };
    } catch (err) {
      return {
        ok: false,
        reason: err instanceof Error ? err.message : String(err),
        entries: [],
        styleSheetCount: 0,
        adoptedCount: 0,
        totalRules: 0
      };
    }
  }

  // browser/mirror/projection/lab/client/LabProjectedHarness.ts
  var LabProjectedHarness = class _LabProjectedHarness {
    client;
    constructor(client) {
      this.client = client;
    }
    static async create(opts) {
      const client = await (0, import_ProjectionClient.createProjectionClient)(opts);
      return new _LabProjectedHarness(client);
    }
    ingest(bytes) {
      this.client.ingest(bytes);
    }
    flush() {
      this.client.flush();
    }
    /** @deprecated alias — prefer {@link flush} */
    flushNow() {
      this.client.flush();
    }
    async reset() {
      await this.client.reset();
    }
    /** @deprecated alias — prefer {@link reset} */
    async resetSurface() {
      await this.client.reset();
    }
    get isArmed() {
      return this.client.isArmed;
    }
    getGeneration() {
      return this.client.getGeneration();
    }
    get lastAcceptedSequence() {
      return this.client.lastAcceptedSequence;
    }
    get document() {
      return this.client.document;
    }
    get desynced() {
      return this.client.desynced;
    }
    get applyError() {
      return this.client.applyError;
    }
    get resyncInFlight() {
      return this.client.resyncInFlight;
    }
    getLiveRegistry() {
      return this.client.getLiveRegistry();
    }
    /**
     * Lab diag — registry-grounded materialization probe for nested apply.
     * Uses applier registry (has closed ShadowRoot refs), not body.childNodes —
     * body as shadow host legitimately has 0 light children.
     */
    probeNestedRegistry(contextId, nodeIds) {
      if (contextId === import_frame.CONTEXT_ID_ROOT) {
        return {
          contextId,
          ok: false,
          reason: "use_root_snapshot_for_context_1",
          registrySize: 0,
          applierSequence: 0,
          applierGeneration: 0,
          applierTableHash: "0",
          applierTableRows: 0,
          applierDesynced: false,
          bodyLightChildCount: 0,
          nodes: []
        };
      }
      const nested = this.client.getNestedApply(contextId);
      if (!nested) {
        return {
          contextId,
          ok: false,
          reason: "nested_context_missing",
          registrySize: 0,
          applierSequence: 0,
          applierGeneration: 0,
          applierTableHash: "0",
          applierTableRows: 0,
          applierDesynced: true,
          bodyLightChildCount: 0,
          nodes: []
        };
      }
      const registry = nested.registry;
      const snap = nested.snapshotTable();
      const doc = nested.document;
      const body = doc.body;
      const bodyLightChildCount = body?.childNodes.length ?? 0;
      const nodes = nodeIds.map((id) => {
        const node = registry.get(id);
        if (!node) {
          return {
            id,
            present: false,
            nodeType: null,
            tagName: null,
            childCount: null,
            isShadowRoot: false,
            shadowHostId: null,
            hostMatchesId: null,
            rect: null
          };
        }
        const isShadowRoot = node.nodeType === Node.DOCUMENT_FRAGMENT_NODE;
        let shadowHostId = null;
        if (isShadowRoot) {
          const host = node.host;
          shadowHostId = host ? registry.idOf(host) ?? null : null;
        }
        let rect = null;
        if (node.nodeType === Node.ELEMENT_NODE) {
          const r = node.getBoundingClientRect();
          rect = { x: r.x, y: r.y, width: r.width, height: r.height };
        }
        return {
          id,
          present: true,
          nodeType: node.nodeType === Node.ELEMENT_NODE ? "ELEMENT" : node.nodeType === Node.TEXT_NODE ? "TEXT" : node.nodeType === Node.DOCUMENT_FRAGMENT_NODE ? "SHADOW_ROOT" : String(node.nodeType),
          tagName: node.nodeType === Node.ELEMENT_NODE ? node.tagName.toLowerCase() : null,
          childCount: node.childNodes.length,
          isShadowRoot,
          shadowHostId,
          hostMatchesId: shadowHostId,
          rect
        };
      });
      return {
        contextId,
        ok: true,
        registrySize: registry.size,
        applierSequence: snap.sequence,
        applierGeneration: snap.generation,
        applierTableHash: snap.table.tableHash,
        applierTableRows: snap.table.rowCount,
        applierDesynced: nested.desynced,
        bodyLightChildCount,
        nodes
      };
    }
    /**
     * Lab diag — root Turnstile rects with closed-shadow pierce (symmetric to Virtual measureTurnstileRootRects).
     */
    measureTurnstileRootRects() {
      return { ok: true, levels: measureTurnstileRootRectsFromDocument(this.client.document) };
    }
    /** Lab diag — computed style on nested widget node (registry ref, not querySelector). */
    probeWidgetPaint(nestedContextId, widgetNodeId) {
      const nested = this.client.getNestedApply(nestedContextId);
      if (!nested) return { ok: false, reason: "nested_context_missing", paint: null };
      const node = nested.registry.get(widgetNodeId);
      if (!node || node.nodeType !== Node.ELEMENT_NODE) {
        return { ok: false, reason: "widget_missing", paint: null };
      }
      return { ok: true, paint: samplePaint(node) };
    }
    /** Lab diag — CSSOM sheet dump in nested or root projected document. */
    probeCssomSheetDump(nestedContextId) {
      const contextId = nestedContextId ?? import_frame.CONTEXT_ID_ROOT;
      const doc = contextId === import_frame.CONTEXT_ID_ROOT ? this.client.document : this.client.getNestedApply(contextId)?.document ?? null;
      if (!doc) {
        return {
          ok: false,
          reason: "document_missing",
          entries: [],
          styleSheetCount: 0,
          adoptedCount: 0,
          totalRules: 0
        };
      }
      return dumpCssomSheets(doc);
    }
    /**
     * Lab diag — rect ladder from nested widget up to root projected surface.
     * Root levels 3–5 use closed-shadow pierce (symmetric to Virtual).
     */
    probeRectLadder(nestedContextId, widgetNodeId) {
      const toLevel = (sample, level) => ({
        level,
        name: sample.name,
        ok: sample.ok,
        reason: sample.reason,
        tagName: sample.tagName ?? null,
        rect: sample.rect ?? null,
        offsetWidth: sample.offsetWidth ?? null,
        offsetHeight: sample.offsetHeight ?? null,
        display: sample.display ?? null,
        visibility: sample.visibility ?? null,
        hasSrcAttr: sample.hasSrcAttr ?? null,
        src: sample.src ?? null
      });
      const nested = this.client.getNestedApply(nestedContextId);
      if (!nested) {
        return { contextId: nestedContextId, ok: false, reason: "nested_context_missing", levels: [] };
      }
      const widgetNode = nested.registry.get(widgetNodeId);
      const widgetEl = widgetNode && widgetNode.nodeType === Node.ELEMENT_NODE ? widgetNode : null;
      const nestedLevels = [
        toLevel(sampleElement(widgetEl, "nested_widget_div"), 1),
        toLevel(sampleElement(nested.document.documentElement, "nested_documentElement"), 2)
      ];
      const rootLevels = this.measureTurnstileRootRects().levels.map((s, i) => toLevel(s, i + 3));
      return { contextId: nestedContextId, ok: true, levels: [...nestedLevels, ...rootLevels] };
    }
    /**
     * Lab diag — peek nested host bookkeeping (awaiting load vs bound nested).
     */
    peekNestedHosts() {
      const c = this.client;
      const pendingFrames = {};
      for (const [id, q] of c.pendingNestedFrames) pendingFrames[String(id)] = q.length;
      const sessions = [...c.nested.entries()].sort((a, b) => a[0] - b[0]).map(([contextId, s]) => {
        let compat = null;
        let bodyLen = 0;
        let docIsLive = null;
        let bodyChildCount = null;
        let registryHasDocument = null;
        let tableRowCount = null;
        let tableHash = null;
        try {
          const live = s.hostIframe.contentDocument;
          compat = live?.compatMode ?? null;
          bodyLen = live?.body?.innerHTML?.length ?? 0;
          bodyChildCount = live?.body?.childNodes?.length ?? 0;
          const regDoc = s.registry.get(1) ?? null;
          docIsLive = live != null && regDoc === live;
          registryHasDocument = regDoc != null;
          const snap = s.snapshotTable();
          tableRowCount = snap.table.rowCount;
          tableHash = snap.table.tableHash;
        } catch {
          compat = "xo";
        }
        return {
          contextId,
          armed: s.isArmed,
          desynced: s.desynced,
          applyError: s.applyError,
          generation: s.getGeneration(),
          compat,
          bodyLen,
          docIsLive,
          bodyChildCount,
          registryHasDocument,
          tableRowCount,
          tableHash
        };
      });
      return {
        nested: [...c.nested.keys()].sort((a, b) => a - b),
        awaiting: [...c.nestedHostAwaitingLoad.keys()].sort((a, b) => a - b),
        pendingFrames,
        sessions
      };
    }
    /**
     * Lab diag — CF/Turnstile host bindings on Projected (registry nodeId ↔ nested contextId).
     * Pair with {@link runTurnstileWidgetParity} on the lab host for (a) readoption vs (b) dead nested.
     */
    probeWidgetHostBindings() {
      const c = this.client;
      const iframeToContext = /* @__PURE__ */ new Map();
      for (const [contextId, nested] of c.nested) {
        iframeToContext.set(nested.hostIframe, contextId);
      }
      const awaitingByIframe = /* @__PURE__ */ new Map();
      for (const [contextId, pending] of c.nestedHostAwaitingLoad) {
        awaitingByIframe.set(pending.iframe, contextId);
      }
      const isCfIframe = (el2) => {
        const id = el2.id || "";
        const src = el2.getAttribute("src") || "";
        return id.startsWith("cf-chl") || /challenges\.cloudflare\.com|turnstile/i.test(src);
      };
      const collectCfIframes = (doc) => {
        const root = doc.documentElement;
        if (!root) return [];
        const out = [];
        const queue = [root];
        while (queue.length > 0) {
          const n = queue.shift();
          if (n.nodeType !== Node.ELEMENT_NODE) continue;
          const el2 = n;
          if (el2.tagName === "IFRAME" && isCfIframe(el2)) {
            out.push(el2);
          }
          const sr = (0, import_closedShadowLookup2.resolveShadowRoot)(el2);
          if (sr) {
            for (const child of Array.from(sr.childNodes)) queue.push(child);
          }
          for (const child of Array.from(el2.childNodes)) queue.push(child);
        }
        return out;
      };
      const rootRegistry = c.getLiveRegistry();
      const nestedPeek = this.peekNestedHosts();
      const hosts = collectCfIframes(this.client.document).map((iframe) => {
        const nestedContextId = iframeToContext.get(iframe) ?? awaitingByIframe.get(iframe) ?? null;
        let registry = rootRegistry;
        if (nestedContextId != null) {
          const nested = c.nested.get(nestedContextId);
          if (nested) registry = nested.registry;
        }
        const registryNodeId = registry.idOf(iframe) ?? null;
        let nestedLive = null;
        if (nestedContextId != null) {
          const nested = c.nested.get(nestedContextId);
          const peek = nestedPeek.sessions.find((s) => s.contextId === nestedContextId);
          nestedLive = {
            bodyLen: peek?.bodyLen ?? null,
            iframeCount: null,
            generation: nested?.getGeneration() ?? null,
            armed: nested?.isArmed ?? null,
            desynced: nested?.desynced ?? null,
            docIsLive: peek?.docIsLive ?? null
          };
        }
        const pendingFrameCount = nestedContextId != null ? c.pendingNestedFrames.get(nestedContextId)?.length ?? 0 : 0;
        return {
          domId: iframe.id || null,
          src: (iframe.getAttribute("src") || "").slice(0, 512),
          w: iframe.offsetWidth,
          h: iframe.offsetHeight,
          registryNodeId,
          nestedContextId,
          awaitingLoad: awaitingByIframe.has(iframe),
          pendingFrameCount,
          inNestedMap: nestedContextId != null && c.nested.has(nestedContextId),
          isConnected: iframe.isConnected,
          nestedLive
        };
      });
      return {
        capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
        rootGeneration: this.client.getGeneration(),
        hosts,
        nestedPeek
      };
    }
    /**
     * Lab diag — load-after-drop: drop must cancel the pending `load` bind so a later
     * navigation cannot leave a dangling awaiting-load entry. Relocated out of
     * {@link ProjectionClient} (product/web bundle) — same logic, driven through its private
     * nested-host bookkeeping via the same lab-only cast as {@link peekNestedHosts}.
     */
    forceLoadAfterDropRaceForDiag(contextId) {
      const c = this.client;
      if (contextId === import_frame.CONTEXT_ID_ROOT) {
        return {
          ok: false,
          reason: "contextId_must_not_be_root",
          afterInstallAwaiting: [],
          afterDropAwaiting: []
        };
      }
      if (c.nested.has(contextId) || c.nestedHostAwaitingLoad.has(contextId)) {
        return {
          ok: false,
          reason: "contextId_in_use",
          afterInstallAwaiting: [...c.nestedHostAwaitingLoad.keys()].sort((a, b) => a - b),
          afterDropAwaiting: []
        };
      }
      const iframe = document.createElement("iframe");
      iframe.setAttribute("data-lab-load-after-drop", String(contextId));
      iframe.style.cssText = "position:absolute;width:0;height:0;border:0;visibility:hidden";
      document.documentElement.appendChild(iframe);
      c.installNestedHost(iframe, contextId);
      const afterInstallAwaiting = [...c.nestedHostAwaitingLoad.keys()].sort((a, b) => a - b);
      c.dropNestedHost(contextId);
      const afterDropAwaiting = [...c.nestedHostAwaitingLoad.keys()].sort((a, b) => a - b);
      iframe.src = "about:blank";
      return {
        ok: true,
        afterInstallAwaiting,
        afterDropAwaiting
      };
    }
    markPropDirty(id) {
      this.client.markPropDirty(id);
    }
    forEachNestedInputSurface(fn) {
      this.client.forEachNestedInputSurface(fn);
    }
    snapshotTable() {
      return this.client.liveTableDigest();
    }
    snapshotContext(contextId) {
      this.client.flush();
      if (contextId === import_frame.CONTEXT_ID_ROOT) {
        return {
          contextId,
          ...this.client.liveTableDigest(),
          desynced: this.client.desynced,
          applyError: this.client.applyError,
          armed: this.client.isArmed,
          resyncInFlight: this.client.resyncInFlight
        };
      }
      const nested = this.client.getNestedApply(contextId);
      if (!nested) {
        return {
          contextId,
          sequence: 0,
          generation: 0,
          table: (0, import_tableDigest.digestReplicatedTable)(this.client.getLiveRegistry()),
          desynced: true,
          applyError: "nested_context_missing",
          armed: false,
          resyncInFlight: false
        };
      }
      return {
        contextId,
        ...nested.snapshotTable(),
        desynced: nested.desynced,
        applyError: nested.applyError,
        armed: nested.isArmed,
        resyncInFlight: nested.resyncInFlight
      };
    }
    nestedDocument(contextId) {
      if (contextId === import_frame.CONTEXT_ID_ROOT) return this.client.document;
      const nested = this.client.getNestedApply(contextId);
      return nested?.isArmed ? nested.document : null;
    }
    /**
     * SEAL-CSSOM-P0-EOF: extra live rule with no table row.
     * Honest producer never emits this; CHECK after this must desync at end-of-frame verify.
     */
    tamperGhostCssRule() {
      const adopted = this.client.document.adoptedStyleSheets;
      const sheet = adopted.length > 0 ? adopted[adopted.length - 1] : void 0;
      if (!sheet) return { ok: false, reason: "tamper missed constructed sheet" };
      try {
        sheet.insertRule(".lab-ghost-eof{color:red}", 0);
        return { ok: true };
      } catch (err) {
        return { ok: false, reason: err instanceof Error ? err.message : String(err) };
      }
    }
  };

  // browser/mirror/projection/lab/client/main.ts
  var import_projected2 = __toESM(require_projected());
  var import_projected3 = __toESM(require_projected());
  var import_domTreeSnapshot = __toESM(require_domTreeSnapshot());
  var import_formControlSnapshot = __toESM(require_formControlSnapshot());

  // browser/mirror/projection/lab/probes/layoutRootCauseProbe.ts
  var DEFAULT_SELECTORS = [
    "header",
    '[class*="header"]',
    "nav",
    "main",
    "body",
    '[class*="search"]',
    "form",
    ".container",
    "#onetrust-banner-sdk"
  ];
  function probeLayoutRootCause(doc, win, selectors = DEFAULT_SELECTORS) {
    const pick = (sel) => {
      const el2 = doc.querySelector(sel);
      if (!el2) return { sel, missing: true };
      const cs = win.getComputedStyle(el2);
      const r = el2.getBoundingClientRect();
      return {
        sel,
        tag: el2.tagName,
        className: String(el2.className || "").slice(0, 120),
        display: cs.display,
        position: cs.position,
        flex: `${cs.flexDirection}/${cs.justifyContent}/${cs.alignItems}`,
        grid: cs.gridTemplateColumns,
        width: cs.width,
        height: cs.height,
        rect: { x: r.x, y: r.y, w: r.width, h: r.height },
        bg: cs.backgroundColor
      };
    };
    const samples = selectors.map(pick);
    const nodes = [
      ...doc.querySelectorAll('header, nav, [class*="header"], [class*="Header"], a, button')
    ].slice(0, 80);
    const rects = nodes.map((el2) => el2.getBoundingClientRect()).filter((r) => r.width > 10 && r.height > 8);
    let overlaps = 0;
    const n = Math.min(rects.length, 40);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = rects[i];
        const b = rects[j];
        const hit = !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
        if (hit) overlaps++;
      }
    }
    const sheets = [];
    let adoptedRules = 0;
    let docSheetRules = 0;
    const walk = (list, origin) => {
      const len = list.length;
      for (let i = 0; i < len; i++) {
        const s = list[i];
        let ruleCount = null;
        let err = null;
        const ruleTextSample = [];
        try {
          const rules = s.cssRules;
          ruleCount = rules.length;
          for (let j = 0; j < Math.min(rules.length, 8); j++) {
            ruleTextSample.push(rules.item(j)?.cssText?.slice(0, 160) ?? "");
          }
          if (origin === "document.adoptedStyleSheets") adoptedRules += rules.length;
          else docSheetRules += rules.length;
        } catch (e) {
          err = e instanceof Error ? e.message : String(e);
        }
        const owner = s.ownerNode;
        sheets.push({
          origin,
          href: s.href || null,
          owner: owner?.nodeName ?? null,
          ownerId: owner && "id" in owner ? String(owner.id || "") || null : null,
          ruleCount,
          err,
          ruleTextSample
        });
      }
    };
    try {
      walk(doc.styleSheets, "document.styleSheets");
    } catch {
    }
    try {
      if (doc.adoptedStyleSheets?.length) {
        walk(doc.adoptedStyleSheets, "document.adoptedStyleSheets");
      }
    } catch {
    }
    const allImgs = [...doc.images];
    const logoImgs = allImgs.filter((img) => {
      const s = img.currentSrc || img.src || "";
      return /logo\.svg/i.test(s) || /\/logo(\.|$)/i.test(s);
    });
    const brokenList = allImgs.filter((i) => i.complete && i.naturalWidth === 0);
    const mapImg = (img) => ({
      src: (img.currentSrc || img.src || "").slice(0, 220),
      srcset: (img.getAttribute("srcset") || "").slice(0, 160),
      complete: img.complete,
      naturalWidth: img.naturalWidth,
      width: img.width
    });
    const seen = /* @__PURE__ */ new Set();
    const imgs = [];
    for (const img of [...logoImgs, ...brokenList]) {
      if (seen.has(img)) continue;
      seen.add(img);
      imgs.push(mapImg(img));
      if (imgs.length >= 80) break;
    }
    const brokenImgs = brokenList.length;
    const styleEls = doc.querySelectorAll("style").length;
    const linkCss = doc.querySelectorAll('link[rel~="stylesheet"]').length;
    const adoptedSheetCount = doc.adoptedStyleSheets?.length ?? 0;
    const docSamples = /* @__PURE__ */ new Set();
    const adoSamples = /* @__PURE__ */ new Set();
    for (const s of sheets) {
      for (const t of s.ruleTextSample) {
        if (!t) continue;
        if (s.origin === "document.styleSheets") docSamples.add(t.slice(0, 80));
        else adoSamples.add(t.slice(0, 80));
      }
    }
    let duplicateAuthorRules = false;
    for (const t of docSamples) {
      if (adoSamples.has(t)) {
        duplicateAuthorRules = true;
        break;
      }
    }
    return {
      ok: true,
      samples,
      overlapPairsAmong40: overlaps,
      styleEls,
      linkCss,
      adoptedSheetCount,
      docSheetCount: doc.styleSheets.length,
      adoptedRules,
      docSheetRules,
      sheets,
      brokenImgs,
      imgsSample: imgs,
      bodyBg: doc.body ? win.getComputedStyle(doc.body).backgroundColor : null,
      dualHint: {
        styleElCount: styleEls,
        adoptedSheetCount,
        bothPlanesSubstantial: docSheetRules >= 50 && adoptedRules >= 50,
        duplicateAuthorRules
      }
    };
  }

  // browser/mirror/projection/lab/client/assetTrace.ts
  var MAX = 2e4;
  var events = [];
  function now() {
    return typeof performance !== "undefined" && performance.now ? Math.round(performance.timeOrigin + performance.now()) : Date.now();
  }
  function traceAllEnabled() {
    return !!globalThis.__SPECULUM_ASSET_TRACE;
  }
  function enableAssetTraceAll() {
    globalThis.__SPECULUM_ASSET_TRACE = true;
  }
  function bodyFnv16(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : bytes ? new Uint8Array(bytes) : new Uint8Array(0);
    let h = 14695981039346656037n;
    const prime = 1099511628211n;
    for (let i = 0; i < u8.length; i++) {
      h ^= BigInt(u8[i]);
      h = BigInt.asUintN(64, h * prime);
    }
    return h.toString(16).padStart(16, "0");
  }
  function bodyHeadAscii(bytes, n = 64) {
    const m = Math.min(bytes.length, n);
    let s = "";
    for (let i = 0; i < m; i++) {
      const c = bytes[i];
      s += c >= 32 && c < 127 ? String.fromCharCode(c) : ".";
    }
    return s;
  }
  function pushAssetTrace(partial) {
    const ev = { t: partial.t ?? now(), ...partial };
    events.push(ev);
    if (events.length > MAX) events.splice(0, events.length - MAX);
  }
  function drainAssetTrace() {
    return events.slice();
  }
  function clearAssetTrace() {
    events.length = 0;
  }
  function urlWorthTracing(url) {
    return /logo\.svg/i.test(url) || traceAllEnabled();
  }
  function installImgTrace(doc) {
    const seen = /* @__PURE__ */ new WeakSet();
    const onEvent = (type) => (ev) => {
      const t = ev.target;
      if (!(t instanceof HTMLImageElement)) return;
      if (seen.has(t) && type === "load") return;
      const src = t.currentSrc || t.src || "";
      if (!urlWorthTracing(src) && !(t.complete && t.naturalWidth === 0)) {
        if (!/logo\.svg/i.test(src)) return;
      }
      seen.add(t);
      pushAssetTrace({
        hop: "img.state",
        url: src.slice(0, 300),
        contextId: 1,
        event: type,
        complete: t.complete,
        naturalWidth: t.naturalWidth,
        naturalHeight: t.naturalHeight,
        currentSrc: (t.currentSrc || "").slice(0, 300)
      });
    };
    const onLoad = onEvent("load");
    const onError = onEvent("error");
    doc.addEventListener("load", onLoad, true);
    doc.addEventListener("error", onError, true);
    return () => {
      doc.removeEventListener("load", onLoad, true);
      doc.removeEventListener("error", onError, true);
    };
  }
  function sampleImgStates(doc, event = "sameS") {
    const imgs = [...doc.images];
    const allBroken = traceAllEnabled();
    let broken = 0;
    for (const img of imgs) {
      const src = img.currentSrc || img.src || "";
      const isLogo = /logo\.svg/i.test(src);
      const isBroken = img.complete && img.naturalWidth === 0;
      if (!isLogo && !isBroken) continue;
      if (isBroken && !isLogo && !allBroken) {
        if (broken >= 20) continue;
        broken++;
      }
      pushAssetTrace({
        hop: "img.state",
        url: src.slice(0, 300),
        contextId: 1,
        event,
        complete: img.complete,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        currentSrc: (img.currentSrc || "").slice(0, 300)
      });
    }
  }

  // browser/mirror/projection/lab/client/main.ts
  var import_decode2 = __toESM(require_decode());
  var import_telemetry = __toESM(require_telemetry());
  var import_frame4 = __toESM(require_frame());
  var import_core2 = __toESM(require_core());

  // browser/mirror/projection/lab/labPublicOrigin.ts
  var NGROK_SKIP_BROWSER_WARNING = "ngrok-skip-browser-warning";
  var NGROK_SKIP_HEADERS = {
    [NGROK_SKIP_BROWSER_WARNING]: "1"
  };

  // browser/mirror/projection/lab/static/labBuildStamp.json
  var labBuildStamp_default = {
    seq: 131,
    builtAt: "2026-09-16T23:00:27.755Z"
  };

  // browser/mirror/projection/lab/client/runsPanel.ts
  var DETAIL_SECTIONS = [
    { id: "overview", label: "Overview" },
    { id: "timeline", label: "Timeline" },
    { id: "verdicts", label: "Verdicts" },
    { id: "acts", label: "Acts" },
    { id: "artifacts", label: "Artifacts" },
    { id: "probes", label: "Probes" },
    { id: "raw", label: "Raw" }
  ];
  function fmtTs(iso) {
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return iso;
      return d.toLocaleString(void 0, {
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      });
    } catch {
      return iso;
    }
  }
  function fmtMs(ms) {
    if (ms == null || !Number.isFinite(ms)) return "\u2014";
    if (ms < 1e3) return `${Math.round(ms)} ms`;
    if (ms < 6e4) return `${(ms / 1e3).toFixed(1)} s`;
    const m = Math.floor(ms / 6e4);
    const s = Math.round(ms % 6e4 / 1e3);
    return `${m}m ${s}s`;
  }
  function fmtBytes(n) {
    if (n == null || !Number.isFinite(n)) return "\u2014";
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  }
  function durationMs(start, end) {
    const a = Date.parse(start);
    const b = Date.parse(end);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return Math.max(0, b - a);
  }
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function metric(label, value, tone) {
    const box = el("div", `runs-metric${tone ? ` runs-metric--${tone}` : ""}`);
    box.append(el("div", "runs-metric__label", label), el("div", "runs-metric__value", value));
    return box;
  }
  function verdictTone(status) {
    if (status === "pass") return "pass";
    if (status === "fail") return "fail";
    return "skipped";
  }
  function runCardTone(run) {
    if (run.verdicts.fail > 0 || run.status === "faulted") return "fail";
    if (run.verdicts.pass > 0 && run.verdicts.fail === 0) return "pass";
    return "neutral";
  }
  function truncateText(raw, max = 56) {
    if (!raw) return "\u2014";
    return raw.length > max ? `${raw.slice(0, max - 1)}\u2026` : raw;
  }
  function truncateUrl(raw, max = 48) {
    if (!raw) return "\u2014";
    try {
      const u = new URL(raw);
      const compact = `${u.host}${u.pathname}`;
      return truncateText(compact, max);
    } catch {
      return truncateText(raw, max);
    }
  }
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }
  function extractRunIdFromDossierPath(path) {
    const norm = path.replace(/\\/g, "/").replace(/\/+$/, "");
    const parts = norm.split("/");
    const last = parts[parts.length - 1];
    return last && last.length > 0 ? last : null;
  }
  function createRunsPanel(opts) {
    const root = document.getElementById("runsPanelRoot");
    if (!root) throw new Error("runsPanelRoot missing");
    let runs = [];
    let selectedId = null;
    let detail = null;
    let filter = "all";
    let search = "";
    let detailSection = "overview";
    let loading = false;
    const selectedIds = /* @__PURE__ */ new Set();
    const listEl = document.getElementById("runsList");
    const detailHeaderEl = document.getElementById("runsDetailHeader");
    const detailBodyEl = document.getElementById("runsDetailBody");
    const searchInput = document.getElementById("runsSearch");
    const filterBar = document.getElementById("runsFilters");
    const statsEl = document.getElementById("runsStats");
    const selectAllInput = document.getElementById("runsSelectAll");
    const deleteSelectedBtn = document.getElementById("runsDeleteSelected");
    function setLoading(on) {
      loading = on;
      root.classList.toggle("runs-panel--loading", on);
    }
    function filteredRuns() {
      const q = search.trim().toLowerCase();
      return runs.filter((r) => {
        if (filter === "pass" && (r.verdicts.fail > 0 || r.exitCode !== 0)) return false;
        if (filter === "fail" && r.verdicts.fail === 0 && r.status !== "faulted") return false;
        if (filter === "browse" && r.mode !== "browse") return false;
        if (filter === "run" && r.mode !== "run") return false;
        if (!q) return true;
        const hay = [
          r.id,
          r.blueprintId ?? "",
          r.url ?? "",
          r.status,
          r.mode
        ].join(" ").toLowerCase();
        return hay.includes(q);
      });
    }
    function renderStats() {
      if (!statsEl) return;
      const visible = filteredRuns();
      const pass = visible.filter((r) => r.verdicts.fail === 0 && r.exitCode === 0 && r.verdicts.pass > 0).length;
      const fail = visible.filter((r) => r.verdicts.fail > 0 || r.status === "faulted" || r.exitCode !== 0).length;
      statsEl.textContent = visible.length === runs.length ? `${runs.length} runs \xB7 ${pass} pass \xB7 ${fail} fail` : `${visible.length}/${runs.length} shown \xB7 ${pass} pass \xB7 ${fail} fail`;
    }
    function syncBulkUi() {
      const visible = filteredRuns();
      const visibleIds = visible.map((r) => r.id);
      const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
      const someSelected = visibleIds.some((id) => selectedIds.has(id));
      if (selectAllInput) {
        selectAllInput.checked = allSelected;
        selectAllInput.indeterminate = someSelected && !allSelected;
      }
      if (deleteSelectedBtn) {
        deleteSelectedBtn.disabled = selectedIds.size === 0 || loading;
        deleteSelectedBtn.textContent = selectedIds.size > 0 ? `Delete (${selectedIds.size})` : "Delete selected";
      }
    }
    async function deleteRuns(ids, label) {
      if (ids.length === 0) return;
      const msg = ids.length === 1 ? `Delete dossier "${ids[0]}"? This removes the folder from disk.` : `Delete ${ids.length} dossiers (${label})? This cannot be undone.`;
      if (!window.confirm(msg)) return;
      setLoading(true);
      try {
        const res = await opts.fetch("/lab/runs/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json();
        const deleted = body.deleted ?? [];
        for (const id of deleted) selectedIds.delete(id);
        if (selectedId && deleted.includes(selectedId)) {
          selectedId = null;
          detail = null;
        }
        opts.onActivity?.(`runs deleted ${deleted.length}${body.failed?.length ? ` (${body.failed.length} failed)` : ""}`);
        await refresh();
      } catch (err) {
        opts.onActivity?.(`runs.delete failed ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setLoading(false);
      }
    }
    function renderFilters() {
      filterBar.querySelectorAll("[data-runs-filter]").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.runsFilter === filter);
      });
    }
    function renderList() {
      listEl.replaceChildren();
      const visible = filteredRuns();
      renderStats();
      syncBulkUi();
      if (visible.length === 0) {
        const empty = el("div", "runs-list-empty", runs.length === 0 ? "No dossiers yet \u2014 start a Browse or Run." : "No runs match filter.");
        listEl.append(empty);
        return;
      }
      for (const run of visible) {
        const card = el("div", `runs-card runs-card--${runCardTone(run)}${selectedId === run.id ? " runs-card--selected" : ""}`);
        card.dataset.runId = run.id;
        const check = el("input");
        check.type = "checkbox";
        check.className = "runs-card__check";
        check.checked = selectedIds.has(run.id);
        check.title = "Select for bulk delete";
        check.addEventListener("click", (ev) => ev.stopPropagation());
        check.addEventListener("change", () => {
          if (check.checked) selectedIds.add(run.id);
          else selectedIds.delete(run.id);
          syncBulkUi();
          card.classList.toggle("runs-card--checked", check.checked);
        });
        const bodyBtn = el("button", "runs-card__body");
        bodyBtn.type = "button";
        const head = el("div", "runs-card__head");
        const title = el("div", "runs-card__title", run.blueprintId ?? (run.mode === "browse" ? "Browse" : run.id.slice(0, 24)));
        const when = el("div", "runs-card__when", fmtTs(run.createdAt));
        head.append(title, when);
        const urlLine = el("div", "runs-card__url", truncateUrl(run.url));
        urlLine.title = run.url ?? "";
        const meta = el("div", "runs-card__meta");
        meta.append(
          el("span", `runs-chip runs-chip--mode`, run.mode),
          el("span", `runs-chip runs-chip--${run.status === "faulted" ? "fail" : "status"}`, run.status)
        );
        if (run.verdicts.pass + run.verdicts.fail + run.verdicts.skipped > 0) {
          meta.append(
            el("span", "runs-chip runs-chip--pass", `\u2713 ${run.verdicts.pass}`),
            run.verdicts.fail > 0 ? el("span", "runs-chip runs-chip--fail", `\u2717 ${run.verdicts.fail}`) : document.createDocumentFragment(),
            run.verdicts.skipped > 0 ? el("span", "runs-chip runs-chip--skip", `\u2298 ${run.verdicts.skipped}`) : document.createDocumentFragment()
          );
        }
        if (run.wallMs != null) {
          meta.append(el("span", "runs-chip runs-chip--muted", fmtMs(run.wallMs)));
        }
        bodyBtn.append(head, urlLine, meta);
        bodyBtn.addEventListener("click", () => {
          void selectRun(run.id);
        });
        card.append(check, bodyBtn);
        card.classList.toggle("runs-card--checked", check.checked);
        listEl.append(card);
      }
    }
    function renderDetailNav() {
      const nav = el("div", "runs-detail-nav");
      for (const s of DETAIL_SECTIONS) {
        const btn = el("button", `runs-detail-nav__btn${detailSection === s.id ? " active" : ""}`, s.label);
        btn.type = "button";
        btn.dataset.runsSection = s.id;
        btn.addEventListener("click", () => {
          detailSection = s.id;
          renderDetail();
        });
        nav.append(btn);
      }
      return nav;
    }
    function renderOverview(d) {
      const wrap = el("div", "runs-section");
      const vSum = d.verdicts.reduce(
        (acc, v) => {
          acc[v.status] += 1;
          return acc;
        },
        { pass: 0, fail: 0, skipped: 0 }
      );
      const hero = el("div", "runs-hero");
      const exitTone = vSum.fail > 0 || d.crash ? "fail" : vSum.pass > 0 ? "pass" : "neutral";
      hero.append(
        el("div", `runs-hero__badge runs-hero__badge--${exitTone}`, vSum.fail > 0 ? "FAILED" : vSum.pass > 0 ? "PASSED" : "NO VERDICTS"),
        el("div", "runs-hero__title", String(d.session.blueprintId ?? d.session.mode ?? "Session")),
        el("div", "runs-hero__sub", String(d.session.url ?? d.meta?.url ?? "\u2014"))
      );
      wrap.append(hero);
      const grid = el("div", "runs-metric-grid");
      grid.append(
        metric("Session", String(d.session.sessionId ?? "\u2014").slice(0, 8) + "\u2026"),
        metric("Mode", String(d.session.mode ?? "\u2014")),
        metric("Status", String(d.session.status ?? "\u2014"), String(d.session.status) === "faulted" ? "fail" : void 0),
        metric("Wall", fmtMs(typeof d.meta?.wallMs === "number" ? d.meta.wallMs : null)),
        metric("Frame Hz", String(d.session.frameRateHz ?? d.meta?.frameRateHz ?? "\u2014")),
        metric("Headed", d.session.headed === true ? "yes" : "no"),
        metric("Verdicts", `${vSum.pass} / ${vSum.fail} / ${vSum.skipped}`, vSum.fail > 0 ? "fail" : "pass"),
        metric("Timeline", String(d.timeline.length)),
        metric("Acts", String(d.acts.length)),
        metric("Artifacts", String(d.manifest?.artifacts?.length ?? 0))
      );
      wrap.append(grid);
      if (d.session.fault && typeof d.session.fault === "object") {
        const fault = d.session.fault;
        const box = el("div", "runs-callout runs-callout--fail");
        box.append(
          el("strong", void 0, "Session fault"),
          el("div", void 0, fault.message ?? "unknown"),
          el("div", "runs-callout__meta", fault.at ? fmtTs(fault.at) : "")
        );
        wrap.append(box);
      }
      if (d.crash) {
        const box = el("div", "runs-callout runs-callout--fail");
        const pre = el("pre", "runs-pre");
        pre.textContent = JSON.stringify(d.crash, null, 2);
        box.append(el("strong", void 0, "Crash"), pre);
        wrap.append(box);
      }
      const pathRow = el("div", "runs-path-row");
      pathRow.append(el("span", "runs-path-row__label", "Dossier"), el("code", "runs-path-row__path", d.dir));
      wrap.append(pathRow);
      return wrap;
    }
    function renderTimeline(d) {
      const wrap = el("div", "runs-section");
      if (d.timeline.length === 0) {
        wrap.append(el("p", "runs-hint", "No timeline entries \u2014 browse sessions or runs without blueprint actions."));
        return wrap;
      }
      const totalMs = d.timeline.reduce((sum, t) => {
        const ms = durationMs(t.startedAt, t.endedAt);
        return sum + (ms ?? 0);
      }, 0);
      const maxMs = Math.max(
        1,
        ...d.timeline.map((t) => durationMs(t.startedAt, t.endedAt) ?? 0)
      );
      const chart = el("div", "runs-timeline-chart");
      chart.setAttribute("aria-label", "Action duration chart");
      for (const t of d.timeline) {
        const ms = durationMs(t.startedAt, t.endedAt) ?? 0;
        const bar = el("div", `runs-timeline-bar runs-timeline-bar--${t.status}`);
        bar.style.width = `${Math.max(4, ms / maxMs * 100)}%`;
        bar.title = `${t.actionId} \xB7 ${t.queue} \xB7 ${fmtMs(ms)}`;
        chart.append(bar);
      }
      wrap.append(
        el("div", "runs-timeline-chart-label", `Action wall total \xB7 ${fmtMs(totalMs)}`),
        chart
      );
      const list = el("div", "runs-timeline-list");
      for (const t of d.timeline) {
        const ms = durationMs(t.startedAt, t.endedAt);
        const row = el("article", `runs-tl-row runs-tl-row--${t.status}`);
        const head = el("div", "runs-tl-row__head");
        head.append(
          el("span", "runs-tl-row__status", t.status),
          el("span", "runs-tl-row__id", t.actionId),
          el("span", "runs-tl-row__queue", t.queue),
          el("span", "runs-tl-row__dur", ms != null ? fmtMs(ms) : "\u2014")
        );
        row.append(head);
        const sub = el("div", "runs-tl-row__sub");
        sub.textContent = `${fmtTs(t.startedAt)} \u2192 ${fmtTs(t.endedAt)}`;
        row.append(sub);
        if (t.detail) {
          row.append(el("div", "runs-tl-row__detail", t.detail));
        }
        list.append(row);
      }
      wrap.append(list);
      return wrap;
    }
    function renderVerdicts(d) {
      const wrap = el("div", "runs-section");
      if (d.verdicts.length === 0) {
        wrap.append(el("p", "runs-hint", "No verdicts recorded."));
        return wrap;
      }
      const groups = { pass: [], fail: [], skipped: [] };
      for (const v of d.verdicts) groups[v.status].push(v);
      for (const [status, items] of Object.entries(groups)) {
        if (items.length === 0) continue;
        const section = el("section", `runs-verdict-group runs-verdict-group--${status}`);
        section.append(el("h3", "runs-verdict-group__title", `${status} (${items.length})`));
        for (const v of items) {
          const card = el("article", `runs-verdict-card runs-verdict-card--${verdictTone(v.status)}`);
          card.append(el("div", "runs-verdict-card__id", v.id), el("div", "runs-verdict-card__reason", v.reason || "\u2014"));
          section.append(card);
        }
        wrap.append(section);
      }
      return wrap;
    }
    function renderActs(d) {
      const wrap = el("div", "runs-section");
      if (d.acts.length === 0) {
        wrap.append(el("p", "runs-hint", "No journal acts."));
        return wrap;
      }
      const table = el("div", "runs-acts-table");
      const head = el("div", "runs-acts-table__head");
      head.append(el("span", void 0, "Act"), el("span", void 0, "Result"), el("span", void 0, "Error"));
      table.append(head);
      for (const a of d.acts) {
        const row = el("div", `runs-acts-table__row${a.ok ? " runs-acts-table__row--ok" : " runs-acts-table__row--fail"}`);
        row.append(
          el("code", "runs-acts-table__name", a.name),
          el("span", "runs-acts-table__ok", a.ok ? "ok" : "fail"),
          el("span", "runs-acts-table__err", a.error ?? "\u2014")
        );
        table.append(row);
      }
      wrap.append(table);
      return wrap;
    }
    function renderArtifacts(d) {
      const wrap = el("div", "runs-section");
      const arts = [...d.manifest?.artifacts ?? []].sort((a, b) => a.path.localeCompare(b.path));
      if (arts.length === 0) {
        wrap.append(el("p", "runs-hint", "Manifest empty or not finalized."));
        return wrap;
      }
      const byKind = /* @__PURE__ */ new Map();
      for (const a of arts) {
        const k = a.kind || "other";
        if (!byKind.has(k)) byKind.set(k, []);
        byKind.get(k).push(a);
      }
      for (const [kind, items] of [...byKind.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        const group = el("section", "runs-artifact-group");
        group.append(el("h3", "runs-artifact-group__title", `${kind} (${items.length})`));
        const list = el("div", "runs-artifact-list");
        for (const a of items) {
          const row = el("div", "runs-artifact-row");
          const link = el("a", "runs-artifact-row__link");
          link.href = `/lab/runs/${encodeURIComponent(d.id)}/files/${encodeURIComponent(a.path)}`;
          link.target = "_blank";
          link.rel = "noopener";
          link.textContent = a.path;
          row.append(link, el("span", "runs-artifact-row__bytes", fmtBytes(a.bytes)));
          list.append(row);
        }
        group.append(list);
        wrap.append(group);
      }
      return wrap;
    }
    function renderProbes(d) {
      const wrap = el("div", "runs-section runs-probes");
      const blocks = [
        ["metrics.json", d.probes.metrics],
        ["input-pipeline.json", d.probes.inputPipeline],
        ["iso.json", d.probes.iso],
        ["iso-browse.json", d.probes.isoBrowse],
        ["telemetry/counts.json", d.telemetryCounts]
      ];
      for (const [label, data] of blocks) {
        const block = el("details", "runs-probe-block");
        block.open = label === "input-pipeline.json" && data != null;
        const sum = el("summary", void 0, label);
        block.append(sum);
        if (!data) {
          block.append(el("p", "runs-hint", "Not present in dossier."));
        } else {
          const pre = el("pre", "runs-pre runs-pre--scroll");
          pre.textContent = JSON.stringify(data, null, 2);
          block.append(pre);
        }
        wrap.append(block);
      }
      return wrap;
    }
    function renderCopyBar(label, text) {
      const bar = el("div", "runs-copy-bar");
      bar.append(el("span", "runs-copy-bar__label", label));
      const btn = el("button", "runs-copy-bar__btn", "Copy");
      btn.type = "button";
      btn.addEventListener("click", () => {
        void copyText(text).then((ok) => {
          opts.onActivity?.(ok ? `copied ${label}` : `copy failed ${label}`);
          if (ok) {
            btn.textContent = "Copied";
            window.setTimeout(() => {
              btn.textContent = "Copy";
            }, 1200);
          }
        });
      });
      bar.append(btn);
      return bar;
    }
    function renderRaw(d) {
      const wrap = el("div", "runs-section");
      const raw = JSON.stringify(d, null, 2);
      wrap.append(renderCopyBar("JSON", raw));
      const pre = el("pre", "runs-pre runs-pre--detail");
      pre.textContent = raw;
      wrap.append(pre);
      return wrap;
    }
    function renderDetailBody(d) {
      switch (detailSection) {
        case "overview":
          return renderOverview(d);
        case "timeline":
          return renderTimeline(d);
        case "verdicts":
          return renderVerdicts(d);
        case "acts":
          return renderActs(d);
        case "artifacts":
          return renderArtifacts(d);
        case "probes":
          return renderProbes(d);
        case "raw":
          return renderRaw(d);
        default:
          return renderOverview(d);
      }
    }
    function renderDetailActions(d, summary) {
      const actions = el("div", "runs-detail-actions");
      const delBtn = el("button", "runs-detail-actions__btn runs-detail-actions__btn--danger", "Delete");
      delBtn.type = "button";
      delBtn.addEventListener("click", () => {
        void deleteRuns([d.id], d.id);
      });
      const copyId = el("button", "runs-detail-actions__btn", "Copy id");
      copyId.type = "button";
      copyId.addEventListener("click", () => {
        void copyText(d.id).then((ok) => opts.onActivity?.(ok ? "copied run id" : "copy failed"));
      });
      const copyPath = el("button", "runs-detail-actions__btn", "Copy path");
      copyPath.type = "button";
      copyPath.addEventListener("click", () => {
        void copyText(d.dir).then((ok) => opts.onActivity?.(ok ? "copied dossier path" : "copy failed"));
      });
      actions.append(delBtn, copyId, copyPath);
      if (summary?.url) {
        const copyUrl = el("button", "runs-detail-actions__btn", "Copy URL");
        copyUrl.type = "button";
        copyUrl.addEventListener("click", () => {
          void copyText(summary.url).then((ok) => opts.onActivity?.(ok ? "copied url" : "copy failed"));
        });
        actions.append(copyUrl);
      }
      return actions;
    }
    function renderDetail() {
      detailHeaderEl.replaceChildren();
      detailBodyEl.replaceChildren();
      if (!detail) {
        detailBodyEl.append(
          el("div", "runs-list-empty", "Select a run to inspect timeline, verdicts, and artifacts.")
        );
        return;
      }
      const summary = runs.find((r) => r.id === detail.id);
      const top = el("div", "runs-detail-top");
      if (summary) {
        const strip = el("div", "runs-detail-strip");
        const tone = runCardTone(summary);
        strip.append(
          el("span", `runs-hero__badge runs-hero__badge--${tone === "fail" ? "fail" : tone === "pass" ? "pass" : "neutral"}`, tone === "fail" ? "FAIL" : tone === "pass" ? "PASS" : "RUN"),
          el("span", `runs-chip runs-chip--mode`, summary.mode),
          el("span", "runs-chip runs-chip--muted", fmtTs(summary.createdAt)),
          summary.blueprintId ? el("span", "runs-chip runs-chip--accent", summary.blueprintId) : document.createDocumentFragment()
        );
        top.append(strip);
        if (summary.url) {
          const urlRow = el("div", "runs-detail-url", truncateUrl(summary.url, 72));
          urlRow.title = summary.url;
          top.append(urlRow);
        }
      }
      top.append(renderDetailActions(detail, summary));
      detailHeaderEl.append(top, renderDetailNav());
      detailBodyEl.append(renderDetailBody(detail));
    }
    async function selectRun(id) {
      selectedId = id;
      renderList();
      setLoading(true);
      try {
        const res = await opts.fetch(`/lab/runs/${encodeURIComponent(id)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        detail = await res.json();
        detailSection = detail.verdicts.some((v) => v.status === "fail") ? "verdicts" : "overview";
        renderDetail();
      } catch (err) {
        detail = null;
        renderDetail();
        opts.onActivity?.(`runs.load failed ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setLoading(false);
      }
    }
    async function refresh() {
      setLoading(true);
      try {
        const res = await opts.fetch("/lab/runs");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json();
        runs = body.runs ?? [];
        renderList();
        if (selectedId && runs.some((r) => r.id === selectedId)) {
          await selectRun(selectedId);
        } else if (selectedId) {
          selectedId = null;
          detail = null;
          renderDetail();
        }
        opts.onActivity?.(`runs refreshed (${runs.length})`);
      } catch (err) {
        opts.onActivity?.(`runs.refresh failed ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setLoading(false);
      }
    }
    async function selectByDossierDir(dossierDir) {
      const id = extractRunIdFromDossierPath(dossierDir);
      if (!id) return;
      if (runs.length === 0) await refresh();
      await selectRun(id);
    }
    function mount() {
      document.getElementById("runsRefresh")?.addEventListener("click", () => {
        void refresh();
      });
      searchInput?.addEventListener("input", () => {
        search = searchInput.value;
        renderList();
      });
      filterBar.querySelectorAll("[data-runs-filter]").forEach((btn) => {
        btn.addEventListener("click", () => {
          filter = btn.dataset.runsFilter ?? "all";
          renderFilters();
          renderList();
        });
      });
      selectAllInput?.addEventListener("change", () => {
        const visible = filteredRuns();
        if (selectAllInput.checked) {
          for (const r of visible) selectedIds.add(r.id);
        } else {
          for (const r of visible) selectedIds.delete(r.id);
        }
        renderList();
      });
      deleteSelectedBtn?.addEventListener("click", () => {
        void deleteRuns([...selectedIds], "selected");
      });
      renderFilters();
      renderDetail();
      void refresh();
    }
    return { refresh, selectByDossierDir, mount };
  }

  // browser/mirror/projection/lab/client/labShell.ts
  var SHEET_SNAP_KEY = "speculum.lab.sheetSnap";
  var SHEET_H_KEY = "speculum.lab.sheetH";
  function readPersistedSnap() {
    try {
      const v = localStorage.getItem(SHEET_SNAP_KEY);
      if (v === "collapsed" || v === "peek" || v === "expanded") return v;
    } catch {
    }
    return null;
  }
  function snapHeight(snap, viewportH) {
    const minBar = 96;
    const max = Math.floor(viewportH * 0.92);
    if (snap === "collapsed") return minBar;
    if (snap === "peek") return Math.min(max, Math.max(minBar + 80, Math.floor(viewportH * 0.42)));
    return Math.min(max, Math.max(minBar + 120, Math.floor(viewportH * 0.78)));
  }
  function initLabShell(opts) {
    let snap = readPersistedSnap() ?? "peek";
    let dragging = false;
    let dragStartY = 0;
    let dragStartH = 0;
    function clampHeight(px) {
      const vh = window.innerHeight;
      const min = 96;
      const max = Math.floor(vh * 0.92);
      return Math.min(max, Math.max(min, Math.round(px)));
    }
    function applyHeight(px) {
      const h = clampHeight(px);
      opts.main.style.setProperty("--sheet-h", `${h}px`);
      opts.sheet.dataset.snap = snap;
    }
    function persistSnap() {
      try {
        localStorage.setItem(SHEET_SNAP_KEY, snap);
        const h = opts.sheet.getBoundingClientRect().height;
        if (Number.isFinite(h)) localStorage.setItem(SHEET_H_KEY, String(Math.round(h)));
      } catch {
      }
    }
    function nearestSnap(h, vh) {
      const collapsed = snapHeight("collapsed", vh);
      const peek = snapHeight("peek", vh);
      const expanded = snapHeight("expanded", vh);
      const dist = (target) => Math.abs(h - target);
      const dC = dist(collapsed);
      const dP = dist(peek);
      const dE = dist(expanded);
      if (dC <= dP && dC <= dE) return "collapsed";
      if (dP <= dE) return "peek";
      return "expanded";
    }
    function setSnap(next, persist = true) {
      snap = next;
      applyHeight(snapHeight(snap, window.innerHeight));
      opts.onSnapChange?.(snap);
      if (persist) persistSnap();
    }
    function setHudCollapsed(collapsed) {
      opts.hud.dataset.collapsed = collapsed ? "true" : "false";
      opts.hudToggle.textContent = collapsed ? "\u25B8" : "\u25BE";
      opts.hudToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    }
    opts.hudToggle.addEventListener("click", () => {
      const collapsed = opts.hud.dataset.collapsed === "true";
      setHudCollapsed(!collapsed);
    });
    opts.hudMore?.addEventListener("click", () => {
      const open = opts.hud.dataset.more === "true";
      opts.hud.dataset.more = open ? "false" : "true";
      opts.hudMore?.setAttribute("aria-expanded", open ? "false" : "true");
      if (!open) setHudCollapsed(false);
    });
    opts.hud.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    const onPointerMove = (ev) => {
      if (!dragging) return;
      const dy = dragStartY - ev.clientY;
      applyHeight(dragStartH + dy);
    };
    const onPointerUp = () => {
      if (!dragging) return;
      dragging = false;
      opts.grabber.classList.remove("is-dragging");
      const h = opts.sheet.getBoundingClientRect().height;
      snap = nearestSnap(h, window.innerHeight);
      applyHeight(snapHeight(snap, window.innerHeight));
      opts.onSnapChange?.(snap);
      persistSnap();
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
    opts.grabber.addEventListener("pointerdown", (ev) => {
      dragging = true;
      dragStartY = ev.clientY;
      dragStartH = opts.sheet.getBoundingClientRect().height;
      opts.grabber.classList.add("is-dragging");
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      ev.preventDefault();
    });
    let lastGrabTap = 0;
    opts.grabber.addEventListener("click", () => {
      const now2 = Date.now();
      if (now2 - lastGrabTap < 320) {
        setSnap(snap === "collapsed" ? "peek" : snap === "peek" ? "expanded" : "collapsed");
      }
      lastGrabTap = now2;
    });
    window.addEventListener("resize", () => {
      applyHeight(snapHeight(snap, window.innerHeight));
    });
    setHudCollapsed(false);
    setSnap(snap, false);
    return {
      setSnap,
      getSnap: () => snap,
      expandForTab: (tab) => {
        if (tab === "Runs" || tab === "Progress") setSnap("expanded");
        else if (snap === "collapsed") setSnap("peek");
      },
      collapse: () => setSnap("collapsed")
    };
  }

  // browser/mirror/projection/lab/client/scrollDiagHost.ts
  function walkFrames(win, out) {
    out.push(win);
    let frames;
    try {
      frames = win.document.getElementsByTagName("iframe");
    } catch {
      return;
    }
    for (let i = 0; i < frames.length; i++) {
      try {
        const child = frames[i]?.contentWindow;
        if (child) walkFrames(child, out);
      } catch {
      }
    }
  }
  function collectDiagFrames() {
    const frames = [];
    walkFrames(window, frames);
    const found = [];
    for (const w of frames) {
      try {
        const dw = w;
        const log = dw.__SCROLL_DIAG_LOG;
        if (!Array.isArray(log)) continue;
        found.push({
          href: (() => {
            try {
              return w.location.href;
            } catch {
              return "(frame)";
            }
          })(),
          log: [...log],
          clear: typeof dw.__SCROLL_DIAG_CLEAR === "function" ? () => dw.__SCROLL_DIAG_CLEAR() : void 0
        });
      } catch {
      }
    }
    return found;
  }
  var sentCounts = /* @__PURE__ */ new WeakMap();
  var diagSessionId = null;
  var flushTimer = null;
  function collectUnsent() {
    const frames = [];
    walkFrames(window, frames);
    const entries = [];
    const commits = [];
    for (const w of frames) {
      try {
        const log = w.__SCROLL_DIAG_LOG;
        if (!Array.isArray(log)) continue;
        const sent = sentCounts.get(w) ?? 0;
        if (log.length <= sent) continue;
        entries.push(...log.slice(sent));
        const total = log.length;
        commits.push(() => sentCounts.set(w, total));
      } catch {
      }
    }
    return { entries, commit: () => commits.forEach((c) => c()) };
  }
  async function flushDiag() {
    const { entries, commit } = collectUnsent();
    if (entries.length === 0) return { ok: true, sent: 0 };
    try {
      const res = await fetch("/lab/diag/gesture", {
        method: "POST",
        headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "true" },
        body: JSON.stringify({ sessionId: diagSessionId, entries })
      });
      if (!res.ok) return { ok: false, sent: 0, error: `http ${res.status}` };
      commit();
      return { ok: true, sent: entries.length };
    } catch (err) {
      return { ok: false, sent: 0, error: err instanceof Error ? err.message : String(err) };
    }
  }
  function setScrollDiagSessionId(id) {
    diagSessionId = id;
  }
  function installScrollDiagHostApis() {
    const api = window;
    api.diagFlush = () => flushDiag();
    api.diagLabel = (label) => {
      const frames = [];
      walkFrames(window, frames);
      for (const w of frames) {
        try {
          w.__SCROLL_DIAG_LABEL = label;
        } catch {
        }
      }
    };
    if (flushTimer === null) {
      flushTimer = window.setInterval(() => {
        const queryLabel = new URLSearchParams(location.search).get("diagLabel");
        if (queryLabel) api.diagLabel?.(queryLabel);
        void flushDiag();
      }, 2e3);
      window.addEventListener("pagehide", () => {
        void flushDiag();
      });
    }
    api.diagDump = () => {
      const frames = collectDiagFrames();
      const payload = frames.length === 0 ? { ok: false, message: "no __SCROLL_DIAG_LOG in any frame yet \u2014 Connect + Start Virtual first", frames: [] } : {
        ok: true,
        dumpedAt: (/* @__PURE__ */ new Date()).toISOString(),
        frameCount: frames.length,
        frames: frames.map((f) => ({ href: f.href, entries: f.log })),
        flat: frames.flatMap((f) => f.log)
      };
      const text = JSON.stringify(payload, null, 2);
      console.log("[diagDump]", payload);
      console.log(text);
      void navigator.clipboard.writeText(text).then(
        () => console.log("[diagDump] copied to clipboard"),
        (err) => console.warn("[diagDump] clipboard failed", err)
      );
      return payload;
    };
    api.diagClear = () => {
      const frames = [];
      walkFrames(window, frames);
      for (const w of frames) {
        try {
          w.__SCROLL_DIAG_CLEAR?.();
          sentCounts.set(w, 0);
        } catch {
        }
      }
      console.log(`[diagClear] cleared ${frames.length} frame(s)`);
    };
  }

  // browser/mirror/projection/lab/client/geckoLabWire.ts
  var import_core = __toESM(require_core());
  var import_frame2 = __toESM(require_frame());
  function classifyFetchDestination(destination) {
    switch (destination) {
      case "image":
        return 1;
      case "font":
        return 2;
      case "audio":
        return 3;
      case "video":
        return 4;
      case "document":
      case "frame":
      case "iframe":
      case "embed":
      case "object":
        return 10;
      case "script":
        return 11;
      case "style":
        return 12;
      case "websocket":
        return 15;
      case "":
        return 5;
      default:
        return 0;
    }
  }
  var gecko = false;
  var corr = 1;
  var pendingAssets = /* @__PURE__ */ new Map();
  var nextStream = 1;
  var swReg = null;
  function setGeckoLab(on) {
    gecko = on;
  }
  function isGeckoLab() {
    return gecko;
  }
  function nextGeckoCorr() {
    corr += 1;
    return corr;
  }
  function sendGeckoControl(ws, bytes) {
    ws.send(JSON.stringify({ type: "client.control", bytes: (0, import_core.bytesToBase64)(bytes) }));
  }
  function sendGeckoViewport(ws, width, height) {
    sendGeckoControl(ws, (0, import_core.encodeViewportSet)(nextGeckoCorr(), 0, width, height));
  }
  function answerGeckoRequest(ws, kind, contextId, requestId, yes, text) {
    const c = nextGeckoCorr();
    if (kind === "dialog") {
      sendGeckoControl(ws, (0, import_core.encodeDialogRespond)(c, contextId, requestId, yes ? text || "ok" : ""));
      return;
    }
    if (kind === "permission") {
      sendGeckoControl(ws, (0, import_core.encodePermissionRespond)(c, contextId, requestId, yes));
      return;
    }
    sendGeckoControl(ws, (0, import_core.encodeDownloadRespond)(c, contextId, requestId, yes));
  }
  function showGeckoPrompt(_kind, description) {
    const yes = window.confirm(description);
    return { yes, text: yes ? "ok" : "" };
  }
  async function ensureGeckoAssetSw(token) {
    if (!("serviceWorker" in navigator)) {
      throw new Error("service worker indispon\xEDvel");
    }
    swReg = await navigator.serviceWorker.register("/lab/asset-sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) => {
        const done = () => resolve();
        navigator.serviceWorker.addEventListener("controllerchange", done, { once: true });
        if (navigator.serviceWorker.controller) {
          navigator.serviceWorker.removeEventListener("controllerchange", done);
          resolve();
        }
      });
    }
    const sw = navigator.serviceWorker.controller ?? swReg.active;
    sw?.postMessage({ type: "token", token });
    sw?.postMessage({ type: "ctx", contextId: import_frame2.CONTEXT_ID_ROOT });
    if (globalThis.__SPECULUM_ASSET_TRACE) {
      sw?.postMessage({ type: "asset-trace-enable", enable: true });
    }
  }
  function enableGeckoAssetTraceAll() {
    enableAssetTraceAll();
    const sw = navigator.serviceWorker.controller ?? swReg?.active;
    sw?.postMessage({ type: "asset-trace-enable", enable: true });
  }
  function registerGeckoAssetContext(contextId, win = window) {
    if (!("serviceWorker" in win.navigator)) {
      return;
    }
    void win.navigator.serviceWorker.ready.then((reg) => {
      (reg.active ?? win.navigator.serviceWorker.controller)?.postMessage({ type: "ctx", contextId });
    });
  }
  function sendGeckoAssetFetch(ws, ctx, url, dest, range, fetchId) {
    const streamId = nextStream++;
    const destCode = classifyFetchDestination(dest);
    const payload = (0, import_core.encodeAssetRequest)(streamId, destCode, url, range, 0);
    if (urlWorthTracing(url)) {
      pushAssetTrace({
        hop: "lab.request",
        streamId,
        fetchId,
        contextId: ctx,
        url: url.slice(0, 300),
        range,
        dest,
        destCode,
        payloadLen: payload.byteLength
      });
    }
    return new Promise((resolve, reject) => {
      pendingAssets.set(streamId, {
        chunks: [],
        resolve,
        reject,
        url,
        contextId: ctx,
        range,
        dest,
        fetchId
      });
      ws.send(JSON.stringify({ type: "client.asset", contextId: ctx, bytes: (0, import_core.bytesToBase64)(payload) }));
    });
  }
  function onGeckoAssetMessage(streamId, phase, data, why) {
    const pending = pendingAssets.get(streamId);
    if (!pending) {
      return;
    }
    if (phase === 2) {
      pendingAssets.delete(streamId);
      if (urlWorthTracing(pending.url)) {
        pushAssetTrace({
          hop: "lab.response",
          streamId,
          fetchId: pending.fetchId,
          contextId: pending.contextId,
          url: pending.url.slice(0, 300),
          range: pending.range,
          dest: pending.dest,
          phase: "denied",
          why: why || "denied",
          chunkTotal: 0,
          bodySha16: bodyFnv16(null)
        });
      }
      console.warn("[gecko-asset] denied", streamId, why || "denied");
      pending.reject(new Error(why || "denied"));
      return;
    }
    if (phase === 1 && data.length) {
      pending.chunks.push(data);
    }
    if (phase === 3) {
      pendingAssets.delete(streamId);
      const total = pending.chunks.reduce((n, c) => n + c.length, 0);
      const body = new Uint8Array(total);
      let o = 0;
      for (const c of pending.chunks) {
        body.set(c, o);
        o += c.length;
      }
      const mimeIn = data.length ? new TextDecoder().decode(data) : "";
      let mime = mimeIn;
      const genericMime = !mime || mime === "application/octet-stream" || mime === "binary/octet-stream" || mime === "text/plain" || mime === "application/force-download" || mime === "text/html" || !mime.toLowerCase().split(";")[0].trim().startsWith("image/");
      if (genericMime && body.length) {
        const head = new TextDecoder().decode(body.slice(0, Math.min(256, body.length))).toLowerCase();
        if (head.includes("<svg") || head.includes("<!doctype svg")) {
          mime = "image/svg+xml";
        } else if (body[0] === 255 && body[1] === 216) {
          mime = "image/jpeg";
        } else if (body[0] === 137 && body[1] === 80) {
          mime = "image/png";
        } else if (body[0] === 71 && body[1] === 73 && body[2] === 70) {
          mime = "image/gif";
        } else if (body.length >= 12 && body[0] === 82 && body[8] === 87 && body[9] === 69 && body[10] === 66 && body[11] === 80) {
          mime = "image/webp";
        }
      }
      if (urlWorthTracing(pending.url)) {
        pushAssetTrace({
          hop: "lab.response",
          streamId,
          fetchId: pending.fetchId,
          contextId: pending.contextId,
          url: pending.url.slice(0, 300),
          range: pending.range,
          dest: pending.dest,
          phase: "complete",
          chunkTotal: total,
          mimeIn,
          mimeOut: mime,
          genericMime,
          bodySha16: bodyFnv16(body),
          bodyHead: bodyHeadAscii(body)
        });
      }
      const headers = new Headers();
      if (mime) {
        headers.set("Content-Type", mime);
      }
      pending.resolve(new Response(body, { headers }));
    }
  }
  function wireGeckoSwFetch(ws, ctx) {
    navigator.serviceWorker.addEventListener("message", (ev) => {
      const msg = ev.data;
      if (msg?.type === "asset-trace" && msg.event && typeof msg.event === "object") {
        pushAssetTrace(msg.event);
        return;
      }
      if (msg?.type !== "asset-fetch" || typeof msg.url !== "string" || typeof msg.id !== "number") {
        return;
      }
      const fetchCtx = typeof msg.contextId === "number" && Number.isInteger(msg.contextId) && msg.contextId >= 1 ? msg.contextId : ctx;
      void sendGeckoAssetFetch(ws, fetchCtx, msg.url, msg.dest ?? "", msg.range ?? "", msg.id).then(
        async (res) => {
          const buf = new Uint8Array(await res.arrayBuffer());
          const contentType = res.headers.get("Content-Type") || "";
          ev.source?.postMessage(
            { type: "asset", id: msg.id, ok: true, bytes: buf.buffer, contentType },
            { transfer: [buf.buffer] }
          );
        },
        (err) => {
          ev.source?.postMessage({ type: "asset", id: msg.id, ok: false, error: err.message });
        }
      );
    });
  }

  // browser/mirror/projection/lab/client/main.ts
  function labFetch(input, init) {
    const headers = new Headers(init?.headers);
    for (const [key, value] of Object.entries(NGROK_SKIP_HEADERS)) {
      headers.set(key, value);
    }
    return fetch(input, { ...init, headers });
  }
  function emptyContextStats() {
    return {
      wireFrames: 0,
      emitted: 0,
      applyOk: 0,
      applyFail: 0,
      desync: 0,
      resync: 0,
      overrun: 0,
      lastApplyMs: null,
      lastBuildMs: null,
      lastEncodeMs: null,
      lastSequence: null,
      generation: null
    };
  }
  function $(id) {
    const el2 = document.getElementById(id);
    if (!el2) throw new Error(`#${id} missing`);
    return el2;
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
      const el2 = styleEls[i];
      const sheet = el2.sheet;
      if (sheet) authorTexts.add(sheetText(sheet));
      else if (el2.textContent) authorTexts.add(el2.textContent);
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
  function logConsole(level, text) {
    const row = document.createElement("div");
    const lvl = level >= 3 ? "lvl-3" : level === 2 ? "lvl-2" : "lvl-1";
    row.className = lvl;
    const tag = level >= 3 ? "error" : level === 2 ? "warn" : "log";
    row.textContent = `${(/* @__PURE__ */ new Date()).toISOString().slice(11, 19)} [${tag}] ${text}`;
    const box = $("consoleLog");
    box.prepend(row);
    while (box.childElementCount > 400) box.lastChild?.remove();
  }
  function formatIntentShort(intent) {
    const rec = intent;
    const kind = typeof rec.type === "string" ? rec.type : typeof rec.kind === "string" ? rec.kind : typeof rec.op === "string" ? rec.op : "intent";
    const id = rec.targetId ?? rec.nodeId ?? rec.id;
    if (kind === "historyNav" && typeof rec.direction === "string") return `${kind}:${rec.direction}`;
    return id != null ? `${kind}#${id}` : kind;
  }
  function readTelemetryFromUi() {
    const cfg = { ...import_telemetry.LAB_TELEMETRY_DEFAULTS };
    for (const key of import_telemetry.TELEMETRY_BOOL_CAPS) {
      const el2 = document.getElementById(`tel_${key}`);
      if (el2) cfg[key] = el2.checked;
    }
    const agg = document.getElementById("tel_aggregateIntervalMs");
    if (agg) cfg.aggregateIntervalMs = Number(agg.value) || 2e3;
    return cfg;
  }
  function setChip(id, text, kind) {
    const el2 = $(id);
    el2.textContent = text;
    el2.className = kind ? `chip ${kind}` : "chip";
    el2.title = text;
    el2.hidden = false;
  }
  function bootLabClient() {
    installScrollDiagHostApis();
    const buildLabel = `build #${labBuildStamp_default.seq}`;
    setChip("chipBuild", buildLabel, "live");
    $("chipBuild").title = `${buildLabel}${labBuildStamp_default.builtAt ? ` \xB7 ${labBuildStamp_default.builtAt}` : ""}`;
    let ws = null;
    let projection = null;
    let disposeImgTrace = null;
    const inputDetachers = /* @__PURE__ */ new Map();
    let inputCaptureMetrics = new import_projected2.ProjectedInputCaptureMetrics();
    let sessionToken = "";
    let assetBaseUrl = window.location.origin;
    let documentBaseUrl = "";
    let canonicalViewport = { width: 1280, height: 720 };
    let viewportSync = null;
    let pendingResize = null;
    let bootDeviceProfile = (0, import_projected3.detectViewportDeviceProfile)();
    const runsPanel = createRunsPanel({
      fetch: labFetch,
      onActivity: logActivity
    });
    runsPanel.mount();
    window.__labDiagProjectedPeek = () => projection ? projection.peekNestedHosts() : null;
    window.__labDiagForceLoadAfterDrop = (contextId = 99) => projection ? projection.forceLoadAfterDropRaceForDiag(contextId) : null;
    window.__speculumLabDumpInputClick = () => {
    };
    void Promise.resolve().then(() => (init_diagDomApply(), diagDomApply_exports)).then(({ diagDomApplyFrameUrls: diagDomApplyFrameUrls2 }) => {
      window.__labDiagDomApplyBins = (urls) => diagDomApplyFrameUrls2(urls ?? ["/lab/diag-f1.bin", "/lab/diag-f3.bin"]);
    });
    window.__speculumEnableAssetTraceAll = () => {
      enableGeckoAssetTraceAll();
    };
    function disposeViewportSync() {
      viewportSync?.dispose();
      viewportSync = null;
      if (pendingResize) {
        pendingResize.resolve({ applied: false, message: "sync disposed", errorCode: "disposed" });
        pendingResize = null;
      }
    }
    function requestRemoteResize(size, device) {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        return Promise.resolve({
          applied: false,
          message: "ws not open",
          errorCode: "ws_closed"
        });
      }
      return new Promise((resolve) => {
        if (pendingResize) {
          pendingResize.resolve({ applied: false, message: "superseded", errorCode: "superseded" });
        }
        pendingResize = { resolve };
        if (isGeckoLab()) {
          sendGeckoViewport(ws, size.width, size.height);
        } else {
          ws.send(
            JSON.stringify({
              type: "client.resize",
              width: size.width,
              height: size.height,
              device
            })
          );
        }
      });
    }
    function startViewportSync() {
      disposeViewportSync();
      projection?.client.setCssSize(canonicalViewport.width, canonicalViewport.height);
      const sync = new import_projected3.ViewportSync({
        measure: () => (0, import_projected3.measureHostElement)(surfaceHost),
        resize: requestRemoteResize,
        viewportPolicy: import_projected3.LAB_VIEWPORT_POLICY,
        onApplied: (size) => {
          canonicalViewport = size;
          projection?.client.setCssSize(size.width, size.height);
          logActivity(`viewport ${size.width}\xD7${size.height}`);
        },
        onRejected: (detail) => {
          logActivity(`viewport resize rejected: ${detail}`);
        }
      });
      sync.seedRemote(canonicalViewport.width, canonicalViewport.height, bootDeviceProfile);
      sync.observe(surfaceHost);
      viewportSync = sync;
    }
    function measureAndNormalizeViewport() {
      const measured = (0, import_projected3.measureHostElement)(surfaceHost);
      return (0, import_projected3.normalizeSessionViewport)(measured.width, measured.height, import_projected3.LAB_VIEWPORT_POLICY);
    }
    function sendInputIntent(intent) {
      if (surfaceWrap.classList.contains("is-crashed")) return;
      if (ws?.readyState !== WebSocket.OPEN) return;
      if (isGeckoLab()) {
        const bytes = (0, import_core2.encodeControlFromIntent)(
          nextGeckoCorr(),
          intent.contextId ?? import_frame4.CONTEXT_ID_ROOT,
          intent
        );
        if (bytes) {
          sendGeckoControl(ws, bytes);
        }
        logActivity(`intent ${formatIntentShort(intent)}`);
        return;
      }
      const payload = { schemaVersion: intent.schemaVersion, type: intent.type };
      if (intent.type === "move" || intent.type === "down" || intent.type === "up") {
        payload.x = intent.x;
        payload.y = intent.y;
        payload.viewportW = intent.viewportW;
        payload.viewportH = intent.viewportH;
        payload.button = intent.button;
        if (intent.type !== "move") {
          if (intent.contextId != null) payload.contextId = intent.contextId;
          if (intent.nodeId !== void 0) payload.nodeId = intent.nodeId;
          if (intent.localX != null) payload.localX = intent.localX;
          if (intent.localY != null) payload.localY = intent.localY;
        }
        payload.payload = JSON.stringify({
          x: intent.x,
          y: intent.y,
          button: intent.button,
          ...intent.type !== "move" && intent.localX != null && intent.localY != null ? { localX: intent.localX, localY: intent.localY } : {}
        });
      } else if (intent.type === "keyDown" || intent.type === "keyUp") {
        payload.key = intent.key;
        payload.code = intent.code;
        payload.payload = JSON.stringify({ key: intent.key, code: intent.code, modifiers: intent.modifiers });
      } else if (intent.type === "scrollSet") {
        payload.contextId = intent.contextId;
        payload.nodeId = intent.nodeId;
        payload.scrollFracX = intent.scrollFracX;
        payload.scrollFracY = intent.scrollFracY;
        payload.payload = JSON.stringify({
          scrollFracX: intent.scrollFracX,
          scrollFracY: intent.scrollFracY
        });
      } else if (intent.type === "historyNav") {
        payload.direction = intent.direction;
        payload.payload = JSON.stringify({ direction: intent.direction });
      }
      payload.timestampClient = intent.timestampClient;
      ws.send(JSON.stringify({ type: "client.intent", intent: payload }));
      logActivity(`intent ${formatIntentShort(intent)}`);
    }
    function sendInputClickDiag() {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        logActivity("input.diag skipped (no ws)");
        return;
      }
      ws.send(
        JSON.stringify({
          type: "browse.inputDiag",
          inputCapture: inputCaptureMetrics.snapshot()
        })
      );
      logActivity("input.diag requested\u2026");
    }
    function sendWidgetParityDiag() {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        logActivity("widget.diag skipped (no ws)");
        return;
      }
      if (!projection) {
        logActivity("widget.diag skipped (no projection)");
        return;
      }
      if (widgetParityInFlight) return;
      widgetParityInFlight = true;
      syncButtons();
      const projectedHosts = projection.probeWidgetHostBindings();
      ws.send(JSON.stringify({ type: "browse.widgetParity", projectedHosts }));
      logActivity("widget.diag requested\u2026");
    }
    window.__speculumLabDumpInputClick = sendInputClickDiag;
    window.__speculumLabWidgetParity = sendWidgetParityDiag;
    document.addEventListener("speculum-input-diag", () => sendInputClickDiag());
    document.addEventListener("speculum-widget-parity", () => sendWidgetParityDiag());
    function bindInputSurfaces(client) {
      for (const detach of inputDetachers.values()) detach();
      inputDetachers.clear();
      inputCaptureMetrics = new import_projected2.ProjectedInputCaptureMetrics();
      const scrollEcho = new import_projected2.ScrollEchoGate();
      const rootSurface = client.document.documentElement;
      if (rootSurface && rootSurface.nodeType === 1) {
        const detach = (0, import_projected2.attachProjectedInputCapture)(rootSurface, client.getLiveRegistry(), sendInputIntent, {
          contextId: import_frame4.CONTEXT_ID_ROOT,
          getGeneration: () => client.getGeneration(),
          getViewportSize: () => canonicalViewport,
          isArmed: () => client.isArmed,
          onMarkPropDirty: (id) => client.markPropDirty(id),
          consumeScrollEcho: (target, observed) => scrollEcho.consume(target, observed),
          metrics: inputCaptureMetrics
        });
        inputDetachers.set(import_frame4.CONTEXT_ID_ROOT, detach);
      }
      const rootWin = client.document.defaultView;
      if (isGeckoLab() && rootWin) {
        registerGeckoAssetContext(import_frame4.CONTEXT_ID_ROOT, rootWin);
      }
      client.forEachNestedInputSurface((info) => {
        const nestedDoc = info.surface.contentDocument;
        const nestedSurface = nestedDoc?.documentElement;
        if (!nestedSurface || nestedSurface.nodeType !== 1) return;
        const nestedWin = nestedDoc.defaultView;
        if (isGeckoLab() && nestedWin) {
          registerGeckoAssetContext(info.contextId, nestedWin);
        }
        const detach = (0, import_projected2.attachProjectedInputCapture)(nestedSurface, info.registry, sendInputIntent, {
          contextId: info.contextId,
          getGeneration: info.getGeneration,
          // Mode A coords are root Virtual viewport — same canonical size as root capture.
          getViewportSize: () => canonicalViewport,
          // Walk nested frame offsets up to the projected root (not lab chrome).
          getRootWindow: () => rootWin,
          isArmed: info.isArmed,
          onMarkPropDirty: info.markPropDirty,
          consumeScrollEcho: (target, observed) => scrollEcho.consume(target, observed),
          metrics: inputCaptureMetrics
        });
        inputDetachers.set(info.contextId, detach);
      });
    }
    let mode = "browse";
    let runInFlight = false;
    let sessionLive = false;
    let sessionId = null;
    let phase = "idle";
    let opsTotal = 0;
    let browseSnapCount = 0;
    let snapInFlight = false;
    let widgetParityInFlight = false;
    let autoSnapTimer = null;
    const byContext = /* @__PURE__ */ new Map();
    function stopAutoSnap() {
      if (autoSnapTimer) {
        clearInterval(autoSnapTimer);
        autoSnapTimer = null;
      }
    }
    function requestBrowseSnap(label) {
      if (!ws || ws.readyState !== WebSocket.OPEN || !sessionLive || snapInFlight) return;
      snapInFlight = true;
      syncButtons();
      const type = isGeckoLab() ? "client.sameS" : "client.snapshot";
      ws.send(JSON.stringify({ type, label, contextId: 1 }));
      logActivity(isGeckoLab() ? `same-S capture\u2026 (${label ?? "manual"})` : `snap\u2026 (${label ?? "manual"})`);
    }
    function startAutoSnap() {
      stopAutoSnap();
      const enabled = document.getElementById("autoSnap")?.checked === true;
      if (!enabled || !sessionLive) return;
      const raw = Number(document.getElementById("autoSnapIntervalMs")?.value);
      const intervalMs = Number.isFinite(raw) && raw >= 1e3 ? raw : 5e3;
      autoSnapTimer = setInterval(() => {
        requestBrowseSnap("auto");
      }, intervalMs);
    }
    function ctxStats(contextId) {
      let row = byContext.get(contextId);
      if (!row) {
        row = emptyContextStats();
        byContext.set(contextId, row);
      }
      return row;
    }
    function observeStreamTelemetry(msg) {
      const kind = typeof msg.kind === "string" ? msg.kind : "";
      const ctxId = typeof msg.contextId === "number" && Number.isInteger(msg.contextId) && msg.contextId >= 1 ? msg.contextId : import_frame4.CONTEXT_ID_ROOT;
      const row = ctxStats(ctxId);
      if (kind === "frameEmitted") {
        row.emitted += 1;
        if (typeof msg.sequence === "number") row.lastSequence = msg.sequence;
        if (typeof msg.generation === "number") row.generation = msg.generation;
        if (typeof msg.buildMs === "number") row.lastBuildMs = msg.buildMs;
        if (typeof msg.encodeMs === "number") row.lastEncodeMs = msg.encodeMs;
      }
      if (kind === "applyResult") {
        const ok = msg.ok === true;
        if (ok) row.applyOk += 1;
        else row.applyFail += 1;
        if (typeof msg.applyMs === "number") row.lastApplyMs = msg.applyMs;
        if (typeof msg.sequence === "number") row.lastSequence = msg.sequence;
        if (typeof msg.generation === "number") row.generation = msg.generation;
      }
      if (kind === "desynced" || kind === "desync") row.desync += 1;
      if (kind === "applyOverrun") row.overrun += 1;
    }
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
    function showCrashOverlay(detail) {
      surfaceWrap.classList.add("is-crashed");
      surfaceWrap.classList.remove("is-empty");
      const overlay = $("surfaceCrash");
      overlay.hidden = false;
      $("surfaceCrashDetail").textContent = detail.trim() || "unknown fault";
      try {
        document.activeElement?.blur?.();
      } catch {
      }
    }
    function clearCrashOverlay() {
      surfaceWrap.classList.remove("is-crashed");
      const overlay = document.getElementById("surfaceCrash");
      if (overlay) overlay.hidden = true;
      const detail = document.getElementById("surfaceCrashDetail");
      if (detail) detail.textContent = "\u2014";
    }
    function truncateHudUrl(raw, max = 52) {
      if (!raw) return "\u2014";
      try {
        const u = new URL(raw);
        const compact = `${u.host}${u.pathname}${u.search}`;
        return compact.length > max ? `${compact.slice(0, max - 1)}\u2026` : compact;
      } catch {
        return raw.length > max ? `${raw.slice(0, max - 1)}\u2026` : raw;
      }
    }
    function updateHudSummary() {
      const el2 = document.getElementById("hudSummary");
      if (!el2) return;
      if (mode === "browse") {
        const fix = fixtureSelect.selectedOptions[0]?.textContent?.trim() || "fixture";
        const url = urlInput.value.trim();
        el2.textContent = url ? `${fix} \xB7 ${truncateHudUrl(url)}` : fix;
        el2.title = url || fix;
      } else {
        const bp = selectedBlueprint();
        const url = bp?.defaultUrl ?? "";
        el2.textContent = bp ? `${bp.id} \xB7 ${truncateHudUrl(url)}` : "Pick blueprint";
        el2.title = url || bp?.description || "";
      }
    }
    let labShell = null;
    let labFullscreen = false;
    function syncFullscreenUi() {
      document.body.classList.toggle("lab-fullscreen", labFullscreen);
      const exitBtn = $("exitFullscreen");
      exitBtn.setAttribute("aria-hidden", labFullscreen ? "false" : "true");
      const enterBtn = $("enterFullscreen");
      enterBtn.setAttribute("aria-pressed", labFullscreen ? "true" : "false");
    }
    async function enterLabFullscreen() {
      labFullscreen = true;
      syncFullscreenUi();
      try {
        const root = document.documentElement;
        if (!document.fullscreenElement && typeof root.requestFullscreen === "function") {
          await root.requestFullscreen();
        }
      } catch {
      }
      logActivity("fullscreen on");
      if (viewportSync) {
        const measured = (0, import_projected3.measureHostElement)(surfaceHost);
        viewportSync.schedule(measured.width, measured.height);
      }
    }
    async function exitLabFullscreen() {
      labFullscreen = false;
      syncFullscreenUi();
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
      } catch {
      }
      logActivity("fullscreen off");
      if (viewportSync) {
        const measured = (0, import_projected3.measureHostElement)(surfaceHost);
        viewportSync.schedule(measured.width, measured.height);
      }
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
      $("browseSnap").disabled = !open || mode !== "browse" || !sessionLive || runInFlight || snapInFlight;
      $("browseWidgetParity").disabled = !open || mode !== "browse" || !sessionLive || runInFlight || widgetParityInFlight || !projection;
      $("browseValidate").disabled = !open || mode !== "browse" || !sessionLive || runInFlight || browseSnapCount < 1 || snapInFlight;
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
      updateHudSummary();
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
      const browseSec = document.getElementById("browseControlsSecondary");
      const runSec = document.getElementById("runControlsSecondary");
      if (browseSec) browseSec.hidden = next !== "browse";
      if (runSec) runSec.hidden = next !== "run";
      fixtureField.hidden = next !== "browse";
      blueprintField.hidden = next !== "run";
      blueprintDesc.hidden = next !== "run";
      if (next === "browse") {
        modeBlurb.textContent = "Free navigation \u2014 pick a fixture or edit the URL, then Start Virtual.";
        urlInput.readOnly = false;
        urlLabel.textContent = "URL";
        urlInput.title = "Editable \u2014 free navigation target";
        if (!urlInput.value || urlInput.value.startsWith(`${location.origin}/fixtures/`)) {
          urlInput.value = "https://www.eneba.com";
        }
      } else {
        modeBlurb.textContent = "Cold blueprint DAG \u2014 URL is locked to the blueprint; soak may override duration/probes.";
        syncRunTarget();
      }
      syncButtons();
      updateHudSummary();
    }
    function showTab(name) {
      $("panelStream").hidden = name !== "Stream";
      $("panelDebug").hidden = name !== "Debug";
      $("panelActivity").hidden = name !== "Activity";
      $("panelConsole").hidden = name !== "Console";
      $("panelConfig").hidden = name !== "Config";
      $("panelProgress").hidden = name !== "Progress";
      $("panelRuns").hidden = name !== "Runs";
      document.querySelectorAll("[data-tab]").forEach((btn) => {
        const on = btn.dataset.tab === name;
        btn.classList.toggle("active", on);
        btn.setAttribute("aria-selected", on ? "true" : "false");
      });
      labShell?.expandForTab(name);
    }
    function renderDebugProbe(payload) {
      const wall = typeof payload.wallMs === "number" ? payload.wallMs : null;
      $("dbgWall").textContent = wall != null ? String(Math.round(wall)) : "\u2014";
      const intentJournal = payload.intentJournal ?? {};
      $("dbgIntents").textContent = String(intentJournal.total ?? 0);
      $("dbgIntentDrop").textContent = String(intentJournal.dropped ?? 0);
      const pipe = payload.inputPipeline ?? null;
      const inject = pipe?.inject ?? null;
      $("dbgInjectRecv").textContent = String(inject?.received ?? pipe?.ingressReceived ?? 0);
      $("dbgInjectDrop").textContent = String(
        (typeof inject?.dropped === "number" ? inject.dropped : 0) + (typeof pipe?.ingressDropped === "number" ? pipe.ingressDropped : 0)
      );
      $("dbgChainPeak").textContent = String(inject?.chainDepthPeak ?? 0);
      $("dbgMoveCollapse").textContent = String(inject?.moveCollapseCount ?? 0);
      const queue = inject?.queueWaitMs ?? null;
      const injMs = inject?.injectMs ?? null;
      $("dbgQueueP95").textContent = queue && typeof queue.p95 === "number" ? queue.p95.toFixed(1) : "\u2014";
      $("dbgInjectP95").textContent = injMs && typeof injMs.p95 === "number" ? injMs.p95.toFixed(1) : "\u2014";
      const metrics = payload.metrics ?? {};
      const fps = typeof metrics.steadyFps === "number" ? metrics.steadyFps : null;
      $("dbgFps").textContent = fps != null ? fps.toFixed(1) : "\u2014";
      $("dbgDesync").textContent = String(metrics.desyncCount ?? 0);
      const cpuOn = payload.cpuProfiling === true;
      const cpuRun = payload.cpuProfileStarted === true;
      $("dbgCpu").textContent = cpuOn ? cpuRun ? "profiling" : "armed" : "off";
      const crash = payload.crash;
      $("dbgCrash").textContent = crash ? JSON.stringify(crash, null, 2) : "none";
      const last = inject?.lastOutcome ?? null;
      $("dbgLastOutcome").textContent = last ? JSON.stringify(last, null, 2) : "\u2014";
      const drops = {
        journal: intentJournal.dropsByError ?? {},
        ingress: pipe?.ingressDropsByReason ?? {},
        inject: inject?.dropsByReason ?? {}
      };
      $("dbgDrops").textContent = JSON.stringify(drops, null, 2);
    }
    function updateStream() {
      const root = ctxStats(import_frame4.CONTEXT_ID_ROOT);
      $("streamFrames").textContent = String(root.wireFrames);
      $("streamApply").textContent = String(root.applyOk);
      $("streamDesync").textContent = String(root.desync);
      $("streamResync").textContent = String(root.resync);
      $("streamOps").textContent = opsTotal > 0 ? String(opsTotal) : "\u2014";
      if (projection) {
        $("streamSeq").textContent = String(projection.lastAcceptedSequence);
      }
      if (root.generation !== null) $("streamGen").textContent = String(root.generation);
      if (root.lastApplyMs !== null) $("streamApplyMs").textContent = root.lastApplyMs.toFixed(1);
      const list = $("streamContextList");
      list.replaceChildren();
      const ids = [...byContext.keys()].sort((a, b) => a - b);
      if (ids.length === 0) {
        const empty = document.createElement("div");
        empty.className = "stream-empty";
        empty.textContent = "No context traffic yet";
        list.append(empty);
        return;
      }
      for (const id of ids) {
        const s = byContext.get(id);
        const card = document.createElement("article");
        card.className = id === import_frame4.CONTEXT_ID_ROOT ? "ctx-card stream-root" : "ctx-card";
        const head = document.createElement("div");
        head.className = "ctx-card-head";
        const idEl = document.createElement("div");
        idEl.className = "ctx-id";
        idEl.textContent = id === import_frame4.CONTEXT_ID_ROOT ? `ctx ${id} \xB7 root` : `ctx ${id}`;
        const seqEl = document.createElement("div");
        seqEl.className = "ctx-seq";
        seqEl.textContent = s.lastSequence !== null ? `seq ${s.lastSequence}` : "seq \u2014";
        head.append(idEl, seqEl);
        const stats = document.createElement("div");
        stats.className = "ctx-stats";
        const rows = [
          ["Wire", String(s.wireFrames), "Wire frame parts received"],
          ["Emit", String(s.emitted), "Virtual frameEmitted"],
          ["Apply+", String(s.applyOk)],
          ["Apply\u2212", s.applyFail > 0 ? String(s.applyFail) : "\u2014"],
          ["Desync", String(s.desync)],
          ["Resync", String(s.resync)],
          ["Ovr", s.overrun > 0 ? String(s.overrun) : "\u2014"],
          ["Build", s.lastBuildMs !== null ? `${s.lastBuildMs.toFixed(1)} ms` : "\u2014"],
          ["Apply", s.lastApplyMs !== null ? `${s.lastApplyMs.toFixed(1)} ms` : "\u2014"]
        ];
        for (const [k, v, title] of rows) {
          const cell = document.createElement("div");
          cell.className = "ctx-stat";
          if (title) cell.title = title;
          const kEl = document.createElement("span");
          kEl.className = "k";
          kEl.textContent = k;
          const vEl = document.createElement("span");
          vEl.className = "v";
          vEl.textContent = v;
          cell.append(kEl, vEl);
          stats.append(cell);
        }
        card.append(head, stats);
        list.append(card);
      }
    }
    function resetStreamCounters() {
      byContext.clear();
      opsTotal = 0;
      browseSnapCount = 0;
      $("streamGen").textContent = "\u2014";
      $("streamApplyMs").textContent = "\u2014";
      $("streamOps").textContent = "\u2014";
      $("streamSnaps").textContent = "0";
      updateStream();
    }
    async function ensureProjection() {
      if (projection) return projection;
      if (isGeckoLab()) {
        await ensureGeckoAssetSw(sessionToken);
      }
      projection = await LabProjectedHarness.create({
        surfaceHost,
        width: canonicalViewport.width,
        height: canonicalViewport.height,
        getToken: () => sessionToken,
        getAssetBaseUrl: () => assetBaseUrl,
        getDocumentBaseUrl: () => isGeckoLab() ? documentBaseUrl : "",
        onArmed: () => {
          bindInputSurfaces(projection);
          disposeImgTrace?.();
          disposeImgTrace = installImgTrace(projection.document);
        },
        onTelemetry: (msg) => {
          observeStreamTelemetry(msg);
          const m = msg;
          const ctxId = typeof m.contextId === "number" ? m.contextId : import_frame4.CONTEXT_ID_ROOT;
          if (m.kind === "clientWarn" && typeof m.message === "string") {
            logConsole(3, m.message);
            logActivity(m.message);
          }
          if (m.kind === "applyResult" && m.ok === true && ctxId !== import_frame4.CONTEXT_ID_ROOT && projection) {
            bindInputSurfaces(projection);
          }
          if (m.kind === "applyResult" && typeof m.opCount === "number" && ctxId === import_frame4.CONTEXT_ID_ROOT && m.ok === true) {
            opsTotal += m.opCount;
            $("streamOps").textContent = String(m.opCount);
          }
          if (m.kind === "desynced" || m.kind === "desync") {
            const tel = msg;
            const detail = [tel.errorCode ?? m.kind, tel.op ? `op=${tel.op}` : "", tel.message ?? ""].filter(Boolean).join(" ");
            logActivity(ctxId === import_frame4.CONTEXT_ID_ROOT ? `desync ${detail}` : `ctx${ctxId} desync ${detail}`);
          }
          if (m.kind === "resyncFailed") {
            const tel = msg;
            const detail = [
              tel.reason ?? "",
              tel.op ? `op=${tel.op}` : "",
              typeof tel.id === "number" ? `id=${tel.id}` : "",
              tel.message ?? ""
            ].filter(Boolean).join(" ");
            logActivity(
              `resync failed attempt=${tel.attempt ?? "?"} exhausted=${tel.exhausted === true} ${detail}`
            );
          }
          if (m.kind === "resyncCompleted") {
            logActivity(`resync completed seq=${msg.sequence ?? "?"}`);
          }
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "client.telemetry", message: msg }));
          }
          updateStream();
        },
        onRequestResync: (info) => {
          const ctxId = info.contextId ?? import_frame4.CONTEXT_ID_ROOT;
          ctxStats(ctxId).resync += 1;
          logActivity(
            ctxId === import_frame4.CONTEXT_ID_ROOT ? `resync requested reason=${info.reason}` : `ctx${ctxId} resync requested reason=${info.reason}`
          );
          updateStream();
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "client.requestResync", ...info }));
          }
        },
        onDesync: (reason) => {
          updateStream();
          logActivity(`desync ${reason}`);
        }
      });
      disposeImgTrace?.();
      disposeImgTrace = installImgTrace(projection.document);
      setSurfaceEmpty(false);
      if (canonicalViewport.width > 0 && canonicalViewport.height > 0) {
        projection.client.setCssSize(canonicalViewport.width, canonicalViewport.height);
      }
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
        const res = await labFetch("/lab/fixtures");
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
        if (mode === "browse") urlInput.value = "https://www.eneba.com";
      }
    }
    async function loadBlueprints() {
      try {
        const res = await labFetch("/lab/blueprints");
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
        disposeViewportSync();
        stopAutoSnap();
        ws = null;
        sessionLive = false;
        runInFlight = false;
        snapInFlight = false;
        syncButtons();
      });
      ws.addEventListener("message", (ev) => {
        if (typeof ev.data !== "string") {
          const bytes = new Uint8Array(ev.data);
          const hdr = (0, import_decode2.peekFrameHeader)(bytes);
          const ctxId = hdr && hdr.contextId >= 1 ? hdr.contextId : import_frame4.CONTEXT_ID_ROOT;
          ctxStats(ctxId).wireFrames += 1;
          updateStream();
          void ensureProjection().then((p) => {
            p.ingest(bytes);
          });
          return;
        }
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (msg.type === "telemetry") {
          const tel = msg.message;
          if (typeof tel === "object" && tel !== null) {
            observeStreamTelemetry(tel);
            updateStream();
          }
          return;
        }
        if (msg.type === "requestSnapshot") {
          const contextId = typeof msg.contextId === "number" && msg.contextId >= 1 ? msg.contextId : 1;
          const includeNestedPeek = msg.includeNestedPeek === true;
          const registryProbeNodeIds = Array.isArray(msg.registryProbeNodeIds) ? msg.registryProbeNodeIds.filter((n) => typeof n === "number") : [];
          const rectLadderRaw = msg.rectLadderProbe;
          const rectLadderProbe = typeof rectLadderRaw === "object" && rectLadderRaw !== null && typeof rectLadderRaw.nestedContextId === "number" ? {
            nestedContextId: rectLadderRaw.nestedContextId,
            widgetNodeId: typeof rectLadderRaw.widgetNodeId === "number" ? rectLadderRaw.widgetNodeId : void 0
          } : void 0;
          const paintRaw = msg.paintProbe;
          const paintProbeReq = typeof paintRaw === "object" && paintRaw !== null && typeof paintRaw.nestedContextId === "number" ? {
            nestedContextId: paintRaw.nestedContextId,
            widgetNodeId: typeof paintRaw.widgetNodeId === "number" ? paintRaw.widgetNodeId : void 0
          } : void 0;
          const sheetDumpRaw = msg.cssomSheetDump;
          const cssomSheetDumpReq = typeof sheetDumpRaw === "object" && sheetDumpRaw !== null ? {
            nestedContextId: typeof sheetDumpRaw.nestedContextId === "number" ? sheetDumpRaw.nestedContextId : void 0
          } : void 0;
          const layoutRootCause = msg.layoutRootCause === true;
          void ensureProjection().then(async (p) => {
            const ctx = p.snapshotContext(contextId);
            const doc = contextId === 1 ? p.document : p.nestedDocument(contextId);
            const win = contextId === 1 ? p.document?.defaultView ?? null : p.nestedDocument(contextId)?.defaultView ?? null;
            const tree = doc ? (0, import_domTreeSnapshot.snapshotTree)(doc) : null;
            const cascade = doc ? probeCssomPaintBoundary(doc) : null;
            const formProps = doc ? (0, import_formControlSnapshot.snapshotFormControls)(doc) : null;
            const nestedPeek = includeNestedPeek && contextId === 1 ? p.peekNestedHosts() : void 0;
            const registryProbe = contextId >= 2 && registryProbeNodeIds.length > 0 ? p.probeNestedRegistry(contextId, registryProbeNodeIds) : void 0;
            const rectLadder = rectLadderProbe ? p.probeRectLadder(
              rectLadderProbe.nestedContextId,
              rectLadderProbe.widgetNodeId ?? 21
            ) : void 0;
            let paintProbe;
            if (paintProbeReq) {
              const wId = paintProbeReq.widgetNodeId ?? 21;
              const paint = p.probeWidgetPaint(paintProbeReq.nestedContextId, wId);
              paintProbe = {
                widgetPaint: paint.paint,
                widgetPaintOk: paint.ok,
                widgetPaintReason: paint.reason
              };
            }
            const cssomSheetDump = cssomSheetDumpReq || layoutRootCause ? p.probeCssomSheetDump(cssomSheetDumpReq?.nestedContextId ?? contextId) : void 0;
            const layoutProbe = layoutRootCause && doc && win ? probeLayoutRootCause(doc, win) : void 0;
            if (doc && isGeckoLab()) {
              sampleImgStates(doc, "sameS");
            }
            const assetTrace = isGeckoLab() ? drainAssetTrace() : void 0;
            ws?.send(
              JSON.stringify({
                type: "client.snapshotResult",
                contextId,
                tree,
                table: ctx.table,
                sequence: ctx.sequence,
                generation: ctx.generation,
                desynced: ctx.desynced,
                applyError: ctx.applyError,
                armed: ctx.armed,
                resyncInFlight: ctx.resyncInFlight,
                cascade,
                formProps,
                ...nestedPeek !== void 0 ? { nestedPeek } : {},
                ...registryProbe !== void 0 ? { registryProbe } : {},
                ...rectLadder !== void 0 ? { rectLadder } : {},
                ...paintProbe !== void 0 ? { paintProbe } : {},
                ...cssomSheetDump !== void 0 ? { cssomSheetDump } : {},
                ...layoutProbe !== void 0 ? { layoutProbe } : {},
                ...assetTrace !== void 0 ? { assetTrace } : {}
              })
            );
          });
          return;
        }
        if (msg.type === "lab.injectFrame") {
          void ensureProjection().then((p) => {
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
          });
          return;
        }
        if (msg.type === "lab.tamper") {
          void ensureProjection().then((p) => {
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
          });
          return;
        }
        if (msg.type === "session.resized") {
          const pending = pendingResize;
          if (pending) {
            pendingResize = null;
            pending.resolve({
              applied: msg.applied === true,
              width: typeof msg.width === "number" ? msg.width : void 0,
              height: typeof msg.height === "number" ? msg.height : void 0,
              message: typeof msg.message === "string" ? msg.message : void 0,
              errorCode: typeof msg.errorCode === "string" ? msg.errorCode : void 0
            });
          }
          return;
        }
        if (msg.type === "session.hello") {
          sessionId = String(msg.sessionId ?? "");
          setScrollDiagSessionId(sessionId);
          sessionToken = String(msg.sessionToken ?? "");
          assetBaseUrl = window.location.origin;
          documentBaseUrl = "";
          setGeckoLab(msg.engine === "gecko");
          if (isGeckoLab() && ws) {
            wireGeckoSwFetch(ws, import_frame4.CONTEXT_ID_ROOT);
            void ensureGeckoAssetSw(sessionToken).then(
              () => logActivity("gecko sw ready"),
              (err) => logActivity(`gecko sw falhou: ${err.message}`)
            );
          }
          logActivity(`session.hello ${sessionId}${isGeckoLab() ? " gecko" : ""}`);
          refreshStatus();
          return;
        }
        if (msg.type === "gecko.requested" && isGeckoLab() && ws) {
          const kind = String(msg.kind ?? "dialog");
          const contextId = Number(msg.contextId ?? import_frame4.CONTEXT_ID_ROOT);
          const requestId = Number(msg.requestId ?? 0);
          const description = String(msg.description ?? "");
          const { yes, text } = showGeckoPrompt(kind, description);
          answerGeckoRequest(ws, kind, contextId, requestId, yes, text);
          logActivity(`gecko.requested ${kind} #${requestId}`);
          return;
        }
        if (msg.type === "gecko.asset" && isGeckoLab()) {
          const streamId = Number(msg.streamId ?? 0);
          const phase2 = Number(msg.phase ?? 0);
          const why = String(msg.why ?? "");
          let data = new Uint8Array(0);
          if (typeof msg.bytes === "string" && msg.bytes.length > 0) {
            const raw = atob(msg.bytes);
            data = new Uint8Array(raw.length);
            for (let i = 0; i < raw.length; i++) data[i] = raw.charCodeAt(i);
          }
          onGeckoAssetMessage(streamId, phase2, data, why);
          return;
        }
        if (msg.type === "session.booted") {
          clearCrashOverlay();
          sessionLive = true;
          sessionId = String(msg.sessionId ?? sessionId ?? "");
          setScrollDiagSessionId(sessionId);
          phase = "live";
          browseSnapCount = 0;
          $("streamSnaps").textContent = "0";
          logActivity(`booted mode=${msg.mode} dossier=${msg.dossierDir}`);
          logActivity("click diag: __speculumLabDumpInputClick() in devtools after pointer click");
          startViewportSync();
          if (msg.mode === "browse") startAutoSnap();
          syncButtons();
          return;
        }
        if (msg.type === "session.stopped") {
          sessionLive = false;
          stopAutoSnap();
          snapInFlight = false;
          disposeViewportSync();
          const reason = typeof msg.reason === "string" ? msg.reason : "";
          if (reason.startsWith("crash:") && phase !== "fault") {
            phase = "fault";
            showCrashOverlay(reason.slice("crash:".length) || reason);
          }
          if (!runInFlight && phase !== "complete" && phase !== "fault") phase = "connected";
          logActivity(`stopped ${msg.reason}${msg.dossierDir ? ` ${msg.dossierDir}` : ""}`);
          if (msg.dossierDir) {
            void runsPanel.refresh().then(() => runsPanel.selectByDossierDir(String(msg.dossierDir)));
          }
          syncButtons();
          return;
        }
        if (msg.type === "widget.diag") {
          const diagnostic = msg.diagnostic;
          console.log("[widget-parity-diag]", diagnostic);
          widgetParityInFlight = false;
          const verdict = diagnostic.verdict;
          const hypothesis = diagnostic.hypothesis;
          logActivity(
            `widget.diag verdict=${verdict ?? "?"} ${(hypothesis ?? []).slice(0, 2).join(" | ") || ""}`
          );
          syncButtons();
          return;
        }
        if (msg.type === "input.diag") {
          const diagnostic = msg.diagnostic;
          console.log("[input-click-diag]", diagnostic);
          const intent = diagnostic.lastIntent;
          const resolve = diagnostic.lastResolve;
          const capture = diagnostic.projectedCapture;
          const rejects = diagnostic.sidecarRejects;
          logActivity(
            `input.diag ctx=${intent?.contextId ?? "?"} node=${intent?.nodeId ?? "?"} xy=${resolve?.ok === true ? `${resolve.x},${resolve.y}` : resolve?.reason ?? "\u2014"} efp=${String(diagnostic.rootElementFromPoint ?? "null")} emit=${JSON.stringify(capture?.emittedByType ?? {})} touch=${capture?.touchstartSeen ?? 0} rejects=${rejects?.total ?? 0}`
          );
          return;
        }
        if (msg.type === "debug.probe") {
          if (msg.payload && typeof msg.payload === "object") {
            renderDebugProbe(msg.payload);
          }
          return;
        }
        if (msg.type === "session.fault") {
          phase = "fault";
          const code = typeof msg.errorCode === "string" ? msg.errorCode : "";
          const detail = `${code ? `${code}: ` : ""}${msg.message}`;
          setChip("chipPhase", `fault ${detail}`, "danger");
          logActivity(`fault ${detail}`);
          if (typeof msg.dossierDir === "string" && msg.dossierDir) {
            logActivity(`fault dossier ${msg.dossierDir}`);
            void runsPanel.refresh().then(() => runsPanel.selectByDossierDir(msg.dossierDir));
          }
          showCrashOverlay(detail);
          if (msg.errorCode || msg.message) {
            renderDebugProbe({
              crash: {
                errorCode: msg.errorCode,
                message: msg.message,
                phase: msg.phase,
                dossierDir: msg.dossierDir
              }
            });
          }
          sessionLive = false;
          runInFlight = false;
          stopAutoSnap();
          snapInFlight = false;
          syncButtons();
          return;
        }
        if (msg.type === "console") {
          const level = typeof msg.level === "number" ? msg.level : 1;
          const text = typeof msg.text === "string" ? msg.text : String(msg.text ?? "");
          logConsole(level, text);
          if (level >= 3) logActivity(`console error ${text.slice(0, 120)}`);
          return;
        }
        if (msg.type === "snap.stored") {
          snapInFlight = false;
          browseSnapCount = typeof msg.snapCount === "number" ? msg.snapCount : browseSnapCount + 1;
          $("streamSnaps").textContent = String(browseSnapCount);
          const pass = msg.allPass === true ? "pass" : "fail";
          logActivity(
            `snap stored ${msg.id}${msg.label ? ` (${msg.label})` : ""} seq=${msg.sequence ?? "\u2014"} ${pass} (n=${browseSnapCount})`
          );
          syncButtons();
          return;
        }
        if (msg.type === "lab.sameSResult") {
          snapInFlight = false;
          browseSnapCount += 1;
          $("streamSnaps").textContent = String(browseSnapCount);
          const ok = msg.ok === true;
          const same = msg.sameSequence === true;
          const vSeq = msg.virtualSequence ?? "\u2014";
          const pSeq = msg.projectedSequence ?? "\u2014";
          const err = typeof msg.error === "string" ? msg.error : "";
          logActivity(
            `same-S ${ok ? "ok" : "fail"} vSeq=${vSeq} pSeq=${pSeq} sameSeq=${same}${err ? ` err=${err}` : ""} (n=${browseSnapCount})`
          );
          syncButtons();
          return;
        }
        if (msg.type === "validate.result") {
          const verdict = msg.allPass === true ? "pass" : "fail";
          logActivity(
            `validate ${verdict} snaps=${msg.snapCount} pass=${msg.pass} fail=${msg.fail} skipped=${msg.skipped}`
          );
          setChip(
            "chipPhase",
            msg.allPass === true ? `iso pass (${msg.snapCount})` : `iso fail (${msg.fail})`,
            msg.allPass === true ? "ok" : "danger"
          );
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
          void runsPanel.refresh().then(() => {
            if (msg.dossierDir) void runsPanel.selectByDossierDir(String(msg.dossierDir));
          });
          showTab("Runs");
          return;
        }
        if (msg.type === "error") {
          logActivity(`error ${msg.message}`);
          if (msg.code === "snapshot_failed" || msg.code === "validate_failed") {
            snapInFlight = false;
            syncButtons();
            return;
          }
          if (msg.code === "widget_parity_failed") {
            widgetParityInFlight = false;
            syncButtons();
            return;
          }
          if (msg.code === "input_dispatch_failed" || msg.code === "input_unavailable" || msg.code === "input_dropped") {
            return;
          }
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
      updateHudSummary();
    });
    blueprintSelect.addEventListener("change", () => {
      syncRunTarget();
      updateHudSummary();
    });
    urlInput.addEventListener("input", () => {
      if (mode === "browse") updateHudSummary();
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
    $("clearConsole").addEventListener("click", () => {
      $("consoleLog").innerHTML = "";
    });
    document.getElementById("autoSnap")?.addEventListener("change", () => {
      if (sessionLive) startAutoSnap();
      else stopAutoSnap();
    });
    document.getElementById("autoSnapIntervalMs")?.addEventListener(
      "change",
      () => {
        if (sessionLive) startAutoSnap();
      }
    );
    $("browseStart").addEventListener("click", () => {
      clearCrashOverlay();
      disposeViewportSync();
      canonicalViewport = measureAndNormalizeViewport();
      bootDeviceProfile = (0, import_projected3.detectViewportDeviceProfile)();
      void (async () => {
        if (isGeckoLab()) {
          try {
            documentBaseUrl = new URL(urlInput.value).href;
          } catch {
            documentBaseUrl = urlInput.value;
          }
        }
        const p = await ensureProjection();
        await p.resetSurface();
        clearAssetTrace();
        disposeImgTrace?.();
        disposeImgTrace = installImgTrace(p.document);
        p.client.setCssSize(canonicalViewport.width, canonicalViewport.height);
        resetStreamCounters();
        logActivity(
          `browse.start viewport ${canonicalViewport.width}\xD7${canonicalViewport.height}`
        );
        ws?.send(
          JSON.stringify({
            type: "browse.start",
            url: urlInput.value,
            width: canonicalViewport.width,
            height: canonicalViewport.height,
            device: bootDeviceProfile,
            frameRateHz: Number(document.getElementById("frameRateHz")?.value) || 60,
            telemetry: readTelemetryFromUi(),
            cpuProfiling: document.getElementById("browseCpu")?.checked === true
          })
        );
      })();
    });
    $("browseNavigate").addEventListener("click", () => {
      if (!sessionLive) return;
      if (isGeckoLab()) {
        try {
          documentBaseUrl = new URL(urlInput.value).href;
        } catch {
          documentBaseUrl = urlInput.value;
        }
      }
      ws?.send(JSON.stringify({ type: "browse.navigate", url: urlInput.value }));
      logActivity(`navigate ${urlInput.value}`);
    });
    $("browseSnap").addEventListener("click", () => {
      requestBrowseSnap("manual");
    });
    $("browseWidgetParity").addEventListener("click", () => {
      sendWidgetParityDiag();
    });
    $("browseValidate").addEventListener("click", () => {
      if (!ws || ws.readyState !== WebSocket.OPEN || browseSnapCount < 1) return;
      logActivity(`validate snaps\u2026 (n=${browseSnapCount})`);
      ws.send(JSON.stringify({ type: "client.validateSnaps" }));
    });
    $("browseStop").addEventListener("click", () => {
      stopAutoSnap();
      snapInFlight = false;
      syncButtons();
      logActivity("browse.stop\u2026");
      ws?.send(
        JSON.stringify({
          type: "browse.stop",
          exportDossier: true,
          inputCapture: inputCaptureMetrics.snapshot()
        })
      );
    });
    $("clearSurface").addEventListener("click", () => {
      clearCrashOverlay();
      disposeViewportSync();
      if (projection) {
        void projection.resetSurface();
      } else {
        surfaceHost.innerHTML = "";
      }
      setSurfaceEmpty(true);
      resetStreamCounters();
      ws?.send(JSON.stringify({ type: "surface.clear" }));
    });
    $("runStart").addEventListener("click", () => {
      clearCrashOverlay();
      void (async () => {
        const p = await ensureProjection();
        await p.resetSurface();
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
      })();
    });
    $("enterFullscreen").addEventListener("click", () => {
      void enterLabFullscreen();
    });
    document.getElementById("diagCopy")?.addEventListener("click", () => {
      const api = window;
      void api.diagFlush?.().then((r) => {
        if (!r) return;
        logActivity(
          r.ok ? `diag flush ${r.sent} gesto(s) -> lab-runs/gesture-diag` : `diag flush falhou: ${r.error}`
        );
      });
      api.diagDump?.();
    });
    $("exitFullscreen").addEventListener("click", () => {
      void exitLabFullscreen();
    });
    document.addEventListener("fullscreenchange", () => {
      if (labFullscreen && document.fullscreenElement !== document.documentElement) {
        labFullscreen = false;
        syncFullscreenUi();
      }
    });
    window.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && labFullscreen) void exitLabFullscreen();
    });
    const mainEl = document.getElementById("labMain");
    const sheetEl = document.getElementById("investigationSheet");
    const grabberEl = document.getElementById("sheetGrabber");
    const hudEl = document.getElementById("surfaceHud");
    const hudToggleEl = document.getElementById("hudToggle");
    const hudBodyEl = document.getElementById("hudBody");
    const hudMoreEl = document.getElementById("hudMore");
    if (mainEl && sheetEl && grabberEl && hudEl && hudToggleEl && hudBodyEl) {
      labShell = initLabShell({
        main: mainEl,
        sheet: sheetEl,
        grabber: grabberEl,
        hud: hudEl,
        hudToggle: hudToggleEl,
        hudBody: hudBodyEl,
        hudMore: hudMoreEl ?? void 0,
        onSnapChange: () => {
          if (viewportSync) {
            const measured = (0, import_projected3.measureHostElement)(surfaceHost);
            viewportSync.schedule(measured.width, measured.height);
          }
        }
      });
    }
    void Promise.all([loadFixtures(), loadBlueprints()]).then(() => {
      showMode("browse");
      updateHudSummary();
    });
    showTab("Stream");
    refreshStatus();
    syncButtons();
    window.__labBootOk = Date.now();
  }
  bootLabClient();
})();
