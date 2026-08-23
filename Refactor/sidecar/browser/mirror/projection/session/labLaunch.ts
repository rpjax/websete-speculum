import type { BrowserLaunchOptions } from '../../../BrowserSession';
import { LAB_VIEWPORT_POLICY } from '@speculum/page-projection/projected';
import { LAB_TELEMETRY_DEFAULTS } from '@speculum/page-projection/core/telemetry';

/** Fill Sessions Launch fields the lab/.NET Launch would supply so lab callers stay thin. */
export function labLaunchOptions(
  overrides: Partial<BrowserLaunchOptions> = {},
): BrowserLaunchOptions {
  return {
    width: overrides.width ?? 1280,
    height: overrides.height ?? 720,
    viewportPolicy: overrides.viewportPolicy ?? LAB_VIEWPORT_POLICY,
    screencastMaxEncodeScale: overrides.screencastMaxEncodeScale ?? 1,
    mirrorMode: overrides.mirrorMode ?? 'pageProjection',
    frameQueueCapacity: overrides.frameQueueCapacity ?? 8192,
    frameRateHz: overrides.frameRateHz ?? 60,
    projectionTelemetry: overrides.projectionTelemetry ?? { ...LAB_TELEMETRY_DEFAULTS },
    cpuProfiling: overrides.cpuProfiling ?? true,
    projectionDataPlane: overrides.projectionDataPlane ?? 'loopback',
    locale: overrides.locale ?? 'en-US',
    language: overrides.language ?? 'en-US',
    timeZoneId: overrides.timeZoneId ?? 'UTC',
    colorScheme: overrides.colorScheme ?? 'light',
  };
}
