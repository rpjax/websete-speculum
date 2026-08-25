import { ConsoleOutputKind, DefaultTransportPath, PipeKind } from './constants'
import type { DataStreamTransport } from './dataStreamTransport'
import { Emitter } from './emitter'
import { FramedReader, writeMessage } from './framing'
import type {
  PageProjectionFrame,
  PageProjectionIntent,
  EvalResult,
  MirrorMode,
  SessionConsoleOutput,
  SessionEventMap,
  SessionInput,
  SessionInputWireMeta,
  SessionStatus,
} from './types'
import { normalizeMirrorMode } from './types'
import { WebTransportDataStreamTransport } from './webTransportDataStreamTransport'

/** Opaque correlation id for Journal ↔ front Activity (always stamped on product send). */
export function newInputTraceId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '')
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

export interface DataStreamsOptions {
  baseUrl?: string
  /** Origin used to fetch `/w7s/health/webtransport-cert` pin (usually the hub). */
  certificateHashBaseUrl?: string
  transportPath?: string
  sessionId: string
  token: string
  /** Defaults to videoStreaming — gates which input pipe is opened. */
  mirrorMode?: MirrorMode
  /** Defaults to {@link WebTransportDataStreamTransport}. */
  transport?: DataStreamTransport
}

/**
 * Logical data streams for a live session (frames, PageProjectionFrames, input, console, notifications, status).
 * Carrier is pluggable via {@link DataStreamTransport}.
 */
export class DataStreams extends Emitter<SessionEventMap> {
  private readonly baseUrl: string
  private readonly certificateHashBaseUrl: string
  private readonly transportPath: string
  private readonly sessionId: string
  private readonly token: string
  private readonly mirrorMode: MirrorMode
  private readonly transport: DataStreamTransport
  private userInput: WritableStreamDefaultWriter<Uint8Array> | null = null
  private pageProjectionInput: WritableStreamDefaultWriter<Uint8Array> | null = null
  private consoleInput: WritableStreamDefaultWriter<Uint8Array> | null = null
  private userInputWriteChain: Promise<void> = Promise.resolve()
  private pageProjectionInputWriteChain: Promise<void> = Promise.resolve()
  private consoleInputWriteChain: Promise<void> = Promise.resolve()
  private lifetime: AbortController | null = null
  private readonly pendingEval = new Map<
    number,
    { resolve: (value: EvalResult) => void; reject: (error: Error) => void }
  >()
  private nextEvalId = 1
  private closed = false
  private connected = false

  constructor(options: DataStreamsOptions) {
    super()
    this.baseUrl = options.baseUrl ?? ''
    this.certificateHashBaseUrl = options.certificateHashBaseUrl ?? options.baseUrl ?? ''
    this.transportPath = options.transportPath ?? DefaultTransportPath
    this.sessionId = options.sessionId
    this.token = options.token
    this.mirrorMode = normalizeMirrorMode(options.mirrorMode)
    this.transport = options.transport ?? new WebTransportDataStreamTransport()
  }

  get isOpen(): boolean {
    return !this.closed && this.connected
  }

  get mode(): MirrorMode {
    return this.mirrorMode
  }

  async open(): Promise<void> {
    await this.close()
    this.closed = false
    this.lifetime = new AbortController()

    await this.transport.connect({
      baseUrl: this.baseUrl,
      certificateHashBaseUrl: this.certificateHashBaseUrl,
      path: this.transportPath,
      sessionId: this.sessionId,
      token: this.token,
    })
    this.connected = true

    if (this.mirrorMode === 'pageProjection') {
      this.pageProjectionInput = await this.openOutgoingWriter(PipeKind.PageProjectionIntent)
    } else {
      this.userInput = await this.openOutgoingWriter(PipeKind.VideoStreamingInput)
    }
    this.consoleInput = await this.openOutgoingWriter(PipeKind.ConsoleInput)
    this.pumpIncoming()
    this.watchClosed()
  }

