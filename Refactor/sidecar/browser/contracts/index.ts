/**
 * Sealed BrowserSession mirror-mode contracts (docs/page-projection/spec/browser-session.md).
 * Normative TypeScript surface for cutover — no optional PP bags on core.
 */

import type { DomInputIngress } from '@speculum/page-projection/core/input/intentTypes';
import type { FormControlSnap } from '@speculum/page-projection/core/formControlSnap';
import type { ProjectionTelemetryConfig } from '@speculum/page-projection/core/telemetry';
import type { ProjectionTelemetryMessage } from '@speculum/page-projection/core/telemetry';
import type {
  BrowserColorScheme,
  BrowserDeviceProfile,
  BrowserEvalResult,
  BrowserGeolocation,
  BrowserProbeRequest,
  BrowserProbeResult,
  BrowserReadyInfo,
  BrowserResizeRequest,
  BrowserResizeResult,
  BrowserScriptInjection,
  BrowserState,
  BrowserTouchPoint,
  CookieNormalizeStats,
  BrowserEditingState,
  BrowserFault,
} from '../BrowserSession';

export type { DomInputIngress, FormControlSnap, ProjectionTelemetryMessage };
export type {
  BrowserReadyInfo,
  BrowserResizeRequest,
  BrowserResizeResult,
  BrowserProbeRequest,
  BrowserProbeResult,
  BrowserEvalResult,
  BrowserState,
  CookieNormalizeStats,
};

export interface ViewportPolicyBounds {
  minWidth: number;
  minHeight: number;
  maxWidth: number;
  maxHeight: number;
}

/** Grant / deny — wire PermissionReply. */
export type BrowserPermissionDecision = 'granted' | 'denied';
export type BrowserPermissionKind = 'camera' | 'microphone';

export interface IBrowserPermissionHost {
  requestPermission(kind: BrowserPermissionKind): Promise<BrowserPermissionDecision>;
}

export interface IBrowserSessionSink {
  onConsole(level: number, text: string): void;
  onLocationChanged(url: string): void;
  onMainFrameNavigationBlocked(url: string): void;
  onEditableFocusChanged(editing: BrowserEditingState | null): void;
  onCrash(fault: BrowserFault): void;
  onSessionAllocated(): void;
  onSessionReleased(): void;
}

export interface PageProjectionFrame {
  contextId: number;
  sequence: number;
  generation: number;
  body: Uint8Array;
  timestampMs: number;
  partIndex?: number;
  partCount?: number;
  flags?: number;
  version?: number;
}

export interface IPageProjectionSessionSink extends IBrowserSessionSink {
  onFrame(frame: PageProjectionFrame): void;
  onProjectionTelemetry(message: ProjectionTelemetryMessage): void;
}

export interface IVideoStreamingSessionSink extends IBrowserSessionSink {
  onVideoFrame(jpeg: Uint8Array): void;
  onAudioFrame(chunk: Uint8Array): void;
  onDisplayAllocated(dims: { width: number; height: number }): void;
  onDisplayReleased(): void;
  onAllocationFaulted(signal: { errorCode?: string; phase?: string; reason?: string }): void;
}

export interface BrowserLaunchOptionsBase {
  width: number;
  height: number;
  viewportPolicy: ViewportPolicyBounds;
  locale: string;
  language: string;
  timeZoneId: string;
  colorScheme: BrowserColorScheme;
  geolocation?: BrowserGeolocation;
  device?: BrowserDeviceProfile;
  scripts?: readonly BrowserScriptInjection[];
  allowedNavigationDomains?: readonly string[];
  cpuProfiling?: boolean;
}

export interface StopCpuProfileResult {
  ok: boolean;
  reason?: string;
  summary?: {
    totalSamples: number;
    wallMs: number;
    approxCpuMs: number;
    ourCode: { totalPct: number; totalMs: number };
  };
  profileBytes?: Uint8Array;
}

/** Interactive video input — no history (goBack/goForward are core). */
export type BrowserInput =
  | { type: 'mousemove'; x: number; y: number }
  | { type: 'mousedown'; x: number; y: number; button: number }
  | { type: 'mouseup'; x: number; y: number; button: number }
  | { type: 'wheel'; x: number; y: number; deltaX: number; deltaY: number }
  | { type: 'keydown'; key: string }
  | { type: 'keyup'; key: string }
  | { type: 'type'; text: string }
  | { type: 'text'; text: string; source?: string }
  | {
      type: 'touch';
      phase: 'start' | 'move' | 'end' | 'cancel';
      points: readonly BrowserTouchPoint[];
      changedIds: readonly number[];
    };

export interface IBrowserSession {
  readonly sessionId: string;
  stop(): Promise<void>;
  dispose(): Promise<void>;
  restoreState(state: BrowserState): Promise<CookieNormalizeStats>;
  exportState(): Promise<BrowserState>;
  navigate(url: string): Promise<void>;
  refresh(): Promise<void>;
  goBack(): Promise<void>;
  goForward(): Promise<void>;
  resize(request: BrowserResizeRequest): Promise<BrowserResizeResult>;
  probe(request: BrowserProbeRequest): Promise<BrowserProbeResult>;
  evaluate(code: string): Promise<BrowserEvalResult>;
  pushCameraFrame(frame: Uint8Array): Promise<void>;
  pushMicrophoneAudio(chunk: Uint8Array): Promise<void>;
  startCpuProfile(): Promise<{ ok: boolean; reason?: string }>;
  stopCpuProfile(): Promise<StopCpuProfileResult>;
}

