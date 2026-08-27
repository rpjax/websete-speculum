"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.labLaunchOptions = labLaunchOptions;
const projected_1 = require("@speculum/page-projection/projected");
const telemetry_1 = require("@speculum/page-projection/core/telemetry");
/** Fill Sessions Launch fields the lab/.NET Launch would supply so lab callers stay thin. */
function labLaunchOptions(overrides = {}) {
    return {
        width: overrides.width ?? 1280,
        height: overrides.height ?? 720,
        viewportPolicy: overrides.viewportPolicy ?? projected_1.LAB_VIEWPORT_POLICY,
        screencastMaxEncodeScale: overrides.screencastMaxEncodeScale ?? 1,
        mirrorMode: overrides.mirrorMode ?? 'pageProjection',
        frameQueueCapacity: overrides.frameQueueCapacity ?? 8192,
        frameRateHz: overrides.frameRateHz ?? 60,
        projectionTelemetry: overrides.projectionTelemetry ?? { ...telemetry_1.LAB_TELEMETRY_DEFAULTS },
        cpuProfiling: overrides.cpuProfiling ?? true,
        projectionDataPlane: overrides.projectionDataPlane ?? 'loopback',
        locale: overrides.locale ?? 'en-US',
        language: overrides.language ?? 'en-US',
        timeZoneId: overrides.timeZoneId ?? 'UTC',
        colorScheme: overrides.colorScheme ?? 'light',
    };
}
//# sourceMappingURL=labLaunch.js.map