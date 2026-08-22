"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.labLaunchOptions = labLaunchOptions;
const telemetry_1 = require("@speculum/page-projection/core/telemetry");
/** Fill Sessions Launch fields the lab/.NET Launch would supply so lab callers stay thin. */
function labLaunchOptions(overrides = {}) {
    return {
        width: overrides.width ?? 1280,
        height: overrides.height ?? 720,
        viewportPolicy: overrides.viewportPolicy ?? {
            minWidth: 100,
            minHeight: 100,
            maxWidth: 1920,
            maxHeight: 1080,
        },
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