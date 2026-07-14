import type {
  DiagnosticsOverview,
  DiagnosticsRuntimeSnapshot,
  DiagnosticsEventRecord,
  DiagnosticsCatalogResponse,
  MotorSessionListItem,
  MotorSessionDiagnosticsSnapshot,
  BrowserProbeResponse,
} from '@/lib/diagnosticsApi'

const now = new Date().toISOString()
const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString()

export const overview: DiagnosticsOverview = {
  diagnosticsSchemaVersion: 1,
  enabled: true,
  degraded: false,
  elevate: null,
  bytesUsed: 12_582_912,
  eventsStored: 347,
  eventsDropped: 0,
  overflowCount: 0,
  probeInFlight: 0,
  lastCleanupUtc: fiveMinAgo,
  redactionMode: 'none',
  effectiveLevels: {
    motorLive: 'Events',
    sidecarBrowser: 'Metrics',
    hostResources: 'Metrics',
    browserQuery: 'Off',
    persistedSessions: 'StateSnapshots',
  },
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
  effectiveLevels: overview.effectiveLevels,
  elevate: null,
  degraded: false,
  bytesUsed: overview.bytesUsed,
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
const corrDrain1 = 'corr-drain-001'
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
    // --- Session lifecycle story for conn1 (6 events, correlated) ---
    { diagnosticsSchemaVersion: 1, id: eid(), utc: ago(12), domain: 'Motor.Live', name: 'Motor.SessionStarting', severity: 'Info', correlationId: corrSessionLifecycle1, connectionId: conn1, persistedSessionId: 'sess-a1b2c3d4-e5f6-7890-abcd-ef1234567890', sidecarSessionId: 'sc-111-222', payload: { restored: false }, redaction: 'none' },
    { diagnosticsSchemaVersion: 1, id: eid(), utc: ago(11.8), domain: 'Motor.Live', name: 'Motor.SessionResolved', severity: 'Info', correlationId: corrSessionLifecycle1, connectionId: conn1, persistedSessionId: 'sess-a1b2c3d4-e5f6-7890-abcd-ef1234567890', sidecarSessionId: 'sc-111-222', payload: { slotIndex: 0 }, redaction: 'none' },
    { diagnosticsSchemaVersion: 1, id: eid(), utc: ago(11.5), domain: 'Motor.Live', name: 'Motor.SlotAcquired', severity: 'Info', correlationId: corrSessionLifecycle1, connectionId: conn1, persistedSessionId: null, sidecarSessionId: 'sc-111-222', payload: { slotIndex: 0, totalSlots: 5 }, redaction: 'none' },
    { diagnosticsSchemaVersion: 1, id: eid(), utc: ago(11.2), domain: 'Motor.Live', name: 'Motor.SidecarConnected', severity: 'Info', correlationId: corrSessionLifecycle1, connectionId: conn1, persistedSessionId: null, sidecarSessionId: 'sc-111-222', payload: { sidecarSessionId: 'sc-111-222' }, redaction: 'none' },
    { diagnosticsSchemaVersion: 1, id: eid(), utc: ago(11), domain: 'Motor.Live', name: 'Motor.SessionPromoted', severity: 'Info', correlationId: corrSessionLifecycle1, connectionId: conn1, persistedSessionId: null, sidecarSessionId: 'sc-111-222', payload: { fps: 24 }, redaction: 'none' },
    { diagnosticsSchemaVersion: 1, id: eid(), utc: ago(10.8), domain: 'Motor.Live', name: 'Motor.SessionStarted', severity: 'Info', correlationId: corrSessionLifecycle1, connectionId: conn1, persistedSessionId: 'sess-a1b2c3d4-e5f6-7890-abcd-ef1234567890', sidecarSessionId: 'sc-111-222', payload: { restored: true, cookieCount: 12, persistedSessionId: 'sess-a1b2c3d4-e5f6-7890-abcd-ef1234567890' }, redaction: 'none' },

    // --- Session lifecycle story for conn2 (3 events) ---
    { diagnosticsSchemaVersion: 1, id: eid(), utc: ago(8), domain: 'Motor.Live', name: 'Motor.SessionStarting', severity: 'Info', correlationId: corrSessionLifecycle2, connectionId: conn2, persistedSessionId: null, sidecarSessionId: 'sc-333-444', payload: { restored: false }, redaction: 'none' },
    { diagnosticsSchemaVersion: 1, id: eid(), utc: ago(7.5), domain: 'Motor.Live', name: 'Motor.SidecarConnected', severity: 'Info', correlationId: corrSessionLifecycle2, connectionId: conn2, persistedSessionId: null, sidecarSessionId: 'sc-333-444', payload: { sidecarSessionId: 'sc-333-444' }, redaction: 'none' },
    { diagnosticsSchemaVersion: 1, id: eid(), utc: ago(7), domain: 'Motor.Live', name: 'Motor.SessionStarted', severity: 'Info', correlationId: corrSessionLifecycle2, connectionId: conn2, persistedSessionId: null, sidecarSessionId: 'sc-333-444', payload: { restored: false, cookieCount: 0 }, redaction: 'none' },

    // --- Navigation story for conn1 (3 events) ---
    { diagnosticsSchemaVersion: 1, id: eid(), utc: ago(6), domain: 'Motor.Live', name: 'Motor.NavigateRequested', severity: 'Info', correlationId: corrNavigate1, connectionId: conn1, persistedSessionId: null, sidecarSessionId: null, payload: { targetUrl: 'https://www.example.com/products' }, redaction: 'none' },
    { diagnosticsSchemaVersion: 1, id: eid(), utc: ago(5.8), domain: 'Motor.Live', name: 'Motor.UrlMapped', severity: 'Info', correlationId: corrNavigate1, connectionId: conn1, persistedSessionId: null, sidecarSessionId: null, payload: { originalUrl: 'https://www.example.com/products', mappedUrl: 'https://www.example.com/products' }, redaction: 'none' },
    { diagnosticsSchemaVersion: 1, id: eid(), utc: ago(5.5), domain: 'Motor.Live', name: 'Motor.NavigateCompleted', severity: 'Info', correlationId: corrNavigate1, connectionId: conn1, persistedSessionId: null, sidecarSessionId: null, payload: { url: 'https://www.example.com/products', durationMs: 340 }, redaction: 'none' },

    // --- Failed navigation story for conn2 (2 events) ---
    { diagnosticsSchemaVersion: 1, id: eid(), utc: ago(4), domain: 'Motor.Live', name: 'Motor.NavigateRequested', severity: 'Info', correlationId: corrNavigate2, connectionId: conn2, persistedSessionId: null, sidecarSessionId: null, payload: { targetUrl: 'https://blocked.example.com/' }, redaction: 'none' },
    { diagnosticsSchemaVersion: 1, id: eid(), utc: ago(3.8), domain: 'Motor.Live', name: 'Motor.NavigateRejected', severity: 'Warning', correlationId: corrNavigate2, connectionId: conn2, persistedSessionId: null, sidecarSessionId: null, payload: { targetUrl: 'https://blocked.example.com/', errorCode: 'navigate_blocked_by_allowlist', phase: 'UrlMapping' }, redaction: 'none' },

    // --- Probe story for conn1 (2 events, sidecar domain) ---
    { diagnosticsSchemaVersion: 1, id: eid(), utc: ago(3), domain: 'Sidecar.Browser', name: 'Sidecar.DiagProbeRequested', severity: 'Info', correlationId: corrProbe1, connectionId: conn1, persistedSessionId: null, sidecarSessionId: 'sc-111-222', payload: { ops: ['process', 'tabs', 'resources'] }, redaction: 'none' },
    { diagnosticsSchemaVersion: 1, id: eid(), utc: ago(2.8), domain: 'Sidecar.Browser', name: 'Sidecar.DiagProbeCompleted', severity: 'Info', correlationId: corrProbe1, connectionId: conn1, persistedSessionId: null, sidecarSessionId: 'sc-111-222', payload: { ops: ['process', 'tabs', 'resources'], durationMs: 120 }, redaction: 'none' },

    // --- Admin action: elevate (2 events, diagnostics domain) ---
    { diagnosticsSchemaVersion: 1, id: eid(), utc: ago(2.5), domain: 'Diagnostics.Self', name: 'Diagnostics.ElevateStarted', severity: 'Info', correlationId: corrAdmin1, connectionId: null, persistedSessionId: null, sidecarSessionId: null, payload: { browserQueryFloor: 'BrowserQuery', minutes: 15 }, redaction: 'none' },
    { diagnosticsSchemaVersion: 1, id: eid(), utc: ago(2.3), domain: 'Diagnostics.Self', name: 'Diagnostics.ConfigApplied', severity: 'Info', correlationId: corrAdmin1, connectionId: null, persistedSessionId: null, sidecarSessionId: null, payload: { section: 'Diagnostics', source: 'ElevateAction' }, redaction: 'none' },

    // --- State export story (2 events) ---
    { diagnosticsSchemaVersion: 1, id: eid(), utc: ago(2), domain: 'Motor.Live', name: 'Motor.StateExportStarted', severity: 'Info', correlationId: corrExport1, connectionId: conn1, persistedSessionId: 'sess-a1b2c3d4-e5f6-7890-abcd-ef1234567890', sidecarSessionId: 'sc-111-222', payload: {}, redaction: 'none' },
    { diagnosticsSchemaVersion: 1, id: eid(), utc: ago(1.8), domain: 'Persistence', name: 'Persistence.StateExportCompleted', severity: 'Info', correlationId: corrExport1, connectionId: conn1, persistedSessionId: 'sess-a1b2c3d4-e5f6-7890-abcd-ef1234567890', sidecarSessionId: 'sc-111-222', payload: { cookieCount: 12, localStorageCount: 4 }, redaction: 'none' },

    // --- Cleanup event (system, no correlation) ---
    { diagnosticsSchemaVersion: 1, id: eid(), utc: ago(1.5), domain: 'Diagnostics.Self', name: 'Diagnostics.CleanupCompleted', severity: 'Info', correlationId: null, connectionId: null, persistedSessionId: null, sidecarSessionId: null, payload: { purgedCount: 12, bytesFreed: 1_048_576 }, redaction: 'none' },

    // --- Host resource metric (uncorrelated) ---
    { diagnosticsSchemaVersion: 1, id: eid(), utc: ago(1), domain: 'HostResources', name: 'HostResources.SampleCollected', severity: 'Metric', correlationId: null, connectionId: null, persistedSessionId: null, sidecarSessionId: null, payload: { cpuUsage: 0.12, memoryUsedMb: 512, gcGen0: 150, gcGen1: 30, gcGen2: 5 }, redaction: 'none' },

    // --- Sidecar screencast metric (uncorrelated, for conn1) ---
    { diagnosticsSchemaVersion: 1, id: eid(), utc: ago(0.5), domain: 'Sidecar.Browser', name: 'Sidecar.ScreencastFrame', severity: 'Metric', correlationId: null, connectionId: conn1, persistedSessionId: null, sidecarSessionId: 'sc-111-222', payload: { fps: 24, frameSequence: 7200 }, redaction: 'none' },

    // --- Admin recovery action (2 events) ---
    { diagnosticsSchemaVersion: 1, id: eid(), utc: ago(0.3), domain: 'Diagnostics.Self', name: 'Diagnostics.RecoverRequested', severity: 'Warning', correlationId: corrAdmin2, connectionId: null, persistedSessionId: null, sidecarSessionId: null, payload: { reason: 'Manual admin action' }, redaction: 'none' },
    { diagnosticsSchemaVersion: 1, id: eid(), utc: ago(0.2), domain: 'Diagnostics.Self', name: 'Diagnostics.Recovered', severity: 'Info', correlationId: corrAdmin2, connectionId: null, persistedSessionId: null, sidecarSessionId: null, payload: { degradedDurationMs: 120_000 }, redaction: 'none' },

    // --- Error event: probe timeout (uncorrelated) ---
    { diagnosticsSchemaVersion: 1, id: eid(), utc: ago(0.1), domain: 'Sidecar.Browser', name: 'Sidecar.DiagProbeTimedOut', severity: 'Error', correlationId: null, connectionId: conn2, persistedSessionId: null, sidecarSessionId: 'sc-333-444', payload: { errorCode: 'probe_timeout', phase: 'Execution', ops: ['cookies'], diagTimeoutMs: 10_000 }, redaction: 'none' },
  ]

  return events.sort((a, b) => b.utc.localeCompare(a.utc))
}

