/**
 * FrameTransport that logs each send to the console (dev / bring-up).
 * Always accepts; never defers.
 */

import type { FrameTransport, FrameTransportResult } from './frameTransport';

export type ConsoleFrameTransportOptions = {
  /** Prefix for log lines. Default: `[FrameTransport]`. */
  label?: string;
  /** Log full byte preview. Default: true. */
  previewBytes?: boolean;
  /** Max bytes shown in preview. Default: 32. */
  previewMaxBytes?: number;
};

function hexPreview(bytes: Uint8Array, max: number): string {
  const n = Math.min(bytes.length, max);
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    parts.push(bytes[i]!.toString(16).padStart(2, '0'));
  }
  const suffix = bytes.length > max ? ` …(+${bytes.length - max})` : '';
  return parts.join(' ') + suffix;
}

export class ConsoleFrameTransport implements FrameTransport {
  private readonly label: string;
  private readonly previewBytes: boolean;
  private readonly previewMaxBytes: number;
  private sendCount = 0;
  private lastPayload: Uint8Array | null = null;

  constructor(opts: ConsoleFrameTransportOptions = {}) {
    this.label = opts.label ?? '[FrameTransport]';
    this.previewBytes = opts.previewBytes ?? true;
    this.previewMaxBytes = opts.previewMaxBytes ?? 32;
  }

  get sends(): number {
    return this.sendCount;
  }

  /** Most recent payload (copy). */
  get lastBytes(): Uint8Array | null {
    return this.lastPayload === null ? null : this.lastPayload.slice();
  }

  send(bytes: Uint8Array): FrameTransportResult {
    this.sendCount += 1;
    this.lastPayload = bytes.slice();
    if (this.previewBytes) {
      console.log(
        `${this.label} send #${this.sendCount} len=${bytes.length}`,
        hexPreview(bytes, this.previewMaxBytes),
      );
    } else {
      console.log(`${this.label} send #${this.sendCount} len=${bytes.length}`);
    }
    return 'accepted';
  }
}
