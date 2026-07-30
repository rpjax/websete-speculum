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
  readonly consoleQ = new DropOldestQueue<{ level: number; text: string }>(64);
  readonly location = new DropOldestQueue<string>(1);
  readonly navigationBlocked = new DropOldestQueue<string>(8);
  readonly editableFocus = new DropOldestQueue<BrowserEditingState | null>(1);
  readonly crash = new DropOldestQueue<BrowserFault>(4);
  /** Opt-in path hops for Telemetry.Sessions.Input.SidecarAdmitted (DropOldest). */
  readonly inputPath = new DropOldestQueue<{ phase: string; kind: string; unixMs: number }>(32);
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
  onInputPathAdmitted(kind: string): void {
    this.inputPath.tryWrite({
      phase: 'admit',
      kind,
      unixMs: Date.now(),
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
    this.consoleQ.close();
    this.location.close();
    this.navigationBlocked.close();
    this.editableFocus.close();
    this.crash.close();
    this.inputPath.close();
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