export interface PageProjectionLaunchOptions extends BrowserLaunchOptionsBase {
  frameRateHz: number;
  maxFrameBytes?: number;
  projectionTelemetry?: Partial<ProjectionTelemetryConfig>;
  frameQueueCapacity: number;
  browserPoolSize?: number;
  browserPoolRefillPerSec?: number;
}

export interface PageProjectionStatus {
  isOpen: boolean;
  tabCount: number;
  url: string;
  resizing: boolean;
  width: number;
  height: number;
  chromeWidth: number;
  chromeHeight: number;
}

export interface PageProjectionTelemetrySnapshot {
  contextId: number;
  logicalWidth: number;
  logicalHeight: number;
  chromeWidth: number;
  chromeHeight: number;
  dataPlaneListening: boolean;
  generation: number;
  sequence: number;
  producerHalted: boolean;
  frameQueueDepth: number;
  inputPendingCount: number;
}

export interface PageProjectionResyncRequest {
  contextId?: number;
  reason?: string;
}

export interface StateSnapshotOpts {
  table?: 'digest' | 'full';
  liveChildOrder?: boolean;
  cssom?: 'none' | 'committed' | 'scan';
  tree?: boolean;
  formProps?: boolean;
  frameNewNodes?: boolean;
}

export interface StateSnapshotTableDigest {
  rowCount: number;
  tableHash: string;
}

export interface StateSnapshotTableDump {
  digest: StateSnapshotTableDigest;
  rows: unknown;
}

export interface StateSnapshotLiveChildOrder {
  childrenByParent: ReadonlyArray<readonly [parentId: number, childIds: readonly number[]]>;
}

export interface StateSnapshotFrameNewNode {
  nodeId: number;
  connected: boolean;
}

export type StateSnapshotResult =
  | { ok: false; reason: string; contextId?: number }
  | {
      ok: true;
      contextId: number;
      generation: number;
      sequence: number;
      table: StateSnapshotTableDigest | StateSnapshotTableDump;
      liveChildOrder: StateSnapshotLiveChildOrder | null;
      cssom: {
        mode: 'committed' | 'scan';
        table: { sheets: unknown; rules: unknown };
        live: { sheets: unknown };
      } | null;
      tree: unknown | null;
      formProps: FormControlSnap[] | null;
      frameNewNodes: readonly StateSnapshotFrameNewNode[] | null;
    };

export interface EmitFrameResult {
  ok: boolean;
  reason?: string;
  generation?: number;
  sequence?: number;
}

export interface IPageProjectionBrowserSession extends IBrowserSession {
  launch(options: PageProjectionLaunchOptions & { mirrorMode?: string; frameRateHz?: number; projectionTelemetry?: Partial<ProjectionTelemetryConfig>; cpuProfiling?: boolean; scripts?: readonly BrowserScriptInjection[]; width: number; height: number }): Promise<BrowserReadyInfo>;
  getStatus(): Promise<PageProjectionStatus>;
  getTelemetrySnapshot(contextId?: number): Promise<PageProjectionTelemetrySnapshot>;
  pushInput(input: DomInputIngress): Promise<
    { status: 'dispatched' } | { status: 'dropped'; reason: string }
  >;
  getAsset(key: string, opts?: unknown): Promise<unknown | null>;
  putUpload(id: string, body: Uint8Array, contentType: string, name: string): Promise<void>;
  requestResync(request?: PageProjectionResyncRequest): Promise<void>;
  haltClocks(): Promise<{ ok: boolean; reason?: string }>;
  resumeClocks(): Promise<{ ok: boolean; reason?: string }>;
  emitFrame(contextId?: number): Promise<EmitFrameResult>;
  getStateSnapshot(contextId: number, opts?: StateSnapshotOpts): Promise<StateSnapshotResult>;
}

export interface VideoStreamingLaunchOptions extends BrowserLaunchOptionsBase {
  screencastMaxEncodeScale: number;
  displayWidth: number;
  displayHeight: number;
}

export interface VideoStreamingStatus {
  isOpen: boolean;
  tabCount: number;
  url: string;
  resizing: boolean;
  width: number;
  height: number;
  chromeWidth: number;
  chromeHeight: number;
  displayAllocated: boolean;
  displayWidth: number;
  displayHeight: number;
  screencastActive: boolean;
}

export interface VideoStreamingTelemetrySnapshot {
  inputPendingCount: number;
  inputChainDepth: number;
  displayAllocated: boolean;
  displayWidth: number;
  displayHeight: number;
  logicalWidth: number;
  logicalHeight: number;
  chromeWidth: number;
  chromeHeight: number;
  inputBackend: 'os' | 'patchright';
  touchPrimary: boolean;
  userDataDirPresent: boolean;
  screencastActive: boolean;
  lastEncodeWidth: number;
  lastEncodeHeight: number;
}

export interface IVideoStreamingBrowserSession extends IBrowserSession {
  launch(options: VideoStreamingLaunchOptions): Promise<BrowserReadyInfo>;
  getStatus(): Promise<VideoStreamingStatus>;
  getTelemetrySnapshot(): Promise<VideoStreamingTelemetrySnapshot>;
  pushInput(input: BrowserInput): Promise<void>;
}

export interface IBrowserSessionFactory {
  createPageProjection(
    sessionId: string,
    sink: IPageProjectionSessionSink,
    permissions: IBrowserPermissionHost,
  ): IPageProjectionBrowserSession;
  createVideoStreaming(
    sessionId: string,
    sink: IVideoStreamingSessionSink,
    permissions: IBrowserPermissionHost,
  ): IVideoStreamingBrowserSession;
}
