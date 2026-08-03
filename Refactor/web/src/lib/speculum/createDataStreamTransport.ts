import {
  DefaultStreamPath,
  DefaultTransportPath,
  type DataStreamTransportKind,
} from './constants'
import type { DataStreamTransport } from './dataStreamTransport'
import { WebSocketDataStreamTransport } from './webSocketDataStreamTransport'
import { WebTransportDataStreamTransport } from './webTransportDataStreamTransport'

export function normalizeDataStreamTransportKind(
  value: string | null | undefined,
): DataStreamTransportKind {
  return value === 'webSocket' ? 'webSocket' : 'webTransport'
}

export function defaultPathForDataStreamTransport(
  kind: DataStreamTransportKind,
): string {
  return kind === 'webSocket' ? DefaultStreamPath : DefaultTransportPath
}

/** Build the carrier for the configured Sessions.dataStreamTransport kind. */
export function createDataStreamTransport(
  kind: DataStreamTransportKind = 'webTransport',
): DataStreamTransport {
  return kind === 'webSocket'
    ? new WebSocketDataStreamTransport()
    : new WebTransportDataStreamTransport()
}
