import { ConsoleOutputKind, DefaultTransportPath, PipeKind } from './constants'
import type { DataStreamTransport } from './dataStreamTransport'
import { Emitter } from './emitter'
import { FramedReader, writeMessage } from './framing'
import type {
  DomDiff,
  DomProjectionInput,
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
 * Logical data streams for a live session (frames, DomDiffs, input, console, notifications, status).
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
  private domProjectionInput: WritableStreamDefaultWriter<Uint8Array> | null = null
  private consoleInput: WritableStreamDefaultWriter<Uint8Array> | null = null
  private userInputWriteChain: Promise<void> = Promise.resolve()
  private domProjectionInputWriteChain: Promise<void> = Promise.resolve()
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

    if (this.mirrorMode === 'domProjection') {
      this.domProjectionInput = await this.openOutgoingWriter(PipeKind.DomProjectionInput)
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
        this.mirrorMode === 'domProjection'
          ? 'VideoStreamingInput is not available in DomProjection mode'
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

  async sendDomProjectionInput(input: DomProjectionInput): Promise<void> {
    if (!this.domProjectionInput) {
      throw new Error(
        this.mirrorMode !== 'domProjection'
          ? 'DomProjectionInput is not available in VideoStreaming mode'
          : 'Data streams are not open',
      )
    }
    const traceId = input.traceId?.trim() || newInputTraceId()
    const writer = this.domProjectionInput
    const write = this.domProjectionInputWriteChain.then(() =>
      writeMessage(writer, {
        generation: input.generation ?? 0,
        type: input.type,
        anchor: input.anchor ?? null,
        timestampClient: input.timestampClient ?? null,
        traceId,
        payload: input.payload ?? '{}',
      }),
    )
    this.domProjectionInputWriteChain = write.then(
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
    await closeWriter(this.domProjectionInput)
    this.domProjectionInput = null
    this.domProjectionInputWriteChain = Promise.resolve()
    await closeWriter(this.consoleInput)
    this.consoleInput = null
    this.consoleInputWriteChain = Promise.resolve()

    await this.transport.close()
    this.emit('close')
  }

  private async openOutgoingWriter(
    kind:
      | typeof PipeKind.VideoStreamingInput
      | typeof PipeKind.DomProjectionInput
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
    try {
      const framed = new FramedReader(reader)
      const kind = await framed.readPipeKind()
      if (kind == null) {
        return
      }

      for await (const message of framed.messages()) {
        switch (kind) {
          case PipeKind.Frame:
            this.emit('frame', message as SessionEventMap['frame'])
            break
          case PipeKind.DomDiff:
            const normalized = normalizeDomDiff(message)
            if (normalized) this.emit('domDiff', normalized)
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

/** Normalize hub DomDiff; reject retired snapshot/patch/root wire shapes. */
function normalizeDomDiff(message: unknown): DomDiff | null {
  const raw = (message ?? {}) as Record<string, unknown>
  const kind = String(raw.kind ?? '')
  if (kind === 'snapshot' || kind === 'patch' || raw.root != null) {
    return null
  }
  if (kind !== 'diff' && kind !== 'cssom') {
    return null
  }
  const targetRaw = raw.target
  const target =
    targetRaw == null || targetRaw === ''
      ? null
      : String(targetRaw)
  if (kind === 'diff' && target !== 'document' && target !== 'anchors') {
    return null
  }
  return {
    sequence: Number(raw.sequence ?? 0),
    generation: Number(raw.generation ?? 0),
    timestamp: Number(raw.timestamp ?? 0),
    treeType: String(raw.treeType ?? 'dom'),
    kind,
    target,
    nodes: (raw.nodes as DomDiff['nodes']) ?? null,
    urls: (raw.urls as DomDiff['urls']) ?? null,
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
