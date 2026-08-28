import type {
  DiagnosticsCapability,
  DiagnosticsOptions,
  EffectiveCapabilities,
} from '@/lib/diagnosticsApi'

/**
 * Client-side projection of configured capabilities (no runtime overlays).
 * Mirrors DiagnosticsRuntime toggle resolution for UI preview only.
 */
export function resolveConfiguredCapabilities(config: DiagnosticsOptions): EffectiveCapabilities {
  if (!config.enabled) {
    return {
      MotorLive: { Metric: false, Event: false, Snapshot: false },
      SidecarBrowser: { Metric: false, Event: false },
      BrowserQuery: { Probe: false },
      PersistedSessions: { Snapshot: false },
      Telemetry: { Metric: false },
      DiagnosticsSelf: { Metric: false },
    }
  }

  return {
    MotorLive: {
      Metric: config.domains.motor.metrics,
      Event: config.domains.motor.events,
      Snapshot: config.domains.motor.snapshots,
    },
    SidecarBrowser: {
      Metric: config.domains.sidecar.metrics,
      Event: config.domains.sidecar.events,
    },
    BrowserQuery: {
      Probe: config.domains.browserQuery.probe,
    },
    PersistedSessions: {
      Snapshot: config.domains.persisted.snapshots,
    },
    Telemetry: {
      Metric: config.telemetry.enabled,
    },
    DiagnosticsSelf: {
      Metric: true,
    },
  }
}

/**
 * Apply Degraded (Metric-only) and Elevate (BrowserQuery + Sidecar force-on) overlays.
 * Elevate overrides Degraded for BrowserQuery and SidecarBrowser.
 */
export function applyRuntimeOverlays(
  base: EffectiveCapabilities,
  opts: { degraded: boolean; elevateActive: boolean },
): EffectiveCapabilities {
  const next: EffectiveCapabilities = {}

  for (const [domain, caps] of Object.entries(base)) {
    if (!opts.degraded) {
      next[domain] = { ...caps }
      continue
    }
    const projected: Partial<Record<DiagnosticsCapability, boolean>> = {}
    for (const key of Object.keys(caps ?? {}) as DiagnosticsCapability[]) {
      projected[key] = key === 'Metric'
    }
    next[domain] = projected
  }

  if (opts.elevateActive) {
    next.BrowserQuery = { ...(next.BrowserQuery ?? {}), Probe: true }
    next.SidecarBrowser = { Metric: true, Event: true }
  }

  return next
}

export function resolveEffectivePreview(
  config: DiagnosticsOptions,
  overlays: { degraded: boolean; elevateActive: boolean },
): EffectiveCapabilities {
  return applyRuntimeOverlays(resolveConfiguredCapabilities(config), overlays)
}

/** Whether a catalog event's domain+capability would be enabled under the given effective map. */
export function isCapabilityEffectivelyOn(
  effective: EffectiveCapabilities,
  domain: string,
  capability: string,
): boolean {
  return effective[domain]?.[capability as DiagnosticsCapability] === true
}

export type MismatchReason = 'degraded' | 'elevate' | 'config' | null

export function explainMismatch(
  configured: boolean,
  effective: boolean,
  overlays: { degraded: boolean; elevateActive: boolean },
): MismatchReason {
  if (configured === effective) return null
  if (overlays.degraded && configured && !effective) return 'degraded'
  if (overlays.elevateActive && !configured && effective) return 'elevate'
  return 'config'
}
