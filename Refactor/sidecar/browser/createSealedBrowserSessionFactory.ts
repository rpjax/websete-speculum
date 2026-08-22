/**
 * Sealed-mode factory adapting the legacy {@link BrowserSessionFactory} Create→Launch shape.
 * Selects PageProjection vs VideoStreaming at {@link BrowserSession.launch} from mirrorMode.
 */

import type {
  BrowserSession,
  BrowserSessionEvents,
  BrowserSessionFactory,
  BrowserLaunchOptions,
  BrowserReadyInfo,
  BrowserState,
  BrowserStatus,
  BrowserResizeRequest,
  BrowserResizeResult,
  BrowserProbeRequest,
  BrowserProbeResult,
  BrowserEvalResult,
  BrowserInput,
  CookieNormalizeStats,
} from './BrowserSession';
import {
  PageProjectionBrowserSession,
  type V4ProjectionFactoryOptions,
} from './mirror/projection/session/PageProjectionBrowserSession';
import { VideoStreamingBrowserSession } from './VideoStreamingBrowserSession';
import { DisplayAllocator } from './patchright/Display';
import type {
  IBrowserPermissionHost,
  IBrowserSessionFactory,
  IPageProjectionBrowserSession,
  IPageProjectionSessionSink,
  IVideoStreamingBrowserSession,
  IVideoStreamingSessionSink,
} from './contracts';

class DenyAllPermissions implements IBrowserPermissionHost {
  async requestPermission(): Promise<'granted' | 'denied'> {
    return 'denied';
  }
}

/**
 * Placeholder until Launch — then replaces self with PP or Video session.
 */
class ModeSelectingSession implements BrowserSession {
  private inner: BrowserSession | null = null;

  constructor(
    readonly sessionId: string,
    private readonly events: BrowserSessionEvents,
    private readonly displays: DisplayAllocator,
    private readonly ppOpts: V4ProjectionFactoryOptions,
  ) {}

  private requireInner(): BrowserSession {
    if (!this.inner) {
      throw Object.assign(new Error('session not launched'), {
        code: 'FAILED_PRECONDITION',
        errorCode: 'not_launched',
        phase: 'session',
      });
    }
    return this.inner;
  }

  async launch(options: BrowserLaunchOptions): Promise<BrowserReadyInfo> {
    if (this.inner) {
      return this.inner!.launch(options);
    }
    if (options.mirrorMode === 'pageProjection') {
      this.inner = new PageProjectionBrowserSession(this.sessionId, this.events, this.ppOpts) as unknown as BrowserSession;
    } else {
      this.inner = new VideoStreamingBrowserSession(this.sessionId, this.events, this.displays);
    }
    return this.inner!.launch(options);
  }

  stop(): Promise<void> {
    return this.inner ? this.inner.stop() : Promise.resolve();
  }
  dispose(): Promise<void> {
    return this.inner ? this.inner.dispose() : Promise.resolve();
  }
  getStatus(): Promise<BrowserStatus> {
    return this.requireInner().getStatus();
  }
  restoreState(state: BrowserState): Promise<CookieNormalizeStats> {
    return this.requireInner().restoreState(state);
  }
  exportState(): Promise<BrowserState> {
    return this.requireInner().exportState();
  }
  navigate(url: string): Promise<void> {
    return this.requireInner().navigate(url);
  }
  refresh(): Promise<void> {
    return this.requireInner().refresh();
  }
  goBack(): Promise<void> {
    return this.requireInner().goBack();
  }
  goForward(): Promise<void> {
    return this.requireInner().goForward();
  }
  resize(request: BrowserResizeRequest): Promise<BrowserResizeResult> {
    return this.requireInner().resize(request);
  }
  probe(request: BrowserProbeRequest): Promise<BrowserProbeResult> {
    return this.requireInner().probe(request);
  }
  evaluate(code: string): Promise<BrowserEvalResult> {
    return this.requireInner().evaluate(code);
  }
  pushInput(input: BrowserInput): Promise<void> {
    return this.requireInner().pushInput(input);
  }
  /** gRPC PushDomInput → sealed PP {@link PageProjectionBrowserSession.pushInput}. */
  async pushDomInput(input: {
    type: string;
    anchor?: string | null;
    targetId?: number | null;
    nodeId?: number | null;
    contextId?: number;
    generation?: number;
    timestampClient?: number | null;
    payloadJson?: string;
    payload?: string;
  }): Promise<{ status: 'dispatched' } | { status: 'dropped'; reason: string }> {
    const s = this.requireInner() as BrowserSession & {
      pushInput?(i: unknown): Promise<unknown>;
    };
    const out = await s.pushInput?.(input);
    if (out && typeof out === 'object' && out !== null && 'status' in out) {
      return out as { status: 'dispatched' } | { status: 'dropped'; reason: string };
    }
    throw Object.assign(new Error('PageProjection input not supported'), {
      code: 'FAILED_PRECONDITION',
    });
  }
  pushCameraFrame(frame: Uint8Array): Promise<void> {
    return this.requireInner().pushCameraFrame(frame);
  }
  pushMicrophoneAudio(chunk: Uint8Array): Promise<void> {
    return this.requireInner().pushMicrophoneAudio(chunk);
  }
  getDomAsset?(
    ...args: Parameters<NonNullable<BrowserSession['getDomAsset']>>
  ): ReturnType<NonNullable<BrowserSession['getDomAsset']>> {
    return this.requireInner().getDomAsset!(...args);
  }
  putDomUpload?(
    ...args: Parameters<NonNullable<BrowserSession['putDomUpload']>>
  ): ReturnType<NonNullable<BrowserSession['putDomUpload']>> {
    return this.requireInner().putDomUpload!(...args);
  }
  requestResync?(request?: { contextId?: number; reason?: string }): Promise<void> {
    return this.requireInner().requestResync?.(request) ?? Promise.resolve();
  }
  haltClocks?(): Promise<{ ok: boolean; reason?: string }> {
    return this.requireInner().haltClocks?.() ?? Promise.resolve({ ok: false, reason: 'unsupported' });
  }
  resumeClocks?(): Promise<{ ok: boolean; reason?: string }> {
    return this.requireInner().resumeClocks?.() ?? Promise.resolve({ ok: false, reason: 'unsupported' });
  }
  emitFrame?(contextId?: number): Promise<{
    ok: boolean;
    generation?: number;
    sequence?: number;
    reason?: string;
  }> {
    return (
      this.requireInner().emitFrame?.(contextId) ??
      Promise.resolve({ ok: false, reason: 'unsupported' })
    );
  }
  getStateSnapshot?(
    contextId: number,
    opts?: import('./contracts').StateSnapshotOpts,
  ): Promise<import('./contracts').StateSnapshotResult> {
    const s = this.requireInner();
    if (!s.getStateSnapshot) {
      return Promise.resolve({ ok: false, reason: 'unsupported', contextId });
    }
    return s.getStateSnapshot(contextId, opts);
  }
}

