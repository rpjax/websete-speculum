import type {
  DiagnosticsOverview,
  DiagnosticsRuntimeSnapshot,
  DiagnosticsEventRecord,
  DiagnosticsCatalogResponse,
  MotorSessionListItem,
  MotorSessionDiagnosticsSnapshot,
  BrowserProbeResponse,
  HostTelemetry,
  TelemetrySample,
  TelemetrySampleRecord,
} from '@/lib/diagnosticsApi'

const now = new Date().toISOString()
const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString()

const STORAGE_MAX_BYTES = 16 * 1024 * 1024 * 1024

const effectiveCapabilities = {
  MotorLive: { Metric: true, Event: true, Snapshot: true },
  SidecarBrowser: { Metric: true, Event: true },
  BrowserQuery: { Probe: false },
  PersistedSessions: { Snapshot: true },
  Telemetry: { Metric: true },
  DiagnosticsSelf: { Metric: true },
}

export const overview: DiagnosticsOverview = {
  diagnosticsSchemaVersion: 1,
  enabled: true,
  degraded: false,
  elevate: null,
  bytesUsed: 12_582_912,
  storageMaxBytes: STORAGE_MAX_BYTES,
  eventsStored: 347,
  eventsDropped: 0,
  overflowCount: 0,
  probeInFlight: 0,
  lastCleanupUtc: fiveMinAgo,
  redactionMode: 'none',
  effectiveCapabilities,
  liveSessions: { activeCount: 2, startingCount: 0, total: 2 },
  needsAttention: [],
}

export const degradedOverview: DiagnosticsOverview = {
  ...overview,
  degraded: true,
  needsAttention: [
    'Diagnostics circuit is degraded — probes may be capped. Use Recover.',
  ],
}

export const runtime: DiagnosticsRuntimeSnapshot = {
  diagnosticsSchemaVersion: 1,
  enabled: true,
  effectiveCapabilities,
  elevate: null,
  degraded: false,
  bytesUsed: overview.bytesUsed,
  storageMaxBytes: STORAGE_MAX_BYTES,
  eventsStored: overview.eventsStored,
  eventsDropped: 0,
  overflowCount: 0,
  probeInFlight: 0,
  lastCleanupUtc: fiveMinAgo,
  redactionMode: 'none',
}

const conn1 = 'conn-aaaa-1111-2222-3333-444444444444'
const conn2 = 'conn-bbbb-5555-6666-7777-888888888888'
const conn3 = 'conn-cccc-9999-0000-1111-222222222222'

const corrSessionLifecycle1 = 'corr-sess-lc-001'
const corrSessionLifecycle2 = 'corr-sess-lc-002'
const corrNavigate1 = 'corr-nav-001'
const corrNavigate2 = 'corr-nav-002'
const corrProbe1 = 'corr-probe-001'
const corrExport1 = 'corr-export-001'
const corrAdmin1 = 'corr-admin-001'
const corrAdmin2 = 'corr-admin-002'

export const liveSessions: MotorSessionListItem[] = [
  {
    connectionId: conn1,
    persistedSessionId: 'sess-a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    sidecarSessionId: 'sc-111-222',
    phase: 'Running',
    currentUrl: 'https://www.example.com/products',
    starting: false,
    fps: 28,
    uptimeMs: 245_000,
  },
  {
    connectionId: conn2,
    persistedSessionId: null,
    sidecarSessionId: 'sc-333-444',
    phase: 'Running',
    currentUrl: 'https://demo.example.com/',
    starting: false,
    fps: 12,
    uptimeMs: 620_000,
  },
  {
    connectionId: conn3,
    persistedSessionId: 'sess-x9y8z7w6-v5u4-3210-fedc-ba9876543210',
    sidecarSessionId: 'sc-555-666',
    phase: 'Starting',
    currentUrl: '',
    starting: true,
    fps: 0,
    uptimeMs: 3_000,
  },
]

export function sessionSnapshot(connectionId: string): MotorSessionDiagnosticsSnapshot {
  const sess = liveSessions.find((s) => s.connectionId === connectionId) ?? liveSessions[0]
  return {
    connectionId: sess.connectionId,
    persistedSessionId: sess.persistedSessionId,
    sidecarSessionId: sess.sidecarSessionId,
    clientToken: 'ctkn-aaaa-bbbb-cccc-dddd-eeeeeeee',
    correlationId: corrSessionLifecycle1,
    phase: sess.phase,
    startedAt: fiveMinAgo,
    uptimeMs: 300_000,
    lastEventUtc: now,
    fps: 24,
    frameSequence: 7200,
    lastFrameUtc: now,
    inputQueueApprox: 0,
    currentUrl: sess.currentUrl,
    lastNavigateResult: 'ok',
    lastNavigateUtc: now,
    sidecarConnected: true,
    lastFault: null,
    exportingState: false,
    forwardingHost: 'www.example.com',
    jsBridgeEnabled: false,
    scriptCount: 2,
    allowlistCount: 2,
    profileDomain: 'browse.example.com',
  }
}

