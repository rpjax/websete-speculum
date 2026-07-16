import type { CorrelationStory } from '@/lib/hooks/useCorrelationStories'

export const EVENT_DESCRIPTIONS: Record<string, string> = {
  'Motor.SessionStarting': 'A user connected and the motor is preparing a remote browser session — acquiring a slot, launching the sidecar process.',
  'Motor.SessionResolved': 'The session identity was resolved — the motor determined which browser slot to use for this connection.',
  'Motor.SlotAcquired': 'A browser slot was successfully reserved for this session from the available pool.',
  'Motor.SidecarConnected': 'The sidecar browser process connected to the motor and is ready to render pages.',
  'Motor.SessionPromoted': 'The session is now fully live — screencast frames are being streamed to the user.',
  'Motor.SessionStarted': 'Session startup completed successfully. The user can now browse remotely.',
  'Motor.SessionStopped': 'The session ended normally — the user disconnected or the session was explicitly closed.',
  'Motor.SessionFailed': 'Session startup failed — the browser could not be launched or connected.',
  'Motor.NavigateRequested': 'The user (or the system) requested navigation to a new URL.',
  'Motor.NavigateCompleted': 'Navigation finished — the browser loaded the target page successfully.',
  'Motor.NavigateRejected': 'Navigation was blocked — the target URL is not permitted by the current allowlist or forwarding rules.',
  'Motor.NavigateBlocked': 'Navigation was refused before a target could be built — the requested URL failed allowlist / forwarding mapping.',
  'Motor.SessionRefused': 'A new session was refused at the capacity gate — the maximum concurrent session limit was already reached.',
  'Motor.UrlMapped': 'The requested URL was processed through the forwarding rules and mapped to a target address.',
  'Motor.StateExportStarted': 'Browser state (cookies, localStorage) is being exported for session persistence.',
  'Motor.StateExportCompleted': 'Browser state was successfully saved — the session can be restored later with these cookies and storage.',
  'Motor.DrainStarted': 'A configuration change triggered session draining — affected sessions will be gracefully stopped.',
  'Motor.DrainCompleted': 'All drained sessions have been stopped. The configuration change is now fully applied.',
  'Motor.SidecarFault': 'The sidecar browser process reported an error — the browser may have crashed or become unresponsive.',
  'Motor.SidecarReconnected': 'The sidecar reconnected after a fault — the browser recovered and the session continues.',
  'Motor.ResizeRequested': 'The user\'s viewport size changed and the remote browser is resizing to match.',
  'Motor.StatusMirrored': 'Periodic session status snapshot captured for monitoring (FPS, frame count, queue depth).',
  'Sidecar.ScreencastFrame': 'A video frame was captured from the remote browser and streamed to the user.',
  'Sidecar.DiagProbeRequested': 'An administrator requested a diagnostic probe — inspecting the browser\'s internal state.',
  'Sidecar.DiagProbeCompleted': 'The diagnostic probe finished successfully — results are available for inspection.',
  'Sidecar.DiagProbeTimedOut': 'The diagnostic probe did not respond within the timeout — the browser may be busy or unresponsive.',
  'Sidecar.DiagProbeRejected': 'The diagnostic probe was rejected — the Browser Query capability is not enabled for this operation.',
  'Sidecar.DiagProbeBusy': 'A diagnostic probe was refused because this connection already has one in flight — only one probe runs per session at a time.',
  'Sidecar.Ready': 'The sidecar browser process started and is ready to accept connections.',
  'Diagnostics.ConfigApplied': 'Diagnostics configuration was updated — new capability toggles, storage settings, or probe limits are now active.',
  'Diagnostics.CleanupPurged': 'Old diagnostic events were purged from the ring buffer to free storage space.',
  'Diagnostics.CleanupCompleted': 'Old diagnostic events were purged from the ring buffer to free storage space.',
  'Diagnostics.Degraded': 'The diagnostics circuit breaker tripped — too many errors capped every domain at the Metrics capability.',
  'Diagnostics.Recovered': 'The diagnostics circuit breaker was reset — full diagnostics capability is restored.',
  'Diagnostics.RecoverRequested': 'An administrator manually requested diagnostics recovery.',
  'Diagnostics.ElevateStarted': 'The Browser Query capability was temporarily unlocked — deeper browser inspection (cookies, DOM, JS) is now available.',
  'Diagnostics.ElevateExpired': 'The temporary Browser Query elevation expired — browser inspection is back to the configured toggles.',
  'Diagnostics.StorageOverflow': 'The diagnostics event buffer is full — oldest events are being dropped to make room.',
  'Persistence.StateExportCompleted': 'Browser state (cookies, localStorage, IndexedDB) was persisted to the session store.',
  'Persistence.SessionQueried': 'A persisted session record was queried from the store.',
  'Telemetry.SampleCollected': 'A composite telemetry sample was collected — machine, API process, motor, sidecar, persistence, and pipeline sections captured on one time axis.',
  'Telemetry.SessionSampleCollected': 'A per-session telemetry slice was captured and scoped to a live session, so it plots inside that session\'s story lane.',
  'Diagnostics.SpanAbandoned': 'An open span was closed synthetically — it timed out, was torn down on disconnect/drain, or was recovered as orphaned after a restart.',
}