  async sendInput(input: SessionInput & SessionInputWireMeta): Promise<void> {
    if (!this.userInput) {
      throw new Error(
        this.mirrorMode === 'pageProjection'
          ? 'VideoStreamingInput is not available in PageProjection mode'
          : 'Data streams are not open',
      )
    }
    const traceId = input.traceId?.trim() || newInputTraceId()
    const clientTimestampMs = input.clientTimestampMs ?? Date.now()
    const { traceId: _t, clientTimestampMs: _c, ...event } = input
    const writer = this.userInput
    const write = this.userInputWriteChain.then(() =>
      writeMessage(writer, {
        type: event.type,
        payload: JSON.stringify(event),
        traceId,
        clientTimestampMs,
      }),
    )
    this.userInputWriteChain = write.then(
      () => undefined,
      () => undefined,
    )
    await write
  }

  async sendPageProjectionIntent(input: PageProjectionIntent): Promise<void> {
    if (!this.pageProjectionInput) {
      throw new Error(
        this.mirrorMode !== 'pageProjection'
          ? 'PageProjectionIntent is not available in VideoStreaming mode'
          : 'Data streams are not open',
      )
    }
    const traceId = input.traceId?.trim() || newInputTraceId()
    const writer = this.pageProjectionInput
    const write = this.pageProjectionInputWriteChain.then(() =>
      writeMessage(writer, {
        generation: input.generation ?? 0,
        type: input.type,
        anchor: input.anchor ?? null,
        targetId: input.targetId ?? null,
        timestampClient: input.timestampClient ?? null,
        traceId,
        payload: input.payload ?? '{}',
        contextId: input.contextId ?? 1,
        schemaVersion: input.schemaVersion ?? 0,
        viewportW: input.viewportW ?? null,
        viewportH: input.viewportH ?? null,
        census: input.census ?? null,
      }),
    )
    this.pageProjectionInputWriteChain = write.then(
      () => undefined,
      () => undefined,
    )
    await write
  }

  async evaluate(code: string): Promise<EvalResult> {
    if (!this.consoleInput) {
      throw new Error('Data streams are not open')
    }
    const id = this.nextEvalId++
    const result = new Promise<EvalResult>((resolve, reject) => {
      this.pendingEval.set(id, { resolve, reject })
    })
    const writer = this.consoleInput
    const write = this.consoleInputWriteChain.then(() =>
      writeMessage(writer, { id, code }),
    )
    this.consoleInputWriteChain = write.then(
      () => undefined,
      () => undefined,
    )
    await write
    return result
  }

  async getStatus(): Promise<SessionStatus> {
    if (!this.connected) {
      throw new Error('Data streams are not open')
    }
    const pipe = await this.transport.openPipe(PipeKind.Status)
    if (!pipe.writable || !pipe.readable) {
      throw new Error('Status pipe is not duplex')
    }
    const writer = pipe.writable.getWriter()
    const reader = pipe.readable.getReader()
    try {
      for await (const message of new FramedReader(reader).messages()) {
        return message as SessionStatus
      }
      throw new Error('Status response was empty')
    } finally {
      try {
        await writer.close()
      } catch {
        // ignore
      }
      reader.releaseLock()
    }
  }

  async close(): Promise<void> {
    if (this.closed && !this.connected) {
      return
    }
    this.closed = true
    this.connected = false
    this.lifetime?.abort()
    this.lifetime = null

    for (const [, pending] of this.pendingEval) {
      pending.reject(new Error('Data streams closed'))
    }
    this.pendingEval.clear()

    await closeWriter(this.userInput)
    this.userInput = null
    this.userInputWriteChain = Promise.resolve()
    await closeWriter(this.pageProjectionInput)
    this.pageProjectionInput = null
    this.pageProjectionInputWriteChain = Promise.resolve()
    await closeWriter(this.consoleInput)
    this.consoleInput = null
    this.consoleInputWriteChain = Promise.resolve()

    await this.transport.close()
    this.emit('close')
  }