let eventIdSeq = 0
function eid(): string {
  eventIdSeq++
  return `evt-mock-${String(eventIdSeq).padStart(6, '0')}`
}
function ago(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString()
}

export function eventsList(): DiagnosticsEventRecord[] {
  const events: DiagnosticsEventRecord[] = [
    // --- Session lifecycle story for conn1 (6 events, correlated; motor.session span still open) ---
    { diagnosticsSchemaVersion: 2, seq: 1, spanId: 'span-sess-1', spanKey: 'motor.session', id: eid(), utc: ago(12), domain: 'MotorLive', name: 'Motor.SessionStarting', severity: 'Info', correlationId: corrSessionLifecycle1, connectionId: conn1, persistedSessionId: 'sess-a1b2c3d4-e5f6-7890-abcd-ef1234567890', sidecarSessionId: 'sc-111-222', payload: { restored: false }, redaction: 'none' },
    { diagnosticsSchemaVersion: 2, seq: 2, causationId: 'span-sess-1', id: eid(), utc: ago(11.8), domain: 'MotorLive', name: 'Motor.SessionResolved', severity: 'Info', correlationId: corrSessionLifecycle1, connectionId: conn1, persistedSessionId: 'sess-a1b2c3d4-e5f6-7890-abcd-ef1234567890', sidecarSessionId: 'sc-111-222', payload: { slotIndex: 0 }, redaction: 'none' },
    { diagnosticsSchemaVersion: 2, seq: 3, causationId: 'span-sess-1', id: eid(), utc: ago(11.5), domain: 'MotorLive', name: 'Motor.SlotAcquired', severity: 'Info', correlationId: corrSessionLifecycle1, connectionId: conn1, persistedSessionId: null, sidecarSessionId: 'sc-111-222', payload: { slotIndex: 0, totalSlots: 5 }, redaction: 'none' },
    { diagnosticsSchemaVersion: 2, seq: 4, causationId: 'span-sess-1', id: eid(), utc: ago(11.2), domain: 'MotorLive', name: 'Motor.SidecarConnected', severity: 'Info', correlationId: corrSessionLifecycle1, connectionId: conn1, persistedSessionId: null, sidecarSessionId: 'sc-111-222', payload: { sidecarSessionId: 'sc-111-222' }, redaction: 'none' },
    { diagnosticsSchemaVersion: 2, seq: 5, causationId: 'span-sess-1', id: eid(), utc: ago(11), domain: 'MotorLive', name: 'Motor.SessionPromoted', severity: 'Info', correlationId: corrSessionLifecycle1, connectionId: conn1, persistedSessionId: null, sidecarSessionId: 'sc-111-222', payload: { fps: 24 }, redaction: 'none' },
    { diagnosticsSchemaVersion: 2, seq: 6, causationId: 'span-sess-1', id: eid(), utc: ago(10.8), domain: 'MotorLive', name: 'Motor.SessionStarted', severity: 'Info', correlationId: corrSessionLifecycle1, connectionId: conn1, persistedSessionId: 'sess-a1b2c3d4-e5f6-7890-abcd-ef1234567890', sidecarSessionId: 'sc-111-222', payload: { restored: true, cookieCount: 12, persistedSessionId: 'sess-a1b2c3d4-e5f6-7890-abcd-ef1234567890' }, redaction: 'none' },

    // --- Session lifecycle story for conn2 (3 events; motor.session span still open) ---
    { diagnosticsSchemaVersion: 2, seq: 7, spanId: 'span-sess-2', spanKey: 'motor.session', id: eid(), utc: ago(8), domain: 'MotorLive', name: 'Motor.SessionStarting', severity: 'Info', correlationId: corrSessionLifecycle2, connectionId: conn2, persistedSessionId: null, sidecarSessionId: 'sc-333-444', payload: { restored: false }, redaction: 'none' },
    { diagnosticsSchemaVersion: 2, seq: 8, causationId: 'span-sess-2', id: eid(), utc: ago(7.5), domain: 'MotorLive', name: 'Motor.SidecarConnected', severity: 'Info', correlationId: corrSessionLifecycle2, connectionId: conn2, persistedSessionId: null, sidecarSessionId: 'sc-333-444', payload: { sidecarSessionId: 'sc-333-444' }, redaction: 'none' },
    { diagnosticsSchemaVersion: 2, seq: 9, causationId: 'span-sess-2', id: eid(), utc: ago(7), domain: 'MotorLive', name: 'Motor.SessionStarted', severity: 'Info', correlationId: corrSessionLifecycle2, connectionId: conn2, persistedSessionId: null, sidecarSessionId: 'sc-333-444', payload: { restored: false, cookieCount: 0 }, redaction: 'none' },

    // --- Diagnostics circuit trip aligned with telemetry degraded window (~4.7h ago) ---
    { diagnosticsSchemaVersion: 1, id: eid(), utc: ago(4.7), domain: 'DiagnosticsSelf', name: 'Diagnostics.Degraded', severity: 'Warning', correlationId: 'corr-degraded-tele', connectionId: null, persistedSessionId: null, sidecarSessionId: null, payload: { reason: 'breaker_pressure', recentDrops: 8 }, redaction: 'none' },
    { diagnosticsSchemaVersion: 1, id: eid(), utc: ago(4.45), domain: 'DiagnosticsSelf', name: 'Diagnostics.StorageOverflow', severity: 'Warning', correlationId: 'corr-degraded-tele', connectionId: null, persistedSessionId: null, sidecarSessionId: null, payload: { overflowCount: 3 }, redaction: 'none' },
    { diagnosticsSchemaVersion: 1, id: eid(), utc: ago(4.4), domain: 'DiagnosticsSelf', name: 'Diagnostics.Recovered', severity: 'Info', correlationId: 'corr-degraded-tele', connectionId: null, persistedSessionId: null, sidecarSessionId: null, payload: { degradedDurationMs: 900_000 }, redaction: 'none' },

    // --- Elevate window aligned with telemetry elevateActive (~2.7h ago) ---
    { diagnosticsSchemaVersion: 1, id: eid(), utc: ago(2.7), domain: 'DiagnosticsSelf', name: 'Diagnostics.ElevateStarted', severity: 'Info', correlationId: 'corr-elevate-tele', connectionId: null, persistedSessionId: null, sidecarSessionId: null, payload: { minutes: 15 }, redaction: 'none' },
    { diagnosticsSchemaVersion: 1, id: eid(), utc: ago(2.55), domain: 'DiagnosticsSelf', name: 'Diagnostics.ElevateExpired', severity: 'Info', correlationId: 'corr-elevate-tele', connectionId: null, persistedSessionId: null, sidecarSessionId: null, payload: {}, redaction: 'none' },

    // --- Navigation story for conn1 (3 events; motor.navigate span closed cleanly) ---
    { diagnosticsSchemaVersion: 2, seq: 10, spanId: 'span-nav-1', spanKey: 'motor.navigate', id: eid(), utc: ago(6), domain: 'MotorLive', name: 'Motor.NavigateRequested', severity: 'Info', correlationId: corrNavigate1, connectionId: conn1, persistedSessionId: null, sidecarSessionId: null, payload: { targetUrl: 'https://www.example.com/products' }, redaction: 'none' },
    { diagnosticsSchemaVersion: 2, seq: 11, causationId: 'span-nav-1', id: eid(), utc: ago(5.8), domain: 'MotorLive', name: 'Motor.UrlMapped', severity: 'Info', correlationId: corrNavigate1, connectionId: conn1, persistedSessionId: null, sidecarSessionId: null, payload: { originalUrl: 'https://www.example.com/products', mappedUrl: 'https://www.example.com/products' }, redaction: 'none' },
    { diagnosticsSchemaVersion: 2, seq: 12, spanId: 'span-nav-1', spanKey: 'motor.navigate', id: eid(), utc: ago(5.5), domain: 'MotorLive', name: 'Motor.NavigateCompleted', severity: 'Info', correlationId: corrNavigate1, connectionId: conn1, persistedSessionId: null, sidecarSessionId: null, payload: { url: 'https://www.example.com/products', durationMs: 340 }, redaction: 'none' },

    // --- conn2 navigation failures: a pre-target build block (standalone beat, nests under the
    //     session via causationId) then a built-but-rejected send (motor.navigate span, warning close) ---
    { diagnosticsSchemaVersion: 2, seq: 13, causationId: 'span-sess-2', id: eid(), utc: ago(4), domain: 'MotorLive', name: 'Motor.NavigateBlocked', severity: 'Warning', correlationId: corrNavigate2, connectionId: conn2, persistedSessionId: null, sidecarSessionId: null, payload: { clientUrl: 'https://blocked.example.com/', errorCode: 'url_blocked', phase: 'build_target' }, redaction: 'none' },
    { diagnosticsSchemaVersion: 2, seq: 14, spanId: 'span-nav-2', spanKey: 'motor.navigate', id: eid(), utc: ago(3.9), domain: 'MotorLive', name: 'Motor.NavigateRequested', severity: 'Info', correlationId: corrNavigate2, connectionId: conn2, persistedSessionId: null, sidecarSessionId: null, payload: { targetUrl: 'https://app.example.com/checkout' }, redaction: 'none' },
    { diagnosticsSchemaVersion: 2, seq: 15, spanId: 'span-nav-2', spanKey: 'motor.navigate', id: eid(), utc: ago(3.8), domain: 'MotorLive', name: 'Motor.NavigateRejected', severity: 'Warning', correlationId: corrNavigate2, connectionId: conn2, persistedSessionId: null, sidecarSessionId: null, payload: { clientUrl: 'https://app.example.com/checkout', targetUrl: 'https://app.example.com/checkout', errorCode: 'navigate_rejected', phase: 'navigate' }, redaction: 'none' },

    // --- Probe story for conn1 (2 events, sidecar domain; sidecar.probe span closed) ---
    { diagnosticsSchemaVersion: 2, seq: 16, spanId: 'span-probe-1', spanKey: 'sidecar.probe', id: eid(), utc: ago(3), domain: 'SidecarBrowser', name: 'Sidecar.DiagProbeRequested', severity: 'Info', correlationId: corrProbe1, connectionId: conn1, persistedSessionId: null, sidecarSessionId: 'sc-111-222', payload: { ops: ['process', 'tabs', 'resources'] }, redaction: 'none' },
    { diagnosticsSchemaVersion: 2, seq: 17, spanId: 'span-probe-1', spanKey: 'sidecar.probe', id: eid(), utc: ago(2.8), domain: 'SidecarBrowser', name: 'Sidecar.DiagProbeCompleted', severity: 'Info', correlationId: corrProbe1, connectionId: conn1, persistedSessionId: null, sidecarSessionId: 'sc-111-222', payload: { ops: ['process', 'tabs', 'resources'], durationMs: 120 }, redaction: 'none' },

    // --- Admin action: elevate (2 events, diagnostics domain) ---
    { diagnosticsSchemaVersion: 1, id: eid(), utc: ago(2.5), domain: 'DiagnosticsSelf', name: 'Diagnostics.ElevateStarted', severity: 'Info', correlationId: corrAdmin1, connectionId: null, persistedSessionId: null, sidecarSessionId: null, payload: { minutes: 15 }, redaction: 'none' },
    { diagnosticsSchemaVersion: 1, id: eid(), utc: ago(2.3), domain: 'DiagnosticsSelf', name: 'Diagnostics.ConfigApplied', severity: 'Info', correlationId: corrAdmin1, connectionId: null, persistedSessionId: null, sidecarSessionId: null, payload: { section: 'Diagnostics', source: 'ElevateAction' }, redaction: 'none' },

    // --- State export story (2 events; motor.export span closed) ---
    { diagnosticsSchemaVersion: 2, seq: 19, spanId: 'span-exp-1', spanKey: 'motor.export', id: eid(), utc: ago(2), domain: 'MotorLive', name: 'Motor.StateExportStarted', severity: 'Info', correlationId: corrExport1, connectionId: conn1, persistedSessionId: 'sess-a1b2c3d4-e5f6-7890-abcd-ef1234567890', sidecarSessionId: 'sc-111-222', payload: {}, redaction: 'none' },
    { diagnosticsSchemaVersion: 2, seq: 20, spanId: 'span-exp-1', spanKey: 'motor.export', id: eid(), utc: ago(1.8), domain: 'PersistedSessions', name: 'Persistence.StateExportCompleted', severity: 'Info', correlationId: corrExport1, connectionId: conn1, persistedSessionId: 'sess-a1b2c3d4-e5f6-7890-abcd-ef1234567890', sidecarSessionId: 'sc-111-222', payload: { cookieCount: 12, localStorageCount: 4 }, redaction: 'none' },

    // --- Capacity refusal + abandoned span (schema v2 span demos) ---
    { diagnosticsSchemaVersion: 2, seq: 21, spanId: 'span-sess-3', spanKey: 'motor.session', id: eid(), utc: ago(1.6), domain: 'MotorLive', name: 'Motor.SessionRefused', severity: 'Warning', correlationId: 'corr-refused-1', connectionId: 'conn-refused-1', persistedSessionId: null, sidecarSessionId: null, payload: { errorCode: 'session_limit', phase: 'acquire_slot', maxSessions: 4, activeCount: 4, startingCount: 0 }, redaction: 'none' },
    { diagnosticsSchemaVersion: 2, seq: 22, spanId: 'span-nav-abandon', spanKey: 'motor.navigate', causationId: 'span-sess-2', id: eid(), utc: ago(1.55), domain: 'MotorLive', name: 'Motor.NavigateRequested', severity: 'Info', correlationId: corrSessionLifecycle2, connectionId: conn2, persistedSessionId: null, sidecarSessionId: 'sc-333-444', payload: { targetUrl: 'https://slow.example.com/' }, redaction: 'none' },
    { diagnosticsSchemaVersion: 2, seq: 23, spanId: 'span-nav-abandon', spanKey: 'motor.navigate', id: eid(), utc: ago(1.4), domain: 'DiagnosticsSelf', name: 'Diagnostics.SpanAbandoned', severity: 'Warning', correlationId: corrSessionLifecycle2, connectionId: conn2, persistedSessionId: null, sidecarSessionId: 'sc-333-444', payload: { spanKey: 'motor.navigate', errorCode: 'span_timeout', phase: 'timeout', openMs: 60_000 }, redaction: 'none' },

    // --- Per-session telemetry slice scoped to conn1's story lane ---
    { diagnosticsSchemaVersion: 2, seq: 24, id: eid(), utc: ago(1), domain: 'Telemetry', name: 'Telemetry.SessionSampleCollected', severity: 'Info', correlationId: corrSessionLifecycle1, connectionId: conn1, persistedSessionId: null, sidecarSessionId: 'sc-111-222', payload: { connectionId: conn1, phase: 'Running', fps: 24, uptimeMs: 660_000, inputQueue: 0, sidecarConnected: true, jsBridgeEnabled: false, urlHost: 'www.example.com' }, redaction: 'none' },

    // --- Cleanup event (system, no correlation) ---
    { diagnosticsSchemaVersion: 1, id: eid(), utc: ago(1.5), domain: 'DiagnosticsSelf', name: 'Diagnostics.CleanupCompleted', severity: 'Info', correlationId: null, connectionId: null, persistedSessionId: null, sidecarSessionId: null, payload: { purgedCount: 12, bytesFreed: 1_048_576 }, redaction: 'none' },

    // --- Sidecar screencast metric (uncorrelated, for conn1) ---
    { diagnosticsSchemaVersion: 1, id: eid(), utc: ago(0.5), domain: 'SidecarBrowser', name: 'Sidecar.ScreencastFrame', severity: 'Metric', correlationId: null, connectionId: conn1, persistedSessionId: null, sidecarSessionId: 'sc-111-222', payload: { fps: 24, frameSequence: 7200 }, redaction: 'none' },

    // --- Admin recovery action (2 events) ---
    { diagnosticsSchemaVersion: 1, id: eid(), utc: ago(0.3), domain: 'DiagnosticsSelf', name: 'Diagnostics.RecoverRequested', severity: 'Warning', correlationId: corrAdmin2, connectionId: null, persistedSessionId: null, sidecarSessionId: null, payload: { reason: 'Manual admin action' }, redaction: 'none' },
    { diagnosticsSchemaVersion: 1, id: eid(), utc: ago(0.2), domain: 'DiagnosticsSelf', name: 'Diagnostics.Recovered', severity: 'Info', correlationId: corrAdmin2, connectionId: null, persistedSessionId: null, sidecarSessionId: null, payload: { degradedDurationMs: 120_000 }, redaction: 'none' },

    // --- Error event: probe timeout (uncorrelated) ---
    { diagnosticsSchemaVersion: 1, id: eid(), utc: ago(0.1), domain: 'SidecarBrowser', name: 'Sidecar.DiagProbeTimedOut', severity: 'Error', correlationId: null, connectionId: conn2, persistedSessionId: null, sidecarSessionId: 'sc-333-444', payload: { errorCode: 'probe_timeout', phase: 'Execution', ops: ['cookies'], diagTimeoutMs: 10_000 }, redaction: 'none' },
  ]

  return events.sort((a, b) => b.utc.localeCompare(a.utc))
}

