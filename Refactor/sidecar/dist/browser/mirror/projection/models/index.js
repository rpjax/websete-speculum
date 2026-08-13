"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isRepeatedConcat = exports.desyncPhase = exports.isProjectionTelemetryMessage = exports.CHILD_LIST_FACT_CAP = exports.TELEMETRY_BOOL_CAPS = exports.LAB_TELEMETRY_DEFAULTS = exports.DEFAULT_TELEMETRY_CONFIG = exports.TELEMETRY_WIRE_VERSION = exports.createLiveFrame = exports.FRAME_WIRE_VERSION = exports.opCodePlane = exports.opCodeName = exports.OpCode = exports.NONE_DOM_NODE_KEY = void 0;
/** Shared wire models — sidecar imports these to decode Virtual→host frames. */
var domNodeKey_1 = require("./domNodeKey");
Object.defineProperty(exports, "NONE_DOM_NODE_KEY", { enumerable: true, get: function () { return domNodeKey_1.NONE_DOM_NODE_KEY; } });
var opcodes_1 = require("./opcodes");
Object.defineProperty(exports, "OpCode", { enumerable: true, get: function () { return opcodes_1.OpCode; } });
Object.defineProperty(exports, "opCodeName", { enumerable: true, get: function () { return opcodes_1.opCodeName; } });
Object.defineProperty(exports, "opCodePlane", { enumerable: true, get: function () { return opcodes_1.opCodePlane; } });
var frame_1 = require("./frame");
Object.defineProperty(exports, "FRAME_WIRE_VERSION", { enumerable: true, get: function () { return frame_1.FRAME_WIRE_VERSION; } });
Object.defineProperty(exports, "createLiveFrame", { enumerable: true, get: function () { return frame_1.createLiveFrame; } });
var telemetry_1 = require("./telemetry");
Object.defineProperty(exports, "TELEMETRY_WIRE_VERSION", { enumerable: true, get: function () { return telemetry_1.TELEMETRY_WIRE_VERSION; } });
Object.defineProperty(exports, "DEFAULT_TELEMETRY_CONFIG", { enumerable: true, get: function () { return telemetry_1.DEFAULT_TELEMETRY_CONFIG; } });
Object.defineProperty(exports, "LAB_TELEMETRY_DEFAULTS", { enumerable: true, get: function () { return telemetry_1.LAB_TELEMETRY_DEFAULTS; } });
Object.defineProperty(exports, "TELEMETRY_BOOL_CAPS", { enumerable: true, get: function () { return telemetry_1.TELEMETRY_BOOL_CAPS; } });
Object.defineProperty(exports, "CHILD_LIST_FACT_CAP", { enumerable: true, get: function () { return telemetry_1.CHILD_LIST_FACT_CAP; } });
Object.defineProperty(exports, "isProjectionTelemetryMessage", { enumerable: true, get: function () { return telemetry_1.isProjectionTelemetryMessage; } });
Object.defineProperty(exports, "desyncPhase", { enumerable: true, get: function () { return telemetry_1.desyncPhase; } });
Object.defineProperty(exports, "isRepeatedConcat", { enumerable: true, get: function () { return telemetry_1.isRepeatedConcat; } });
//# sourceMappingURL=index.js.map