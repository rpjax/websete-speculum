"use strict";
/**
 * Builds the pre-script that assigns Virtual projection config on `globalThis`
 * before `virtual.js` runs.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildConfigPayload = buildConfigPayload;
exports.buildConfigPreScript = buildConfigPreScript;
const projectionConfig_1 = require("@speculum/page-projection/virtual/config/projectionConfig");
function buildConfigPayload(opts) {
    const transport = opts.transport ?? 'loopback';
    const dataPlaneUrl = (opts.dataPlaneUrl ?? '').trim();
    const sessionId = (opts.sessionId ?? '').trim();
    if (transport === 'loopback' && dataPlaneUrl.length === 0) {
        throw new Error('buildConfigPayload: dataPlaneUrl is required when transport is "loopback"');
    }
    if (transport === 'loopback' && sessionId.length === 0) {
        throw new Error('buildConfigPayload: sessionId is required when transport is "loopback"');
    }
    const loopbackCarrier = opts.loopbackCarrier ?? 'extension';
    if (loopbackCarrier !== 'extension') {
        throw new Error(`buildConfigPayload: loopbackCarrier must be "extension" (got ${String(loopbackCarrier)})`);
    }
    const planeBridgeToken = (opts.planeBridgeToken ?? '').trim();
    if (transport === 'loopback' && planeBridgeToken.length === 0) {
        throw new Error('buildConfigPayload: planeBridgeToken is required when transport is "loopback"');
    }
    const payload = {
        transport,
        loopbackCarrier,
    };
    if (sessionId.length > 0)
        payload.sessionId = sessionId;
    if (dataPlaneUrl.length > 0)
        payload.dataPlaneUrl = dataPlaneUrl;
    if (planeBridgeToken.length > 0)
        payload.planeBridgeToken = planeBridgeToken;
    if (opts.frameRateHz !== undefined)
        payload.frameRateHz = opts.frameRateHz;
    if (opts.bufferedAmountWatermark !== undefined) {
        payload.bufferedAmountWatermark = opts.bufferedAmountWatermark;
    }
    if (opts.maxFrameBytes !== undefined)
        payload.maxFrameBytes = opts.maxFrameBytes;
    if (opts.telemetry !== undefined)
        payload.telemetry = opts.telemetry;
    if (opts.generation !== undefined)
        payload.generation = opts.generation;
    if (opts.cssomPollHz !== undefined)
        payload.cssomPollHz = opts.cssomPollHz;
    if (opts.diagBoot === true)
        payload.diagBoot = true;
    return payload;
}
/**
 * Returns a JS statement string suitable for `addInitScript` / CDP evaluate-on-new-document,
 * injected **before** the main Virtual bundle.
 */
function buildConfigPreScript(opts) {
    const payload = buildConfigPayload(opts);
    return `globalThis.${projectionConfig_1.PROJECTION_CONFIG_GLOBAL}=${JSON.stringify(payload)};`;
}
//# sourceMappingURL=buildConfigPreScript.js.map