export const catalog: DiagnosticsCatalogResponse = {
  diagnosticsSchemaVersion: 2,
  events: [
    { name: 'Motor.SessionStarting', domain: 'MotorLive', capability: 'Metric', persist: true, spanRole: 'Open', spanKey: 'motor.session', spanTimeoutSec: 0 },
    { name: 'Motor.SessionStarted', domain: 'MotorLive', capability: 'Metric', persist: true },
    { name: 'Motor.SessionResolved', domain: 'MotorLive', capability: 'Metric', persist: true },
    { name: 'Motor.SessionStopped', domain: 'MotorLive', capability: 'Metric', persist: true, spanRole: 'Close', spanKey: 'motor.session', spanTimeoutSec: 0 },
    { name: 'Motor.SessionRefused', domain: 'MotorLive', capability: 'Metric', persist: true, spanRole: 'Close', spanKey: 'motor.session', spanTimeoutSec: 0 },
    { name: 'Motor.NavigateRequested', domain: 'MotorLive', capability: 'Metric', persist: true, spanRole: 'Open', spanKey: 'motor.navigate', spanTimeoutSec: 60 },
    { name: 'Motor.NavigateCompleted', domain: 'MotorLive', capability: 'Metric', persist: true, spanRole: 'Close', spanKey: 'motor.navigate', spanTimeoutSec: 0 },
    { name: 'Motor.NavigateRejected', domain: 'MotorLive', capability: 'Metric', persist: true, spanRole: 'Close', spanKey: 'motor.navigate', spanTimeoutSec: 0 },
    { name: 'Motor.NavigateBlocked', domain: 'MotorLive', capability: 'Metric', persist: true },
    { name: 'Motor.UrlMapped', domain: 'MotorLive', capability: 'Metric', persist: true },
    { name: 'Motor.StateExportRequested', domain: 'MotorLive', capability: 'Metric', persist: true, spanRole: 'Open', spanKey: 'motor.export', spanTimeoutSec: 60 },
    { name: 'Motor.StateExportCompleted', domain: 'MotorLive', capability: 'Metric', persist: true, spanRole: 'Close', spanKey: 'motor.export', spanTimeoutSec: 0 },
    { name: 'Sidecar.DiagProbeRequested', domain: 'SidecarBrowser', capability: 'Metric', persist: true, spanRole: 'Open', spanKey: 'sidecar.probe', spanTimeoutSec: 30 },
    { name: 'Sidecar.DiagProbeCompleted', domain: 'SidecarBrowser', capability: 'Metric', persist: true, spanRole: 'Close', spanKey: 'sidecar.probe', spanTimeoutSec: 0 },
    { name: 'Sidecar.DiagProbeTimedOut', domain: 'SidecarBrowser', capability: 'Metric', persist: true, spanRole: 'Close', spanKey: 'sidecar.probe', spanTimeoutSec: 0 },
    { name: 'Diagnostics.ConfigApplied', domain: 'DiagnosticsSelf', capability: 'Metric', persist: true },
    { name: 'Diagnostics.Degraded', domain: 'DiagnosticsSelf', capability: 'Metric', persist: true },
    { name: 'Diagnostics.Recovered', domain: 'DiagnosticsSelf', capability: 'Metric', persist: true },
    { name: 'Diagnostics.ElevateStarted', domain: 'DiagnosticsSelf', capability: 'Metric', persist: true },
    { name: 'Diagnostics.SpanAbandoned', domain: 'DiagnosticsSelf', capability: 'Metric', persist: true, spanRole: 'Close', spanTimeoutSec: 0 },
    { name: 'Telemetry.SampleCollected', domain: 'Telemetry', capability: 'Metric', persist: true },
  ],
}

