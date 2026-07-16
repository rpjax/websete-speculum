export type MotorStatus = 'idle' | 'connecting' | 'connected' | 'error'

export interface EditingUiState {
  focused: boolean
  inputMode?: string
  multiline?: boolean
  tagName?: string
}

export interface MotorUiState {
  status: MotorStatus
  statusText: string
  showOverlay: boolean
  url: string
  fps: number | null
  navDisabled: boolean
  editing?: EditingUiState | null
  showKeyboard?: boolean
  correlationId?: string
  connectionId?: string
  persistedSessionId?: string
  sidecarSessionId?: string
}

export interface DeviceProfilePayload {
  mobile: boolean
  touch: boolean
  deviceScaleFactor: number
  maxTouchPoints: number
  userAgentProfile?: string
  screenOrientation?: string
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
  editing?: EditingUiState | null
}

export interface MotorElements {
  canvas: HTMLCanvasElement
  viewport: HTMLDivElement
  urlBar: HTMLInputElement
  ime?: HTMLTextAreaElement | null
}

export type StateListener = (state: MotorUiState) => void
