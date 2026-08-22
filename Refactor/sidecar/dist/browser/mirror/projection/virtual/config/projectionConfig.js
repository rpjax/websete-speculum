"use strict";
/**
 * Virtual runtime config — read once from the pre-script global, then frozen.
 *
 * Sidecar injects `buildConfigPreScript(...)` *before* `virtual.js`, which assigns
 * `globalThis.__SPECULUM_PROJECTION__`. This module does not read Node env.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROJECTION_CONFIG_GLOBAL = void 0;
exports.readProjectionConfig = readProjectionConfig;
exports.getProjectionConfig = getProjectionConfig;
exports.clearProjectionConfigCache = clearProjectionConfigCache;
const telemetry_1 = require("../../core/telemetry");
exports.PROJECTION_CONFIG_GLOBAL = '__SPECULUM_PROJECTION__';
const DEFAULTS = {
    transport: 'loopback',
    frameRateHz: 60,
    bufferedAmountWatermark: 256 * 1024,
    maxFrameBytes: 1 << 20,
    cssomPollHz: 0,
};
let cached;
function asPositiveNumber(value, fallback, label) {
    if (value === undefined || value === null)
        return fallback;
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`ProjectionConfig.${label} must be a positive number (got ${String(value)})`);
    }
    return n;
}
function asNonNegativeNumber(value, fallback, label) {
    if (value === undefined || value === null)
        return fallback;
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n) || n < 0) {
        throw new Error(`ProjectionConfig.${label} must be >= 0 (got ${String(value)})`);
    }
    return n;
}
function asTransport(value) {
    if (value === undefined || value === null)
        return DEFAULTS.transport;
    if (value === 'console' || value === 'loopback' || value === 'discard')
        return value;
    throw new Error(`ProjectionConfig.transport must be "console" | "loopback" | "discard" (got ${String(value)})`);
}
function asBool(value, fallback) {
    if (value === undefined || value === null)
        return fallback;
    if (typeof value === 'boolean')
        return value;
    throw new Error(`ProjectionConfig.telemetry field must be boolean (got ${String(value)})`);
}
function resolveTelemetry(raw) {
    if (raw === undefined || raw === null) {
        return { ...telemetry_1.DEFAULT_TELEMETRY_CONFIG };
    }
    if (typeof raw !== 'object') {
        throw new Error('ProjectionConfig.telemetry must be an object');
    }
    const bag = raw;
    const resolved = { ...telemetry_1.DEFAULT_TELEMETRY_CONFIG };
    for (const key of telemetry_1.TELEMETRY_BOOL_CAPS) {
        resolved[key] = asBool(bag[key], telemetry_1.DEFAULT_TELEMETRY_CONFIG[key]);
    }
    resolved.aggregateIntervalMs = asPositiveNumber(bag.aggregateIntervalMs, telemetry_1.DEFAULT_TELEMETRY_CONFIG.aggregateIntervalMs, 'telemetry.aggregateIntervalMs');
    return resolved;
}
/**
 * Reads `globalThis.__SPECULUM_PROJECTION__` once, validates, freezes.
 * Call from bootstrap before wiring collaborators.
 */
function readProjectionConfig() {
    if (cached !== undefined)
        return cached;
    const raw = globalThis.__SPECULUM_PROJECTION__;
    if (raw === undefined || raw === null || typeof raw !== 'object') {
        throw new Error(`ProjectionConfig missing: inject buildConfigPreScript() before virtual.js ` +
            `(expected globalThis.${exports.PROJECTION_CONFIG_GLOBAL})`);
    }
    const bag = raw;
    const transport = asTransport(bag.transport);
    const dataPlaneUrl = typeof bag.dataPlaneUrl === 'string' ? bag.dataPlaneUrl.trim() : '';
    if (transport === 'loopback' && dataPlaneUrl.length === 0) {
        throw new Error('ProjectionConfig.dataPlaneUrl is required when transport is "loopback"');
    }
    const resolved = {
        transport,
        dataPlaneUrl,
        frameRateHz: asPositiveNumber(bag.frameRateHz, DEFAULTS.frameRateHz, 'frameRateHz'),
        bufferedAmountWatermark: asPositiveNumber(bag.bufferedAmountWatermark, DEFAULTS.bufferedAmountWatermark, 'bufferedAmountWatermark'),
        maxFrameBytes: asPositiveNumber(bag.maxFrameBytes, DEFAULTS.maxFrameBytes, 'maxFrameBytes'),
        telemetry: Object.freeze(resolveTelemetry(bag.telemetry)),
        generation: asPositiveNumber(bag.generation, 1, 'generation'),
        cssomPollHz: asNonNegativeNumber(bag.cssomPollHz, DEFAULTS.cssomPollHz, 'cssomPollHz'),
    };
    cached = Object.freeze(resolved);
    return cached;
}
/** After {@link readProjectionConfig}; throws if not initialized. */
function getProjectionConfig() {
    if (cached === undefined) {
        throw new Error('ProjectionConfig not loaded — call readProjectionConfig() in bootstrap first');
    }
    return cached;
}
/** Test helper. */
function clearProjectionConfigCache() {
    cached = undefined;
}
//# sourceMappingURL=projectionConfig.js.map