export function probeResult(ops: string[]): BrowserProbeResponse {
  const data: Record<string, unknown> = {}
  if (ops.includes('process')) data.process = { pid: 12345, type: 'browser' }
  if (ops.includes('tabs')) data.tabs = [
    { id: 1, url: 'https://www.example.com/', title: 'Example' },
    { id: 2, url: 'about:blank', title: '' },
  ]
  if (ops.includes('cookies')) data.cookies = [
    { name: '_ga', domain: '.example.com', value: 'GA1.2.12345.67890' },
    { name: 'session_id', domain: 'www.example.com', value: 'abc123def456' },
    { name: '_fbp', domain: '.example.com', value: 'fb.1.1234567890.123456' },
  ]
  if (ops.includes('storage')) data.localStorage = [
    { origin: 'https://www.example.com', keys: 5, estimatedBytes: 2048 },
  ]
  if (ops.includes('resources')) data.resources = { jsHeapUsed: 45_000_000, jsHeapTotal: 67_000_000 }
  if (ops.includes('evaluate')) data.evaluate = 'Example Home'
  if (ops.includes('dom')) data.dom = { outerHTML: '<body class="loaded"><div id="app">…</div></body>' }
  if (ops.includes('export')) data.export = { triggered: true }
  return { ok: true, correlationId: 'corr-probe-mock', data, redaction: 'none' }
}

