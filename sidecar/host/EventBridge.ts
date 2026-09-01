import {
  type AllocationLifecycleSignal,
  type BrowserEditingState,
  type BrowserFault,
  type BrowserPermissionDecision,
  type BrowserSessionEvents,
} from '../browser/BrowserSession';
import { DropOldestQueue } from './DropOldestQueue';

export type PermissionKind = 'camera' | 'microphone';

export interface PermissionRequestMsg {
  corrId: number;
  kind: PermissionKind;
  sessionId: string;
}

/** Per-session event fan-out with bounded queues (media DropOldest). */
export class EventBridge implements BrowserSessionEvents {
  readonly video = new DropOldestQueue<Uint8Array>(2);
  readonly audio = new DropOldestQueue<Uint8Array>(2);
  /**
   * PageProjection Dom+Cssom envelopes — sized for SPA boot churn (T5 DropAll on overflow).
   * Default 8192 aligns with API PageProjectionFrameChannels.DefaultConnectionCapacity (BZ1).
   * Replaced at Launch via {@link configureDomCapacity} when Sessions config differs.
   */
  private _dom = new DropOldestQueue<{
    sequence: number;
    generation: number;
    plane: string;
    operation: string;
    timestampMs: number;
    body: Uint8Array;
    partIndex?: number;
    partCount?: number;
    flags?: number;
    version?: number;
  }>(8192);

  get dom(): DropOldestQueue<{
    sequence: number;
    generation: number;
    plane: string;
    operation: string;
    timestampMs: number;
    body: Uint8Array;
    partIndex?: number;
    partCount?: number;
    flags?: number;
    version?: number;
    contextId?: number;
  }> {
    return this._dom;
  }

  /** High-watermark fraction — pause Virtual live emit before DropAll (T5 backpressure defer). */
  static readonly DomBackpressureRatio = 0.8;

  /** Resume live emit when depth falls below this fraction of capacity. */
  static readonly DomBackpressureClearRatio = 0.5;

  private _domBackpressure = false;
  private _onDomBackpressureChanged: ((paused: boolean) => void) | null = null;
  readonly consoleQ = new DropOldestQueue<{ level: number; text: string }>(64);
  readonly location = new DropOldestQueue<string>(1);
  readonly navigationBlocked = new DropOldestQueue<string>(8);
  readonly editableFocus = new DropOldestQueue<BrowserEditingState | null>(1);
  readonly crash = new DropOldestQueue<BrowserFault>(4);
  /** Opt-in path hops for Telemetry.Sessions.VideoStreamingInput.SidecarAdmitted (DropOldest). */
  readonly videoStreamingInputPath = new DropOldestQueue<{
    phase: string;
    kind: string;
    unixMs: number;
  }>(32);
  /** Opt-in path hops for Telemetry.Sessions.PageProjection.Input.* (DropOldest). */
  readonly pageProjectionInputPath = new DropOldestQueue<{
    phase: string;
    kind: string;
    unixMs: number;
    reason?: string;
    generation?: number;
  }>(32);
  /** Opt-in PageProjection lifecycle (GenerationBumped | QueueDropped | session_pool_*) — DropOldest. */
  readonly pageProjectionLifecycle = new DropOldestQueue<{
    kind: string;
    fromGeneration: number;
    toGeneration: number;
    reason: string;
    url?: string;
    frameKind?: string;
    unixMs: number;
    droppedCount?: number;
    capacity?: number;
    sequence?: number;
    lowestDroppedSequence?: number;
    highestDroppedSequence?: number;
    displayWidth?: number;
    displayHeight?: number;
    poolSize?: number;
    waitMs?: number;
    heldMs?: number;
  }>(32);
  /** Opt-in allocation lifecycle for Telemetry.Sessions.Sidecar.* (DropOldest). */
  readonly allocationLifecycle = new DropOldestQueue<
    AllocationLifecycleSignal & { unixMs: number }
  >(16);
  private faulted = false;

  private nextCorrId = 1;
  private sinkEpoch = 0;
  private readonly permissionWaiters = new Map<
    number,
    { kind: PermissionKind; resolve: (d: BrowserPermissionDecision) => void; epoch: number }
  >();
  private permissionSink: ((req: PermissionRequestMsg) => void) | null = null;

  constructor(readonly sessionId: string) {}

