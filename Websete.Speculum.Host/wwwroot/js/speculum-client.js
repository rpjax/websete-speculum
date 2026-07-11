'use strict';

// ── Dev mode ──────────────────────────────────────────────────────────────────
const IS_DEV = location.hostname === 'localhost' || location.hostname === '127.0.0.1';

// ── Protocol constants (sidecar binary protocol) ──────────────────────────────
const MSG_URL         = 0x04;
const MSG_CONSOLE     = 0x05;
const MSG_EVAL_RESULT = 0x06;
const MSG_SCREENCAST  = 0x08;  // CDP Page.startScreencast JPEG frame
const MSG_REDIRECT    = 0x0A;  // virtual browser left allowed navigation domain → redirect real browser
const VCON_METHODS    = ['log', 'warn', 'error', 'info', 'debug'];

// ── Session status monitor — console styles ───────────────────────────────────
const _ST = {
  badge:   'background:#1a3a4a;color:#80cbc4;font-weight:700;padding:1px 7px;border-radius:3px;font-family:monospace;font-size:11px',
  key:     'color:#546e7a;font-family:monospace',
  val:     'color:#cfd8dc;font-family:monospace',
  ok:      'color:#4caf50;font-weight:700;font-family:monospace',
  warn:    'color:#ff9800;font-weight:700;font-family:monospace',
  err:     'color:#f44336;font-weight:700;font-family:monospace',
};

// ── DOM refs ──────────────────────────────────────────────────────────────────
const canvas     = document.getElementById('canvas');
const ctx        = canvas.getContext('2d');
const overlay    = document.getElementById('overlay');
const statusEl   = document.getElementById('status');
const urlBar     = document.getElementById('url-bar');
const backBtn    = document.getElementById('back-btn');
const fwdBtn     = document.getElementById('fwd-btn');
const connectBtn = document.getElementById('connect-btn');
const viewport   = document.getElementById('viewport');
const fpsEl      = document.getElementById('fps');

if (IS_DEV) fpsEl.classList.add('active');

// ── Session state ─────────────────────────────────────────────────────────────
let connection          = null;
let connecting          = false;
let frameWorker         = null;
let latestDrawnSeq      = 0;
let userInputSubject    = null;
let consoleInputSubject = null;
let sessionW            = 1280;
let sessionH            = 720;
let _currentUrl         = '';   // last URL reported by the virtual browser

// ── Status monitor state ──────────────────────────────────────────────────────
let _statusLastLogTs  = 0;   // performance.now() of last periodic log
let _statusPrevTabs   = -1;  // previous tabCount (-1 = not yet received)

// ── JsBridge — pending vcon() calls ───────────────────────────────────────────
let   _evalId      = 0;
const _evalPending = new Map();

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Ensure frame decode worker is running. */
function ensureFrameWorker() {
  if (frameWorker) return;
  frameWorker = new Worker('/workers/frame-decode.js');
  frameWorker.onmessage = (ev) => {
    const { seq, bitmap, error } = ev.data;
    if (error) {
      console.warn('[frame] JPEG decode error', error);
      return;
    }
    if (seq < latestDrawnSeq) {
      bitmap.close();
      return;
    }
    latestDrawnSeq = seq;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    tickFps();
  };
}

function teardownFrameWorker() {
  if (!frameWorker) return;
  frameWorker.terminate();
  frameWorker = null;
  latestDrawnSeq = 0;
}

function setStatus(text, cls) {
  statusEl.textContent = text;
  statusEl.className   = cls;
}

// ── FPS counter ───────────────────────────────────────────────────────────────
let fpsFrames = 0;
let fpsLastTs = performance.now();

function tickFps() {
  if (!IS_DEV) return;
  fpsFrames++;
  const now = performance.now();
  const elapsed = now - fpsLastTs;
  if (elapsed >= 1000) {
    fpsEl.textContent = Math.round(fpsFrames * 1000 / elapsed) + ' fps';
    fpsFrames = 0;
    fpsLastTs = now;
  }
}

