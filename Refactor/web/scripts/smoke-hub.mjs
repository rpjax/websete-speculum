// Ad-hoc driver: proves the refactor hub flow (EnsureProfile → StartSession →
// StopSession) end to end against a running API + sidecar, and that the live
// Journal stream reports the facts those acts admitted. Not part of CI.
//
// Usage:
//   node scripts/smoke-hub.mjs                         # process-local API
//   node scripts/smoke-hub.mjs http://localhost:8080   # dockup Traefik (dev/smoke)
import { HubConnectionBuilder, HttpTransportType, LogLevel } from '@microsoft/signalr'
import { MessagePackHubProtocol } from '@microsoft/signalr-protocol-msgpack'

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

const origin = process.argv[2] ?? 'https://localhost:5001'

const connection = new HubConnectionBuilder()
  .withUrl(`${origin}/vhub`, { transport: HttpTransportType.WebSockets })
  .withHubProtocol(new MessagePackHubProtocol())
  .configureLogging(LogLevel.Warning)
  .build()

const facts = []
let journal = null

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

  console.log('SMOKE OK')
} catch (error) {
  console.error('SMOKE FAILED:', error?.message ?? error)
  process.exitCode = 1
} finally {
  journal?.dispose()
  await connection.stop()
}
