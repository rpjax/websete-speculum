'use strict';

/**
 * Isolated content — plane byte tunnel (top frame) + SessionConfig / initContext relay (all frames).
 */

const PLANE_CHANNEL = 'speculum.extension.plane';
const RUNTIME_CHANNEL = 'speculum.extension.runtime';
const PLANE_PORT = 'speculum-plane';
const RUNTIME_PORT = 'speculum-runtime';

/** @type {string | null} */
let boundToken = null;
/** @type {chrome.runtime.Port | null} */
let planePort = null;
/** @type {chrome.runtime.Port | null} */
let runtimePort = null;

const isTop = window === window.top;

function toPortBytes(bytes) {
  if (bytes instanceof Uint8Array) return Array.from(bytes);
  if (bytes instanceof ArrayBuffer) return Array.from(new Uint8Array(bytes));
  if (ArrayBuffer.isView(bytes)) {
    return Array.from(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  }
  if (Array.isArray(bytes)) return bytes;
  return null;
}

function fromPortBytes(bytes) {
  if (bytes instanceof Uint8Array) return bytes;
  if (Array.isArray(bytes)) return Uint8Array.from(bytes);
  if (ArrayBuffer.isView(bytes)) {
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  return null;
}

function ensurePlanePort() {
  if (planePort) return planePort;
  planePort = chrome.runtime.connect({ name: PLANE_PORT });
  planePort.onDisconnect.addListener(() => {
    planePort = null;
  });
  planePort.onMessage.addListener((msg) => {
    if (!msg || msg.channel !== PLANE_CHANNEL) return;
    if ((msg.kind === 'message' || msg.kind === 'send') && msg.bytes != null) {
      const u8 = fromPortBytes(msg.bytes);
      if (u8) msg = Object.assign({}, msg, { bytes: u8 });
    }
    window.postMessage(msg, '*');
  });
  return planePort;
}

function ensureRuntimePort() {
  if (runtimePort) return runtimePort;
  runtimePort = chrome.runtime.connect({ name: RUNTIME_PORT });
  runtimePort.onDisconnect.addListener(() => {
    runtimePort = null;
  });
  runtimePort.onMessage.addListener((msg) => {
    if (!msg || msg.channel !== RUNTIME_CHANNEL) return;
    window.postMessage(msg, '*');
  });
  return runtimePort;
}

function isFromPage(ev) {
  return ev.source === window && ev.data && typeof ev.data === 'object';
}

window.addEventListener('message', (ev) => {
  if (!isFromPage(ev)) return;
  const d = ev.data;

  if (d.channel === RUNTIME_CHANNEL) {
    if (d.kind !== 'config-request' && d.kind !== 'initContext-request') return;
    try {
      ensureRuntimePort().postMessage(d);
    } catch {
      runtimePort = null;
      try {
        ensureRuntimePort().postMessage(d);
      } catch {
        window.postMessage(
          {
            channel: RUNTIME_CHANNEL,
            kind: d.kind === 'config-request' ? 'config-fail' : 'initContext-fail',
            reqId: d.reqId,
            reason: 'port_dead',
          },
          '*',
        );
      }
    }
    return;
  }

  if (!isTop) return;
  if (d.channel !== PLANE_CHANNEL) return;

  if (d.kind === 'bind') {
    if (typeof d.token !== 'string' || d.token.length === 0) return;
    boundToken = d.token;
    window.postMessage({ channel: PLANE_CHANNEL, token: boundToken, kind: 'bind-ack' }, '*');
    return;
  }
  if (d.kind !== 'open' && d.kind !== 'send' && d.kind !== 'close') return;
  if (!boundToken || d.token !== boundToken) return;

  let out = d;
  if (d.kind === 'send') {
    const portBytes = toPortBytes(d.bytes);
    if (!portBytes) return;
    out = Object.assign({}, d, { bytes: portBytes });
  }

  try {
    ensurePlanePort().postMessage(out);
  } catch {
    planePort = null;
    try {
      ensurePlanePort().postMessage(out);
    } catch {
      /* drop */
    }
  }
});

// Warm ports so config/plane are answerable as soon as MAIN asks (hard-nav Port race).
try {
  ensureRuntimePort();
} catch {
  /* SW not ready yet — first request reconnects */
}
if (isTop) {
  try {
    ensurePlanePort();
  } catch {
    /* SW not ready yet — first bind/open reconnects */
  }
}
