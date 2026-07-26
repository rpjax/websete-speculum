/** Wire pipe kinds — must match SessionWebTransportEndpoint.SessionPipeKind. */
export const PipeKind = {
  Frame: 1,
  ConsoleOutput: 2,
  Notification: 3,
  UserInput: 4,
  ConsoleInput: 5,
  Status: 6,
} as const

export type PipeKindValue = (typeof PipeKind)[keyof typeof PipeKind]

export const ConsoleOutputKind = {
  Console: 1,
  EvalResult: 2,
} as const

export const NotificationKind = {
  LocationChanged: 1,
  MainFrameNavigationBlocked: 2,
  EditableFocusChanged: 3,
  Crashed: 4,
  InputRejected: 5,
} as const

export const DefaultHubPath = '/vhub'
export const DefaultTransportPath = '/vtransport'
export const MaxMessageBytes = 1024 * 1024
