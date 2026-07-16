import type { DiagnosticsOptions } from '@/lib/diagnosticsApi'
import { DIAGNOSTICS_PRESETS } from '@/lib/diagnosticsConstants'

export const sectionData: Record<string, unknown> = {
  Admin: { configured: true },
  Forwarding: {
    host: 'www.example.com',
    domains: ['example.com', '*.example.com'],
  },
  MaxSessions: 4,
  SessionPolicy: { ttlDays: 30 },
  JsBridge: { enable: false },
  Hosting: {
    acmeEmail: 'ops@example.com',
    profiles: [
      {
        domain: 'browse.example.com',
        acmeEmail: null,
        subdomainMirroringEnabled: true,
        edgeTls: { provider: 'cloudflare', email: 'cf@example.com', apiToken: '***' },
      },
      {
        domain: 'demo.example.com',
        acmeEmail: null,
        subdomainMirroringEnabled: false,
      },
    ],
  },
  Diagnostics: {
    enabled: true,
    profile: 'Production',
    domains: DIAGNOSTICS_PRESETS.Production.domains,
    telemetry: DIAGNOSTICS_PRESETS.Production.telemetry,
    storage: DIAGNOSTICS_PRESETS.Production.storage,
    sampling: DIAGNOSTICS_PRESETS.Production.sampling,
    elevate: { browserQueryMaxMinutes: 30 },
    probe: {
      diagTimeoutMs: 10_000,
      maxConcurrentProbesPerSession: 2,
      maxProbeResponseBytes: 512 * 1024,
      hostSampleIntervalMs: 1000,
    },
  } satisfies DiagnosticsOptions,
  ScriptInjection: [
    { scriptId: 'scr-001', url: null, position: 'HeaderTop', type: 'Classic' },
    { scriptId: null, url: 'https://cdn.example.com/analytics.js', position: 'BodyBottom', type: 'Module' },
  ],
}
