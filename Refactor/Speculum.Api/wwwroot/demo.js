import { createSessionClient } from './speculum/index.js'

const el = {
  profileId: document.getElementById('profileId'),
  path: document.getElementById('path'),
  start: document.getElementById('start'),
  stop: document.getElementById('stop'),
  status: document.getElementById('status'),
  back: document.getElementById('back'),
  forward: document.getElementById('forward'),
  canvas: document.getElementById('frame'),
  log: document.getElementById('log'),
  hint: document.getElementById('hint'),
  lastInput: document.getElementById('lastInput'),
}

const ctx = el.canvas.getContext('2d')
const client = createSessionClient()

/** @type {import('./speculum/liveSession.js').LiveSession|null} */
let session = null
let lastSequence = -1n

/** @type {Map<number, { id: number, x: number, y: number, radiusX: number, radiusY: number, force: number }>} */
const activeTouches = new Map()

function log(line, data) {
  const stamp = new Date().toISOString().slice(11, 23)
  const extra = data === undefined ? '' : ' ' + summarize(data)
  el.log.textContent = `[${stamp}] ${line}${extra}\n` + el.log.textContent
}

function summarize(value) {
  try {
    if (value?.jpeg instanceof Uint8Array) {
      return JSON.stringify({
        sequence: value.sequence,
        timestamp: value.timestamp,
        jpegBytes: value.jpeg.byteLength,
      })
    }
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/**
 * @param {{ type: string } & Record<string, unknown>} event
 */
function sendInput(event) {
  if (!session) {
    return
  }
  if (el.lastInput) {
    el.lastInput.textContent = `last input: ${event.type}`
  }
  void session.sendInput(event)
}

function setBusy(running) {
  el.start.disabled = running
  el.stop.disabled = !running
  el.status.disabled = !running
  el.back.disabled = !running
  el.forward.disabled = !running
}

/**
 * @param {Uint8Array} jpeg
 */
async function paintJpeg(jpeg) {
  const blob = new Blob([jpeg], { type: 'image/jpeg' })
  const bitmap = await createImageBitmap(blob)
  if (el.canvas.width !== bitmap.width || el.canvas.height !== bitmap.height) {
    el.canvas.width = bitmap.width
    el.canvas.height = bitmap.height
  }
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()
}

/**
 * @param {number} clientX
 * @param {number} clientY
 */
function canvasPoint(clientX, clientY) {
  const rect = el.canvas.getBoundingClientRect()
  return {
    x: Math.round((clientX - rect.left) * (el.canvas.width / rect.width)),
    y: Math.round((clientY - rect.top) * (el.canvas.height / rect.height)),
  }
}

/**
 * @param {TouchList} list
 */
function touchPointsFromList(list) {
  /** @type {{ id: number, x: number, y: number, radiusX: number, radiusY: number, force: number }[]} */
  const points = []
  for (let i = 0; i < list.length; i++) {
    const t = list.item(i)
    if (!t) continue
    const { x, y } = canvasPoint(t.clientX, t.clientY)
    points.push({
      id: t.identifier,
      x,
      y,
      radiusX: t.radiusX || 1,
      radiusY: t.radiusY || 1,
      force: t.force || 1,
    })
  }
  return points
}

/**
 * @param {import('./speculum/liveSession.js').LiveSession} next
 */
function bindSession(next) {
  session = next
  session.on('frame', (event) => {
    const frame = event.detail
    const sequence = BigInt(frame.sequence ?? 0)
    if (sequence <= lastSequence) {
      return
    }
    lastSequence = sequence
    void paintJpeg(frame.jpeg)
  })
  session.on('console', (event) => log('console', event.detail))
  session.on('notification', (event) => log('notification', event.detail))
  session.on('error', (event) => log('error', event.detail?.message ?? event.detail))
  session.on('close', () => {
    log('session closed')
    setBusy(false)
    session = null
  })
}

el.canvas.tabIndex = 0

el.canvas.addEventListener('mousemove', (event) => {
  if (!session) return
  const { x, y } = canvasPoint(event.clientX, event.clientY)
  sendInput({ type: 'mousemove', x, y })
})

el.canvas.addEventListener('mousedown', (event) => {
  if (!session) return
  el.canvas.focus()
  const { x, y } = canvasPoint(event.clientX, event.clientY)
  sendInput({
    type: 'mousedown',
    x,
    y,
    button: event.button,
  })
})

el.canvas.addEventListener('mouseup', (event) => {
  if (!session) return
  const { x, y } = canvasPoint(event.clientX, event.clientY)
  sendInput({
    type: 'mouseup',
    x,
    y,
    button: event.button,
  })
})

el.canvas.addEventListener('contextmenu', (event) => {
  event.preventDefault()
})

el.canvas.addEventListener(
  'wheel',
  (event) => {
    if (!session) return
    event.preventDefault()
    const { x, y } = canvasPoint(event.clientX, event.clientY)
    sendInput({
      type: 'wheel',
      x,
      y,
      deltaX: event.deltaX,
      deltaY: event.deltaY,
    })
  },
  { passive: false },
)

el.canvas.addEventListener('keydown', (event) => {
  if (!session) return
  event.preventDefault()
  sendInput({ type: 'keydown', key: event.key })
  if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
    sendInput({ type: 'type', text: event.key })
  }
})

el.canvas.addEventListener('keyup', (event) => {
  if (!session) return
  event.preventDefault()
  sendInput({ type: 'keyup', key: event.key })
})

/**
 * @param {TouchEvent} event
 * @param {'start' | 'move' | 'end' | 'cancel'} phase
 */
function onTouch(event, phase) {
  if (!session) return
  event.preventDefault()
  const changed = touchPointsFromList(event.changedTouches)
  if (phase === 'start' || phase === 'move') {
    for (const p of touchPointsFromList(event.touches)) {
      activeTouches.set(p.id, p)
    }
  } else {
    for (const p of changed) {
      activeTouches.delete(p.id)
    }
  }
  const points = [...activeTouches.values()]
  sendInput({
    type: 'touch',
    phase,
    points,
    changedIds: changed.map((p) => p.id),
  })
}

el.canvas.addEventListener(
  'touchstart',
  (event) => onTouch(event, 'start'),
  { passive: false },
)
el.canvas.addEventListener(
  'touchmove',
  (event) => onTouch(event, 'move'),
  { passive: false },
)
el.canvas.addEventListener(
  'touchend',
  (event) => onTouch(event, 'end'),
  { passive: false },
)
el.canvas.addEventListener(
  'touchcancel',
  (event) => onTouch(event, 'cancel'),
  { passive: false },
)

el.back.addEventListener('click', () => {
  sendInput({ type: 'goback' })
})

el.forward.addEventListener('click', () => {
  sendInput({ type: 'goforward' })
})

el.start.addEventListener('click', async () => {
  const profileId = el.profileId.value.trim()
  if (!profileId) {
    log('profileId required')
    return
  }
  el.start.disabled = true
  try {
    if (!client.isConnected) {
      log('connecting hub…')
      await client.connect()
      log('hub connected', { connectionId: client.connectionId })
    }
    lastSequence = -1n
    log('starting session…')
    const next = await client.startSession({
      profileId,
      path: el.path.value.trim() || '/',
      viewportWidth: el.canvas.width,
      viewportHeight: el.canvas.height,
    })
    bindSession(next)
    setBusy(true)
    el.hint.textContent = `session ${next.sessionId} — click canvas, scroll, type, touch`
    log('session live', { sessionId: next.sessionId })
  } catch (error) {
    log('start failed', error?.message ?? error)
    setBusy(false)
  }
})

el.stop.addEventListener('click', async () => {
  if (!session) {
    return
  }
  el.stop.disabled = true
  try {
    await session.stop()
    log('stopped')
  } catch (error) {
    log('stop failed', error?.message ?? error)
  } finally {
    session = null
    setBusy(false)
  }
})

el.status.addEventListener('click', async () => {
  if (!session) {
    return
  }
  try {
    const status = await session.getStatus()
    log('status', status)
  } catch (error) {
    log('status failed', error?.message ?? error)
  }
})

log('ready — import from /speculum/index.js')
