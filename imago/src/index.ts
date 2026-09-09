/**
 * Imago — Windows desktop tool. The panel is the only interface (D-024): there is
 * no console surface, and none is coming.
 *
 *   npm run build && npm start
 */
import { spawn } from 'node:child_process'
import { startPanel } from './panel/server.js'

// A recording lives for as long as a human browses. The panel process outliving
// one bad promise is not defensive programming, it is the product working: an
// escaping rejection here takes the whole session with it.
process.on('unhandledRejection', (reason) => {
  console.error('[imago] unhandled rejection —', reason)
})
process.on('uncaughtException', (error) => {
  console.error('[imago] uncaught exception —', error)
})

const PORT = Number(process.env.IMAGO_PORT ?? 7411)

const { url } = await startPanel(PORT)
console.log(`imago panel — ${url}`)

if (process.platform === 'win32' && process.env.IMAGO_NO_OPEN !== '1') {
  spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref()
}
