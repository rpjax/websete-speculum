import {
  type BrowserEvalResult,
  type BrowserInput,
  type BrowserLaunchOptions,
  type BrowserProbeRequest,
  type BrowserProbeResult,
  type BrowserReadyInfo,
  type BrowserResizeRequest,
  type BrowserResizeResult,
  type BrowserSession,
  type BrowserSessionEvents,
  type BrowserSessionFactory,
  type BrowserState,
  type BrowserStatus,
  type BrowserTelemetrySnapshot,
} from './BrowserSession';
import { HarnessRenderer } from './mock/HarnessRenderer';
import { HarnessScene } from './mock/HarnessScene';
import { validateResizeViewport, type ViewportPolicyBounds } from '../grpc/validate';

/**
 * Interactive harness BrowserSession for SPECULUM_BROWSER=mock.
 * Soft resize: logical W×H changes without tearing down; display dims from Launch policy.
 */
export class MockBrowserSession implements BrowserSession {
  private open = false;
  private width = 1280;
  private height = 720;
  private resizing = false;
  private viewportPolicy: ViewportPolicyBounds | null = null;
  private state: BrowserState = {
    cookies: [],
    localStorage: [],
    idbRecords: [],
    history: [],
  };
  private frameTimer: ReturnType<typeof setTimeout> | null = null;
  private frameBusy = false;
  private readonly emitFrames: boolean;
  private readonly frameIntervalMs: number;
  private scene: HarnessScene | null = null;
  private renderer: HarnessRenderer | null = null;
  private emitFps = 0;
  private framesThisSecond = 0;
  private fpsWindowStart = 0;
  private movePending: { x: number; y: number } | null = null;
  private moveScheduled = false;

  constructor(
    readonly sessionId: string,
    private readonly events: BrowserSessionEvents,
    options?: { emitFrames?: boolean; frameIntervalMs?: number },
  ) {
    this.emitFrames = options?.emitFrames ?? true;
    this.frameIntervalMs = options?.frameIntervalMs ?? 16;
  }

  private displayDims(): { displayWidth: number; displayHeight: number } {
    const policy = this.viewportPolicy;
    if (!policy) {
      return { displayWidth: 0, displayHeight: 0 };
    }
    return { displayWidth: policy.maxWidth, displayHeight: policy.maxHeight };
  }

  async launch(options: BrowserLaunchOptions): Promise<BrowserReadyInfo> {
    this.width = options.width;
    this.height = options.height;
    this.viewportPolicy = options.viewportPolicy;
    this.open = true;
    this.events.onAllocationLifecycle?.({
      kind: 'display_allocated',
      displayWidth: options.viewportPolicy.maxWidth,
      displayHeight: options.viewportPolicy.maxHeight,
      logicalWidth: this.width,
      logicalHeight: this.height,
      inputBackend: 'patchright',
    });
    this.scene = new HarnessScene(this.width, this.height, {
      onLocationChanged: (url) => this.events.onLocationChanged(url),
      onMainFrameNavigationBlocked: (url) => this.events.onMainFrameNavigationBlocked(url),
      onEditableFocusChanged: (editing) => this.events.onEditableFocusChanged(editing),
    });
    this.scene.setAllowedDomains(options.allowedNavigationDomains);
    this.scene.bootstrap('https://mock.local/');
    this.renderer = new HarnessRenderer(this.width, this.height);
    this.fpsWindowStart = Date.now();
    this.framesThisSecond = 0;
    this.startFrames();
    return { width: this.width, height: this.height };
  }

  async stop(): Promise<void> {
    if (this.open && this.viewportPolicy) {
      this.events.onAllocationLifecycle?.({
        kind: 'display_released',
        displayWidth: this.viewportPolicy.maxWidth,
        displayHeight: this.viewportPolicy.maxHeight,
        logicalWidth: this.width,
        logicalHeight: this.height,
        inputBackend: 'patchright',
      });
    }
    this.stopFrames();
    this.open = false;
    this.scene = null;
    this.renderer = null;
  }

  async dispose(): Promise<void> {
    await this.stop();
  }

  async getStatus(): Promise<BrowserStatus> {
    const dims = this.displayDims();
    return {
      isOpen: this.open,
      tabCount: 1,
      url: this.scene?.currentUrl ?? 'about:blank',
      resizing: this.resizing,
      width: this.width,
      height: this.height,
      displayWidth: dims.displayWidth,
      displayHeight: dims.displayHeight,
      chromeWidth: this.open ? this.width : 0,
      chromeHeight: this.open ? this.height : 0,
    };
  }

  getTelemetrySnapshot(): BrowserTelemetrySnapshot {
    const dims = this.displayDims();
    return {
      inputPendingCount: this.movePending ? 1 : 0,
      inputChainDepth: 0,
      displayAllocated: this.open && this.viewportPolicy !== null,
      displayWidth: dims.displayWidth,
      displayHeight: dims.displayHeight,
      logicalWidth: this.width,
      logicalHeight: this.height,
      chromeWidth: this.open ? this.width : 0,
      chromeHeight: this.open ? this.height : 0,
      inputBackend: 'patchright',
      touchPrimary: false,
      userDataDirPresent: false,
    };
  }

  async restoreState(state: BrowserState): Promise<void> {
    this.state = {
      cookies: [...state.cookies],
      localStorage: [...state.localStorage],
      idbRecords: [...state.idbRecords],
      history: [...state.history],
    };
  }