// ── Canvas / session size ─────────────────────────────────────────────────────
function syncCanvasSize(w, h) {
  sessionW      = w;
  sessionH      = h;
  canvas.width  = w;
  canvas.height = h;
  invalidateRect();
}

// ── ResizeObserver — propagates viewport changes to the virtual browser ───────
let resizeTimer = null;

const resizeObserver = new ResizeObserver(entries => {
  const entry = entries[0];
  if (!entry) return;
  const w = Math.round(entry.contentRect.width);
  const h = Math.round(entry.contentRect.height);
  if (w < 100 || h < 100) return;
  if (w === sessionW && h === sessionH) return;

  invalidateRect();
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(async () => {
    syncCanvasSize(w, h);
    if (connection) {
      try { await connection.invoke('ResizeAsync', w, h); } catch { /* ignore if not started */ }
    }
  }, 250);
});

resizeObserver.observe(viewport);

// ── Frame handler (server → client stream) ────────────────────────────────────
// Frame { jpeg: byte[], sequence, timestamp } via MessagePack protocol.
function onFrame(frame) {
  if (!frame || !frame.jpeg || !frame.jpeg.length) return;
  const seq = frame.sequence ?? 0;
  if (seq < latestDrawnSeq) return;

  ensureFrameWorker();
  const buf = frame.jpeg instanceof Uint8Array
    ? frame.jpeg.buffer.slice(frame.jpeg.byteOffset, frame.jpeg.byteOffset + frame.jpeg.byteLength)
    : frame.jpeg;
  frameWorker.postMessage({ seq, jpeg: buf }, [buf]);
}

