import type { PipeKindValue } from './constants'

/** Byte pipe opened on a data-stream transport (logical stream = PipeKind). */
export interface DataStreamPipe {
  /** Set when the peer labeled the pipe (incoming); omit when client opens with known kind. */
  kind?: PipeKindValue
  readable?: ReadableStream<Uint8Array>
  writable?: WritableStream<Uint8Array>
}

export interface DataStreamTransportConnectOptions {
  baseUrl?: string
  /** Origin for `/w7s/health/webtransport-cert` pin (usually hub). */
  certificateHashBaseUrl?: string
  path: string
  sessionId: string
  token: string
}

/**
 * Carrier for logical data streams. Implementations may use one socket or many;
 * callers only open/accept pipes by {@link PipeKindValue}.
 */
export interface DataStreamTransport {
  connect(opts: DataStreamTransportConnectOptions): Promise<void>
  /** Client-initiated pipe (usually duplex or client→server). */
  openPipe(kind: PipeKindValue): Promise<DataStreamPipe>
  /** Server-initiated pipes (WT incoming uni / WS demux). */
  acceptIncoming(signal: AbortSignal): AsyncIterable<DataStreamPipe>
  close(): Promise<void>
  /** Settles when the carrier is gone (optional). */
  readonly closed?: Promise<unknown> | null
}