  /**
   * Apply Sessions.frameQueueCapacity at Launch (queue must be empty —
   * Create→Launch window has no Dom emits yet).
   */
  configureDomCapacity(capacity: number): void {
    const cap = Math.max(64, Math.min(65_536, Math.floor(capacity)));
    if (cap === this._dom.maxCapacity) return;
    if (this._dom.pendingCount > 0) {
      return;
    }
    this._dom = new DropOldestQueue(cap);
    this._domBackpressure = false;
  }

  /** PageProjection registers pause/resume of page liveEmit (T5 defer). */
  setDomBackpressureHandler(handler: ((paused: boolean) => void) | null): void {
    this._onDomBackpressureChanged = handler;
  }

  get isDomBackpressured(): boolean {
    return this._domBackpressure;
  }

  private updateDomBackpressureAfterWrite(): void {
    const capacity = this._dom.maxCapacity;
    const pending = this._dom.pendingCount;
    if (!this._domBackpressure && pending > capacity * EventBridge.DomBackpressureRatio) {
      this._domBackpressure = true;
      this._onDomBackpressureChanged?.(true);
      return;
    }
    if (this._domBackpressure && pending <= capacity * EventBridge.DomBackpressureClearRatio) {
      this._domBackpressure = false;
      this._onDomBackpressureChanged?.(false);
    }
  }

  /** Called by WatchPageProjectionFrames after each dequeue so clear can fire. */
  notifyDomQueueDrained(): void {
    this.updateDomBackpressureAfterWrite();
  }

  /** M3: API reports consumer-side queue depth; motor decides pause/resync. */
  onConsumerPressure(
    pressure: {
      queuedFrames?: number;
      queuedBytes?: number;
      oldestQueuedMs?: number;
      draining?: boolean;
    },
    requestResync?: (req: { reason: string }) => Promise<void>,
  ): void {
    const frames = Math.max(0, Math.floor(Number(pressure.queuedFrames ?? 0)));
    const capacity = this._dom.maxCapacity;
    if (capacity <= 0) {
      return;
    }

    const ratio = frames / capacity;
    const oldestMs = Number(pressure.oldestQueuedMs ?? 0);

    if (!this._domBackpressure && ratio > EventBridge.DomBackpressureRatio) {
      this._domBackpressure = true;
      this._onDomBackpressureChanged?.(true);
    } else if (
      this._domBackpressure
      && (ratio <= EventBridge.DomBackpressureClearRatio || pressure.draining === true)
    ) {
      this._domBackpressure = false;
      this._onDomBackpressureChanged?.(false);
    }

    if (requestResync && (oldestMs >= 5000 || ratio > 0.95)) {
      void requestResync({ reason: 'consumer_pressure' }).catch(() => {});
    }
  }

  /** Called by Control stream to receive permission requests. Returns sink epoch. */
  setPermissionSink(sink: ((req: PermissionRequestMsg) => void) | null): number {
    this.permissionSink = sink;
    return ++this.sinkEpoch;
  }

  /**
   * Control stream detached. Denies waiters from `ownedEpoch` only, and clears the
   * sink only when it is still `ownedSink` so a reopened Control is not wiped.
   */
  clearPermissionSink(
    ownedSink: ((req: PermissionRequestMsg) => void) | null,
    ownedEpoch: number,
  ): void {
    for (const [id, w] of this.permissionWaiters) {
      if (w.epoch !== ownedEpoch) continue;
      w.resolve('deny');
      this.permissionWaiters.delete(id);
    }
    if (this.permissionSink === ownedSink) {
      this.permissionSink = null;
    }
  }

  onVideoFrame(jpeg: Uint8Array): void {
    this.video.tryWrite(jpeg);
  }

  onPageProjectionFrame(diff: {
    sequence: number;
    generation: number;
    plane: string;
    operation: string;
    timestampMs: number;
    body: Uint8Array;
    partIndex?: number;
    partCount?: number;
    flags?: number;
    version?: number;
    contextId?: number;
  }): void {
    if (this.dom.isClosed) {
      this.emitLifecycleQueueDropped({
        reason: 'sidecar_bridge_closed',
        generation: diff.generation,
        operation: diff.operation,
        plane: diff.plane,
        droppedCount: 1,
        capacity: this.dom.maxCapacity,
        sequence: diff.sequence,
        lowestDroppedSequence: diff.sequence,
        highestDroppedSequence: diff.sequence,
      });
      return;
    }

    const { dropped, lowestSequence, highestSequence } = this.dom.tryWriteDropAllOnOverflow(diff);
    if (dropped > 0) {
      this.emitLifecycleQueueDropped({
        reason: 'sidecar_bridge',
        generation: diff.generation,
        operation: diff.operation,
        plane: diff.plane,
        droppedCount: dropped,
        capacity: this.dom.maxCapacity,
        sequence: diff.sequence,
        lowestDroppedSequence: lowestSequence ?? undefined,
        highestDroppedSequence: highestSequence ?? undefined,
      });
      // DropAll emptied the backlog — clear backpressure so Virtual can re-establish.
      if (this._domBackpressure) {
        this._domBackpressure = false;
        this._onDomBackpressureChanged?.(false);
      }
    } else {
      this.updateDomBackpressureAfterWrite();
    }
  }

