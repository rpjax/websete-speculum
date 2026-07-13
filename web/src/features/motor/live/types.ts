export type MotorStatus = 'idle' | 'connecting' | 'connected' | 'error'

export interface MotorUiState {
  status: MotorStatus
  statusText: string
  showOverlay: boolean
  url: string
  fps: number | null
  navDisabled: boolean
  correlationId?: string
  connectionId?: string
  persistedSessionId?: string
  sidecarSessionId?: string
}

export interface FramePayload {
  jpeg: Uint8Array | number[]
  sequence?: number
}

export interface ConsoleOutputPayload {
  data: Uint8Array | ArrayBuffer | number[] | string
}

export interface SessionStatusPayload {
  tabCount: number
  url: string
  resizing: boolean
  width: number
  height: number
  fps: number
  uptimeMs: number
  sessionId: string
  jsBridgeEnabled: boolean
}

export interface MotorElements {
  canvas: HTMLCanvasElement
  viewport: HTMLDivElement
  urlBar: HTMLInputElement
}

export type StateListener = (state: MotorUiState) => void