  private async openOutgoingWriter(
    kind:
      | typeof PipeKind.VideoStreamingInput
      | typeof PipeKind.PageProjectionIntent
      | typeof PipeKind.ConsoleInput,
  ): Promise<WritableStreamDefaultWriter<Uint8Array>> {
    const pipe = await this.transport.openPipe(kind)
    if (!pipe.writable) {
      throw new Error(`Pipe ${kind} has no writable`)
    }
    const writer = pipe.writable.getWriter()
    if (pipe.readable) {
      void this.pumpDuplexResponses(pipe.readable.getReader())
    }
    return writer
  }

  private async pumpDuplexResponses(
    reader: ReadableStreamDefaultReader<Uint8Array>,
  ): Promise<void> {
    try {
      for await (const message of new FramedReader(reader).messages()) {
        this.onConsole(message as SessionConsoleOutput)
      }
    } catch {
      // stream ended
    }
  }

  private pumpIncoming(): void {
    const signal = this.lifetime?.signal
    if (!signal) {
      return
    }

    void (async () => {
      try {
        for await (const pipe of this.transport.acceptIncoming(signal)) {
          if (!pipe.readable) {
            continue
          }
          void this.handleIncoming(pipe.readable)
        }
      } catch (error) {
        if (!signal.aborted) {
          this.emit('error', error)
        }
      }
    })()
  }

  private async handleIncoming(stream: ReadableStream<Uint8Array>): Promise<void> {
    const reader = stream.getReader()
    let kind: number | null = null
    try {
      const framed = new FramedReader(reader)
      kind = await framed.readPipeKind()
      if (kind == null) {
        return
      }

      for await (const message of framed.messages()) {
        switch (kind) {
          case PipeKind.Frame:
            this.emit('frame', message as SessionEventMap['frame'])
            break
          case PipeKind.PageProjectionFrame:
            const normalized = normalizePageProjectionFrame(message)
            if (normalized) {
              this.emit('pageProjectionFrame', normalized)
            } else {
              const raw = (message ?? {}) as Record<string, unknown>
              this.emit('pageProjectionFrameRejected', {
                sequence: Number(raw.sequence ?? 0) || null,
                generation: Number(raw.generation ?? 0) || null,
                plane: raw.plane != null ? String(raw.plane) : null,
                operation: raw.operation != null ? String(raw.operation) : null,
                reason: rejectReason(raw),
              })
            }
            break
          case PipeKind.ConsoleOutput:
            this.onConsole(message as SessionConsoleOutput)
            break
          case PipeKind.Notification:
            this.emit('notification', message as SessionEventMap['notification'])
            break
          default:
            break
        }
      }
    } catch (error) {
      if (!this.closed) {
        this.emit('error', error)
      }
    } finally {
      reader.releaseLock()
      // Fan-out Complete / wire cut ends the PageProjection uni-stream while WT/WS stays up.
      // Surface EOF so DomProjector can T8 OOB resync (journal-only QD is invisible).
      if (
        kind === PipeKind.PageProjectionFrame
        && !this.closed
        && this.connected
      ) {
        this.emit('pageProjectionFrameEnded', { reason: 'wire_stall' })
      }
    }
  }

  private onConsole(message: SessionConsoleOutput): void {
    this.emit('console', message)
    if (message?.kind !== ConsoleOutputKind.EvalResult || message.requestId == null) {
      return
    }
    const requestId = Number(message.requestId)
    const pending = this.pendingEval.get(requestId)
    if (!pending) {
      return
    }
    this.pendingEval.delete(requestId)
    pending.resolve({
      requestId,
      ok: Boolean(message.ok),
      value: message.value,
      error: message.error,
    })
  }

  private watchClosed(): void {
    const closed = this.transport.closed
    if (!closed) {
      return
    }
    void closed.then(
      () => this.close(),
      () => this.close(),
    )
  }
}

/**
 * Wire `body` arrives as a `Uint8Array` (MessagePack `bin`) via `@msgpack/msgpack`; also
 * accept `ArrayBuffer` / plain number arrays / `{ data: number[] }` Buffer-like shapes so
 * tests and alternate transports don't need to know the decoder's exact output shape.
 */