  async exportState(): Promise<BrowserState> {
    return {
      cookies: [...this.state.cookies],
      localStorage: [...this.state.localStorage],
      idbRecords: [...this.state.idbRecords],
      history: [...this.state.history],
    };
  }

  async navigate(url: string): Promise<void> {
    this.scene?.navigateTo(url, true);
  }

  async refresh(): Promise<void> {
    this.scene?.refresh();
  }

  async resize(request: BrowserResizeRequest): Promise<BrowserResizeResult> {
    if (!this.open || !this.viewportPolicy) {
      return {
        ok: false,
        width: this.width,
        height: this.height,
        errorCode: 'session_gone',
        phase: 'resize_apply',
        message: 'browser session is not open',
        ...this.displayDims(),
      };
    }
    const validated = validateResizeViewport(
      request.width,
      request.height,
      this.viewportPolicy,
    );
    if (!validated.ok) {
      return {
        ok: false,
        width: this.width,
        height: this.height,
        errorCode: validated.errorCode,
        phase: 'validate',
        message: validated.message,
        ...this.displayDims(),
      };
    }
    if (this.resizing) {
      return {
        ok: false,
        width: this.width,
        height: this.height,
        errorCode: 'resize_busy',
        phase: 'validate',
        message: 'another resize is in progress',
        ...this.displayDims(),
      };
    }
    // Soft no-op when logical size unchanged (mock has no device profile state).
    if (validated.width === this.width && validated.height === this.height) {
      return {
        ok: true,
        width: this.width,
        height: this.height,
        chromeWidth: this.width,
        chromeHeight: this.height,
        ...this.displayDims(),
      };
    }
    this.resizing = true;
    try {
      this.width = validated.width;
      this.height = validated.height;
      this.scene?.resize(this.width, this.height);
      this.renderer?.resize(this.width, this.height);
      return {
        ok: true,
        width: this.width,
        height: this.height,
        chromeWidth: this.width,
        chromeHeight: this.height,
        ...this.displayDims(),
      };
    } finally {
      this.resizing = false;
    }
  }

  async probe(request: BrowserProbeRequest): Promise<BrowserProbeResult> {
    return {
      ok: true,
      data: { ops: request.ops, mock: true },
    };
  }

  async evaluate(code: string): Promise<BrowserEvalResult> {
    this.scene?.noteEvaluate(code);
    this.events.onConsole(0, `[mock evaluate] ${code.slice(0, 80)}`);
    return { ok: true, value: JSON.stringify({ echo: code }) };
  }

  async pushInput(input: BrowserInput): Promise<void> {
    if (!this.scene) return;
    if (input.type === 'mousemove') {
      this.queueMouseMove(input.x, input.y);
      return;
    }
    this.scene.applyInput(input);
  }

  async pushCameraFrame(_frame: Uint8Array): Promise<void> {
    // accepted no-op
  }

  async pushMicrophoneAudio(_chunk: Uint8Array): Promise<void> {
    // accepted no-op
  }

  /** Test helper: ask the bridge/API for camera permission. */
  requestCameraPermission(): Promise<'allow' | 'deny'> {
    return this.events.onCameraPermissionRequested();
  }

  private queueMouseMove(x: number, y: number): void {
    this.movePending = { x, y };
    if (this.moveScheduled) return;
    this.moveScheduled = true;
    setImmediate(() => {
      this.moveScheduled = false;
      const p = this.movePending;
      this.movePending = null;
      if (!p || !this.scene) return;
      this.scene.applyInput({ type: 'mousemove', x: p.x, y: p.y });
    });
  }

  private startFrames(): void {
    if (!this.emitFrames || this.frameTimer) return;
    const tick = (): void => {
      this.frameTimer = null;
      if (!this.open) return;
      void this.emitFrame().finally(() => {
        if (!this.open || !this.emitFrames) return;
        this.frameTimer = setTimeout(tick, this.frameIntervalMs);
      });
    };
    this.frameTimer = setTimeout(tick, 0);
  }

  private stopFrames(): void {
    if (this.frameTimer) {
      clearTimeout(this.frameTimer);
      this.frameTimer = null;
    }
  }

  private async emitFrame(): Promise<void> {
    if (this.frameBusy || !this.scene || !this.renderer || !this.open) return;
    this.frameBusy = true;
    try {
      const now = Date.now();
      if (now - this.fpsWindowStart >= 1000) {
        this.emitFps = this.framesThisSecond;
        this.framesThisSecond = 0;
        this.fpsWindowStart = now;
      }
      const snap = this.scene.snapshot({
        nowMs: now,
        emitFps: this.emitFps,
        encodeMs: this.renderer.encodeMs,
        jpegQuality: this.renderer.jpegQuality,
      });
      const jpeg = await this.renderer.renderJpeg(snap);
      if (!this.open) return;
      this.events.onVideoFrame(jpeg);
      this.framesThisSecond++;
    } catch (err) {
      console.warn('[mock-harness] frame encode failed:', (err as Error).message);
    } finally {
      this.frameBusy = false;
    }
  }
}

export function createMockBrowserSessionFactory(options?: {
  emitFrames?: boolean;
  frameIntervalMs?: number;
}): BrowserSessionFactory {
  return {
    create(sessionId, events) {
      return new MockBrowserSession(sessionId, events, options);
    },
  };
}