function b64toU8(b64) {
  const bin = atob(b64);
  const u8  = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

/** Normalise MessagePack bin or legacy base64 wire payloads. */
function wireToU8(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (Array.isArray(data)) return new Uint8Array(data);
  if (typeof data === 'string') return b64toU8(data);
  return new Uint8Array(0);
}

// ── Console output handler (server → client stream) ───────────────────────────
// ConsoleOutput { data } — MessagePack bin or legacy base64.
function onConsoleOutput(output) {
  const bytes = wireToU8(output.data);
  if (bytes.length < 1) return;
  const view = new DataView(bytes.buffer);
  const type = bytes[0];

  if (type === MSG_URL) {
    if (bytes.length < 5) return;
    const len = view.getUint32(1, true);
    _currentUrl = new TextDecoder().decode(bytes.slice(5, 5 + len));
    // Only update the bar if the user isn't currently editing it.
    if (document.activeElement !== urlBar) urlBar.value = _currentUrl;

  } else if (type === MSG_CONSOLE) {
    if (bytes.length < 6) return;
    const level = bytes[1];
    const len   = view.getUint32(2, true);
    const text  = new TextDecoder().decode(bytes.slice(6, 6 + len));
    const fn    = console[VCON_METHODS[level] ?? 'log'];
    fn.call(console,
      '%c[VCON]%c ' + text,
      'color:#ff9800;font-weight:bold;font-family:monospace',
      'color:inherit;font-family:monospace',
    );

  } else if (type === MSG_EVAL_RESULT) {
    if (bytes.length < 10) return;
    const id    = view.getUint32(1, true);
    const ok    = bytes[5] === 1;
    const len   = view.getUint32(6, true);
    const value = new TextDecoder().decode(bytes.slice(10, 10 + len));
    const p     = _evalPending.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    _evalPending.delete(id);
    if (ok) {
      let parsed;
      try   { parsed = JSON.parse(value); }
      catch { parsed = value; }
      console.log('%c[VCON] ←%c', 'color:#ff9800;font-weight:bold;font-family:monospace', 'color:inherit', parsed);
      p.resolve(parsed);
    } else {
      console.error('%c[VCON] ←%c Error: ' + value, 'color:#ff9800;font-weight:bold;font-family:monospace', 'color:inherit');
      p.reject(new Error(value));
    }

  } else if (type === MSG_REDIRECT) {
    // The virtual browser tried to navigate outside the allowed domain list.
    // Redirect the real browser instead — this closes the Speculum session.
    if (bytes.length < 5) return;
    const len         = view.getUint32(1, true);
    const redirectUrl = new TextDecoder().decode(bytes.slice(5, 5 + len));
    console.info(
      '%c[SPECULUM]%c Leaving — virtual browser navigated outside allowed domains → %c' + redirectUrl,
      'background:#1565c0;color:#fff;font-weight:bold;padding:1px 6px;border-radius:3px',
      'color:#888',
      'color:#1e88e5',
    );
    window.location.href = redirectUrl;
  }
}

// ── Input — send to server via client→server stream ───────────────────────────
// UserInput on the server: { type: string, payload: string (full JSON) }
function sendInput(obj) {
  if (!userInputSubject) return;
  userInputSubject.next({ type: obj.type, payload: JSON.stringify(obj) });
}

// ── JsBridge — vcon() ─────────────────────────────────────────────────────────
let _jsBridgeEnabled = false;

function installVcon() {
  if (!_jsBridgeEnabled) {
    uninstallVcon();
    return;
  }
  window.vcon = function vcon(code) {
    return new Promise((resolve, reject) => {
      if (!consoleInputSubject) { reject(new Error('[vcon] No active session')); return; }
      const id    = ++_evalId;
      const timer = setTimeout(() => {
        _evalPending.delete(id);
        reject(new Error('[vcon] Timed out after 10 s'));
      }, 10_000);
      _evalPending.set(id, { resolve, reject, timer });
      // ConsoleInput on the server: { id: number, code: string }
      consoleInputSubject.next({ id, code });
    });
  };
}

function uninstallVcon() { delete window.vcon; }

// ── Session status monitor ────────────────────────────────────────────────────

/** Format milliseconds as HH:MM:SS. */
function _fmtUptime(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0') + ':' + String(s % 60).padStart(2,'0');
}

/**
 * Prints a full console.table snapshot of the current session status.
 * Used on first status and whenever a tab-count anomaly changes state.
 */
function _printStatusTable(s) {
  const tabOk  = s.tabCount === 1;
  const tabStr = tabOk ? '✔  ' + s.tabCount : '⚠  ' + s.tabCount + ' (expected 1)';
  console.groupCollapsed('%c SPECULUM STATUS ', _ST.badge);
  console.table({
    'Tabs':       tabStr,
    'FPS':        s.fps.toFixed(1),
    'Resolution': s.width + '×' + s.height,
    'Uptime':     _fmtUptime(s.uptimeMs),
    'Resizing':   s.resizing ? 'yes' : 'no',
    'JsBridge':   s.jsBridgeEnabled ? 'enabled' : 'disabled',
    'URL':        s.url,
    'Session':    s.sessionId.slice(0, 8) + '…',
  });
  console.groupEnd();
}

/**
 * Called on every SessionStatus message (~1 s interval).
 *
 * Behaviour:
 *   • First call: prints a full status table.
 *   • Every 5 s: logs a compact one-liner via console.debug (visible only
 *     when DevTools level ≥ Verbose; keeps the console clean by default).
 *   • Immediately on tab-count change: prints a warning/info + full table.
 */
function onSessionStatus(s) {
  _jsBridgeEnabled = !!s.jsBridgeEnabled;
  if (_jsBridgeEnabled && connection) installVcon();
  else if (!_jsBridgeEnabled) uninstallVcon();

  const now   = performance.now();
  const tabOk = s.tabCount === 1;

  // First status ever — print full table and set baseline.
  if (_statusPrevTabs === -1) {
    _statusPrevTabs  = s.tabCount;
    _statusLastLogTs = now;
    _printStatusTable(s);
    if (!tabOk) {
      console.warn(
        '%c SPECULUM %c ⚠ TAB ANOMALY: ' + s.tabCount + ' tab(s) open (expected 1)',
        _ST.badge, _ST.warn,
      );
    }
    return;
  }

  // Periodic compact log (every 5 s, Verbose-only via console.debug).
  if (now - _statusLastLogTs >= 5_000) {
    _statusLastLogTs = now;
    const tabMark = tabOk ? '✔' : '⚠';
    console.debug(
      '%c SPECULUM %c ' + tabMark + ' tabs=%c' + s.tabCount +
      '%c  fps=%c' + s.fps.toFixed(1) +
      '%c  ' + s.width + '×' + s.height +
      '  up=%c' + _fmtUptime(s.uptimeMs) +
      '%c  ' + (s.url.length > 55 ? s.url.slice(0, 52) + '…' : s.url),
      _ST.badge, _ST.key,
      tabOk ? _ST.ok : _ST.warn,
      _ST.key, _ST.val,
      _ST.key, _ST.val,
      _ST.key, _ST.val,
    );
  }

  // Tab count changed — alert immediately.
  if (s.tabCount !== _statusPrevTabs) {
    _statusPrevTabs = s.tabCount;
    if (!tabOk) {
      console.warn(
        '%c SPECULUM %c ⚠ TAB ANOMALY: ' + s.tabCount + ' tab(s) open (expected 1)',
        _ST.badge, _ST.warn,
      );
      _printStatusTable(s);
    } else {
      console.info(
        '%c SPECULUM %c ✔ Tab count restored to 1',
        _ST.badge, _ST.ok,
      );
    }
  }
}

function printBanner(w, h) {
  const BADGE = 'background:#1565c0;color:#fff;font-weight:bold;padding:2px 8px;border-radius:3px;letter-spacing:.05em';
  const DIM   = 'color:#666;font-weight:bold';
  const VAL   = 'color:#ddd;font-family:monospace';
  console.groupCollapsed('%c SPECULUM %c — virtual browser bridge', BADGE, 'color:#888');
  console.log('%cViewport %c' + w + '×' + h,               DIM, VAL);
  console.log('%cTransport%c SignalR / HTTP3 + JPEG Screencast', DIM, VAL);
  console.log('%cURL      %c' + window.location.href,        DIM, VAL);
  console.groupEnd();
}

// ── Disconnect / cleanup ──────────────────────────────────────────────────────
async function stopConnection() {
  teardownFrameWorker();
  uninstallVcon();

  for (const { reject: rej, timer } of _evalPending.values()) {
    clearTimeout(timer);
    rej(new Error('[vcon] Session closed'));
  }
  _evalPending.clear();

  _statusLastLogTs = 0;
  _statusPrevTabs  = -1;

  if (userInputSubject)    try { userInputSubject.complete();    } catch { /* ignore */ }
  if (consoleInputSubject) try { consoleInputSubject.complete(); } catch { /* ignore */ }
  userInputSubject    = null;
  consoleInputSubject = null;

  if (connection) {
    try { await connection.stop(); } catch { /* ignore */ }
    connection = null;
  }
}

function onDisconnected() {
  setStatus('Disconnected — click to reconnect', 'error');
  backBtn.disabled    = true;
  fwdBtn.disabled     = true;
  urlBar.disabled     = true;
  urlBar.value        = '';
  connectBtn.disabled = false;
  overlay.classList.remove('hidden');
  heldKeys.clear();
  pressedBtns.clear();
  connecting = false;

  teardownFrameWorker();
  uninstallVcon();

  for (const { reject: rej, timer } of _evalPending.values()) {
    clearTimeout(timer);
    rej(new Error('[vcon] Session closed'));
  }
  _evalPending.clear();
  _statusLastLogTs = 0;
  _statusPrevTabs  = -1;

  if (userInputSubject)    try { userInputSubject.complete();    } catch { /* ignore */ }
  if (consoleInputSubject) try { consoleInputSubject.complete(); } catch { /* ignore */ }
  userInputSubject    = null;
  consoleInputSubject = null;
  connection = null;
}

/** Full session bootstrap after SignalR is connected. */
async function bootstrapSession() {
  const initW = viewport.clientWidth  || 1280;
  const initH = viewport.clientHeight || 720;
  syncCanvasSize(initW, initH);

  await connection.invoke('StartSessionAsync', window.location.href, initW, initH);

  connection.stream('OpenFrameChannel').subscribe({
    next:     onFrame,
    error:    (err) => console.error('[frame stream]', err),
    complete: () => {},
  });

  connection.stream('OpenConsoleOutputChannel').subscribe({
    next:     onConsoleOutput,
    error:    (err) => console.error('[console stream]', err),
    complete: () => {},
  });

  connection.stream('OpenStatusChannel').subscribe({
    next:     onSessionStatus,
    error:    (err) => console.warn('[status stream]', err),
    complete: () => {},
  });

  userInputSubject    = new signalR.Subject();
  consoleInputSubject = new signalR.Subject();
  connection.send('OpenUserInputChannel', userInputSubject);
  connection.send('OpenConsoleInputChannel', consoleInputSubject);

  setStatus('Streaming', 'connected');
  backBtn.disabled  = false;
  fwdBtn.disabled   = false;
  urlBar.disabled   = false;
  overlay.classList.add('hidden');
  canvas.focus();
  printBanner(initW, initH);
}

// ── Connect ───────────────────────────────────────────────────────────────────
async function connect() {
  if (connecting) return;
  connecting = true;

  setStatus('Connecting...', 'connecting');
  connectBtn.disabled = true;

  try {
    const readyRes = await fetch('/ready');
    if (!readyRes.ok) {
      window.location.replace('/setup');
      return;
    }
  } catch {
    setStatus('Error: cannot reach server', 'error');
    connectBtn.disabled = false;
    connecting = false;
    return;
  }

  await stopConnection();

  connection = new signalR.HubConnectionBuilder()
    .withUrl('/vhub')
    .withHubProtocol(new signalR.protocols.msgpack.MessagePackHubProtocol())
    .withAutomaticReconnect()
    .build();

  connection.onclose(onDisconnected);
  connection.onreconnecting(() => setStatus('Reconnecting...', 'connecting'));
  connection.onreconnected(async () => {
    try {
      await bootstrapSession();
    } catch (err) {
      console.error('[reconnect]', err);
      setStatus('Reconnect failed — click to retry', 'error');
      connectBtn.disabled = false;
      overlay.classList.remove('hidden');
    }
  });

  try {
    await connection.start();
    await bootstrapSession();
  } catch (err) {
    console.error('[connect]', err);
    setStatus('Error: ' + err.message, 'error');
    connectBtn.disabled = false;
    await stopConnection();
  } finally {
    connecting = false;
  }
}

connectBtn.addEventListener('click', connect);

// ── Input helpers ─────────────────────────────────────────────────────────────
let _cachedRect = null;
function invalidateRect() { _cachedRect = null; }
function canvasToPage(clientX, clientY) {
  if (!_cachedRect) _cachedRect = canvas.getBoundingClientRect();
  return {
    x: Math.round((clientX - _cachedRect.left) * (sessionW / _cachedRect.width)),
    y: Math.round((clientY - _cachedRect.top)  * (sessionH / _cachedRect.height)),
  };
}

// ── Mouse events ──────────────────────────────────────────────────────────────
let lastMoveTime  = 0;
const pressedBtns = new Set();

canvas.addEventListener('mousemove', e => {
  const now = performance.now();
  if (now - lastMoveTime < 16) return;
  lastMoveTime = now;
  const {x, y} = canvasToPage(e.clientX, e.clientY);
  sendInput({ type: 'mousemove', x, y });
});

canvas.addEventListener('mousedown', e => {
  e.preventDefault();
  canvas.focus();
  pressedBtns.add(e.button);
  const {x, y} = canvasToPage(e.clientX, e.clientY);
  sendInput({ type: 'mousedown', x, y, button: e.button });
});

window.addEventListener('mouseup', e => {
  if (!pressedBtns.has(e.button)) return;
  pressedBtns.delete(e.button);
  const {x, y} = canvasToPage(e.clientX, e.clientY);
  sendInput({ type: 'mouseup', x, y, button: e.button });
});

window.addEventListener('mousemove', e => {
  if (pressedBtns.size === 0) return;
  const now = performance.now();
  if (now - lastMoveTime < 16) return;
  lastMoveTime = now;
  const {x, y} = canvasToPage(e.clientX, e.clientY);
  sendInput({ type: 'mousemove', x, y });
});

canvas.addEventListener('contextmenu', e => e.preventDefault());

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const {x, y} = canvasToPage(e.clientX, e.clientY);
  let dX = e.deltaX, dY = e.deltaY;
  if      (e.deltaMode === 1) { dX *= 40; dY *= 40; }
  else if (e.deltaMode === 2) { dX *= canvas.clientWidth; dY *= canvas.clientHeight; }
  sendInput({ type: 'wheel', x, y, deltaX: dX, deltaY: dY });
}, { passive: false });