function toBodyBytes(value: unknown): Uint8Array | null {
  if (value == null) return null
  if (value instanceof Uint8Array) return value.byteLength > 0 ? value : null
  if (value instanceof ArrayBuffer) {
    return value.byteLength > 0 ? new Uint8Array(value) : null
  }
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView
    return view.byteLength > 0 ? new Uint8Array(view.buffer, view.byteOffset, view.byteLength) : null
  }
  if (Array.isArray(value)) {
    return value.length > 0 ? Uint8Array.from(value as number[]) : null
  }
  if (typeof value === 'object' && Array.isArray((value as { data?: unknown }).data)) {
    const data = (value as { data: number[] }).data
    return data.length > 0 ? Uint8Array.from(data) : null
  }
  return null
}

/** Normalize hub PageProjectionFrame; reject legacy snapshot wire shapes. */
function rejectReason(raw: Record<string, unknown>): string {
  if (raw.kind === 'snapshot' || raw.root != null || Array.isArray(raw.nodes) || Array.isArray(raw.urls)) {
    return 'legacy_snapshot_shape'
  }
  const plane = String(raw.plane ?? '').trim()
  const operation = String(raw.operation ?? '').trim()
  // Redesigned binary wire (PP-WIRE-1): empty plane/operation is the sole discriminator.
  if (!plane && !operation) {
    return toBodyBytes(raw.body) ? 'normalize_rejected' : 'missing_body'
  }
  if (plane !== 'dom' && plane !== 'cssom') return 'invalid_plane'
  if (!operation) return 'missing_operation'
  return 'normalize_rejected'
}

function normalizePageProjectionFrame(message: unknown): PageProjectionFrame | null {
  const raw = (message ?? {}) as Record<string, unknown>
  // Retired legacy shapes.
  if (raw.kind === 'snapshot' || raw.root != null || Array.isArray(raw.nodes) || Array.isArray(raw.urls)) {
    return null
  }
  const plane = String(raw.plane ?? '').trim()
  const operation = String(raw.operation ?? '').trim()

  // Redesigned binary wire (PP-WIRE-1): API relays Body opaquely with empty plane/operation.
  if (!plane && !operation) {
    const body = toBodyBytes(raw.body)
    if (!body) return null
    return {
      sequence: Number(raw.sequence ?? 0),
      generation: Number(raw.generation ?? 0),
      timestamp: Number(raw.timestamp ?? 0),
      plane: '',
      operation: '',
      body,
      partIndex: Number(raw.partIndex ?? 0),
      partCount: Number(raw.partCount ?? 1) || 1,
      flags: Number(raw.flags ?? 0),
      version: Number(raw.version ?? 1) || 1,
    }
  }

  if (plane !== 'dom' && plane !== 'cssom') {
    return null
  }
  if (!operation) {
    return null
  }
  return {
    sequence: Number(raw.sequence ?? 0),
    generation: Number(raw.generation ?? 0),
    timestamp: Number(raw.timestamp ?? 0),
    plane,
    operation,
    document: (raw.document as PageProjectionFrame['document']) ?? null,
    childList: (raw.childList as PageProjectionFrame['childList']) ?? null,
    patch: (raw.patch as PageProjectionFrame['patch']) ?? null,
    scrollViewport: (raw.scrollViewport as PageProjectionFrame['scrollViewport']) ?? null,
    scrollElement: (raw.scrollElement as PageProjectionFrame['scrollElement']) ?? null,
    install: (raw.install as PageProjectionFrame['install']) ?? null,
    sheetList: (raw.sheetList as PageProjectionFrame['sheetList']) ?? null,
    ruleList: (raw.ruleList as PageProjectionFrame['ruleList']) ?? null,
    cssomPatch: (raw.cssomPatch as PageProjectionFrame['cssomPatch']) ?? null,
  }
}

async function closeWriter(
  writer: WritableStreamDefaultWriter<Uint8Array> | null,
): Promise<void> {
  if (!writer) {
    return
  }
  try {
    await writer.close()
  } catch {
    try {
      writer.releaseLock()
    } catch {
      // ignore
    }
  }
}
