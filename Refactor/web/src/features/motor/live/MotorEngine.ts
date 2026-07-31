import { API_URL } from '@/lib/env'
import { createCorrelationId } from '@/lib/createUuid'
import { fetchClientConfig, saveClientToken, type ClientConfig } from '@/lib/clientConfig'
import { syncClientLocation } from '@/features/motor/mapping/syncClientLocation'
import { MotorConnection } from './MotorConnection'
import { MotorScreencast } from './MotorScreencast'
import { MotorVcon } from './MotorVcon'
import { MotorInput } from './MotorInput'
import {
  detectDeviceProfile,
  deviceProfilesEqual,
  isTouchPrimaryProfile,
  normalizeSessionViewport,
  validateResizeViewport,
  DEFAULT_VIEWPORT_POLICY,
} from './deviceProfile'
import { viewportSizesClose } from '@/features/sessions/live/CanvasViewportSync'
import type {
  ConsoleOutputPayload,
  DeviceProfilePayload,
  MotorElements,
  MotorUiState,
  ResizeResultPayload,
  SessionStatusPayload,
  StateListener,
} from './types'

function hasSubdomainMirroring(config: ClientConfig | null | undefined): boolean {
  return !!config?.hosting.domains.some((d) => d.subdomainMirroringEnabled)
}

export type { MotorStatus, MotorUiState } from './types'

export class MotorEngine {
  private connecting = false
  private sessionW = 1280
  private sessionH = 720
  private currentUrl = ''
  private resizeTimer: ReturnType<typeof setTimeout> | null = null
  private resizeObserver: ResizeObserver | null = null
  private orientationCleanup: (() => void) | null = null
  private listeners = new Set<StateListener>()
  private elements: MotorElements | null = null
  private mounted = false
  private clientConfig: ClientConfig | null = null
  private correlationId: string | undefined
  private connectionId: string | undefined
  private persistedSessionId: string | undefined
  private sidecarSessionId: string | undefined
  private deviceProfile: DeviceProfilePayload = detectDeviceProfile()
  private keyboardShellOpen = false
  /** User dismissed the IME while remote field still focused — do not auto-reopen until focus ends. */
  private imeDismissedByUser = false
  /** True while engine blurs IME because remote editing ended (not a user dismiss). */
  private softBlurringIme = false
  /** Autofocus IME at most once per remote editing session. */
  private imeAutoFocusTried = false
  /** Consecutive status ticks without editing — absorb probe false-negatives. */
  private editingMissTicks = 0
  private editingSessionActive = false
  /** True while a ResizeAsync invoke is in flight — do not commit canvas from status. */
  private resizeInFlight = false
  /** Viewport size used for remote resize — frozen while local keyboard is open. */
  private remoteViewportW = 0
  private remoteViewportH = 0
  /** True when a sync was skipped because the local keyboard shell was open. */
  private viewportSyncPending = false

  private screencast = new MotorScreencast()
  private vcon = new MotorVcon({
    onMappedUrl: (url) => this.applyMappedUrl(url),
    onRedirect: (url) => { window.location.href = url },
  })
  private input = new MotorInput({
    getConnection: () => this.connection.hub,
    getSessionSize: () => ({ w: this.sessionW, h: this.sessionH }),
    getCurrentUrl: () => this.currentUrl,
    // Use keyboardShellOpen (set from IME focus) — not this.input — to avoid a circular field init.
    isEditingActive: (): boolean => this.keyboardShellOpen,
    onImeFocusChange: (focused) => this.onImeFocusChange(focused),
    isTouchPrimary: (): boolean => isTouchPrimaryProfile(this.deviceProfile),
  })
  private connection = new MotorConnection({
    onFrame: (frame) => this.screencast.onFrame(frame),
    onConsoleOutput: (output) => this.onConsoleOutput(output),
    onSessionStatus: (status) => this.onSessionStatus(status),
    onDisconnected: () => this.onDisconnected(),
    onReconnecting: () => this.emit({ status: 'connecting', statusText: 'Reconnecting...' }),
    emitError: (message) => this.emit({
      status: 'error',
      statusText: message,
      showOverlay: true,
      navDisabled: true,
    }),
  })

