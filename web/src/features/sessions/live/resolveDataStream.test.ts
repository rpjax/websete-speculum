import { describe, expect, it } from 'vitest'
import { resolveDataStreamForPage } from './resolveDataStream'

describe('resolveDataStreamForPage', () => {
  it('obeys WebTransport and uses env transport origin', () => {
    expect(
      resolveDataStreamForPage({
        configured: 'webTransport',
        hubOrigin: 'https://hub.example',
        transportOrigin: 'https://localhost:8443',
      }),
    ).toEqual({
      kind: 'webTransport',
      transportBaseUrl: 'https://localhost:8443',
    })
  })

  it('obeys WebTransport with empty same-origin transport', () => {
    expect(
      resolveDataStreamForPage({
        configured: 'webTransport',
        hubOrigin: '',
        transportOrigin: '',
      }),
    ).toEqual({
      kind: 'webTransport',
      transportBaseUrl: '',
    })
  })

  it('obeys WebSocket and uses hub/same-origin, ignoring WT transport origin', () => {
    expect(
      resolveDataStreamForPage({
        configured: 'webSocket',
        hubOrigin: '',
        transportOrigin: 'https://localhost:8443',
      }),
    ).toEqual({
      kind: 'webSocket',
      transportBaseUrl: '',
    })
  })
})
