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
  /** PageProjection Dom+Cssom envelopes — sized for SPA churn (T5 DropAll on overflow). */
  readonly dom = new DropOldestQueue<{
    sequence: number;
    generation: number;
    plane: string;
    operation: string;
    timestampMs: number;
    body: Uint8Array;
  }>(1024);
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
  /** Opt-in PageProjection lifecycle (GenerationBumped | QueueDropped) — DropOldest. */
  readonly pageProjectionLifecycle = new DropOldestQueue<{
    kind: string;
    fromGeneration: number;
    toGeneration: number;
    reason: string;
    url?: string;
    diffKind?: string;
    unixMs: number;
    droppedCount?: number;
    capacity?: number;
    sequence?: number;
    lowestDroppedSequence?: number;
    highestDroppedSequence?: number;
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

  onPageProjectionDiff(diff: {
    sequence: number;
    generation: number;
    plane: string;
    operation: string;
    timestampMs: number;
    body: Uint8Array;
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

    // T5/D13: overflow → client sequence gap → desync (never silently truncated chronology).
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
      diffKind: ev.operation,
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
        diffKind: ev.operation,
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
    diffKind?: string;
  }): void {
    this.pageProjectionLifecycle.tryWrite({
      kind: 'generation_bumped',
      fromGeneration: event.fromGeneration,
      toGeneration: event.toGeneration,
      reason: event.reason,
      url: event.url,
      diffKind: event.diffKind,
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
      diffKind: event.liveArmed ? 'armed' : 'disarmed',
      unixMs: Date.now(),
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
      diffKind: coords,
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
      sink({ corrId, kind, sessionId: this.sessionId });
    });
  }
}
