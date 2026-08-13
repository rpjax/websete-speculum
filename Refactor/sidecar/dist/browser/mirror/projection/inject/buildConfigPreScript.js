"use strict";
/**
 * Builds the pre-script that assigns Virtual projection config on `globalThis`
 * before `virtual.js` runs.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildConfigPreScript = buildConfigPreScript;
const projectionConfig_1 = require("../virtual/config/projectionConfig");
/**
 * Returns a JS statement string suitable for `addInitScript` / CDP evaluate-on-new-document,
 * injected **before** the main Virtual bundle.
 */
function buildConfigPreScript(opts) {
    const transport = opts.transport ?? 'loopback';
    const dataPlaneUrl = (opts.dataPlaneUrl ?? '').trim();
    if (transport === 'loopback' && dataPlaneUrl.length === 0) {
        throw new Error('buildConfigPreScript: dataPlaneUrl is required when transport is "loopback"');
    }
    const payload = {
        transport,
    };
    if (dataPlaneUrl.length > 0)
        payload.dataPlaneUrl = dataPlaneUrl;
    if (opts.frameRateHz !== undefined)
        payload.frameRateHz = opts.frameRateHz;
    if (opts.bufferedAmountWatermark !== undefined) {
        payload.bufferedAmountWatermark = opts.bufferedAmountWatermark;
    }
    if (opts.maxFrameBytes !== undefined)
        payload.maxFrameBytes = opts.maxFrameBytes;
    if (opts.telemetry !== undefined)
        payload.telemetry = opts.telemetry;
    return `globalThis.${projectionConfig_1.PROJECTION_CONFIG_GLOBAL}=${JSON.stringify(payload)};`;
}
//# sourceMappingURL=buildConfigPreScript.js.map