export const ERROR_EXPLANATIONS: Record<string, { summary: string; detail: string; action?: string }> = {
  navigate_blocked_by_allowlist: {
    summary: 'URL blocked by allowlist',
    detail: 'The requested URL is not in the site\'s allowed domain list. Only URLs matching the forwarding host or explicit allowlist entries are permitted.',
    action: 'Check Forwarding settings or add the domain to the allowlist.',
  },
  navigate_url_mapping_failed: {
    summary: 'URL mapping failed',
    detail: 'The forwarding rules could not map the requested URL to a valid target. The URL format may be invalid or the forwarding host may not be configured.',
    action: 'Verify the Forwarding configuration and ensure the target host is reachable.',
  },
  probe_timeout: {
    summary: 'Probe timed out',
    detail: 'The browser did not respond to the probe request within the configured timeout. The browser may be busy loading a heavy page or running expensive scripts.',
    action: 'Try again, or increase diagTimeoutMs in Governance → Advanced settings.',
  },
  probe_level_insufficient: {
    summary: 'Browser Query capability disabled',
    detail: 'The requested probe operation needs the Browser Query capability, which is currently off. Operations like cookie or DOM inspection require it.',
    action: 'Use the Elevate feature on the Health tab to temporarily unlock Browser Query, or enable the toggle in Governance.',
  },
  probe_rejected_degraded: {
    summary: 'Probe rejected (degraded)',
    detail: 'The diagnostics circuit is degraded, so probes are limited. The system entered this state after too many errors.',
    action: 'Recover the circuit from the Health tab first, then retry the probe.',
  },
  session_slot_exhausted: {
    summary: 'No browser slots available',
    detail: 'All available browser slots are in use. The maximum concurrent session limit has been reached.',
    action: 'Wait for existing sessions to end, or increase MaxSessions in Capacity settings.',
  },
  session_limit: {
    summary: 'Session refused — capacity reached',
    detail: 'A new session was refused because the maximum concurrent session limit was already reached at the capacity gate.',
    action: 'Wait for existing sessions to end, or increase MaxSessions in Capacity settings.',
  },
  url_blocked: {
    summary: 'URL blocked before navigation',
    detail: 'The requested URL could not be mapped to a permitted target — it failed the allowlist / forwarding rules before navigation started.',
    action: 'Check Forwarding settings or add the domain to the allowlist.',
  },
  span_timeout: {
    summary: 'Span timed out',
    detail: 'An operation span (e.g. navigate, export, probe) did not close within its timeout window and was abandoned by the span sweeper.',
    action: 'Inspect the originating session — the operation may have stalled or the connection dropped.',
  },
  span_abandoned: {
    summary: 'Span abandoned',
    detail: 'An open span was force-closed — typically an orphan recovered after a process restart, or torn down when its connection ended.',
  },
  sidecar_connect_failed: {
    summary: 'Browser process failed to connect',
    detail: 'The sidecar browser process could not establish a connection to the motor. The process may have crashed during startup.',
    action: 'Check server logs for sidecar errors. The session will be automatically retried.',
  },
}

export const PHASE_DESCRIPTIONS: Record<string, string> = {
  Starting: 'Session is being prepared — browser process launching, slot being acquired.',
  Running: 'Session is live — the user is actively browsing through the remote browser.',
  Stopping: 'Session is shutting down — state is being exported and resources released.',
  Faulted: 'Session encountered an error — the sidecar browser may have crashed.',
  Draining: 'Session is being gracefully stopped due to a configuration change.',
}

export function describeEvent(name: string): string {
  return EVENT_DESCRIPTIONS[name] ?? `Diagnostic event: ${name}`
}

export function describeErrorCode(code: string): { summary: string; detail: string; action?: string } {
  return ERROR_EXPLANATIONS[code] ?? {
    summary: code.replace(/_/g, ' '),
    detail: `Error code: ${code}`,
  }
}

