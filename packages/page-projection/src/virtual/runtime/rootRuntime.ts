/**
 * Root runtime — sidecar WS, mint, implements emitFrame. Once per tab.
 */

import { CONTEXT_ID_ROOT } from '../../core/frame';
import { PlaneChannel } from '../../core/plane';
import type { DataPlane } from '../../core/plane';
import type { FrameTransport } from '../transport/frameTransport';
import { ConsoleFrameTransport } from '../transport/consoleFrameTransport';
import { LoopbackFrameTransport } from '../transport/loopbackFrameTransport';
import { NullFrameTransport } from '../transport/nullFrameTransport';
import { VirtualDomainBus } from '../bus/virtualDomainBus';
import { ContextIdMint } from '../../core/contextIdMint';
import type { ProjectionConfig } from '../config/projectionConfig';
import { createLoopbackSocketFactory } from '../transport/loopbackSocketFactory';

export class RootRuntime {
  readonly mintAllocator = new ContextIdMint();
  readonly bus: VirtualDomainBus;
  readonly frameTransport: FrameTransport;
  readonly dataPlane: DataPlane | null;
  readonly loopback: LoopbackFrameTransport | null;
  private readonly config: ProjectionConfig;
  private readonly textEncoder = new TextEncoder();
  private telemetryUnsub: (() => void) | null = null;

  constructor(config: ProjectionConfig, win: Window) {
    this.config = config;
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
        createSocket: createLoopbackSocketFactory(config.loopbackCarrier),
      });
      // Do not open() here — establishConnection arms whenOpen before the socket
      // starts connecting (extension plane open-ok can otherwise beat the listener).
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
      isDeliverableDestination: (contextId) => contextId === CONTEXT_ID_ROOT,
      emitFrame: (bytes) => {
        this.frameTransport.send(bytes);
      },
    });
    this.telemetryUnsub = this.bus.onTelemetry((message) => this.fanoutTelemetry(message));
  }

  mint(): number {
    return this.mintAllocator.mint();
  }

  async establishConnection(): Promise<void> {
    if (!this.loopback) return;
    if (!this.loopback.destinationUrl) {
      this.loopback.open(this.config.dataPlaneUrl);
    }
    await this.loopback.establishConnection({
      sessionId: this.config.sessionId,
      generation: this.config.generation,
    });
  }

  /** @deprecated Prefer {@link establishConnection}. */
  async whenOpen(): Promise<void> {
    await this.establishConnection();
  }

  dispose(): void {
    this.telemetryUnsub?.();
    this.telemetryUnsub = null;
  }

  private fanoutTelemetry(message: import('../../core/telemetry').ProjectionTelemetryMessage): void {
    const plane = this.dataPlane;
    if (plane === null) return;
    if ('isEstablished' in plane) {
      if (!(plane as { isEstablished: boolean }).isEstablished) return;
    } else if (!plane.isOpen) {
      return;
    }
    const bytes = this.textEncoder.encode(JSON.stringify(message));
    void plane.send(PlaneChannel.Telemetry, bytes);
  }
}
