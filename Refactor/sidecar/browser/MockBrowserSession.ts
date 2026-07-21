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
} from './BrowserSession';

/**
 * In-memory BrowserSession for composition / gRPC smoke tests.
 * Optionally emits periodic fake video frames after launch.
 */
export class MockBrowserSession implements BrowserSession {
  private open = false;
  private width = 1280;
  private height = 720;
  private url = 'about:blank';
  private resizing = false;
  private state: BrowserState = {
    cookies: [],
    localStorage: [],
    idbRecords: [],
    history: [],
  };
  private frameTimer: ReturnType<typeof setInterval> | null = null;
  private readonly emitFrames: boolean;

  constructor(
    readonly sessionId: string,
    private readonly events: BrowserSessionEvents,
    options?: { emitFrames?: boolean; frameIntervalMs?: number },
  ) {
    this.emitFrames = options?.emitFrames ?? true;
    this.frameIntervalMs = options?.frameIntervalMs ?? 500;
  }

  private readonly frameIntervalMs: number;

  async launch(options: BrowserLaunchOptions): Promise<BrowserReadyInfo> {
    this.width = options.width;
    this.height = options.height;
    this.open = true;
    this.url = 'https://mock.local/';
    this.events.onLocationChanged(this.url);
    this.startFrames();
    return { width: this.width, height: this.height };
  }

  async stop(): Promise<void> {
    this.stopFrames();
    this.open = false;
  }

  async dispose(): Promise<void> {
    await this.stop();
  }

  async getStatus(): Promise<BrowserStatus> {
    return {
      isOpen: this.open,
      tabCount: 1,
      url: this.url,
      resizing: this.resizing,
      width: this.width,
      height: this.height,
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
    this.url = url;
    this.events.onLocationChanged(url);
  }

  async refresh(): Promise<void> {
    this.events.onLocationChanged(this.url);
  }

  async resize(request: BrowserResizeRequest): Promise<BrowserResizeResult> {
    this.resizing = true;
    this.width = request.width;
    this.height = request.height;
    this.resizing = false;
    return {
      ok: true,
      width: this.width,
      height: this.height,
      chromeWidth: this.width,
      chromeHeight: this.height,
      displayWidth: this.width,
      displayHeight: this.height,
    };
  }

  async probe(request: BrowserProbeRequest): Promise<BrowserProbeResult> {
    return {
      ok: true,
      data: { ops: request.ops, mock: true },
    };
  }

  async evaluate(code: string): Promise<BrowserEvalResult> {
    this.events.onConsole(0, `[mock evaluate] ${code.slice(0, 80)}`);
    return { ok: true, value: JSON.stringify({ echo: code }) };
  }

  async pushInput(input: BrowserInput): Promise<void> {
    if (input.type === 'type' || input.type === 'text') {
      this.events.onConsole(0, `[mock input] ${input.type}: ${input.text}`);
    }
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

  private startFrames(): void {
    if (!this.emitFrames || this.frameTimer) return;
    this.frameTimer = setInterval(() => {
      if (!this.open) return;
      // Minimal JPEG SOI/EOI stub (not a real image — enough for transport smoke).
      this.events.onVideoFrame(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]));
    }, this.frameIntervalMs);
  }

  private stopFrames(): void {
    if (this.frameTimer) {
      clearInterval(this.frameTimer);
      this.frameTimer = null;
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
