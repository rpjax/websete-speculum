import { HubConnectionBuilder, HttpTransportType, LogLevel } from "@microsoft/signalr"
import { MessagePackHubProtocol } from "@microsoft/signalr-protocol-msgpack"
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"
const origin = process.argv[2] ?? "http://localhost:8080"
const connection = new HubConnectionBuilder()
  .withUrl(`${origin}/vhub`, { transport: HttpTransportType.WebSockets })
  .withHubProtocol(new MessagePackHubProtocol())
  .configureLogging(LogLevel.Warning)
  .build()
try {
  await connection.start()
  const ensured = await connection.invoke("EnsureProfileAsync", { profileId: null })
  const started = await connection.invoke("StartSessionAsync", {
    profileId: ensured.profileId, path: "/", query: "", viewportWidth: 1280, viewportHeight: 720, device: null, clientEnvironment: null,
  })
  console.log("started", started)
  try {
    await connection.invoke("NavigateAsync", {
      sessionId: started.sessionId,
      token: started.token,
      path: "/about",
      query: "",
    })
    console.log("NAVIGATE OK")
  } catch (e) {
    console.error("NAVIGATE FAILED:", e?.message ?? e)
  }
  await connection.invoke("StopSessionAsync", { sessionId: started.sessionId, token: started.token })
} catch (e) {
  console.error("SETUP FAILED:", e?.message ?? e)
  process.exitCode = 1
} finally {
  await connection.stop()
}
