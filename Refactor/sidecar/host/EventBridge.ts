import {
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

  private nextCorrId = 1;
  private readonly permissionWaiters = new Map<
    number,
    { kind: PermissionKind; resolve: (d: BrowserPermissionDecision) => void }
  >();
  private permissionSink: ((req: PermissionRequestMsg) => void) | null = null;

  constructor(readonly sessionId: string) {}

  /** Called by Control stream to receive permission requests. */
  setPermissionSink(sink: ((req: PermissionRequestMsg) => void) | null): void {
    this.permissionSink = sink;
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
    this.crash.tryWrite(fault);
  }

  resolvePermission(corrId: number, allow: boolean): void {
    const waiter = this.permissionWaiters.get(corrId);
    if (!waiter) return;
    this.permissionWaiters.delete(corrId);
    waiter.resolve(allow ? 'allow' : 'deny');
  }

  close(): void {
    this.video.close();
    this.audio.close();
    this.consoleQ.close();
    this.location.close();
    this.navigationBlocked.close();
    this.editableFocus.close();
    this.crash.close();
    for (const [, w] of this.permissionWaiters) {
      w.resolve('deny');
    }
    this.permissionWaiters.clear();
    this.permissionSink = null;
  }

  private requestPermission(kind: PermissionKind): Promise<BrowserPermissionDecision> {
    const corrId = this.nextCorrId++;
    return new Promise<BrowserPermissionDecision>((resolve) => {
      this.permissionWaiters.set(corrId, { kind, resolve });
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
