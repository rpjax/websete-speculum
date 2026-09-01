import type { DataStreamTransportKind } from '@/lib/speculum'

export interface ResolveDataStreamOptions {
  configured: DataStreamTransportKind
  hubOrigin: string
  transportOrigin: string
}

export interface ResolvedDataStream {
  kind: DataStreamTransportKind
  transportBaseUrl: string
}

/**
 * Map Sessions.dataStreamTransport to the carrier base URL.
 * Kind comes only from admin/client-config — no client-side fallback.
 * WebSocket uses hub/same-origin (`/w7s/vstream`); WebTransport uses env transport origin.
 */
export function resolveDataStreamForPage(options: ResolveDataStreamOptions): ResolvedDataStream {
  const kind = options.configured
  return {
    kind,
    transportBaseUrl:
      kind === 'webSocket'
        ? options.hubOrigin.trim()
        : options.transportOrigin.trim(),
  }
}
