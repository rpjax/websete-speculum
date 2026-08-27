"use strict";
(() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
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
        OpCode2[OpCode2["EpochReset"] = 2] = "EpochReset";
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
        [OpCode.EpochReset]: "epochReset",
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
      exports.spliceCssomBeforeCheck = exports.createFrame = exports.CSSOM_SCOPE_PIERCE_HOST = exports.CSSOM_SCOPE_MAIN = exports.CHECK_SCOPE_RANGE = exports.CHECK_SCOPE_TABLE = exports.SHADOW_INIT_FLAGS_MASK = exports.SHADOW_INIT_SERIALIZABLE = exports.SHADOW_INIT_CLONABLE = exports.SHADOW_INIT_DELEGATES_FOCUS = exports.SHADOW_MODE_OPEN = exports.INSERT_AT_END = exports.CONTEXT_ID_ROOT = exports.DOCUMENT_ID = exports.FRAME_PREFIX_BYTES = exports.FRAME_WIRE_VERSION = exports.NodeKind = void 0;
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
      function peekFrameHeader2(bytes) {
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
      exports.peekFrameHeader = peekFrameHeader2;
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
      exports.PersistentStringTable = PersistentStringTable;
      function decodeFramePart(input, persistent) {
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
      exports.decodeFramePart = decodeFramePart;
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
          case opcodes_1.OpCode.EpochReset:
            return { op: opcodes_1.OpCode.EpochReset, generation: r.u32() };
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
              if (mode !== frame_1.SHADOW_MODE_OPEN) {
                throw new Error(`NODE_NEW SHADOW_ROOT mode ${mode} is not open (frame-protocol.md \xA74.2)`);
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
      exports.FramePartAssembler = FramePartAssembler;
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
        collectSubtreeIds(id, out) {
          out.push(id);
          const seen = /* @__PURE__ */ new Set();
          let child = this.lastChildOf.get(id) ?? NONE;
          while (child !== NONE) {
            if (seen.has(child))
              break;
            seen.add(child);
            this.collectSubtreeIds(child, out);
            const row = this.rows.get(child);
            child = row?.prevSibling ?? NONE;
          }
          const shadow = this.shadowRootByHost.get(id);
          if (shadow !== void 0 && shadow !== id)
            this.collectSubtreeIds(shadow, out);
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
          case opcodes_1.OpCode.EpochReset:
            table.reset();
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
            if (op.mode !== frame_1.SHADOW_MODE_OPEN) {
              return failOp(i, "malformed", "nodeNew", op.id, "NODE_NEW SHADOW_ROOT mode must be 0 (open) (frame-protocol.md \xA74.2)");
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
      exports.isNestedHostNavAttr = void 0;
      function isNestedHostNavAttr(name) {
        const n = name.toLowerCase();
        return n === "src" || n === "srcdoc";
      }
      exports.isNestedHostNavAttr = isNestedHostNavAttr;
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
        const el = doc.createElement("style");
        el.setAttribute(exports.PARITY_STYLE_ATTR, "");
        el.textContent = exports.SCRIPTING_ON_PAINT_PARITY_CSS;
        if (head != null)
          head.appendChild(el);
        else
          host.insertBefore(el, host.firstChild);
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

  // ../packages/page-projection/dist/projected/standardsMarginParity.js
  var require_standardsMarginParity = __commonJS({
    "../packages/page-projection/dist/projected/standardsMarginParity.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.installStandardsMarginParity = exports.MARGIN_PARITY_ATTR = exports.STANDARDS_MARGIN_PARITY_CSS = void 0;
      exports.STANDARDS_MARGIN_PARITY_CSS = [
        "body{margin-top:0!important}",
        /* Quirks collapses first-heading margin-top through body; standards keeps ~0.67*2em. */
        "body:has(> :is(h1,h2,h3,h4,h5,h6):first-child){padding-top:1.34em!important}",
        "body:has(> :is(h1,h2,h3,h4,h5,h6):first-child)>:is(h1,h2,h3,h4,h5,h6):first-child{margin-top:0!important}"
      ].join("");
      exports.MARGIN_PARITY_ATTR = "data-speculum-standards-margin-parity";
      function installStandardsMarginParity(doc) {
        if (doc.compatMode === "CSS1Compat")
          return;
        if (doc.querySelector(`style[${exports.MARGIN_PARITY_ATTR}]`))
          return;
        const host = doc.head ?? doc.documentElement;
        if (!host)
          return;
        const el = doc.createElement("style");
        el.setAttribute(exports.MARGIN_PARITY_ATTR, "");
        el.textContent = exports.STANDARDS_MARGIN_PARITY_CSS;
        if (doc.head)
          doc.head.appendChild(el);
        else
          host.insertBefore(el, host.firstChild);
      }
      exports.installStandardsMarginParity = installStandardsMarginParity;
    }
  });

  // ../packages/page-projection/dist/projected/standardsBlankDocument.js
  var require_standardsBlankDocument = __commonJS({
    "../packages/page-projection/dist/projected/standardsBlankDocument.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.ensureStandardsBlankDocument = void 0;
      function ensureStandardsBlankDocument(_doc) {
      }
      exports.ensureStandardsBlankDocument = ensureStandardsBlankDocument;
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
      var standardsMarginParity_1 = require_standardsMarginParity();
      var standardsBlankDocument_1 = require_standardsBlankDocument();
      var DomFrameApplier = class {
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
          const result = (0, replicatedTableApply_1.applyFrameToTableChecked)(this.table, frame.resync, frame.ops, frame.sequence);
          if (!result.ok) {
            if (result.opName === "check") {
              return this.fail("precondition", "check", result.expected, result.actual);
            }
            return this.failOp(result.reason, result.opName, result.id, result.message);
          }
          for (let i = 0; i < frame.ops.length; i++) {
            try {
              if (!this.applyOp(frame.ops[i]))
                return false;
            } catch {
              return this.fail("malformed", "apply", 0);
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
            case opcodes_1.OpCode.Check:
              return true;
            // §4.1 — no DOM effect; already evaluated in phase 1
            case opcodes_1.OpCode.EpochReset:
              return this.applyEpochReset();
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
        /**
         * §4.1 `EPOCH_RESET` `DOM` effect: "the surface is discarded (a new document buffer is
         * prepared — §6)." No double-buffer surface exists yet (Stage 4) — discards in place, which is
         * safe here specifically because phase 1 already validated the *whole* frame (§P3: "if phase
         * 1 fails, the DOM was never touched") and `EPOCH_RESET` is ordering-guaranteed first (§7 rule
         * 1), so every `NODE_NEW`/`INSERT` immediately following in this same frame rebuilds the
         * surface before Phase 2 returns — there is no observable empty-document frame.
         */
        applyEpochReset() {
          for (const childScopeId of this.childScopes.values()) {
            this.options.onNestedHostDrop?.(childScopeId);
          }
          this.childScopes.clear();
          this.nestedHostIds.clear();
          this.doc.replaceChildren();
          (0, standardsBlankDocument_1.ensureStandardsBlankDocument)(this.doc);
          this.registry.clear();
          this.registry.register(frame_1.DOCUMENT_ID, this.doc);
          this.propDirty.reset();
          this.clearCssom();
          return true;
        }
        clearCssom() {
          this.sheets.clear();
          this.rules.clear();
          this.sheetHost.clear();
          this.paritySheet = null;
          try {
            (0, scriptingOnPaintParity_1.installScriptingOnPaintParity)(this.doc);
            (0, standardsMarginParity_1.installStandardsMarginParity)(this.doc);
            const sheet = (0, scriptingOnPaintParity_1.paritySheetForDocument)(this.doc);
            this.paritySheet = sheet ?? null;
            this.doc.adoptedStyleSheets = sheet != null ? [sheet] : [];
          } catch (err) {
            const detail = err instanceof Error ? err.message : String(err);
            this.options.onWarn?.(`scriptingOnPaintParity: clearCssom failed: ${detail}`);
          }
        }
        /**
         * K5 sandbox has no `allow-scripts`; hide `<noscript>` like Chromium with JS on.
         * Call after phase-2 materialize — EPOCH_RESET may run while `defaultView`/head are gone.
         */
        ensurePaintParity() {
          (0, scriptingOnPaintParity_1.installScriptingOnPaintParity)(this.doc);
          (0, standardsMarginParity_1.installStandardsMarginParity)(this.doc);
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
            sheet = new view.CSSStyleSheet();
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
          } catch {
            return this.fail("malformed", "ruleNew", op.id);
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
              return this.fail("malformed", "nodeNew", op.id);
            }
            const uri = (0, elementNs_1.elementNsUri)(op.ns, op.uri);
            node = this.doc.createElementNS(uri, op.name);
            const attrs = op.nestedHost === true ? op.attrs.filter((a) => !(0, nestedNav_1.isNestedHostNavAttr)(a.name)) : op.attrs;
            if (!applyAttrs(node, attrs, this.options.stampUrl)) {
              return this.fail("malformed", "nodeNew", op.id);
            }
            if (op.nestedHost === true && op.childScopeId != null) {
              this.childScopes.set(op.id, op.childScopeId);
              this.nestedHostIds.add(op.id);
            }
          } else if (op.kind === opcodes_1.NodeKind.Text) {
            node = this.doc.createTextNode(op.value);
          } else if (op.kind === opcodes_1.NodeKind.Comment) {
            node = this.doc.createComment(op.value);
          } else if (op.kind === opcodes_1.NodeKind.Doctype) {
            const want = op.name || "html";
            const existing = this.doc.doctype;
            if (existing && existing.name === want) {
              node = existing;
            } else {
              if (existing)
                existing.remove();
              node = this.doc.implementation.createDocumentType(want, "", "");
            }
          } else if (op.kind === opcodes_1.NodeKind.ShadowRoot) {
            const host = this.registry.get(op.host);
            if (!host || host.nodeType !== Node.ELEMENT_NODE)
              return this.fail("address_miss", "nodeNew", op.host);
            const el = host;
            if (el.shadowRoot)
              return this.fail("bad_target", "nodeNew", op.id);
            const init = { mode: "open" };
            if ((op.initFlags & frame_1.SHADOW_INIT_DELEGATES_FOCUS) !== 0)
              init.delegatesFocus = true;
            const extra = init;
            if ((op.initFlags & frame_1.SHADOW_INIT_CLONABLE) !== 0)
              extra.clonable = true;
            if ((op.initFlags & frame_1.SHADOW_INIT_SERIALIZABLE) !== 0)
              extra.serializable = true;
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
            if (node.nodeType === Node.DOCUMENT_TYPE_NODE && parent === this.doc && this.doc.doctype === node) {
              continue;
            }
            parent.insertBefore(node, before);
            this.maybeInstallNestedHost(id, node);
          }
          return true;
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
          const attrs = this.nestedHostIds.has(op.node) ? op.attrs.filter((a) => !(0, nestedNav_1.isNestedHostNavAttr)(a.name)) : op.attrs;
          if (!applyAttrs(node, attrs, this.options.stampUrl)) {
            return this.fail("malformed", "attrSet", op.node);
          }
          return true;
        }
        applyAttrDel(op) {
          const node = this.registry.get(op.node);
          if (!node || node.nodeType !== Node.ELEMENT_NODE)
            return this.fail("address_miss", "attrDel", op.node);
          const el = node;
          for (let i = 0; i < op.names.length; i++)
            el.removeAttribute(op.names[i]);
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
          const el = node;
          if (op.propId === propSet_1.PROP_ID_VALUE && "value" in el) {
            el.value = String(op.value);
            return true;
          }
          if (op.propId === propSet_1.PROP_ID_CHECKED && "checked" in el) {
            el.checked = Boolean(op.value);
            return true;
          }
          if (op.propId === propSet_1.PROP_ID_SELECTED && el instanceof HTMLOptionElement) {
            el.selected = Boolean(op.value);
            return true;
          }
          return true;
        }
        maybeInstallNestedHost(id, node) {
          if (!this.nestedHostIds.has(id))
            return;
          const childScopeId = this.childScopes.get(id);
          if (childScopeId === void 0)
            return;
          const el = node;
          if (el.contentWindow)
            this.options.onNestedHost?.(el, childScopeId);
        }
      };
      exports.DomFrameApplier = DomFrameApplier;
      function applyAttrs(el, attrs, stampUrl) {
        return (0, attrApply_1.applyAttrPairs)((name, value) => {
          const stamped = stampUrl ? stampUrl(name, value) : value;
          el.setAttribute(name, stamped);
        }, attrs);
      }
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
        const el = eventTargetElement(target);
        if (el == null)
          return false;
        return el.closest("a[href], area[href]") != null;
      }
      exports.isProjectedNavigable = isProjectedNavigable;
      function suppressProjectedDefault(event) {
        if (event.cancelable)
          event.preventDefault();
        event.stopPropagation();
      }
      exports.suppressProjectedDefault = suppressProjectedDefault;
      function layoutViewportSize(win) {
        const el = win.document.documentElement;
        const width = el?.clientWidth || win.innerWidth;
        const height = el?.clientHeight || win.innerHeight;
        return { width, height };
      }
      exports.layoutViewportSize = layoutViewportSize;
      function attachProjectedNativeGuard(doc) {
        const onActivate = (event) => suppressProjectedDefault(event);
        const onPointerDown = (event) => {
          const pe = event;
          if (typeof pe.button === "number" && pe.button !== 0)
            return;
          if (isProjectedNavigable(event.target))
            suppressProjectedDefault(event);
        };
        const onTouchStart = (event) => {
          if (isProjectedNavigable(event.target))
            suppressProjectedDefault(event);
        };
        doc.addEventListener("click", onActivate, true);
        doc.addEventListener("auxclick", onActivate, true);
        doc.addEventListener("dblclick", onActivate, true);
        doc.addEventListener("submit", onActivate, true);
        doc.addEventListener("pointerdown", onPointerDown, true);
        doc.addEventListener("touchstart", onTouchStart, { capture: true, passive: false });
        return () => {
          doc.removeEventListener("click", onActivate, true);
          doc.removeEventListener("auxclick", onActivate, true);
          doc.removeEventListener("dblclick", onActivate, true);
          doc.removeEventListener("submit", onActivate, true);
          doc.removeEventListener("pointerdown", onPointerDown, true);
          doc.removeEventListener("touchstart", onTouchStart, true);
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
      function stripBareDocument(doc) {
        while (doc.firstChild)
          doc.removeChild(doc.firstChild);
        (0, projectedNativeGuard_1.attachProjectedNativeGuard)(doc);
      }
      function docOf(iframe) {
        const doc = iframe.contentDocument;
        if (!doc)
          throw new Error("nested surface: no contentDocument");
        return doc;
      }
      function createNestedResyncSurface(primaryHost) {
        const primaryDoc = primaryHost.contentDocument;
        if (primaryDoc)
          (0, projectedNativeGuard_1.attachProjectedNativeGuard)(primaryDoc);
        let activeIframe = primaryHost;
        let standbyIframe = null;
        function attachStandbySibling() {
          const parent = activeIframe.parentElement;
          if (!parent)
            throw new Error("nested surface: host has no parent");
          const iframe = document.createElement("iframe");
          iframe.title = "Nested projected resync build";
          iframe.sandbox.add("allow-same-origin");
          iframe.style.cssText = activeIframe.style.cssText;
          iframe.style.visibility = "hidden";
          parent.insertBefore(iframe, activeIframe.nextSibling);
          stripBareDocument(docOf(iframe));
          return iframe;
        }
        return {
          get document() {
            return docOf(activeIframe);
          },
          beginResyncBuild() {
            if (standbyIframe !== null)
              standbyIframe.remove();
            standbyIframe = attachStandbySibling();
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
          reset() {
            if (standbyIframe !== null) {
              standbyIframe.remove();
              standbyIframe = null;
            }
            if (activeIframe !== primaryHost) {
              activeIframe.remove();
              activeIframe = primaryHost;
            }
            stripBareDocument(docOf(activeIframe));
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
      var PageProjectionRegistry = class {
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
              const sr = node.shadowRoot;
              if (sr)
                stack.push(sr);
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
      exports.PageProjectionRegistry = PageProjectionRegistry;
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

  // ../packages/page-projection/dist/projected/sessionBindingAuth.js
  var require_sessionBindingAuth = __commonJS({
    "../packages/page-projection/dist/projected/sessionBindingAuth.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.stampAttrAuth = exports.stampAuthInServedBody = exports.stampCssTextAuth = exports.stampSrcsetAuth = exports.appendSessionBindingQuery = exports.appendCacheBust = exports.appendSessionAuth = exports.isVirtualAssetUrl = exports.SessionCacheBustQueryParam = exports.SessionAuthQueryParam = void 0;
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
        return value.split(",").map((part) => {
          const trimmed = part.trim();
          if (!trimmed)
            return part;
          const bits = trimmed.split(/\s+/);
          const u = bits[0];
          const rest = bits.slice(1).join(" ");
          const stamped = appendSessionAuth(u, token, assetBaseUrl);
          return rest ? `${stamped} ${rest}` : stamped;
        }).join(", ");
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
      var opcodes_1 = require_opcodes();
      var tableDigest_1 = require_tableDigest();
      var telemetry_1 = require_telemetry();
      var sessionBindingAuth_1 = require_sessionBindingAuth();
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
        onArmedCb;
        onNestedHostCb;
        onNestedHostDropCb;
        onTelemetry;
        onRequestResyncCb;
        getToken;
        getAssetBaseUrl;
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
          this.surface = (0, nestedResyncSurface_1.createNestedResyncSurface)(opts.hostIframe);
          const registry = new registry_1.PageProjectionRegistry();
          registry.register(frame_1.DOCUMENT_ID, opts.document);
          this.live = { applier: this.createApplier(opts.document, registry, true), registry };
        }
        get isArmed() {
          return this.armed;
        }
        get desynced() {
          return this.lastDesyncReason !== null;
        }
        get applyError() {
          return this.lastDesyncReason;
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
          this.surface.reset();
          this.live.applier.reset();
        }
        createApplier(doc, registry, initiallyLive) {
          const state = { swapped: initiallyLive };
          const token = () => this.getToken?.() || "";
          const base = () => this.getAssetBaseUrl?.() || "";
          return new applyDom_1.DomFrameApplier(doc, registry, {
            stampUrl: (name, value) => (0, sessionBindingAuth_1.stampAttrAuth)(name, value, token(), base()),
            stampCssText: (text) => (0, sessionBindingAuth_1.stampCssTextAuth)(text, token(), base()),
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
                v: telemetry_1.TELEMETRY_WIRE_VERSION,
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
          if (frame.generation !== this.generation) {
            const firstOp = frame.ops[0];
            const isEpochReset = firstOp !== void 0 && firstOp.op === opcodes_1.OpCode.EpochReset;
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
            if (this.everArmed)
              this.beginResyncTarget();
          }
          if (frame.sequence !== this.lastSequence + 1) {
            this.desync("sequence_gap", { expectedSequence: this.lastSequence + 1, gotSequence: frame.sequence });
            return;
          }
          this.lastSequence = frame.sequence;
          const target = this.resync ?? this.live;
          target.applier.enqueue(frame);
        }
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
          const registry = new registry_1.PageProjectionRegistry();
          registry.register(frame_1.DOCUMENT_ID, doc);
          const applier = this.createApplier(doc, registry, false);
          this.resync = { applier, registry, attempt: this.resyncAttempts };
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
              reason
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
          if (this.lastDesyncReason === null) {
            this.lastDesyncReason = extra?.op ? `${reason}:${extra.op}` : reason;
          }
          this.armed = false;
          this.assembler.reset();
          this.live.applier.reset();
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
      function attachBareIframe(container) {
        const iframe = document.createElement("iframe");
        iframe.title = "Projected surface";
        iframe.sandbox.add("allow-same-origin");
        iframe.style.cssText = "position:absolute;inset:0;width:100%;height:100%;border:0;background:#fff";
        container.appendChild(iframe);
        const doc = iframe.contentDocument;
        if (!doc)
          throw new Error("surface: no contentDocument");
        while (doc.firstChild)
          doc.removeChild(doc.firstChild);
        return iframe;
      }
      function docOf(iframe) {
        const doc = iframe.contentDocument;
        if (!doc)
          throw new Error("surface: no contentDocument");
        return doc;
      }
      function createSurfaceHost(container, opts = { width: 1280, height: 720 }) {
        container.style.position = "relative";
        container.style.width = "100%";
        container.style.height = "100%";
        container.style.overflow = "hidden";
        container.replaceChildren();
        const stage = document.createElement("div");
        stage.setAttribute("data-pp-surface-stage", "");
        let cssW = Math.max(1, Math.round(opts.width));
        let cssH = Math.max(1, Math.round(opts.height));
        stage.style.cssText = `position:absolute;left:0;top:0;overflow:hidden;width:${cssW}px;height:${cssH}px`;
        container.appendChild(stage);
        let activeIframe = attachBareIframe(stage);
        let standbyIframe = null;
        return {
          get document() {
            return docOf(activeIframe);
          },
          beginResyncBuild() {
            if (standbyIframe !== null)
              standbyIframe.remove();
            standbyIframe = attachBareIframe(stage);
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
          reset() {
            if (standbyIframe !== null) {
              standbyIframe.remove();
              standbyIframe = null;
            }
            stage.replaceChildren();
            activeIframe = attachBareIframe(stage);
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
      var nestedProjectedApply_1 = require_nestedProjectedApply();
      var registry_1 = require_registry();
      var surface_1 = require_surface();
      var tableDigest_1 = require_tableDigest();
      var frame_1 = require_frame();
      var opcodes_1 = require_opcodes();
      var telemetry_1 = require_telemetry();
      var sessionBindingAuth_1 = require_sessionBindingAuth();
      var MAX_RESYNC_ATTEMPTS = 3;
      var RESYNC_BACKOFF_MS = 300;
      var RESYNC_RESPONSE_TIMEOUT_MS = 5e3;
      var ProjectionClient = class {
        persistentStrings = new decode_1.PersistentStringTable();
        assembler = new decode_1.FramePartAssembler();
        surface;
        onTelemetry;
        onArmedCb;
        onDesyncCb;
        onRequestResyncCb;
        getToken;
        getAssetBaseUrl;
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
        /** contextId → host waiting for initial about:blank `load` before apply binds. */
        nestedHostAwaitingLoad = /* @__PURE__ */ new Map();
        constructor(opts) {
          this.surface = (0, surface_1.createSurfaceHost)(opts.surfaceHost, {
            width: opts.width ?? 1280,
            height: opts.height ?? 720
          });
          this.onTelemetry = opts.onTelemetry;
          this.onArmedCb = opts.onArmed;
          this.onDesyncCb = opts.onDesync;
          this.onRequestResyncCb = opts.onRequestResync;
          this.getToken = opts.getToken;
          this.getAssetBaseUrl = opts.getAssetBaseUrl;
          this.token = opts.token;
          this.assetBaseUrl = opts.assetBaseUrl;
          const registry = new registry_1.PageProjectionRegistry();
          registry.register(frame_1.DOCUMENT_ID, this.surface.document);
          this.live = { applier: this.createApplier(this.surface.document, registry, true), registry };
        }
        installNestedHost(iframe, contextId) {
          if (this.nested.has(contextId))
            return;
          if (this.nestedHostAwaitingLoad.has(contextId))
            return;
          const pending = { iframe, bind: () => void 0, cancelled: false };
          const bind = () => {
            if (pending.cancelled)
              return;
            this.nestedHostAwaitingLoad.delete(contextId);
            if (this.nested.has(contextId))
              return;
            const doc = iframe.contentDocument;
            const win = iframe.contentWindow;
            if (!doc || !win)
              return;
            while (doc.firstChild)
              doc.removeChild(doc.firstChild);
            const session = new nestedProjectedApply_1.NestedProjectedApply({
              hostIframe: iframe,
              document: doc,
              contextId,
              getToken: () => this.resolveToken(),
              getAssetBaseUrl: () => this.resolveAssetBaseUrl(),
              onNestedHost: (childIframe, childScopeId) => this.installNestedHost(childIframe, childScopeId),
              onNestedHostDrop: (childScopeId) => this.dropNestedHost(childScopeId),
              onTelemetry: (msg) => this.onTelemetry?.(msg),
              onArmed: () => {
                try {
                  win.__speculumNestedApplyArmed = true;
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
          };
          pending.bind = bind;
          this.nestedHostAwaitingLoad.set(contextId, pending);
          iframe.addEventListener("load", bind, { once: true });
        }
        cancelPendingNestedHost(contextId) {
          const pending = this.nestedHostAwaitingLoad.get(contextId);
          if (!pending)
            return;
          pending.cancelled = true;
          pending.iframe.removeEventListener("load", pending.bind);
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
        reset() {
          this.abandonResyncAttempt();
          this.resyncAttempts = 0;
          this.resyncExhausted = false;
          this.persistentStrings = new decode_1.PersistentStringTable();
          this.assembler = new decode_1.FramePartAssembler();
          this.lastSequence = 0;
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
          this.surface.reset();
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
          if (frame.generation !== this.generation) {
            const firstOp = frame.ops[0];
            const isEpochReset = firstOp !== void 0 && firstOp.op === opcodes_1.OpCode.EpochReset;
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
            if (this.everArmed)
              this.beginResyncTarget();
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
                if (!this.armed)
                  this.notifyLiveSurfaceReady();
              } else {
                state.swapped = true;
                this.commitResyncSwap(frame, applyMs);
              }
            },
            onOverrun: (durationMs, lastSequence) => {
              this.onTelemetry?.({
                v: telemetry_1.TELEMETRY_WIRE_VERSION,
                contextId: frame_1.CONTEXT_ID_ROOT,
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
          const registry = new registry_1.PageProjectionRegistry();
          registry.register(frame_1.DOCUMENT_ID, doc);
          const applier = this.createApplier(doc, registry, false);
          this.resync = { applier, registry, attempt: this.resyncAttempts };
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
        failResyncAttempt(reason) {
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
              contextId
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
          if (this.lastDesyncReason === null) {
            this.lastDesyncReason = extra?.op ? `${reason}:${extra.op}` : reason;
          }
          this.armed = false;
          this.assembler.reset();
          this.live.applier.reset();
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
          this.scheduleResyncAttempt(reason);
        }
      };
      exports.ProjectionClient = ProjectionClient;
      function createProjectionClient2(opts) {
        return new ProjectionClient(opts);
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
      exports.UNIFIED_INTENT_SCHEMA_VERSION = 1;
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
          const visW = rootWin.innerWidth;
          const visH = rootWin.innerHeight;
          if (visW <= 0 || visH <= 0)
            return null;
          const { width: vw, height: vh } = opts.getViewportSize();
          if (vw <= 0 || vh <= 0)
            return null;
          const sx = x * (vw / visW);
          const sy = y * (vh / visH);
          return { x: Math.min(Math.max(sx, 0), vw - 1e-6), y: Math.min(Math.max(sy, 0), vh - 1e-6) };
        };
        const runPointerEdge = (event, type) => {
          if (!opts.isArmed()) {
            opts.metrics?.noteSkip("disarmed");
            return;
          }
          const coords = surfaceCoordsFromClient(event.clientX, event.clientY);
          if (!coords) {
            opts.metrics?.noteSkip("no_coords");
            return;
          }
          const stamp = viewportStamp();
          const target = event.target;
          if (!target || typeof target !== "object" || !("nodeType" in target)) {
            opts.metrics?.noteSkip("no_node");
            return;
          }
          const nodeId = registry.idOf(target);
          if (nodeId == null) {
            opts.metrics?.noteSkip("no_node");
            return;
          }
          enqueue({
            schemaVersion: unifiedIntentTypes_1.UNIFIED_INTENT_SCHEMA_VERSION,
            type,
            timestampClient: performance.now(),
            ...stamp,
            x: coords.x,
            y: coords.y,
            button: buttonFromEvent(event.button),
            contextId: opts.contextId,
            nodeId
          });
        };
        const onPointerEdge = (event, type) => {
          runPointerEdge(event, type);
        };
        const onClick = (event) => {
          event.preventDefault();
          event.stopPropagation();
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
          if (!opts.isArmed()) {
            opts.metrics?.noteSkip("disarmed");
            return;
          }
          const el = event.target;
          if (el === doc || el === win || isElement(el) && el === doc.scrollingElement) {
            if (!win)
              return;
            const top2 = win.scrollY || doc.scrollingElement?.scrollTop || 0;
            const left2 = win.scrollX || doc.scrollingElement?.scrollLeft || 0;
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
              scrollX: left2,
              scrollY: top2
            });
            return;
          }
          if (!isElement(el))
            return;
          const nodeId = registry.idOfNearest(el);
          if (nodeId == null) {
            opts.metrics?.noteSkip("no_node");
            return;
          }
          const top = el.scrollTop;
          const left = el.scrollLeft;
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
            scrollX: left,
            scrollY: top
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
        const onPointerDown = (event) => {
          if (event.pointerType === "touch" && win) {
            const vw = win.innerWidth;
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
          }
          onPointerEdge(event, "down");
        };
        const onPointerMove = (event) => {
          if (!edgeSwipe || event.pointerId !== edgeSwipe.pointerId)
            return;
          event.preventDefault();
          event.stopPropagation();
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
          onPointerEdge(event, "up");
        };
        doc.addEventListener("pointerdown", onPointerDown, true);
        doc.addEventListener("pointermove", onPointerMove, true);
        doc.addEventListener("pointerup", onPointerUp, true);
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
        return () => {
          buffer.dispose();
          detachHistoryTrap();
          doc.removeEventListener("pointerdown", onPointerDown, true);
          doc.removeEventListener("pointermove", onPointerMove, true);
          doc.removeEventListener("pointerup", onPointerUp, true);
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
        lastEmitWallMs = null;
        intervalSamples = [];
        noteEmit(type) {
          this.emitted += 1;
          const key = type || "unknown";
          this.emittedByType[key] = (this.emittedByType[key] ?? 0) + 1;
          const now = Date.now();
          if (this.lastEmitWallMs != null) {
            const gap = now - this.lastEmitWallMs;
            if (Number.isFinite(gap) && gap >= 0) {
              this.intervalSamples.push(gap);
              if (this.intervalSamples.length > SAMPLE_CAP)
                this.intervalSamples.shift();
            }
          }
          this.lastEmitWallMs = now;
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
        snapshot() {
          return {
            emitted: this.emitted,
            emittedByType: { ...this.emittedByType },
            moveCoalesced: this.moveCoalesced,
            scrollCoalesced: this.scrollCoalesced,
            skippedDisarmed: this.skippedDisarmed,
            skippedNoCoords: this.skippedNoCoords,
            skippedNoNodeId: this.skippedNoNodeId,
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
          const el = nodes[i];
          const snap = snapshotOne(el);
          if (snap)
            out.push(snap);
        }
        out.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
        return out;
      }
      exports.snapshotFormControls = snapshotFormControls2;
      function snapshotOne(el) {
        const tag = el.tagName;
        if (tag === "TEXTAREA") {
          const key2 = el.id || null;
          if (!key2)
            return null;
          return { key: key2, value: el.value };
        }
        if (tag === "OPTION") {
          const select = el.closest("select");
          const selectId = select?.id || "";
          const value = el.value;
          if (!selectId && !value)
            return null;
          return { key: `option:${selectId}:${value}`, selected: el.selected };
        }
        if (tag !== "INPUT")
          return null;
        const input = el;
        const type = (input.type || "text").toLowerCase();
        if (SKIP_INPUT_TYPES.has(type))
          return null;
        const key = el.id || null;
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
      function measureHostElement2(el) {
        if (!el) {
          return { width: 0, height: 0 };
        }
        return {
          width: Math.round(el.clientWidth),
          height: Math.round(el.clientHeight)
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
            return;
          }
          const { width: w, height: h } = validated;
          const nextProfile = this.detectDevice();
          if ((0, viewportPolicy_1.viewportSizesClose)(w, h, this.remoteW, this.remoteH) && (0, viewportDevice_1.deviceProfilesEqual)(this.deviceProfile, nextProfile)) {
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
            return;
          }
          const targetW = validated.width;
          const targetH = validated.height;
          const profile = this.detectDevice();
          if ((0, viewportPolicy_1.viewportSizesClose)(targetW, targetH, this.remoteW, this.remoteH) && (0, viewportDevice_1.deviceProfilesEqual)(this.deviceProfile, profile)) {
            this.consecutiveRejects = 0;
            return;
          }
          this.resizeInFlight = true;
          try {
            const result = await this.resize({ width: targetW, height: targetH }, profile);
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
              this.onRejected?.(String(detail));
              this.consecutiveRejects++;
              if (this.consecutiveRejects <= _ViewportSync.MAX_REJECT_RETRIES) {
                this.pending = true;
              }
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
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
      exports.stampAuthInServedBody = exports.stampSrcsetAuth = exports.stampCssTextAuth = exports.stampAttrAuth = exports.appendSessionBindingQuery = exports.appendCacheBust = exports.appendSessionAuth = exports.isVirtualAssetUrl = exports.SessionCacheBustQueryParam = exports.SessionAuthQueryParam = exports.deviceProfilesEqual = exports.detectViewportDeviceProfile = exports.viewportSizesClose = exports.validateResizeViewport = exports.normalizeSessionViewport = exports.VIEWPORT_SIZE_EPSILON = exports.LAB_VIEWPORT_POLICY = exports.VIEWPORT_POLICY_BASELINE = exports.measureHostElement = exports.ViewportSync = exports.snapshotFormControls = exports.ScrollEchoGate = exports.ProjectedInputCaptureMetrics = exports.attachProjectedInputCapture = exports.NestedProjectedApply = exports.createSurfaceHost = exports.PageProjectionRegistry = exports.DomFrameApplier = exports.createProjectionClient = exports.ProjectionClient = void 0;
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
            const el = node;
            const attrs = [];
            const host = el.contentWindow != null;
            for (let i = 0; i < el.attributes.length; i++) {
              const a = el.attributes[i];
              if (host && (a.name === "src" || a.name === "srcdoc"))
                continue;
              attrs.push([a.name, a.value]);
            }
            attrs.sort((x, y) => x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0);
            const result = { tag: el.tagName.toLowerCase() };
            const ns = (0, elementNs_1.elementNsSnapshotLabel)(el.namespaceURI);
            if (ns !== void 0)
              result.ns = ns;
            if (attrs.length > 0)
              result.attrs = attrs;
            const children = mapChildren(node);
            if (children.length > 0)
              result.children = children;
            const sr = el.shadowRoot;
            if (sr !== null && sr.mode === "open" && sr.slotAssignment !== "manual") {
              const shadowKids = mapChildren(sr);
              result.shadow = { tag: "#shadow-root", ...shadowKids.length > 0 ? { children: shadowKids } : {} };
            }
            if (host) {
              try {
                const iframe = el;
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

  // browser/mirror/projection/lab/client/LabProjectedHarness.ts
  var import_ProjectionClient = __toESM(require_ProjectionClient());
  var import_frame = __toESM(require_frame());
  var import_tableDigest = __toESM(require_tableDigest());
  var LabProjectedHarness = class {
    client;
    constructor(opts) {
      this.client = (0, import_ProjectionClient.createProjectionClient)(opts);
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
    reset() {
      this.client.reset();
    }
    /** @deprecated alias — prefer {@link reset} */
    resetSurface() {
      this.client.reset();
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
     * Lab diag — peek nested host bookkeeping (awaiting load vs bound nested).
     */
    peekNestedHosts() {
      const c = this.client;
      return {
        nested: [...c.nested.keys()].sort((a, b) => a - b),
        awaiting: [...c.nestedHostAwaitingLoad.keys()].sort((a, b) => a - b)
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
  var import_projected = __toESM(require_projected());
  var import_projected2 = __toESM(require_projected());
  var import_domTreeSnapshot = __toESM(require_domTreeSnapshot());
  var import_formControlSnapshot = __toESM(require_formControlSnapshot());
  var import_decode = __toESM(require_decode());
  var import_telemetry = __toESM(require_telemetry());
  var import_frame2 = __toESM(require_frame());
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
    const inputDetachers = /* @__PURE__ */ new Map();
    let inputCaptureMetrics = new import_projected.ProjectedInputCaptureMetrics();
    let sessionToken = "";
    let assetBaseUrl = window.location.origin;
    let canonicalViewport = { width: 1280, height: 720 };
    let viewportSync = null;
    let pendingResize = null;
    let bootDeviceProfile = (0, import_projected2.detectViewportDeviceProfile)();
    window.__labDiagProjectedPeek = () => projection ? projection.peekNestedHosts() : null;
    window.__labDiagForceLoadAfterDrop = (contextId = 99) => projection ? projection.forceLoadAfterDropRaceForDiag(contextId) : null;
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
        ws.send(
          JSON.stringify({
            type: "client.resize",
            width: size.width,
            height: size.height,
            device
          })
        );
      });
    }
    function startViewportSync() {
      disposeViewportSync();
      projection?.client.setCssSize(canonicalViewport.width, canonicalViewport.height);
      const sync = new import_projected2.ViewportSync({
        measure: () => (0, import_projected2.measureHostElement)(surfaceHost),
        resize: requestRemoteResize,
        viewportPolicy: import_projected2.LAB_VIEWPORT_POLICY,
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
      const measured = (0, import_projected2.measureHostElement)(surfaceHost);
      return (0, import_projected2.normalizeSessionViewport)(measured.width, measured.height, import_projected2.LAB_VIEWPORT_POLICY);
    }
    function sendInputIntent(intent) {
      if (surfaceWrap.classList.contains("is-crashed")) return;
      if (ws?.readyState === WebSocket.OPEN) {
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
          }
          payload.payload = JSON.stringify({ x: intent.x, y: intent.y, button: intent.button });
        } else if (intent.type === "keyDown" || intent.type === "keyUp") {
          payload.key = intent.key;
          payload.code = intent.code;
          payload.payload = JSON.stringify({ key: intent.key, code: intent.code, modifiers: intent.modifiers });
        } else if (intent.type === "scrollSet") {
          payload.contextId = intent.contextId;
          payload.nodeId = intent.nodeId;
          payload.scrollX = intent.scrollX;
          payload.scrollY = intent.scrollY;
          payload.payload = JSON.stringify({ scrollX: intent.scrollX, scrollY: intent.scrollY });
        } else if (intent.type === "historyNav") {
          payload.direction = intent.direction;
          payload.payload = JSON.stringify({ direction: intent.direction });
        }
        payload.timestampClient = intent.timestampClient;
        ws.send(JSON.stringify({ type: "client.intent", intent: payload }));
        logActivity(`intent ${formatIntentShort(intent)}`);
      }
    }
    function bindInputSurfaces(client) {
      for (const detach of inputDetachers.values()) detach();
      inputDetachers.clear();
      inputCaptureMetrics = new import_projected.ProjectedInputCaptureMetrics();
      const scrollEcho = new import_projected.ScrollEchoGate();
      const rootSurface = client.document.documentElement;
      if (rootSurface && rootSurface.nodeType === 1) {
        const detach = (0, import_projected.attachProjectedInputCapture)(rootSurface, client.getLiveRegistry(), sendInputIntent, {
          contextId: import_frame2.CONTEXT_ID_ROOT,
          getGeneration: () => client.getGeneration(),
          getViewportSize: () => canonicalViewport,
          isArmed: () => client.isArmed,
          onMarkPropDirty: (id) => client.markPropDirty(id),
          consumeScrollEcho: (target, observed) => scrollEcho.consume(target, observed),
          metrics: inputCaptureMetrics
        });
        inputDetachers.set(import_frame2.CONTEXT_ID_ROOT, detach);
      }
      const rootWin = client.document.defaultView;
      client.forEachNestedInputSurface((info) => {
        const nestedDoc = info.surface.contentDocument;
        const nestedSurface = nestedDoc?.documentElement;
        if (!nestedSurface || nestedSurface.nodeType !== 1) return;
        const detach = (0, import_projected.attachProjectedInputCapture)(nestedSurface, info.registry, sendInputIntent, {
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
      ws.send(JSON.stringify({ type: "client.snapshot", label }));
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
      const ctxId = typeof msg.contextId === "number" && Number.isInteger(msg.contextId) && msg.contextId >= 1 ? msg.contextId : import_frame2.CONTEXT_ID_ROOT;
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
    function measureHeader() {
      const h = $("labHeader").getBoundingClientRect().height;
      document.documentElement.style.setProperty("--hdr-h", `${Math.ceil(h)}px`);
    }
    let labFullscreen = false;
    function syncFullscreenUi() {
      document.body.classList.toggle("lab-fullscreen", labFullscreen);
      const exitBtn = $("exitFullscreen");
      exitBtn.setAttribute("aria-hidden", labFullscreen ? "false" : "true");
      const enterBtn = $("enterFullscreen");
      enterBtn.setAttribute("aria-pressed", labFullscreen ? "true" : "false");
      if (!labFullscreen) measureHeader();
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
        const measured = (0, import_projected2.measureHostElement)(surfaceHost);
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
        const measured = (0, import_projected2.measureHostElement)(surfaceHost);
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
        if (!urlInput.value || urlInput.value.startsWith(`${location.origin}/fixtures/`)) {
          urlInput.value = "https://www.eneba.com";
        }
      } else {
        modeBlurb.textContent = "Cold blueprint DAG \u2014 URL is locked to the blueprint; soak may override duration/probes.";
        syncRunTarget();
      }
      syncButtons();
    }
    function showTab(name) {
      $("panelStream").hidden = name !== "Stream";
      $("panelDebug").hidden = name !== "Debug";
      $("panelActivity").hidden = name !== "Activity";
      $("panelConsole").hidden = name !== "Console";
      $("panelConfig").hidden = name !== "Config";
      $("panelProgress").hidden = name !== "Progress";
      document.querySelectorAll("[data-tab]").forEach((btn) => {
        const on = btn.dataset.tab === name;
        btn.classList.toggle("active", on);
        btn.setAttribute("aria-selected", on ? "true" : "false");
      });
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
      const root = ctxStats(import_frame2.CONTEXT_ID_ROOT);
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
        card.className = id === import_frame2.CONTEXT_ID_ROOT ? "ctx-card stream-root" : "ctx-card";
        const head = document.createElement("div");
        head.className = "ctx-card-head";
        const idEl = document.createElement("div");
        idEl.className = "ctx-id";
        idEl.textContent = id === import_frame2.CONTEXT_ID_ROOT ? `ctx ${id} \xB7 root` : `ctx ${id}`;
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
    function ensureProjection() {
      if (projection) return projection;
      projection = new LabProjectedHarness({
        surfaceHost,
        width: canonicalViewport.width,
        height: canonicalViewport.height,
        getToken: () => sessionToken,
        getAssetBaseUrl: () => assetBaseUrl,
        onArmed: () => {
          bindInputSurfaces(projection);
        },
        onTelemetry: (msg) => {
          observeStreamTelemetry(msg);
          const m = msg;
          const ctxId = typeof m.contextId === "number" ? m.contextId : import_frame2.CONTEXT_ID_ROOT;
          if (m.kind === "clientWarn" && typeof m.message === "string") {
            logConsole(3, m.message);
            logActivity(m.message);
          }
          if (m.kind === "applyResult" && m.ok === true && ctxId !== import_frame2.CONTEXT_ID_ROOT && projection) {
            bindInputSurfaces(projection);
          }
          if (m.kind === "applyResult" && typeof m.opCount === "number" && ctxId === import_frame2.CONTEXT_ID_ROOT && m.ok === true) {
            opsTotal += m.opCount;
            $("streamOps").textContent = String(m.opCount);
          }
          if (m.kind === "desynced" || m.kind === "desync") {
            logActivity(
              ctxId === import_frame2.CONTEXT_ID_ROOT ? `desync ${msg.errorCode ?? m.kind}` : `ctx${ctxId} desync ${msg.errorCode ?? m.kind}`
            );
          }
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "client.telemetry", message: msg }));
          }
          updateStream();
        },
        onRequestResync: (info) => {
          const ctxId = info.contextId ?? import_frame2.CONTEXT_ID_ROOT;
          ctxStats(ctxId).resync += 1;
          logActivity(
            ctxId === import_frame2.CONTEXT_ID_ROOT ? `resync requested reason=${info.reason}` : `ctx${ctxId} resync requested reason=${info.reason}`
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
        if (mode === "browse") urlInput.value = "https://www.eneba.com";
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
          const p = ensureProjection();
          const bytes = new Uint8Array(ev.data);
          const hdr = (0, import_decode.peekFrameHeader)(bytes);
          const ctxId = hdr && hdr.contextId >= 1 ? hdr.contextId : import_frame2.CONTEXT_ID_ROOT;
          ctxStats(ctxId).wireFrames += 1;
          p.ingest(bytes);
          updateStream();
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
          const p = ensureProjection();
          const ctx = p.snapshotContext(contextId);
          const doc = contextId === 1 ? p.document : p.nestedDocument(contextId);
          const tree = doc ? (0, import_domTreeSnapshot.snapshotTree)(doc) : null;
          const cascade = doc ? probeCssomPaintBoundary(doc) : null;
          const formProps = doc ? (0, import_formControlSnapshot.snapshotFormControls)(doc) : null;
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
              formProps
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
          sessionToken = String(msg.sessionToken ?? "");
          assetBaseUrl = window.location.origin;
          logActivity(`session.hello ${sessionId}`);
          refreshStatus();
          return;
        }
        if (msg.type === "session.booted") {
          clearCrashOverlay();
          sessionLive = true;
          sessionId = String(msg.sessionId ?? sessionId ?? "");
          phase = "live";
          browseSnapCount = 0;
          $("streamSnaps").textContent = "0";
          logActivity(`booted mode=${msg.mode} dossier=${msg.dossierDir}`);
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
          syncButtons();
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
          return;
        }
        if (msg.type === "error") {
          logActivity(`error ${msg.message}`);
          if (msg.code === "snapshot_failed" || msg.code === "validate_failed") {
            snapInFlight = false;
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
      bootDeviceProfile = (0, import_projected2.detectViewportDeviceProfile)();
      const p = ensureProjection();
      p.resetSurface();
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
    });
    $("browseNavigate").addEventListener("click", () => {
      if (!sessionLive) return;
      ws?.send(JSON.stringify({ type: "browse.navigate", url: urlInput.value }));
      logActivity(`navigate ${urlInput.value}`);
    });
    $("browseSnap").addEventListener("click", () => {
      requestBrowseSnap("manual");
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
        projection.resetSurface();
      } else {
        surfaceHost.innerHTML = "";
      }
      setSurfaceEmpty(true);
      resetStreamCounters();
      ws?.send(JSON.stringify({ type: "surface.clear" }));
    });
    $("runStart").addEventListener("click", () => {
      clearCrashOverlay();
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
    $("enterFullscreen").addEventListener("click", () => {
      void enterLabFullscreen();
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
    void Promise.all([loadFixtures(), loadBlueprints()]).then(() => {
      showMode("browse");
      measureHeader();
    });
    showTab("Stream");
    refreshStatus();
    syncButtons();
    window.__labBootOk = Date.now();
  }
  bootLabClient();
})();
