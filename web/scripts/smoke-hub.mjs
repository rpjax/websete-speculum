// Ad-hoc driver: proves the refactor hub flow (EnsureProfile → StartSession →
// NavigateAsync → still live → StopSession) against a running API + sidecar.
// Not part of CI.
//
// Usage:
//   node scripts/smoke-hub.mjs                         # process-local API
//   node scripts/smoke-hub.mjs http://localhost:8080   # dockup Traefik (dev/smoke)
import { HubConnectionBuilder, HttpTransportType, LogLevel } from '@microsoft/signalr'
import { MessagePackHubProtocol } from '@microsoft/signalr-protocol-msgpack'

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

const origin = process.argv[2] ?? 'https://localhost:5001'
const navigatePath = process.argv[3] ?? '/watch'
const navigateQuery = process.argv[4] ?? 'v=dQw4w9WgXcQ'

const connection = new HubConnectionBuilder()
  .withUrl(`${origin}/vhub`, { transport: HttpTransportType.WebSockets })
  .withHubProtocol(new MessagePackHubProtocol())
  .configureLogging(LogLevel.Warning)
  .build()

const facts = []
let journal = null
let sessionEnded = null

connection.on('SessionEnded', (evt) => {
  sessionEnded = evt
  console.log('SessionEnded →', evt)
})
connection.on('SyncUrl', () => {})
connection.on('Redirect', () => {})

try {
  await connection.start()
  console.log('hub connected', connection.connectionId)

  journal = connection.stream('StreamJournalAsync').subscribe({
    next: (fact) => {
      facts.push(fact)
      console.log('journal fact →', fact.type, fact.indexKeys)
    },
    error: (error) => console.error('journal stream error:', error?.message ?? error),
    complete: () => {},
  })

  const ensured = await connection.invoke('EnsureProfileAsync', { profileId: null })
  console.log('EnsureProfileAsync →', ensured)

  const started = await connection.invoke('StartSessionAsync', {
    profileId: ensured.profileId,
    path: '/',
    query: '',
    viewportWidth: 1280,
    viewportHeight: 720,
    device: null,
    clientEnvironment: null,
  })
  console.log('StartSessionAsync →', started)

  // Heavy navigate must keep the session live (no SessionEnded / fake crash).
  await connection.invoke('NavigateAsync', {
    sessionId: started.sessionId,
    token: started.token,
    path: navigatePath,
    query: navigateQuery,
  })
  console.log('NavigateAsync → ok', navigatePath, navigateQuery)

  await new Promise((resolve) => setTimeout(resolve, 500))
  if (sessionEnded) {
    throw new Error(
      `session ended after navigate (reason=${sessionEnded.reason} errorCode=${sessionEnded.errorCode})`,
    )
  }

  const crashedFacts = facts.filter(
    (f) =>
      typeof f?.type === 'string' &&
      /BrowserCrashed|browser_crashed/i.test(f.type),
  )
  if (crashedFacts.length > 0) {
    throw new Error(`journal reported crash after navigate: ${JSON.stringify(crashedFacts)}`)
  }

  await connection.invoke('StopSessionAsync', {
    sessionId: started.sessionId,
    token: started.token,
  })
  console.log('StopSessionAsync → ok')

  // Stop already returned, so this is only a beat for the fan-out to land.
  await new Promise((resolve) => setTimeout(resolve, 250))
  if (facts.length === 0) {
    throw new Error('journal stream reported no facts for the start/stop flow')
  }

  console.log('SMOKE OK (navigate stayed live)')
} catch (error) {
  console.error('SMOKE FAILED:', error?.message ?? error)
  process.exitCode = 1
} finally {
  journal?.dispose()
  await connection.stop()
}