export const hostSample: HostTelemetry = {
  hostname: 'speculum-motor-01',
  uptimeSec: 86_400,
  cpuUsage: 12.4,
  memoryUsed: 512_000_000,
  memoryPrivate: 480_000_000,
  memoryTotal: 2_048_000_000,
  gcHeap: 180_000_000,
  gcGen0: 150,
  gcGen1: 30,
  gcGen2: 5,
  threadCount: 24,
  threadPoolBusy: 3,
  threadPoolQueued: 0,
  diskFreeBytes: 10_000_000_000,
}

export const persistedList = [
  {
    sessionId: 'sess-a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    createdAt: fiveMinAgo,
    updatedAt: now,
    expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    clientToken: 'ctkn-aaaa-bbbb-cccc-dddd-eeeeeeee',
    cookieCount: 12,
    localStorageCount: 4,
    idbRecordCount: 2,
    historyCount: 7,
  },
  {
    sessionId: 'sess-x9y8z7w6-v5u4-3210-fedc-ba9876543210',
    createdAt: new Date(Date.now() - 60 * 60_000).toISOString(),
    updatedAt: new Date(Date.now() - 30 * 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 6 * 86_400_000).toISOString(),
    clientToken: 'ctkn-xxxx-yyyy-zzzz-wwww-vvvvvvvv',
    cookieCount: 5,
    localStorageCount: 1,
    idbRecordCount: 0,
    historyCount: 3,
  },
]