// ── Touch events ──────────────────────────────────────────────────────────────
canvas.addEventListener('touchstart', e => {
  e.preventDefault();
  canvas.focus();
  const t = e.changedTouches[0];
  if (!t) return;
  const {x, y} = canvasToPage(t.clientX, t.clientY);
  sendInput({ type: 'mousedown', x, y, button: 0 });
}, { passive: false });

canvas.addEventListener('touchmove', e => {
  e.preventDefault();
  const t = e.touches[0];
  if (!t) return;
  const now = performance.now();
  if (now - lastMoveTime < 16) return;
  lastMoveTime = now;
  const {x, y} = canvasToPage(t.clientX, t.clientY);
  sendInput({ type: 'mousemove', x, y });
}, { passive: false });

canvas.addEventListener('touchend', e => {
  e.preventDefault();
  const t = e.changedTouches[0];
  if (!t) return;
  const {x, y} = canvasToPage(t.clientX, t.clientY);
  sendInput({ type: 'mouseup', x, y, button: 0 });
}, { passive: false });

canvas.addEventListener('touchcancel', e => {
  e.preventDefault();
  const t = e.changedTouches[0];
  if (!t) return;
  const {x, y} = canvasToPage(t.clientX, t.clientY);
  sendInput({ type: 'mouseup', x, y, button: 0 });
}, { passive: false });

