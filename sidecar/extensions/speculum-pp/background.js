'use strict';

/**
 * Speculum PP service worker — plane byte tunnel + SessionConfig C2 + root initContext generation.
 *
 * C2: sidecar writes c2-endpoint.json next to this file before loadUnpacked; SW connects and
 * receives SessionConfig; ACK before navigate. chrome.storage.session survives SW restart.
 */

const PLANE_CHANNEL = 'speculum.extension.plane';
const RUNTIME_CHANNEL = 'speculum.extension.runtime';
const C2_CHANNEL = 'speculum.extension.c2';

/** @typedef {{ ws: WebSocket | null, url: string, socketId: number, token: string }} PlaneSession */
/** @typedef {{
 *   sessionId: string,
 *   dataPlaneUrl: string,
 *   planeBridgeToken: string,
 *   transport?: string,
 *   loopbackCarrier?: string,
 *   frameRateHz?: number,
 *   bufferedAmountWatermark?: number,
 *   maxFrameBytes?: number,
 *   telemetry?: object,
 *   cssomPollHz?: number,
 * }} SessionConfig */

/** @type {Map<string, PlaneSession>} */
const planeSessions = new Map();
/** @type {Map<string, chrome.runtime.Port>} */
const planePorts = new Map();
/** @type {Map<string, object[]>} */
const planePending = new Map();
/** @type {WeakMap<chrome.runtime.Port, string>} */
const planePortKeys = new WeakMap();
const planePortsWithListeners = new WeakSet();
let anonSeq = 1;

/** @type {SessionConfig | null} */
let sessionConfig = null;
/** @type {number} */
let nextGeneration = 1;
/** @type {WebSocket | null} */
let c2Socket = null;
/** @type {ReturnType<typeof setInterval> | null} */
let heartbeatTimer = null;
/** @type {ReturnType<typeof setInterval> | null} */
let swKeepaliveTimer = null;

/** @type {Promise<void>} */
let stateReady = restoreState();

function ensureStateReady() {
  return stateReady;
}

function startSwKeepalive() {
  if (swKeepaliveTimer) clearInterval(swKeepaliveTimer);
  swKeepaliveTimer = setInterval(() => {
    void chrome.storage.session.get(['sessionConfig']).catch(() => {});
  }, 1000);
}

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
  const session = planeSessions.get(key);
  if (!session) return;
  planeSessions.delete(key);
  planePending.delete(key);
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
  const port = planePorts.get(key);
  if (!port) {
    const q = planePending.get(key) ?? [];
    q.push(msg);
    if (q.length > 32) q.shift();
    planePending.set(key, q);
    return;
  }
  try {
    port.postMessage(msg);
  } catch {
    const q = planePending.get(key) ?? [];
    q.push(msg);
    if (q.length > 32) q.shift();
    planePending.set(key, q);
  }
}

/** Forward WS bytes using the live session socketId/token (survives nav socketId bump). */
function forwardWsBytes(key, bytes) {
  const session = planeSessions.get(key);
  if (!session) return;
  const portBytes = bytesToPort(bytes);
  if (!portBytes) return;
  forwardToKey(key, {
    channel: PLANE_CHANNEL,
    token: session.token,
    kind: 'message',
    socketId: session.socketId,
    bytes: portBytes,
  });
}

function flushPending(key) {
  const q = planePending.get(key);
  if (!q || q.length === 0) return;
  planePending.delete(key);
  for (const msg of q) forwardToKey(key, msg);
}

function replayOpenOkIfNeeded(key) {
  const session = planeSessions.get(key);
  if (!session || !session.ws) return;
  if (session.ws.readyState !== WebSocket.OPEN) return;
  forwardToKey(key, {
    channel: PLANE_CHANNEL,
    token: session.token,
    kind: 'open-ok',
    socketId: session.socketId,
  });
}

