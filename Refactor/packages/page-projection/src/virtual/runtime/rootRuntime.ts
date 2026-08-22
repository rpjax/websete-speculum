/**
 * Root runtime — sidecar WS, mint, implements emitFrame. Once per tab.
 */

import { PlaneChannel } from '../../plane';
import type { DataPlane } from '../../plane';
import type { FrameTransport } from '../transport/frameTransport';
import { ConsoleFrameTransport } from '../transport/consoleFrameTransport';
import { LoopbackFrameTransport } from '../transport/loopbackFrameTransport';
import { NullFrameTransport } from '../transport/nullFrameTransport';
import { ProjectionBus, type ResyncRequestEvent } from '../bus/projectionBus';
import { ContextIdMint } from '../../models/contextIdMint';
import type { ProjectionConfig } from '../config/projectionConfig';

export class RootRuntime {
  readonly mintAllocator = new ContextIdMint();
  readonly bus: ProjectionBus;
  readonly frameTransport: FrameTransport;
  readonly dataPlane: DataPlane | null;
  readonly loopback: LoopbackFrameTransport | null;
  private readonly textEncoder = new TextEncoder();
  private telemetryUnsub: (() => void) | null = null;

  constructor(config: ProjectionConfig, win: Window) {
    let frameTransport: FrameTransport;
    let dataPlane: DataPlane | null = null;
    let loopback: LoopbackFrameTransport | null = null;
    if (config.transport === 'console') {
      frameTransport = new ConsoleFrameTransport();
    } else if (config.transport === 'discard') {
      frameTransport = new NullFrameTransport();
    } else {
      loopback = new LoopbackFrameTransport({
        bufferedAmountWatermark: config.bufferedAmountWatermark,
      });
      loopback.open(config.dataPlaneUrl);
      frameTransport = loopback;
      dataPlane = loopback.dataPlane;
    }
    this.frameTransport = frameTransport;
    this.dataPlane = dataPlane;
    this.loopback = loopback;
    this.bus = new ProjectionBus({
      window: win,
      role: 'root',
      mint: () => this.mint(),
      emitFrame: (bytes) => {
        this.frameTransport.send(bytes);
      },
      sendSidecarResync: (req) => this.forwardResyncToSidecar(req),
    });
    this.telemetryUnsub = this.bus.onTelemetry((message) => this.fanoutTelemetry(message));
  }

  mint(): number {
    return this.mintAllocator.mint();
  }

  async whenOpen(): Promise<void> {
    if (!this.loopback) return;
    await this.loopback.whenOpen();
  }

  dispose(): void {
    this.telemetryUnsub?.();
    this.telemetryUnsub = null;
  }

  private fanoutTelemetry(message: import('../../models/telemetry').ProjectionTelemetryMessage): void {
    const plane = this.dataPlane;
    if (plane === null || !plane.isOpen) return;
    const bytes = this.textEncoder.encode(JSON.stringify(message));
    void plane.send(PlaneChannel.Telemetry, bytes);
  }

  private forwardResyncToSidecar(_req: ResyncRequestEvent): void {
    // Virtual root listens on the sidecar Control channel; Projected root uses lab WS.
  }
}
