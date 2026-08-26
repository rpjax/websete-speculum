/**
 * Root runtime — sidecar WS, mint, implements emitFrame. Once per tab.
 */

import { PlaneChannel } from '../../core/plane';
import type { DataPlane } from '../../core/plane';
import type { FrameTransport } from '../transport/frameTransport';
import { ConsoleFrameTransport } from '../transport/consoleFrameTransport';
import { LoopbackFrameTransport } from '../transport/loopbackFrameTransport';
import { NullFrameTransport } from '../transport/nullFrameTransport';
import { VirtualDomainBus } from '../bus/virtualDomainBus';
import { ContextIdMint } from '../../core/contextIdMint';
import type { ProjectionConfig } from '../config/projectionConfig';

export class RootRuntime {
  readonly mintAllocator = new ContextIdMint();
  readonly bus: VirtualDomainBus;
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
    this.bus = new VirtualDomainBus({
      window: win,
      role: 'root',
      mint: () => this.mint(),
      isDeliverableDestination: (contextId) => this.mintAllocator.hasMinted(contextId),
      emitFrame: (bytes) => {
        this.frameTransport.send(bytes);
      },
    });
    this.telemetryUnsub = this.bus.onTelemetry((message) => this.fanoutTelemetry(message));
  }

  mint(): number {
    return this.mintAllocator.mint();
  }

  async whenOpen(): Promise<void> {
    if (this.loopback) {
      await this.loopback.whenOpen();
    }
  }

  dispose(): void {
    this.telemetryUnsub?.();
    this.telemetryUnsub = null;
  }

  private fanoutTelemetry(message: import('../../core/telemetry').ProjectionTelemetryMessage): void {
    const plane = this.dataPlane;
    if (plane === null || !plane.isOpen) return;
    const bytes = this.textEncoder.encode(JSON.stringify(message));
    void plane.send(PlaneChannel.Telemetry, bytes);
  }
}