/* ── Telemetry history (composite Telemetry.SampleCollected series) ──
 * The story we tell in the explorer: host CPU/memory should scale roughly
 * LINEARLY with the number of live motor sessions. We inject three named
 * NON-LINEAR anomaly windows so the Insights panel + divergence detector have
 * real signal to surface:
 *   A) leak      — resource climbs while live sessions stay flat
 *   B) efficiency — live sessions climb while CPU stays flat (batching win)
 *   C) regression — per-session CPU cost rises super-linearly under load
 */
const TELEMETRY_COUNT = 360 // 6h @ 1min
const TELEMETRY_INTERVAL_MIN = 1
const MB = 1024 * 1024

const IDLE_CPU = 5.5 // % floor with zero sessions
const CPU_PER_SESSION = 3.4 // % per live session (linear baseline)
const IDLE_MEM_MB = 430
const MEM_PER_SESSION_MB = 27
const CAPACITY_MAX = 25

interface AnomalyWindow {
  from: number
  to: number
  kind: 'leak' | 'efficiency' | 'regression'
}
const ANOMALIES: AnomalyWindow[] = [
  { from: 70, to: 92, kind: 'leak' },
  { from: 165, to: 190, kind: 'efficiency' },
  { from: 250, to: 275, kind: 'regression' },
]