  /** Emit queue_dropped lifecycle; if lifecycle queue itself DropOldests, emit sidecar_lifecycle_overflow. */
  emitLifecycleQueueDropped(ev: {
    reason: string;
    generation: number;
    operation?: string;
    plane?: string;
    droppedCount: number;
    capacity: number;
    sequence?: number;
    lowestDroppedSequence?: number;
    highestDroppedSequence?: number;
  }): void {
    const payload = {
      kind: 'queue_dropped',
      fromGeneration: 0,
      toGeneration: ev.generation,
      reason: ev.reason,
      frameKind: ev.operation,
      url: ev.plane,
      unixMs: Date.now(),
      droppedCount: ev.droppedCount,
      capacity: ev.capacity,
      sequence: ev.sequence,
      lowestDroppedSequence: ev.lowestDroppedSequence,
      highestDroppedSequence: ev.highestDroppedSequence,
    };
    const { droppedOldest } = this.pageProjectionLifecycle.tryWriteReportingDrop(payload);
    if (droppedOldest) {
      // Best-effort: try to surface that a prior QD was evicted from the lifecycle queue.
      this.pageProjectionLifecycle.tryWrite({
        kind: 'queue_dropped',
        fromGeneration: 0,
        toGeneration: ev.generation,
        reason: 'sidecar_lifecycle_overflow',
        frameKind: ev.operation,
        url: ev.plane,
        unixMs: Date.now(),
        droppedCount: 1,
        capacity: this.pageProjectionLifecycle.maxCapacity,
        sequence: ev.sequence,
        lowestDroppedSequence: ev.sequence,
        highestDroppedSequence: ev.sequence,
      });
    }
  }

  onPageProjectionGenerationBumped(event: {
    fromGeneration: number;
    toGeneration: number;
    reason: string;
    url?: string;
    frameKind?: string;
  }): void {
    this.pageProjectionLifecycle.tryWrite({
      kind: 'generation_bumped',
      fromGeneration: event.fromGeneration,
      toGeneration: event.toGeneration,
      reason: event.reason,
      url: event.url,
      frameKind: event.frameKind,
      unixMs: Date.now(),
    });
  }

  onPageProjectionSoftNavObserved(event: {
    generation: number;
    url?: string;
    documentEpoch?: string;
    liveArmed: boolean;
  }): void {
    this.pageProjectionLifecycle.tryWrite({
      kind: 'soft_nav_observed',
      fromGeneration: event.generation,
      toGeneration: event.generation,
      reason: event.documentEpoch ?? '',
      url: event.url,
      frameKind: event.liveArmed ? 'armed' : 'disarmed',
      unixMs: Date.now(),
    });
  }

  onSessionPoolAcquired(event: {
    maxWidth: number;
    maxHeight: number;
    poolSize: number;
    waitMs: number;
  }): void {
    this.pageProjectionLifecycle.tryWrite({
      kind: 'session_pool_acquired',
      fromGeneration: 0,
      toGeneration: 0,
      reason: '',
      unixMs: Date.now(),
      displayWidth: event.maxWidth,
      displayHeight: event.maxHeight,
      poolSize: event.poolSize,
      waitMs: event.waitMs,
    });
  }

  onSessionPoolReleased(event: { heldMs: number }): void {
    this.pageProjectionLifecycle.tryWrite({
      kind: 'session_pool_released',
      fromGeneration: 0,
      toGeneration: 0,
      reason: '',
      unixMs: Date.now(),
      heldMs: event.heldMs,
    });
  }