function handleOpen(key, msg) {
  const { socketId, url, token } = msg;
  if (typeof url !== 'string' || typeof socketId !== 'number') return;

  const existing = planeSessions.get(key);
  if (
    existing &&
    existing.ws &&
    existing.ws.readyState === WebSocket.OPEN &&
    existing.url === url
  ) {
    // SW-owned loopback survives root hard nav — reuse canonical WS (runtime-redesign §5).
    existing.socketId = socketId;
    existing.token = token;
    forwardToKey(key, {
      channel: PLANE_CHANNEL,
      token,
      kind: 'open-ok',
      socketId,
    });
    return;
  }

  closeWsOnly(key);

  let ws;
  try {
    ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
  } catch (err) {
    forwardToKey(key, {
      channel: PLANE_CHANNEL,
      token,
      kind: 'open-fail',
      socketId,
      message: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  planeSessions.set(key, { ws, url, socketId, token });

  ws.addEventListener('open', () => {
    const session = planeSessions.get(key);
    if (!session || session.ws !== ws) return;
    forwardToKey(key, {
      channel: PLANE_CHANNEL,
      token: session.token,
      kind: 'open-ok',
      socketId: session.socketId,
    });
  });

  ws.addEventListener('message', (ev) => {
    const session = planeSessions.get(key);
    if (!session || session.ws !== ws) return;
    const data = ev.data;
    let bytes;
    if (data instanceof ArrayBuffer) {
      bytes = new Uint8Array(data);
    } else if (ArrayBuffer.isView(data)) {
      bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    } else {
      return;
    }
    forwardWsBytes(key, bytes);
  });

  ws.addEventListener('close', (ev) => {
    const session = planeSessions.get(key);
    if (!session || session.ws !== ws) return;
    forwardToKey(key, {
      channel: PLANE_CHANNEL,
      token: session.token,
      kind: 'close',
      socketId: session.socketId,
      code: ev.code,
      reason: ev.reason,
    });
    planeSessions.delete(key);
  });

  ws.addEventListener('error', () => {
    const session = planeSessions.get(key);
    if (!session || session.ws !== ws) return;
    forwardToKey(key, {
      channel: PLANE_CHANNEL,
      token: session.token,
      kind: 'error',
      socketId: session.socketId,
      message: 'websocket error',
    });
  });
}

function handleSend(key, msg) {
  const session = planeSessions.get(key);
  if (!session || !session.ws || session.ws.readyState !== WebSocket.OPEN) return;
  if (typeof msg.socketId === 'number' && msg.socketId !== session.socketId) return;
  const buf = toUint8Array(msg.bytes);
  if (!buf) return;
  try {
    session.ws.send(buf);
  } catch {
    /* ignore */
  }
}

function handleClose(key, msg) {
  const session = planeSessions.get(key);
  if (!session || !session.ws) return;
  // Superseded extension-plane socketIds after nav reuse must not tear down the SW WS.
  if (typeof msg.socketId === 'number' && msg.socketId !== session.socketId) return;
  try {
    session.ws.close(msg.code, msg.reason);
  } catch {
    /* ignore */
  }
}

function bindPlanePort(key, port) {
  const prev = planePorts.get(key);
  if (prev && prev !== port) {
    try {
      prev.disconnect();
    } catch {
      /* ignore */
    }
  }
  planePorts.set(key, port);
  planePortKeys.set(port, key);
  flushPending(key);
  replayOpenOkIfNeeded(key);

  if (planePortsWithListeners.has(port)) return;
  planePortsWithListeners.add(port);

  port.onMessage.addListener((msg) => {
    if (!msg || msg.channel !== PLANE_CHANNEL) return;
    const currentKey = planePortKeys.get(port);
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
    const currentKey = planePortKeys.get(port);
    if (currentKey && planePorts.get(currentKey) === port) {
      planePorts.delete(currentKey);
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
  const session = planeSessions.get(fromKey);
  const q = planePending.get(fromKey);
  planeSessions.delete(fromKey);
  planePending.delete(fromKey);
  if (planePorts.get(fromKey) === port) planePorts.delete(fromKey);
  if (session) planeSessions.set(toKey, session);
  if (q && q.length) {
    const existing = planePending.get(toKey) ?? [];
    planePending.set(toKey, existing.concat(q));
  }
  planePorts.set(toKey, port);
  planePortKeys.set(port, toKey);
  flushPending(toKey);
  replayOpenOkIfNeeded(toKey);
}

function publicConfig() {
  if (!sessionConfig) return null;
  const cfg = Object.assign({}, sessionConfig);
  if (!cfg.transport) cfg.transport = 'loopback';
  if (!cfg.loopbackCarrier) cfg.loopbackCarrier = 'extension';
  return cfg;
}

async function replyConfigRequest(port, reqId) {
  await ensureStateReady();
  if (sessionConfig === null) {
    port.postMessage({
      channel: RUNTIME_CHANNEL,
      kind: 'config-fail',
      reqId,
      reason: 'no_config',
    });
    return;
  }
  port.postMessage({
    channel: RUNTIME_CHANNEL,
    kind: 'config-ok',
    reqId,
    config: publicConfig(),
  });
}

async function replyInitContextRequest(port, reqId) {
  await ensureStateReady();
  if (sessionConfig === null) {
    port.postMessage({
      channel: RUNTIME_CHANNEL,
      kind: 'initContext-fail',
      reqId,
      reason: 'no_config',
    });
    return;
  }
  const generation = nextGeneration++;
  void persistState();
  const tabUrl = port.sender?.tab?.url ?? '';
  const installKind = !tabUrl || tabUrl === 'about:blank' ? 'blank' : 'navigation';
  c2Send({
    kind: 'DocumentInstall',
    generation,
    url: tabUrl,
    installKind,
    t: new Date().toISOString(),
  });
  port.postMessage({
    channel: RUNTIME_CHANNEL,
    kind: 'initContext-ok',
    reqId,
    generation,
  });
}

async function persistState() {
  try {
    await chrome.storage.session.set({
      sessionConfig,
      nextGeneration,
    });
  } catch {
    /* ignore */
  }
}

async function restoreState() {
  try {
    const bag = await chrome.storage.session.get(['sessionConfig', 'nextGeneration']);
    if (bag.sessionConfig && typeof bag.sessionConfig === 'object') {
      sessionConfig = bag.sessionConfig;
    }
    if (typeof bag.nextGeneration === 'number' && bag.nextGeneration >= 1) {
      nextGeneration = bag.nextGeneration;
    }
  } catch {
    /* ignore */
  }
}

function applySessionConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return false;
  if (typeof cfg.sessionId !== 'string' || !cfg.sessionId.trim()) return false;
  if (typeof cfg.dataPlaneUrl !== 'string' || !cfg.dataPlaneUrl.trim()) return false;
  if (typeof cfg.planeBridgeToken !== 'string' || !cfg.planeBridgeToken.trim()) return false;
  sessionConfig = {
    sessionId: cfg.sessionId.trim(),
    dataPlaneUrl: cfg.dataPlaneUrl.trim(),
    planeBridgeToken: cfg.planeBridgeToken.trim(),
    transport: cfg.transport === 'console' || cfg.transport === 'discard' ? cfg.transport : 'loopback',
    loopbackCarrier: 'extension',
    frameRateHz: cfg.frameRateHz,
    bufferedAmountWatermark: cfg.bufferedAmountWatermark,
    maxFrameBytes: cfg.maxFrameBytes,
    telemetry: cfg.telemetry,
    cssomPollHz: cfg.cssomPollHz,
    configGateTimeoutMs:
      typeof cfg.configGateTimeoutMs === 'number' && cfg.configGateTimeoutMs > 0
        ? Math.floor(cfg.configGateTimeoutMs)
        : undefined,
    initContextTimeoutMs:
      typeof cfg.initContextTimeoutMs === 'number' && cfg.initContextTimeoutMs > 0
        ? Math.floor(cfg.initContextTimeoutMs)
        : undefined,
  };
  void persistState();
  startSwKeepalive();
  return true;
}

function handleRuntimeMessage(port, msg) {
  if (!msg || msg.channel !== RUNTIME_CHANNEL) return;
  const reqId = msg.reqId;

  if (msg.kind === 'config-request') {
    void replyConfigRequest(port, reqId);
    return;
  }

  if (msg.kind === 'initContext-request') {
    void replyInitContextRequest(port, reqId);
    return;
  }
}

function bindRuntimePort(port) {
  port.onMessage.addListener((msg) => handleRuntimeMessage(port, msg));
}

function c2Send(msg) {
  if (!c2Socket || c2Socket.readyState !== WebSocket.OPEN) return;
  try {
    c2Socket.send(JSON.stringify(Object.assign({ channel: C2_CHANNEL }, msg)));
  } catch {
    /* ignore */
  }
}

function handleC2Message(raw) {
  let msg;
  try {
    msg = JSON.parse(String(raw));
  } catch {
    return;
  }
  if (!msg || msg.channel !== C2_CHANNEL) return;

  if (msg.kind === 'SessionConfig') {
    const ok = applySessionConfig(msg.config);
    c2Send({
      kind: 'SessionConfigAck',
      ok,
      sessionId: ok && sessionConfig ? sessionConfig.sessionId : null,
      reason: ok ? undefined : 'invalid_config',
    });
    return;
  }

  if (msg.kind === 'RuntimeProbe') {
    void (async () => {
      await ensureStateReady();
      c2Send({
        kind: 'RuntimeProbeAck',
        ok: sessionConfig !== null,
        sessionId: sessionConfig ? sessionConfig.sessionId : null,
      });
    })();
    return;
  }

  if (msg.kind === 'ClearSession') {
    sessionConfig = null;
    void persistState();
    c2Send({ kind: 'ClearSessionAck', ok: true });
  }
}

async function connectC2() {
  let url = null;
  try {
    const endpoint = chrome.runtime.getURL('c2-endpoint.json');
    const res = await fetch(endpoint);
    if (res.ok) {
      const body = await res.json();
      if (body && typeof body.url === 'string') url = body.url;
    }
  } catch {
    /* missing until sidecar writes it */
  }
  if (!url) {
    setTimeout(() => {
      void connectC2();
    }, 250);
    return;
  }

  if (c2Socket) {
    try {
      c2Socket.close();
    } catch {
      /* ignore */
    }
    c2Socket = null;
  }

  let ws;
  try {
    ws = new WebSocket(url);
  } catch {
    setTimeout(() => {
      void connectC2();
    }, 500);
    return;
  }
  c2Socket = ws;
  ws.addEventListener('open', () => {
    c2Send({ kind: 'Hello', extensionId: chrome.runtime.id });
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
      c2Send({ kind: 'Heartbeat' });
    }, 5000);
  });
  ws.addEventListener('message', (ev) => handleC2Message(ev.data));
  ws.addEventListener('close', () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    c2Socket = null;
    setTimeout(() => {
      void connectC2();
    }, 500);
  });
  ws.addEventListener('error', () => {
    /* close handler reconnects */
  });
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'speculum-runtime') {
    bindRuntimePort(port);
    return;
  }
  if (port.name !== 'speculum-plane') return;

  const tabKey = resolveKey(port);
  if (tabKey) {
    bindPlanePort(tabKey, port);
    return;
  }

  const anonKey = `anon:${anonSeq++}`;
  bindPlanePort(anonKey, port);

  const upgrade = (attempt) => {
    if (planePortKeys.get(port) !== anonKey) return;
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
  planePorts.delete(key);
  planePending.delete(key);
  closeWsOnly(key);
});

void stateReady.then(() => {
  if (sessionConfig !== null) startSwKeepalive();
  connectC2();
});
