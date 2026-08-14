"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.desyncPhase = exports.isProjectionTelemetryMessage = exports.TELEMETRY_BOOL_CAPS = exports.LAB_TELEMETRY_DEFAULTS = exports.DEFAULT_TELEMETRY_CONFIG = exports.TELEMETRY_WIRE_VERSION = exports.PersistentStringTable = exports.FramePartAssembler = exports.decodeFramePart = exports.createFrame = exports.INSERT_AT_END = exports.DOCUMENT_ID = exports.FRAME_WIRE_VERSION = exports.NodeKind = exports.opCodeName = exports.OpCode = exports.NONE_DOM_NODE_KEY = void 0;
/** Shared wire models — sidecar imports these to decode Virtual→host frames. */
var domNodeKey_1 = require("./domNodeKey");
Object.defineProperty(exports, "NONE_DOM_NODE_KEY", { enumerable: true, get: function () { return domNodeKey_1.NONE_DOM_NODE_KEY; } });
var opcodes_1 = require("./opcodes");
Object.defineProperty(exports, "OpCode", { enumerable: true, get: function () { return opcodes_1.OpCode; } });
Object.defineProperty(exports, "opCodeName", { enumerable: true, get: function () { return opcodes_1.opCodeName; } });
Object.defineProperty(exports, "NodeKind", { enumerable: true, get: function () { return opcodes_1.NodeKind; } });
var frame_1 = require("./frame");
Object.defineProperty(exports, "FRAME_WIRE_VERSION", { enumerable: true, get: function () { return frame_1.FRAME_WIRE_VERSION; } });
Object.defineProperty(exports, "DOCUMENT_ID", { enumerable: true, get: function () { return frame_1.DOCUMENT_ID; } });
Object.defineProperty(exports, "INSERT_AT_END", { enumerable: true, get: function () { return frame_1.INSERT_AT_END; } });
Object.defineProperty(exports, "createFrame", { enumerable: true, get: function () { return frame_1.createFrame; } });
var decode_1 = require("./decode");
Object.defineProperty(exports, "decodeFramePart", { enumerable: true, get: function () { return decode_1.decodeFramePart; } });
Object.defineProperty(exports, "FramePartAssembler", { enumerable: true, get: function () { return decode_1.FramePartAssembler; } });
Object.defineProperty(exports, "PersistentStringTable", { enumerable: true, get: function () { return decode_1.PersistentStringTable; } });
var telemetry_1 = require("./telemetry");
Object.defineProperty(exports, "TELEMETRY_WIRE_VERSION", { enumerable: true, get: function () { return telemetry_1.TELEMETRY_WIRE_VERSION; } });
Object.defineProperty(exports, "DEFAULT_TELEMETRY_CONFIG", { enumerable: true, get: function () { return telemetry_1.DEFAULT_TELEMETRY_CONFIG; } });
Object.defineProperty(exports, "LAB_TELEMETRY_DEFAULTS", { enumerable: true, get: function () { return telemetry_1.LAB_TELEMETRY_DEFAULTS; } });
Object.defineProperty(exports, "TELEMETRY_BOOL_CAPS", { enumerable: true, get: function () { return telemetry_1.TELEMETRY_BOOL_CAPS; } });
Object.defineProperty(exports, "isProjectionTelemetryMessage", { enumerable: true, get: function () { return telemetry_1.isProjectionTelemetryMessage; } });
Object.defineProperty(exports, "desyncPhase", { enumerable: true, get: function () { return telemetry_1.desyncPhase; } });
//# sourceMappingURL=index.js.map