  onPageProjectionScrollEchoHit(event: {
    kind: string;
    generation?: number;
    anchor?: string;
    scrollX?: number;
    scrollY?: number;
    scrollTop?: number;
    scrollLeft?: number;
  }): void {
    const coords =
      event.kind === 'viewport'
        ? `${event.scrollX ?? 0},${event.scrollY ?? 0}`
        : `${event.scrollTop ?? 0},${event.scrollLeft ?? 0}`;
    this.pageProjectionLifecycle.tryWrite({
      kind: 'scroll_echo_hit',
      fromGeneration: event.generation ?? 0,
      toGeneration: event.generation ?? 0,
      reason: event.kind,
      url: event.anchor,
      frameKind: coords,
      unixMs: Date.now(),
    });
  }

  onAudioFrame(chunk: Uint8Array): void {
    this.audio.tryWrite(chunk);
  }

  onConsole(level: number, text: string): void {
    this.consoleQ.tryWrite({ level, text });
  }

  onLocationChanged(url: string): void {
    this.location.tryWrite(url);
  }

  onMainFrameNavigationBlocked(url: string): void {
    this.navigationBlocked.tryWrite(url);
  }

  onEditableFocusChanged(editing: BrowserEditingState | null): void {
    this.editableFocus.tryWrite(editing);
  }

  onCameraPermissionRequested(): Promise<BrowserPermissionDecision> {
    return this.requestPermission('camera');
  }

  onMicrophonePermissionRequested(): Promise<BrowserPermissionDecision> {
    return this.requestPermission('microphone');
  }

  onCrash(fault: BrowserFault): void {
    this.faulted = true;
    this.crash.tryWrite(fault);
  }

  /** Fire-and-forget admit hop — never blocks PushInput. */
  onVideoStreamingInputPathAdmitted(kind: string): void {
    this.videoStreamingInputPath.tryWrite({
      phase: 'admit',
      kind,
      unixMs: Date.now(),
    });
  }

  /** Fire-and-forget Dom Projection path hop — never blocks PushDomInput. */
  onPageProjectionIntentPath(event: {
    phase: 'sidecar_admitted' | 'cdp_dropped';
    kind: string;
    reason?: string;
    generation?: number;
  }): void {
    this.pageProjectionInputPath.tryWrite({
      phase: event.phase,
      kind: event.kind,
      unixMs: Date.now(),
      reason: event.reason,
      generation: event.generation,
    });
  }

  onAllocationLifecycle(signal: AllocationLifecycleSignal): void {
    this.allocationLifecycle.tryWrite({
      ...signal,
      unixMs: Date.now(),
    });
  }

  get isFaulted(): boolean {
    return this.faulted;
  }

  resolvePermission(corrId: number, allow: boolean): void {
    const waiter = this.permissionWaiters.get(corrId);
    if (!waiter) return;
    this.permissionWaiters.delete(corrId);
    waiter.resolve(allow ? 'allow' : 'deny');
  }

  /**
   * Ends all Watch* queues. Contract: call only from SessionRegistry.dispose /
   * CloseConnection (API Dispose of the sidecar session object). Chromium stop(),
   * crash, or navigate must never close the bridge — gRPC streams outlive the browser.
   */
  close(): void {
    this.video.close();
    this.audio.close();
    this.dom.close();
    this.consoleQ.close();
    this.location.close();
    this.navigationBlocked.close();
    this.editableFocus.close();
    this.crash.close();
    this.videoStreamingInputPath.close();
    this.pageProjectionInputPath.close();
    this.pageProjectionLifecycle.close();
    this.allocationLifecycle.close();
    for (const [, w] of this.permissionWaiters) {
      w.resolve('deny');
    }
    this.permissionWaiters.clear();
    this.permissionSink = null;
  }

  private requestPermission(kind: PermissionKind): Promise<BrowserPermissionDecision> {
    const corrId = this.nextCorrId++;
    const epoch = this.sinkEpoch;
    return new Promise<BrowserPermissionDecision>((resolve) => {
      this.permissionWaiters.set(corrId, { kind, resolve, epoch });
      const sink = this.permissionSink;
      if (!sink) {
        this.permissionWaiters.delete(corrId);
        resolve('deny');
        return;
      }
      // Yield so nested unary handlers (e.g. probe resyncPermissions) do not block
      // the Control stream from receiving PermissionReply on the same grpc worker.
      setImmediate(() => {
        if (!this.permissionWaiters.has(corrId)) return;
        sink({ corrId, kind, sessionId: this.sessionId });
      });
    });
  }
}