// ── Keyboard events ───────────────────────────────────────────────────────────
canvas.setAttribute('tabindex', '0');
const heldKeys = new Set();

canvas.addEventListener('keydown', e => {
  if (e.key === 'F12') return;
  if ((e.ctrlKey || e.metaKey) && ['r','l','t','w','n'].includes(e.key.toLowerCase())) return;
  e.preventDefault();
  heldKeys.add(e.key);
  sendInput({ type: 'keydown', key: e.key });
});

canvas.addEventListener('keyup', e => {
  if (!heldKeys.has(e.key)) return;
  heldKeys.delete(e.key);
  sendInput({ type: 'keyup', key: e.key });
});

canvas.addEventListener('blur', () => {
  for (const key of heldKeys) sendInput({ type: 'keyup', key });
  heldKeys.clear();
});

// ── Navigation buttons ────────────────────────────────────────────────────────
// goback / goforward are handled by the sidecar as JSON input events
backBtn.addEventListener('click', () => sendInput({ type: 'goback' }));
fwdBtn.addEventListener('click',  () => sendInput({ type: 'goforward' }));

// ── URL bar navigation ────────────────────────────────────────────────────────
urlBar.addEventListener('focus', () => {
  // Select all on focus so the user can immediately type a new URL.
  urlBar.select();
});

urlBar.addEventListener('blur', () => {
  // Revert to the last confirmed URL if the user didn't commit.
  urlBar.value = _currentUrl;
});

urlBar.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const url = urlBar.value.trim();
    if (!url) { urlBar.value = _currentUrl; return; }
    // Prefix bare hostnames / search terms with https:// for convenience.
    const target = /^https?:\/\//i.test(url) ? url : 'https://' + url;
    urlBar.value = target;
    urlBar.blur();
    canvas.focus();
    if (connection) connection.invoke('NavigateAsync', target).catch(console.error);
  } else if (e.key === 'Escape') {
    urlBar.value = _currentUrl;
    urlBar.blur();
    canvas.focus();
  }
  // Prevent canvas key handlers from firing while the URL bar has focus.
  e.stopPropagation();
});

// ── Auto-connect ──────────────────────────────────────────────────────────────
connect();