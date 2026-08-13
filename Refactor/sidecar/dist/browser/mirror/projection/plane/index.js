"use strict";
/**
 * Data-plane barrel — shared Chromium ↔ Sidecar mux types.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isPlaneEnvelope = exports.decodePlaneEnvelope = exports.encodePlaneEnvelope = exports.PLANE_HEADER_SIZE = exports.PLANE_VERSION = exports.PLANE_MAGIC = exports.planeChannelName = exports.PlaneChannel = void 0;
var channels_1 = require("./channels");
Object.defineProperty(exports, "PlaneChannel", { enumerable: true, get: function () { return channels_1.PlaneChannel; } });
Object.defineProperty(exports, "planeChannelName", { enumerable: true, get: function () { return channels_1.planeChannelName; } });
var envelope_1 = require("./envelope");
Object.defineProperty(exports, "PLANE_MAGIC", { enumerable: true, get: function () { return envelope_1.PLANE_MAGIC; } });
Object.defineProperty(exports, "PLANE_VERSION", { enumerable: true, get: function () { return envelope_1.PLANE_VERSION; } });
Object.defineProperty(exports, "PLANE_HEADER_SIZE", { enumerable: true, get: function () { return envelope_1.PLANE_HEADER_SIZE; } });
Object.defineProperty(exports, "encodePlaneEnvelope", { enumerable: true, get: function () { return envelope_1.encodePlaneEnvelope; } });
Object.defineProperty(exports, "decodePlaneEnvelope", { enumerable: true, get: function () { return envelope_1.decodePlaneEnvelope; } });
Object.defineProperty(exports, "isPlaneEnvelope", { enumerable: true, get: function () { return envelope_1.isPlaneEnvelope; } });
//# sourceMappingURL=index.js.map