export function narrateStory(story: CorrelationStory): string {
  const events = story.events
  const payloads = events.map((e) => e.payload as Record<string, unknown> | null).filter(Boolean)
  const failed = events.find((e) => e.severity === 'Error' || e.name.includes('Rejected') || e.name.includes('Failed') || e.name.includes('TimedOut'))

  switch (story.type) {
    case 'session-lifecycle': {
      const started = payloads.find((p) => p?.restored !== undefined)
      const restored = started?.restored
      const cookies = started?.cookieCount
      if (failed) {
        const fp = failed.payload as Record<string, unknown> | null
        const errorCode = fp?.errorCode ? String(fp.errorCode) : 'an unknown error'
        const explained = describeErrorCode(errorCode)
        return `A remote browser session attempted to start but failed: ${explained.summary}. ${explained.detail}`
      }
      if (restored) {
        return `A returning user reconnected and their previous session was restored${cookies ? ` with ${cookies} cookies` : ''}. The browser is ready for use.`
      }
      return `A new remote browser session was created. The sidecar browser process launched, connected, and is now streaming to the user.`
    }

    case 'navigation': {
      const nav = payloads.find((p) => p?.targetUrl)
      const url = nav?.targetUrl ? String(nav.targetUrl) : 'a page'
      if (failed) {
        const fp = failed.payload as Record<string, unknown> | null
        const errorCode = fp?.errorCode ? String(fp.errorCode) : undefined
        if (errorCode) {
          const explained = describeErrorCode(errorCode)
          return `Navigation to ${url} was blocked: ${explained.summary}. ${explained.detail}`
        }
        return `Navigation to ${url} failed.`
      }
      return `The user navigated to ${url}. The URL was validated, mapped through forwarding rules, and loaded successfully.`
    }

    case 'probe': {
      const probe = payloads.find((p) => Array.isArray(p?.ops))
      const ops = probe?.ops ? (probe.ops as string[]).join(', ') : 'browser state'
      if (failed) {
        const fp = failed.payload as Record<string, unknown> | null
        const errorCode = fp?.errorCode ? String(fp.errorCode) : undefined
        if (errorCode) {
          const explained = describeErrorCode(errorCode)
          return `A diagnostic probe (${ops}) was attempted but ${explained.summary.toLowerCase()}. ${explained.detail}`
        }
        return `A diagnostic probe (${ops}) failed to complete.`
      }
      return `An administrator ran a diagnostic probe inspecting ${ops}. The browser responded with the requested data.`
    }

    case 'drain': {
      const drain = payloads.find((p) => p?.sessionCount !== undefined)
      const count = drain?.sessionCount
      const trigger = drain?.sectionKey ? String(drain.sectionKey) : 'a configuration change'
      return `A session drain was triggered by ${trigger}${count !== undefined ? `, affecting ${count} session(s)` : ''}. Sessions were gracefully stopped and their state exported.`
    }

    case 'state-export': {
      const exp = payloads.find((p) => p?.cookieCount !== undefined)
      const cookies = exp?.cookieCount
      const ls = exp?.localStorageCount
      const parts: string[] = []
      if (cookies !== undefined) parts.push(`${cookies} cookies`)
      if (ls !== undefined) parts.push(`${ls} localStorage entries`)
      return `Browser state was exported and saved for future session restoration${parts.length > 0 ? ` (${parts.join(', ')})` : ''}. The user can reconnect and pick up where they left off.`
    }

    case 'admin': {
      const admin = payloads.find((p) => p?.minutes !== undefined || p?.reason || p?.section)
      if (events.some((e) => e.name.includes('Elevate'))) {
        const minutes = admin?.minutes
        return `An administrator temporarily unlocked the Browser Query capability${minutes ? ` for ${minutes} minutes` : ''}. Deep browser inspection (cookies, DOM, JS evaluation) is now available.`
      }
      if (events.some((e) => e.name.includes('Recover'))) {
        return `An administrator manually recovered the diagnostics circuit. The system was in a degraded state and is now restored to full functionality.`
      }
      if (events.some((e) => e.name.includes('Config'))) {
        const section = admin?.section ? String(admin.section) : 'Diagnostics'
        return `The ${section} configuration was updated. New settings are now active across the motor.`
      }
      return 'An administrative action was performed on the diagnostics system.'
    }

    default:
      return `${events.length} diagnostic event(s) occurred as part of this correlated activity.`
  }
}

export function describePhase(phase: string): string {
  return PHASE_DESCRIPTIONS[phase] ?? phase
}

export function humanizeConnectionId(connectionId: string | null): string {
  if (!connectionId) return 'System'
  return `Session ${connectionId.slice(5, 13).toUpperCase()}`
}

export function humanizeDomain(domain: string): string {
  const DOMAIN_HUMAN: Record<string, string> = {
    MotorLive: 'Session lifecycle, navigation, and streaming',
    SidecarBrowser: 'Browser process, probes, and screencast',
    BrowserQuery: 'Cookies, DOM, localStorage, JS evaluation',
    PersistedSessions: 'State export, restore, and stored sessions',
    Telemetry: 'Composite machine, API process, motor, sidecar, persistence, and pipeline sample',
    DiagnosticsSelf: 'Pipeline config, elevation, and cleanup',
  }
  return DOMAIN_HUMAN[domain] ?? domain
}
