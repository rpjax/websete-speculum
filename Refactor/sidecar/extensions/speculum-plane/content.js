'use strict';

const CHANNEL = 'speculum.extension.plane';
const PORT_NAME = 'speculum-plane';

/** @type {string | null} */
let boundToken = null;
/** @type {chrome.runtime.Port | null} */
let port = null;

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
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  return null;
}

function ensurePort() {
  if (port) return port;
  port = chrome.runtime.connect({ name: PORT_NAME });
  port.onDisconnect.addListener(() => {
    port = null;
  });
  port.onMessage.addListener((msg) => {
    if (!msg || msg.channel !== CHANNEL) return;
    // Restore Uint8Array at the page edge (EP-03).
    if ((msg.kind === 'message' || msg.kind === 'send') && msg.bytes != null) {
      const u8 = fromPortBytes(msg.bytes);
      if (u8) msg = Object.assign({}, msg, { bytes: u8 });
    }
    window.postMessage(msg, '*');
  });
  return port;
}

function isValidFromPage(ev) {
  return ev.source === window && ev.data && ev.data.channel === CHANNEL;
}

window.addEventListener('message', (ev) => {
  if (!isValidFromPage(ev)) return;
  const d = ev.data;
  if (d.kind === 'bind') {
    if (typeof d.token !== 'string' || d.token.length === 0) return;
    boundToken = d.token;
    window.postMessage({ channel: CHANNEL, token: boundToken, kind: 'bind-ack' }, '*');
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

  const p = ensurePort();
  try {
    p.postMessage(out);
  } catch {
    port = null;
    try {
      ensurePort().postMessage(out);
    } catch {
      /* drop */
    }
  }
});

ensurePort();
try {
  if (document.documentElement) {
    document.documentElement.setAttribute('data-speculum-plane', '1');
  } else {
    const obs = new MutationObserver(() => {
      if (document.documentElement) {
        document.documentElement.setAttribute('data-speculum-plane', '1');
        obs.disconnect();
      }
    });
    obs.observe(document, { childList: true });
  }
} catch {
  /* ignore */
}