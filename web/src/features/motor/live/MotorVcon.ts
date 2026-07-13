import type * as signalR from '@microsoft/signalr'
import type { ConsoleOutputPayload } from './types'

export const MSG_URL = 0x04
export const MSG_CONSOLE = 0x05
export const MSG_EVAL_RESULT = 0x06
export const MSG_REDIRECT = 0x0a

const VCON_METHODS = ['log', 'warn', 'error', 'info', 'debug'] as const

export type ConsoleInputSubject = signalR.Subject<{ id: number; code: string }>

export interface MotorVconHandlers {
  onMappedUrl: (url: string) => void
  onRedirect: (url: string) => void
}

function wireToU8(data: ConsoleOutputPayload['data']): Uint8Array {
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (Array.isArray(data)) return new Uint8Array(data)
  if (typeof data === 'string') {
    const bin = atob(data)
    const u8 = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
    return u8
  }
  return new Uint8Array(0)
}

export class MotorVcon {
  private evalId = 0
  private evalPending = new Map<number, {
    resolve: (v: unknown) => void
    reject: (e: Error) => void
    timer: ReturnType<typeof setTimeout>
  }>()
  private consoleInputSubject: ConsoleInputSubject | null = null
  private jsBridgeEnabled = false
  private handlers: MotorVconHandlers

  constructor(handlers: MotorVconHandlers) {
    this.handlers = handlers
  }

  setConsoleInputSubject(subject: ConsoleInputSubject | null) {
    this.consoleInputSubject = subject
  }

  setJsBridgeEnabled(enabled: boolean) {
    this.jsBridgeEnabled = enabled
    if (enabled) this.install()
    else this.uninstall()
  }

  handleConsoleOutput(output: ConsoleOutputPayload) {
    const bytes = wireToU8(output.data)
    if (bytes.length < 1) return
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const type = bytes[0]

    if (type === MSG_URL) {
      if (bytes.length < 5) return
      const len = view.getUint32(1, true)
      const mapped = new TextDecoder().decode(bytes.slice(5, 5 + len))
      this.handlers.onMappedUrl(mapped)
    } else if (type === MSG_CONSOLE) {
      if (bytes.length < 6) return
      const level = bytes[1]
      const len = view.getUint32(2, true)
      const text = new TextDecoder().decode(bytes.slice(6, 6 + len))
      const fn = console[VCON_METHODS[level] ?? 'log'] as (...args: unknown[]) => void
      fn.call(console, '%c[VCON]%c ' + text, 'color:#ff9800;font-weight:bold;font-family:monospace', 'color:inherit;font-family:monospace')
    } else if (type === MSG_EVAL_RESULT) {
      if (bytes.length < 10) return
      const id = view.getUint32(1, true)
      const ok = bytes[5] === 1
      const len = view.getUint32(6, true)
      const value = new TextDecoder().decode(bytes.slice(10, 10 + len))
      const p = this.evalPending.get(id)
      if (!p) return
      clearTimeout(p.timer)
      this.evalPending.delete(id)
      if (ok) {
        let parsed: unknown
        try { parsed = JSON.parse(value) } catch { parsed = value }
        p.resolve(parsed)
      } else {
        p.reject(new Error(value))
      }
    } else if (type === MSG_REDIRECT) {
      if (bytes.length < 5) return
      const len = view.getUint32(1, true)
      const redirectUrl = new TextDecoder().decode(bytes.slice(5, 5 + len))
      this.handlers.onRedirect(redirectUrl)
    }
  }

  install() {
    if (!this.jsBridgeEnabled) {
      this.uninstall()
      return
    }
    ;(window as Window & { vcon?: (code: string) => Promise<unknown> }).vcon = (code: string) =>
      new Promise((resolve, reject) => {
        if (!this.consoleInputSubject) {
          reject(new Error('[vcon] No active session'))
          return
        }
        const id = ++this.evalId
        const timer = setTimeout(() => {
          this.evalPending.delete(id)
          reject(new Error('[vcon] Timed out after 10 s'))
        }, 10_000)
        this.evalPending.set(id, { resolve, reject, timer })
        this.consoleInputSubject.next({ id, code })
      })
  }

  uninstall() {
    delete (window as Window & { vcon?: (code: string) => Promise<unknown> }).vcon
  }

  rejectAllPending(reason: string) {
    for (const { reject, timer } of this.evalPending.values()) {
      clearTimeout(timer)
      reject(new Error(reason))
    }
    this.evalPending.clear()
  }

  reset() {
    this.rejectAllPending('[vcon] Session closed')
    this.uninstall()
    this.consoleInputSubject = null
    this.jsBridgeEnabled = false
  }
}
