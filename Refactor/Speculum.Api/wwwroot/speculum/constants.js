/** @typedef {'frame'|'console'|'notification'|'userInput'|'consoleInput'|'status'} PipeName */

/** Wire pipe kinds — must match SessionWebTransportEndpoint.SessionPipeKind. */
export const PipeKind = Object.freeze({
  Frame: 1,
  ConsoleOutput: 2,
  Notification: 3,
  UserInput: 4,
  ConsoleInput: 5,
  Status: 6,
})

export const ConsoleOutputKind = Object.freeze({
  Console: 1,
  EvalResult: 2,
})

export const NotificationKind = Object.freeze({
  LocationChanged: 1,
  MainFrameNavigationBlocked: 2,
  EditableFocusChanged: 3,
  Crashed: 4,
  InputRejected: 5,
})

export const DefaultHubPath = '/vhub'
export const DefaultTransportPath = '/vtransport'