function sessionCurve(t: number): number {
  // Smooth multi-harmonic daily-ish load, clamped to [0, CAPACITY_MAX].
  const base = 8 + 5 * Math.sin(t / 34) + 3.5 * Math.sin(t / 12 + 1.3) + 1.5 * Math.sin(t / 5)
  return Math.max(0, Math.min(CAPACITY_MAX, Math.round(base)))
}

let telemetryCache: TelemetrySampleRecord[] | null = null

export function telemetrySamples(): TelemetrySampleRecord[] {
  if (telemetryCache) return telemetryCache
  const out: TelemetrySampleRecord[] = []
  const start = Date.now() - TELEMETRY_COUNT * TELEMETRY_INTERVAL_MIN * 60_000
  let idSeq = 0

  for (let t = 0; t <= TELEMETRY_COUNT; t++) {
    const utc = new Date(start + t * TELEMETRY_INTERVAL_MIN * 60_000).toISOString()

    let live = sessionCurve(t)
    let cpuMultiplier = 1
    let memBonusMb = 0
    let cpuBonusPct = 0

    const anomaly = ANOMALIES.find((a) => t >= a.from && t <= a.to)
    if (anomaly) {
      const progress = (t - anomaly.from) / Math.max(1, anomaly.to - anomaly.from)
      if (anomaly.kind === 'leak') {
        // Freeze sessions near the window's entry level; ramp CPU + memory.
        live = sessionCurve(anomaly.from)
        cpuBonusPct = 22 * progress
        memBonusMb = 340 * progress
      } else if (anomaly.kind === 'efficiency') {
        // Sessions ramp toward capacity; CPU held near the entry level (batching).
        live = Math.min(CAPACITY_MAX, sessionCurve(anomaly.from) + Math.round(progress * 12))
        cpuMultiplier = 0.42
      } else {
        // Regression: per-session cost balloons — cpu grows with live².
        cpuMultiplier = 1 + progress * 1.6
      }
    }

    const noise = (seed: number) => (Math.sin(t * 12.9898 + seed) * 43_758.5453) % 1
    const cpuNoise = Math.abs(noise(1)) * 3 - 1.5
    const memNoise = Math.abs(noise(2)) * 14 - 7

    const cpu = clamp(
      (IDLE_CPU + live * CPU_PER_SESSION) * cpuMultiplier + cpuBonusPct + cpuNoise,
      0.5,
      99,
    )
    const memMb = clamp(IDLE_MEM_MB + live * MEM_PER_SESSION_MB + memBonusMb + memNoise, 300, 1950)
    const memBytes = Math.round(memMb) * MB
    const threads = 20 + Math.round(live * 1.6) + (cpu > 55 ? 5 : 0)
    const starting = live > 0 && t % 17 === 0 ? 1 : 0
    const avgFps = Math.max(6, 30 - live * 0.85)
    const faulted = anomaly?.kind === 'leak' && t % 6 === 0 ? 1 : 0

    const sample: TelemetrySample = {
      host: {
        hostname: 'speculum-motor-01',
        uptimeSec: 86_400 + t * 60,
        cpuUsage: round1(cpu),
        memoryUsed: memBytes,
        memoryPrivate: Math.round(memBytes * 0.94),
        memoryTotal: 2_048_000_000,
        gcHeap: Math.round(memBytes * 0.35),
        gcGen0: 120 + t,
        gcGen1: 24 + Math.floor(t / 12),
        gcGen2: 4 + Math.floor(t / 90),
        threadCount: threads,
        threadPoolBusy: cpu > 40 ? 4 : 2,
        threadPoolQueued: cpu > 70 ? 2 : 0,
        diskFreeBytes: 10_000_000_000 - t * 250_000,
      },
      motor: {
        total: live + starting,
        live,
        starting,
        stopping: 0,
        byPhase: { Running: live, Starting: starting },
        avgFps: round1(avgFps),
        minFps: round1(Math.max(4, avgFps - 6)),
        maxFps: round1(Math.min(30, avgFps + 4)),
        inputQueueTotal: Math.round(live * (cpu > 60 ? 2.4 : 0.6)),
        frameChannelDepthTotal: Math.round(live * 1.2),
        statusChannelDepthTotal: Math.round(live * 0.4),
        capacityMax: CAPACITY_MAX,
        capacityUsedPct: round1((live / CAPACITY_MAX) * 100),
        liveSessionIds: null,
        sessions: null,
      },
      sidecar: {
        connected: live,
        faulted,
        faultedSessionIds: null,
      },
      persistence: {
        storedSessions: 8 + Math.floor(t / 40),
        totalCookies: 96 + t,
        totalHistory: 42 + Math.floor(t / 3),
        expiringSoon: t % 50 === 0 ? 2 : 0,
        storeBytes: 4_200_000 + t * 1500,
      },
      pipeline: {
        bytesUsed: 12_000_000 + t * 42_000,
        storageMaxBytes: STORAGE_MAX_BYTES,
        usedPct: round1(((12_000_000 + t * 42_000) / STORAGE_MAX_BYTES) * 100),
        eventsStored: 300 + t * 3,
        eventsDropped: anomaly?.kind === 'leak' || (t >= 80 && t <= 95)
          ? Math.max(0, Math.round((t - 70) * 0.4))
          : 0,
        overflowCount: t >= 82 && t <= 90 ? Math.round((t - 81) / 2) : 0,
        probeInFlight: 0,
        degraded: t >= 80 && t <= 95,
        elevateActive: t >= 200 && t <= 210,
        recentDrops: t >= 80 && t <= 95 ? Math.round(2 + (t - 80) * 0.5) : null,
        recentSlowWrites: cpu > 80 || (t >= 80 && t <= 95) ? 1 + Math.floor((t % 5) / 2) : null,
      },
    }

    out.push({
      diagnosticsSchemaVersion: 1,
      id: `tele-mock-${String(++idSeq).padStart(6, '0')}`,
      utc,
      domain: 'Telemetry',
      name: 'Telemetry.SampleCollected',
      severity: 'Metric',
      correlationId: null,
      connectionId: null,
      persistedSessionId: null,
      sidecarSessionId: null,
      payload: sample,
      redaction: 'none',
    })
  }

  telemetryCache = out
  return out
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}
function round1(v: number): number {
  return Math.round(v * 10) / 10
}