export const catalog: DiagnosticsCatalogResponse = {
  diagnosticsSchemaVersion: 1,
  events: [
    'Motor.SessionStarting',
    'Motor.SessionResolved',
    'Motor.SlotAcquired',
    'Motor.SidecarConnected',
    'Motor.SessionPromoted',
    'Motor.SessionStarted',
    'Motor.SessionStopped',
    'Motor.SessionFailed',
    'Motor.NavigateRequested',
    'Motor.NavigateCompleted',
    'Motor.NavigateRejected',
    'Motor.UrlMapped',
    'Motor.StateExportStarted',
    'Motor.StateExportCompleted',
    'Motor.DrainStarted',
    'Motor.DrainCompleted',
    'Motor.SidecarFault',
    'Motor.SidecarReconnected',
    'Motor.ResizeRequested',
    'Motor.StatusMirrored',
    'Sidecar.ScreencastFrame',
    'Sidecar.DiagProbeRequested',
    'Sidecar.DiagProbeCompleted',
    'Sidecar.DiagProbeTimedOut',
    'Sidecar.DiagProbeRejected',
    'Sidecar.Ready',
    'Diagnostics.ConfigApplied',
    'Diagnostics.CleanupCompleted',
    'Diagnostics.Degraded',
    'Diagnostics.Recovered',
    'Diagnostics.RecoverRequested',
    'Diagnostics.ElevateStarted',
    'Diagnostics.ElevateExpired',
    'Diagnostics.StorageOverflow',
    'Persistence.StateExportCompleted',
    'Persistence.SessionQueried',
    'HostResources.SampleCollected',
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

export const hostSample: Record<string, unknown> = {
  hostname: 'speculum-motor-01',
  uptime: 86400,
  cpuUsage: 0.12,
  memoryUsed: 512_000_000,
  memoryTotal: 2_048_000_000,
  diskFree: 10_000_000_000,
  gcCollections: { gen0: 150, gen1: 30, gen2: 5 },
  threadCount: 24,
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
