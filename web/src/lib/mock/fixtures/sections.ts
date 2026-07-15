import type { DiagnosticsOptions } from '@/lib/diagnosticsApi'

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
    domains: {
      motor: { metrics: true, events: true, snapshots: true },
      sidecar: { metrics: true, events: false },
      browserQuery: { probe: false },
      persisted: { snapshots: true },
    },
    telemetry: {
      enabled: true,
      intervalSeconds: 30,
      host: { enabled: true },
      motor: { enabled: true, includeSessionIds: false, includePerSession: false, includeUrlHost: false },
      sidecar: { enabled: true, includeFaultedIds: false },
      persistence: { enabled: true, includeBytes: false },
      pipeline: { enabled: true, includeBreakerPressure: false },
    },
    storage: {
      maxBytes: 64 * 1024 * 1024,
      maxEventsPerSession: 5000,
      ttlHours: 24,
      overflow: 'DropOldest',
    },
    sampling: { statusMirrorRatio: 1, expensiveEventRatio: 0.25 },
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
