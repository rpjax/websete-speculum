import { describe, expect, it } from 'vitest'
import {
  createDataStreamTransport,
  defaultPathForDataStreamTransport,
  normalizeDataStreamTransportKind,
} from './createDataStreamTransport'
import { DefaultStreamPath, DefaultTransportPath } from './constants'
import { WebSocketDataStreamTransport } from './webSocketDataStreamTransport'
import { WebTransportDataStreamTransport } from './webTransportDataStreamTransport'

describe('createDataStreamTransport', () => {
  it('normalizes unknown values to webTransport', () => {
    expect(normalizeDataStreamTransportKind(undefined)).toBe('webTransport')
    expect(normalizeDataStreamTransportKind('nope')).toBe('webTransport')
    expect(normalizeDataStreamTransportKind('webSocket')).toBe('webSocket')
  })

  it('picks default paths per kind', () => {
    expect(defaultPathForDataStreamTransport('webTransport')).toBe(DefaultTransportPath)
    expect(defaultPathForDataStreamTransport('webSocket')).toBe(DefaultStreamPath)
  })

  it('builds the matching carrier', () => {
    expect(createDataStreamTransport('webTransport')).toBeInstanceOf(
      WebTransportDataStreamTransport,
    )
    expect(createDataStreamTransport('webSocket')).toBeInstanceOf(WebSocketDataStreamTransport)
  })
})