  private state: MotorUiState = {
    status: 'idle',
    statusText: 'Disconnected',
    showOverlay: true,
    url: '',
    fps: null,
    navDisabled: true,
    resizeWarning: null,
  }

  constructor() {
    this.connection.rebootstrap = () => this.bootstrapSession()
  }

  subscribe(listener: StateListener) {
    this.listeners.add(listener)
    listener(this.state)
    return () => this.listeners.delete(listener)
  }

  private emit(partial: Partial<MotorUiState>) {
    this.state = {
      ...this.state,
      ...partial,
      correlationId:     partial.correlationId ?? this.correlationId ?? this.state.correlationId,
      connectionId:        partial.connectionId ?? this.connectionId ?? this.state.connectionId,
      persistedSessionId: partial.persistedSessionId ?? this.persistedSessionId ?? this.state.persistedSessionId,
      sidecarSessionId:  partial.sidecarSessionId ?? this.sidecarSessionId ?? this.state.sidecarSessionId,
    }
    for (const l of this.listeners) l(this.state)
  }

  private newCorrelationId(): string {
    return createCorrelationId()
  }

  mount(elements: MotorElements) {
    this.mounted = true
    this.elements = elements
    this.deviceProfile = detectDeviceProfile()
    this.screencast.attach(elements, (fps) => this.emit({ fps }))
    if (elements.ime) this.input.setImeElement(elements.ime)
    this.input.bind(elements)
    this.resizeObserver = new ResizeObserver(() => {
      const el = this.elements?.viewport
      if (!el) return
      // Always clientWidth/Height — contentRect can disagree by a few px and trigger
      // a needless ResizeAsync right after StartSession.
      this.scheduleRemoteViewportSync(el.clientWidth, el.clientHeight)
    })
    this.resizeObserver.observe(elements.viewport)
    const onOrientation = () => {
      const el = this.elements?.viewport
      if (!el) return
      this.scheduleRemoteViewportSync(el.clientWidth, el.clientHeight)
    }
    window.addEventListener('orientationchange', onOrientation)
    const orientation = window.screen?.orientation
    orientation?.addEventListener?.('change', onOrientation)
    this.orientationCleanup = () => {
      window.removeEventListener('orientationchange', onOrientation)
      orientation?.removeEventListener?.('change', onOrientation)
    }
    void this.connect()
  }

  unmount() {
    this.mounted = false
    this.input.unbind()
    if (this.resizeTimer) {
      clearTimeout(this.resizeTimer)
      this.resizeTimer = null
    }
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.orientationCleanup?.()
    this.orientationCleanup = null
    void this.stopSession()
    this.screencast.detach()
    this.elements = null
  }

