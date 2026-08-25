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
    if (transport === 'loopback' && dataPlaneUrl.length === 0) {
        throw new Error('buildConfigPayload: dataPlaneUrl is required when transport is "loopback"');
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
    if (opts.generation !== undefined)
        payload.generation = opts.generation;
    if (opts.cssomPollHz !== undefined)
        payload.cssomPollHz = opts.cssomPollHz;
    return payload;
}
/**
 * Returns a JS statement string suitable for `addInitScript` / CDP evaluate-on-new-document,
 * injected **before** the main Virtual bundle.
 */
function buildConfigPreScript(opts) {
    const payload = buildConfigPayload(opts);
    // This runs as its own separate injected `<script>` tag (Patchright leaves it attached to
    // the document — see bootstrap.ts's matching `currentScript.remove()` for why that matters);
    // clean up after itself the same way, or `virtual.js`'s own removal of *its* tag still leaves
    // this smaller one behind for the observer to mirror as page content.
    return `globalThis.${projectionConfig_1.PROJECTION_CONFIG_GLOBAL}=${JSON.stringify(payload)};document.currentScript?.remove();`;
}
//# sourceMappingURL=buildConfigPreScript.js.map