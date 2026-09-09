import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import fastifyWebsocket from '@fastify/websocket'
import { imagoRoot, sessionDir } from '../core/store.js'
import { panel, recoverOrphans } from './state.js'

const here = dirname(fileURLToPath(import.meta.url))
const UI_DIR = join(here, '../../dist/ui')

/** Errors reach the panel as sentences, never as `Error: [object Object]`. */
function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export interface Panel { url: string; close: () => Promise<void> }

export async function startPanel(port: number): Promise<Panel> {
  const recovered = recoverOrphans()
  if (recovered.length) console.log(`recovered ${recovered.length} interrupted session(s): ${recovered.join(', ')}`)

  const app = Fastify({ logger: false })

  // An action endpoint (mark, close) carries no payload. The default JSON parser
  // rejects an empty body outright, which turns "close the sandbox" into an
  // unexplained 400 — the operator cannot close a session because of a header.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const text = typeof body === 'string' ? body.trim() : ''
    if (!text) return done(null, {})
    try { done(null, JSON.parse(text)) }
    catch (e) { done(e instanceof Error ? e : new Error('invalid JSON body'), undefined) }
  })

  await app.register(fastifyWebsocket)

  app.get('/api/state', async () => panel.snapshotOfState())
  app.get('/api/home', async () => ({ root: imagoRoot(), platform: process.platform }))

  // QoL: open a session or run folder in Explorer. Windows only (D-025), and only
  // ever inside IMAGO_HOME — a panel that can open arbitrary paths is a shell.
  app.post('/api/reveal', async (req, reply) => {
    const { path } = (req.body ?? {}) as { path?: string }
    const root = resolve(imagoRoot())
    if (!path) return reply.status(400).send({ ok: false, error: 'path is required' })
    const target = resolve(path)
    if (!target.startsWith(root)) {
      return reply.status(400).send({ ok: false, error: 'only paths inside the imago home can be opened' })
    }
    if (process.platform !== 'win32') {
      return reply.status(400).send({ ok: false, error: 'opening a folder is Windows-only' })
    }
    spawn('explorer.exe', [target], { detached: true, stdio: 'ignore' }).unref()
    return { ok: true }
  })

  app.post('/api/record/start', async (req, reply) => {
    const body = (req.body ?? {}) as { name?: string; url?: string; settleMs?: number; channel?: string; executablePath?: string }
    try {
      const meta = await panel.start(
        { settleMs: body.settleMs ?? 500, channel: body.channel, executablePath: body.executablePath },
        body.name?.trim() || 'session',
        body.url?.trim() || undefined,
      )
      return { ok: true, session: meta }
    } catch (e) {
      return reply.status(400).send({ ok: false, error: msg(e) })
    }
  })

  app.post('/api/record/mark', async (_req, reply) => {
    try { return { ok: true, snapshot: await panel.mark() } }
    catch (e) { return reply.status(400).send({ ok: false, error: msg(e) }) }
  })

  app.post('/api/record/close', async (_req, reply) => {
    try { return { ok: true, report: await panel.close() } }
    catch (e) { return reply.status(400).send({ ok: false, error: msg(e) }) }
  })

  app.get('/api/sizes', async () => panel.sizes())

  app.post('/api/session/rename', async (req, reply) => {
    const { id, name } = (req.body ?? {}) as { id?: string; name?: string }
    try {
      if (!id) throw new Error('id is required')
      panel.rename(id, name ?? '')
      return { ok: true }
    } catch (e) { return reply.status(400).send({ ok: false, error: msg(e) }) }
  })

  app.post('/api/session/delete', async (req, reply) => {
    const { ids } = (req.body ?? {}) as { ids?: string[] }
    try {
      if (!Array.isArray(ids) || ids.length === 0) throw new Error('ids is required')
      return { ok: true, ...(await panel.remove(ids)) }
    } catch (e) { return reply.status(400).send({ ok: false, error: msg(e) }) }
  })

  app.post('/api/run/delete', async (req, reply) => {
    const { sessionId, runId } = (req.body ?? {}) as { sessionId?: string; runId?: string }
    try {
      if (!sessionId || !runId) throw new Error('sessionId and runId are required')
      await panel.removeRun(sessionId, runId)
      return { ok: true }
    } catch (e) { return reply.status(400).send({ ok: false, error: msg(e) }) }
  })

  app.post('/api/generate', async (req, reply) => {
    const body = (req.body ?? {}) as { sessionId?: string; profile?: unknown }
    try {
      if (!body.sessionId) throw new Error('sessionId is required')
      const manifest = panel.generate(body.sessionId, body.profile as never)
      return { ok: true, manifest }
    } catch (e) { return reply.status(400).send({ ok: false, error: msg(e) }) }
  })

  app.post('/api/preview/start', async (req, reply) => {
    const body = (req.body ?? {}) as { sessionId?: string; runId?: string; mode?: string; proxyBase?: string }
    try {
      if (!body.sessionId || !body.runId) throw new Error('sessionId and runId are required')
      const handle = await panel.openPreview(
        body.sessionId, body.runId, (body.mode as never) ?? 'fixtures', body.proxyBase ?? null,
      )
      return { ok: true, preview: { runId: handle.runId, url: handle.url, port: handle.port, mode: handle.mode } }
    } catch (e) { return reply.status(400).send({ ok: false, error: msg(e) }) }
  })

  app.post('/api/preview/mode', async (req, reply) => {
    const body = (req.body ?? {}) as { runId?: string; mode?: string; proxyBase?: string }
    try {
      if (!body.runId) throw new Error('runId is required')
      panel.setPreviewMode(body.runId, (body.mode as never) ?? 'off', body.proxyBase ?? null)
      return { ok: true }
    } catch (e) { return reply.status(400).send({ ok: false, error: msg(e) }) }
  })

  app.post('/api/preview/stop', async (req, reply) => {
    const body = (req.body ?? {}) as { runId?: string }
    try {
      if (!body.runId) throw new Error('runId is required')
      await panel.closePreview(body.runId)
      return { ok: true }
    } catch (e) { return reply.status(400).send({ ok: false, error: msg(e) }) }
  })

  app.post('/api/parity/run', async (req, reply) => {
    const body = (req.body ?? {}) as { sessionId?: string; runId?: string }
    try {
      if (!body.sessionId || !body.runId) throw new Error('sessionId and runId are required')
      const report = await panel.runParityCheck(body.sessionId, body.runId)
      return { ok: true, report }
    } catch (e) { return reply.status(400).send({ ok: false, error: msg(e) }) }
  })

  app.get('/api/parity/report', async (req, reply) => {
    const q = req.query as { sessionId?: string; runId?: string }
    if (!q.sessionId || !q.runId) {
      return reply.status(400).send({ ok: false, error: 'sessionId and runId are required' })
    }
    const report = panel.getParityReport(q.sessionId, q.runId)
    if (!report) return reply.status(404).send({ ok: false, error: 'no parity report — run parity first' })
    return { ok: true, report }
  })

  app.get('/api/parity/asset', async (req, reply) => {
    const q = req.query as { sessionId?: string; runId?: string; file?: string }
    if (!q.sessionId || !q.runId || !q.file) {
      return reply.status(400).send({ ok: false, error: 'sessionId, runId and file are required' })
    }
    const path = panel.parityAssetPath(q.sessionId, q.runId, q.file)
    if (!path) return reply.status(404).send({ ok: false, error: 'asset not found' })
    return reply.type('image/png').send(readFileSync(path))
  })

  app.get('/api/parity/reference', async (req, reply) => {
    const q = req.query as { sessionId?: string; snapId?: string }
    if (!q.sessionId || !q.snapId) {
      return reply.status(400).send({ ok: false, error: 'sessionId and snapId are required' })
    }
    const path = join(sessionDir(q.sessionId), 'oracles', q.snapId, 'reference.png')
    if (!existsSync(path)) return reply.status(404).send({ ok: false, error: 'no reference for this snapshot' })
    return reply.type('image/png').send(readFileSync(path))
  })

  app.get('/api/session/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const detail = panel.detail(id)
    if (!detail) return reply.status(404).send({ ok: false, error: 'unknown session' })
    return detail
  })

  app.get('/ws', { websocket: true }, (socket) => {
    const send = (msg: unknown) => { try { socket.send(JSON.stringify(msg)) } catch { /* closed */ } }
    send({ type: 'hello', state: panel.snapshotOfState() })
    const off = panel.subscribe(send)
    socket.on('close', off)
  })

  if (existsSync(UI_DIR)) {
    await app.register(fastifyStatic, { root: UI_DIR })
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api') || req.url.startsWith('/ws')) return reply.status(404).send({ error: 'not found' })
      return reply.sendFile('index.html')
    })
  } else {
    app.get('/', async () => 'UI not built — run `npm run build`')
  }

  await app.listen({ port, host: '127.0.0.1' })
  const address = app.server.address()
  const bound = typeof address === 'object' && address ? address.port : port
  return {
    url: `http://127.0.0.1:${bound}/`,
    close: async () => { await panel.stopAllPreviews(); await app.close() },
  }
}