  /** Debounced ResizeAsync — CSS host owns size; remote adapts. */
  private scheduleRemoteViewportSync(rawW: number, rawH: number) {
    // Do not resize the remote device when the local virtual keyboard shrinks the SPA.
    if (this.keyboardShellOpen) {
      this.viewportSyncPending = true
      return
    }
    // Coalesce while an invoke is in flight — avoids concurrent ResizeAsync / sidecar busy.
    if (this.resizeInFlight) {
      this.viewportSyncPending = true
      return
    }
    const validated = validateResizeViewport(rawW, rawH, DEFAULT_VIEWPORT_POLICY)
    if (!validated.ok) return
    const { w, h } = validated
    const nextProfile = detectDeviceProfile()
    if (
      viewportSizesClose(w, h, this.remoteViewportW, this.remoteViewportH)
      && deviceProfilesEqual(this.deviceProfile, nextProfile)
    ) {
      return
    }
    this.input.invalidateRect()
    if (this.resizeTimer) clearTimeout(this.resizeTimer)
    this.resizeTimer = setTimeout(async () => {
      const el = this.elements?.viewport
      if (!this.connection.hub || this.resizeInFlight || !el) return
      // Re-measure at fire time so layout settle can cancel a needless resize.
      const latest = validateResizeViewport(el.clientWidth, el.clientHeight, DEFAULT_VIEWPORT_POLICY)
      if (!latest.ok) return
      const profile = detectDeviceProfile()
      if (
        viewportSizesClose(latest.w, latest.h, this.remoteViewportW, this.remoteViewportH)
        && deviceProfilesEqual(this.deviceProfile, profile)
      ) {
        return
      }
      this.resizeInFlight = true
      try {
        const result = await this.connection.hub.invoke<ResizeResultPayload>(
          'ResizeAsync', latest.w, latest.h, profile,
        )
        if (result?.applied) {
          // Confirm CSS-requested size — never chase ack/chrome deltas into another resize.
          this.syncCanvasSize(latest.w, latest.h)
          this.remoteViewportW = latest.w
          this.remoteViewportH = latest.h
          this.deviceProfile = profile
          this.emit({ resizeWarning: null })
        } else {
          const detail = result?.message || result?.errorCode || 'resize rejected'
          this.emit({ resizeWarning: `Viewport resize failed: ${detail}` })
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        this.emit({ resizeWarning: `Viewport resize failed: ${message}` })
      } finally {
        this.resizeInFlight = false
        if (this.viewportSyncPending && !this.keyboardShellOpen) {
          this.flushPendingViewportSync()
        }
      }
    }, 320)
  }

  /** After IME closes, apply any orientation/size changes deferred while the shell was open. */
  private flushPendingViewportSync() {
    if (!this.viewportSyncPending || this.keyboardShellOpen) return
    this.viewportSyncPending = false
    const el = this.elements?.viewport
    if (!el) return
    this.scheduleRemoteViewportSync(el.clientWidth, el.clientHeight)
  }

  /**
   * Freeze remote resize only while the hidden IME actually holds DOM focus
   * (OS keyboard likely open). Programmatic focus failures must not stall ResizeAsync.
   */
  private onImeFocusChange(focused: boolean) {
    if (focused === this.keyboardShellOpen) return
    this.keyboardShellOpen = focused
    this.input.invalidateRect()
    if (!focused) {
      // User dismissed the OS keyboard while the remote field is still focused.
      if (!this.softBlurringIme && this.state.editing?.focused) {
        this.imeDismissedByUser = true
      }
      this.flushPendingViewportSync()
    }
  }

  private softBlurIme() {
    if (!this.input.isImeFocused()) return
    this.softBlurringIme = true
    try {
      this.input.blurIme()
    } finally {
      this.softBlurringIme = false
    }
  }

  private isActive(): boolean {
    return this.mounted && this.elements !== null
  }

  async connect() {
    if (this.connecting || !this.isActive()) return
    this.connecting = true
    this.emit({ status: 'connecting', statusText: 'Connecting...', showOverlay: true })

    try {
      const readyRes = await fetch(`${API_URL}/health/ready`, { credentials: 'include' })
      if (!this.isActive()) return
      if (!readyRes.ok) {
        window.location.replace('/setup')
        return
      }
      this.clientConfig = await fetchClientConfig(API_URL, true)
    } catch {
      if (!this.isActive()) return
      this.emit({ status: 'error', statusText: 'Error: cannot reach server', showOverlay: true })
      this.connecting = false
      return
    }

    await this.stopSession()
    if (!this.isActive()) return

    try {
      await this.connection.start()
      if (!this.isActive()) {
        await this.stopSession()
        return
      }
      this.connectionId = this.connection.getConnectionId() ?? undefined
      this.correlationId = this.newCorrelationId()
      this.emit({ connectionId: this.connectionId, correlationId: this.correlationId })
      await this.bootstrapSession()
    } catch (err) {
      console.error('[connect]', err)
      const message = err instanceof Error ? err.message : String(err)
      this.emit({ status: 'error', statusText: `Error: ${message}`, showOverlay: true })
      await this.stopSession()
    } finally {
      this.connecting = false
    }
  }

  private async bootstrapSession() {
    const elements = this.elements
    if (!this.isActive() || !this.connection.hub || !elements) return
    this.connection.teardownChannels()

    const rawW = elements.viewport.clientWidth || 1280
    const rawH = elements.viewport.clientHeight || 720
    const { w: initW, h: initH } = normalizeSessionViewport(rawW, rawH, DEFAULT_VIEWPORT_POLICY)
    this.syncCanvasSize(initW, initH)
    this.remoteViewportW = initW
    this.remoteViewportH = initH
    this.deviceProfile = detectDeviceProfile()

    const clientToken = await this.connection.invokeStartSession(
      initW, initH, this.correlationId, this.deviceProfile)
    if (!clientToken) {
      await this.stopSession()
      return
    }
    if (this.clientConfig) saveClientToken(clientToken, this.clientConfig)
    this.persistedSessionId = clientToken
    this.emit({ persistedSessionId: clientToken })

    this.connection.openChannels()
    this.input.setUserInputSubject(this.connection.getUserInputSubject())
    this.vcon.setConsoleInputSubject(this.connection.getConsoleInputSubject())

    this.emit({
      status: 'connected',
      statusText: 'Streaming',
      showOverlay: false,
      navDisabled: false,
      url: this.currentUrl,
    })
    elements.canvas.focus()
  }

  private onDisconnected() {
    this.emit({
      status: 'error',
      statusText: 'Disconnected — click to reconnect',
      showOverlay: true,
      navDisabled: true,
      url: '',
    })
    this.input.clearPointerState()
    this.screencast.teardown()
    this.vcon.reset()
    this.input.setUserInputSubject(null)
    this.connection.teardownChannels()
    this.connecting = false
  }

  private async stopSession() {
    this.screencast.teardown()
    this.vcon.reset()
    this.input.setUserInputSubject(null)
    await this.connection.stop()
  }

  private syncCanvasSize(w: number, h: number) {
    if (!this.elements) return
    const clamped = normalizeSessionViewport(w, h, DEFAULT_VIEWPORT_POLICY)
    this.sessionW = clamped.w
    this.sessionH = clamped.h
    this.elements.canvas.width = clamped.w
    this.elements.canvas.height = clamped.h
    this.input.invalidateRect()
  }

  private onConsoleOutput(output: ConsoleOutputPayload) {
    if (!this.elements) return
    this.vcon.handleConsoleOutput(output)
  }

  private applyMappedUrl(mapped: string) {
    if (!this.elements) return
    this.currentUrl = mapped
    if (document.activeElement !== this.elements.urlBar) {
      this.elements.urlBar.value = mapped
      this.emit({ url: mapped })
    }
    syncClientLocation(mapped, hasSubdomainMirroring(this.clientConfig))
  }

  private onSessionStatus(s: SessionStatusPayload) {
    this.vcon.setJsBridgeEnabled(!!s.jsBridgeEnabled)

    if (s.sessionId) {
      this.sidecarSessionId = s.sessionId
      this.emit({ sidecarSessionId: s.sessionId })
    }

    if (s.url && this.elements && document.activeElement !== this.elements.urlBar) {
      this.currentUrl = s.url
      this.elements.urlBar.value = s.url
      this.emit({ url: s.url })
      syncClientLocation(s.url, hasSubdomainMirroring(this.clientConfig))
    }

    // Status geometry must never drive CSS or remote resize targets.
    // CSS host → ResizeAsync is the only size authority.

    const editing = s.editing?.focused ? s.editing : null

    if (!editing) {
      this.editingMissTicks++
      // Require two consecutive misses so a single probe false-negative does not
      // clear dismiss state or tear down the IME mid-keystroke.
      if (this.editingSessionActive && this.editingMissTicks < 2) {
        return
      }
      if (this.editingSessionActive) {
        this.editingSessionActive = false
        this.imeAutoFocusTried = false
        this.imeDismissedByUser = false
        this.softBlurIme()
      }
      this.editingMissTicks = 0
      this.emit({ editing: null, showKeyboard: false })
      return
    }

    this.editingMissTicks = 0
    this.editingSessionActive = true
    this.emit({
      editing,
      showKeyboard: true,
    })

    // Autofocus once per editing session (may need user gesture / Show keyboard).
    if (!this.input.isImeFocused() && !this.imeDismissedByUser && !this.imeAutoFocusTried) {
      this.imeAutoFocusTried = true
      this.input.focusIme()
    }
  }

  openVirtualKeyboard() {
    this.imeDismissedByUser = false
    this.imeAutoFocusTried = true
    this.input.focusIme()
    this.emit({ showKeyboard: true })
  }

  closeVirtualKeyboard() {
    this.imeDismissedByUser = true
    this.softBlurringIme = false
    this.input.blurIme()
    this.elements?.canvas.focus()
    if (this.keyboardShellOpen) {
      this.keyboardShellOpen = false
      this.flushPendingViewportSync()
    }
  }

  goBack() { this.input.goBack() }
  goForward() { this.input.goForward() }
}
