'use strict';

/**
 * Speculum Plane background — transparent byte tunnel to loopback WS.
 * EP-06: one WS per tab; new open replaces predecessor.
 * Port disconnect MUST NOT close the WS; on Port reconnect, replay open-ok if WS already OPEN.
 * Bytes on Port are number[] (structured-clone safe).
 *
 * Connect must not require port.sender.tab.id synchronously — CDP-loaded MV3 can
 * omit it on the first tick; we retry, then fall back to a port-local session key.
 */

const CHANNEL = 'speculum.extension.plane';

/** @typedef {{ ws: WebSocket | null, url: string, socketId: number, token: string }} PlaneSession */

/** @type {Map<string, PlaneSession>} */
const sessions = new Map();

/** @type {Map<string, chrome.runtime.Port>} */
const ports = new Map();

/** @type {Map<string, object[]>} */
const pending = new Map();

/** @type {WeakMap<chrome.runtime.Port, string>} */
const portKeys = new WeakMap();

/** Ports that already have onMessage/onDisconnect wired. */
const portsWithListeners = new WeakSet();

let anonSeq = 1;

function toUint8Array(bytes) {
  if (bytes instanceof Uint8Array) return bytes;
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  if (ArrayBuffer.isView(bytes)) {
    const view = bytes;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  if (Array.isArray(bytes)) return Uint8Array.from(bytes);
  return null;
}

function bytesToPort(bytes) {
  const u8 = toUint8Array(bytes);
  if (!u8) return null;
  return Array.from(u8);
}

function closeWsOnly(key) {
  const session = sessions.get(key);
  if (!session) return;
  sessions.delete(key);
  pending.delete(key);
  const ws = session.ws;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    try {
      ws.close(1000, 'replaced');
    } catch {
      /* ignore */
    }
  }
}

function forwardToKey(key, msg) {
  const port = ports.get(key);
  if (!port) {
    const q = pending.get(key) ?? [];
    q.push(msg);
    if (q.length > 32) q.shift();
    pending.set(key, q);
    return;
  }
  try {
    port.postMessage(msg);
  } catch {
    const q = pending.get(key) ?? [];
    q.push(msg);
    if (q.length > 32) q.shift();
    pending.set(key, q);
  }
}

function flushPending(key) {
  const q = pending.get(key);
  if (!q || q.length === 0) return;
  pending.delete(key);
  for (const msg of q) {
    forwardToKey(key, msg);
  }
}

function replayOpenOkIfNeeded(key) {
  const session = sessions.get(key);
  if (!session || !session.ws) return;
  if (session.ws.readyState !== WebSocket.OPEN) return;
  forwardToKey(key, {
    channel: CHANNEL,
    token: session.token,
    kind: 'open-ok',
    socketId: session.socketId,
  });
}

function handleOpen(key, msg) {
  const { socketId, url, token } = msg;
  if (typeof url !== 'string' || typeof socketId !== 'number') return;

  closeWsOnly(key);

  let ws;
  try {
    ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
  } catch (err) {
    forwardToKey(key, {
      channel: CHANNEL,
      token,
      kind: 'open-fail',
      socketId,
      message: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  sessions.set(key, { ws, url, socketId, token });

  ws.addEventListener('open', () => {
    forwardToKey(key, { channel: CHANNEL, token, kind: 'open-ok', socketId });
  });

  ws.addEventListener('message', (ev) => {
    const data = ev.data;
    let bytes;
    if (data instanceof ArrayBuffer) {
      bytes = new Uint8Array(data);
    } else if (ArrayBuffer.isView(data)) {
      bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    } else {
      return;
    }
    const portBytes = bytesToPort(bytes);
    if (!portBytes) return;
    forwardToKey(key, { channel: CHANNEL, token, kind: 'message', socketId, bytes: portBytes });
  });

  ws.addEventListener('close', (ev) => {
    forwardToKey(key, {
      channel: CHANNEL,
      token,
      kind: 'close',
      socketId,
      code: ev.code,
      reason: ev.reason,
    });
    const cur = sessions.get(key);
    if (cur && cur.ws === ws) sessions.delete(key);
  });

  ws.addEventListener('error', () => {
    forwardToKey(key, {
      channel: CHANNEL,
      token,
      kind: 'error',
      socketId,
      message: 'websocket error',
    });
  });
}

function handleSend(key, msg) {
  const session = sessions.get(key);
  if (!session || !session.ws || session.ws.readyState !== WebSocket.OPEN) return;
  const buf = toUint8Array(msg.bytes);
  if (!buf) return;
  try {
    session.ws.send(buf);
  } catch {
    /* ignore */
  }
}

function handleClose(key, msg) {
  const session = sessions.get(key);
  if (!session || !session.ws) return;
  try {
    session.ws.close(msg.code, msg.reason);
  } catch {
    /* ignore */
  }
}

function bindPort(key, port) {
  const prev = ports.get(key);
  if (prev && prev !== port) {
    try {
      prev.disconnect();
    } catch {
      /* ignore */
    }
  }
  ports.set(key, port);
  portKeys.set(port, key);
  flushPending(key);
  replayOpenOkIfNeeded(key);

  // Listeners once per Port — migrateKey only remaps keys.
  if (portsWithListeners.has(port)) return;
  portsWithListeners.add(port);

  port.onMessage.addListener((msg) => {
    if (!msg || msg.channel !== CHANNEL) return;
    const currentKey = portKeys.get(port);
    if (!currentKey) return;
    switch (msg.kind) {
      case 'open':
        handleOpen(currentKey, msg);
        break;
      case 'send':
        handleSend(currentKey, msg);
        break;
      case 'close':
        handleClose(currentKey, msg);
        break;
      default:
        break;
    }
  });

  port.onDisconnect.addListener(() => {
    const currentKey = portKeys.get(port);
    if (currentKey && ports.get(currentKey) === port) {
      ports.delete(currentKey);
    }
  });
}

function resolveKey(port) {
  const tabId = port.sender?.tab?.id;
  if (typeof tabId === 'number') return `tab:${tabId}`;
  return null;
}

function migrateKey(fromKey, toKey, port) {
  if (fromKey === toKey) return;
  const session = sessions.get(fromKey);
  const q = pending.get(fromKey);
  sessions.delete(fromKey);
  pending.delete(fromKey);
  if (ports.get(fromKey) === port) ports.delete(fromKey);
  if (session) sessions.set(toKey, session);
  if (q && q.length) {
    const existing = pending.get(toKey) ?? [];
    pending.set(toKey, existing.concat(q));
  }
  ports.set(toKey, port);
  portKeys.set(port, toKey);
  flushPending(toKey);
  replayOpenOkIfNeeded(toKey);
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'speculum-plane') return;

  const tabKey = resolveKey(port);
  if (tabKey) {
    bindPort(tabKey, port);
    return;
  }

  const anonKey = `anon:${anonSeq++}`;
  bindPort(anonKey, port);

  const upgrade = (attempt) => {
    if (portKeys.get(port) !== anonKey) return;
    const resolved = resolveKey(port);
    if (resolved) {
      migrateKey(anonKey, resolved, port);
      return;
    }
    if (attempt < 20) setTimeout(() => upgrade(attempt + 1), 25);
  };
  setTimeout(() => upgrade(0), 0);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  const key = `tab:${tabId}`;
  ports.delete(key);
  pending.delete(key);
  closeWsOnly(key);
});