export function createSealedBrowserSessionFactory(options?: {
  headless?: boolean;
  displays?: DisplayAllocator;
}): BrowserSessionFactory & IBrowserSessionFactory {
  const displays = options?.displays ?? new DisplayAllocator();
  const ppOpts: V4ProjectionFactoryOptions = { headless: options?.headless ?? true };
  void DenyAllPermissions;

  const legacy: BrowserSessionFactory = {
    create(sessionId, events) {
      return new ModeSelectingSession(sessionId, events, displays, ppOpts);
    },
  };

  return {
    ...legacy,
    createPageProjection(
      sessionId: string,
      sink: IPageProjectionSessionSink,
      _permissions: IBrowserPermissionHost,
    ): IPageProjectionBrowserSession {
      const events: BrowserSessionEvents = {
        onVideoFrame() {},
        onAudioFrame() {},
        onConsole: (l, t) => sink.onConsole(l, t),
        onLocationChanged: (u) => sink.onLocationChanged(u),
        onMainFrameNavigationBlocked: (u) => sink.onMainFrameNavigationBlocked(u),
        onEditableFocusChanged: (e) => sink.onEditableFocusChanged(e),
        onCrash: (f) => sink.onCrash(f),
        onCameraPermissionRequested: async () => 'deny',
        onMicrophonePermissionRequested: async () => 'deny',
        onPageProjectionFrame: (d) =>
          sink.onFrame({
            contextId: d.contextId ?? 1,
            sequence: d.sequence,
            generation: d.generation,
            body: d.body,
            timestampMs: d.timestampMs,
            partIndex: d.partIndex,
            partCount: d.partCount,
            flags: d.flags,
            version: d.version,
          }),
        onPageProjectionTelemetry: (m) => sink.onProjectionTelemetry(m),
      };
      return new PageProjectionBrowserSession(
        sessionId,
        events,
        ppOpts,
      ) as unknown as IPageProjectionBrowserSession;
    },
    createVideoStreaming(
      sessionId: string,
      sink: IVideoStreamingSessionSink,
      _permissions: IBrowserPermissionHost,
    ): IVideoStreamingBrowserSession {
      const events: BrowserSessionEvents = {
        onVideoFrame: (j) => sink.onVideoFrame(j),
        onAudioFrame: (a) => sink.onAudioFrame(a),
        onConsole: (l, t) => sink.onConsole(l, t),
        onLocationChanged: (u) => sink.onLocationChanged(u),
        onMainFrameNavigationBlocked: (u) => sink.onMainFrameNavigationBlocked(u),
        onEditableFocusChanged: (e) => sink.onEditableFocusChanged(e),
        onCrash: (f) => sink.onCrash(f),
        onCameraPermissionRequested: async () => 'deny',
        onMicrophonePermissionRequested: async () => 'deny',
        onAllocationLifecycle: (s) => {
          if (s.kind === 'display_allocated') {
            sink.onDisplayAllocated({
              width: s.displayWidth ?? 0,
              height: s.displayHeight ?? 0,
            });
          } else if (s.kind === 'display_released') {
            sink.onDisplayReleased();
          } else if (s.kind === 'allocation_faulted') {
            sink.onAllocationFaulted({
              errorCode: s.errorCode,
              phase: s.phase,
              reason: s.reason,
            });
          }
        },
      };
      return new VideoStreamingBrowserSession(
        sessionId,
        events,
        displays,
      ) as unknown as IVideoStreamingBrowserSession;
    },
  };
}
