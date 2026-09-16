/* Speculum — SW do Projected Gecko. URL original. Token no header. Sem rewrite. */
const TOKEN_HEADER = 'x-speculum-session-token';
let token = '';
let pageClientId = '';
let nextId = 1;
const pending = new Map();
const ctxByClient = new Map();

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  const msg = event.data;
  if (!msg || typeof msg !== 'object') {
    return;
  }
  if (msg.type === 'token' && typeof msg.token === 'string') {
    token = msg.token;
    if (event.source && typeof event.source.id === 'string') {
      pageClientId = event.source.id;
    }
    return;
  }
  if (msg.type === 'ctx' && typeof msg.contextId === 'number' && event.source && typeof event.source.id === 'string') {
    ctxByClient.set(event.source.id, msg.contextId);
    return;
  }
  if (msg.type === 'asset' && typeof msg.id === 'number') {
    const waiter = pending.get(msg.id);
    if (!waiter) {
      return;
    }
    pending.delete(msg.id);
    waiter(msg);
  }
});

function destOk(dest) {
  return dest === 'image' || dest === 'font' || dest === 'audio' || dest === 'video' || dest === '';
}

self.addEventListener('fetch', (event) => {
  const dest = event.request.destination;
  const url = new URL(event.request.url);
  if (url.origin === self.location.origin) {
    return;
  }
  if (!destOk(dest)) {
    event.respondWith(new Response('', { status: 403, statusText: 'speculum-denied' }));
    return;
  }
  event.respondWith(proxy(event.request, event.clientId));
});

async function pageClient() {
  if (pageClientId) {
    const pinned = await self.clients.get(pageClientId);
    if (pinned) {
      return pinned;
    }
  }
  const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  return clientList[0] ?? null;
}

function looksLikeImageBody(bytes, contentType) {
  if (!bytes || bytes.byteLength < 3) return false;
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8[0] === 0xff && u8[1] === 0xd8) return true;
  if (u8[0] === 0x89 && u8[1] === 0x50) return true;
  if (u8[0] === 0x47 && u8[1] === 0x49 && u8[2] === 0x46) return true;
  if (
    u8.byteLength >= 12 &&
    u8[0] === 0x52 &&
    u8[8] === 0x57 &&
    u8[9] === 0x45 &&
    u8[10] === 0x42 &&
    u8[11] === 0x50
  ) {
    return true;
  }
  const head = new TextDecoder().decode(u8.slice(0, Math.min(256, u8.byteLength))).toLowerCase();
  if (head.includes('<svg') || head.includes('<!doctype svg')) return true;
  const ct = (contentType || '').toLowerCase();
  // Tipo image/* com corpo que não cheira — recusar (evita cache de decode falho).
  if (ct.startsWith('image/')) return false;
  return bytes.byteLength > 0;
}

function assetResponse(request, bytes, contentType) {
  const headers = new Headers();
  if (contentType) {
    headers.set('Content-Type', contentType);
  }
  // Sem isto o Chromium gruda o primeiro body vazio/errado do cold race e o <img> fica nw=0
  // mesmo depois do tee completo (fetch/blob novos funcionam; o src original não).
  headers.set('Cache-Control', 'no-store');
  const dest = request.destination;
  const wantImage = dest === 'image' || dest === '' || (contentType || '').toLowerCase().startsWith('image/');
  if (wantImage && !looksLikeImageBody(bytes, contentType)) {
    headers.set('Cache-Control', 'no-store');
    return new Response('', { status: 502, statusText: 'speculum-bad-image', headers });
  }
  if (token) {
    headers.set(TOKEN_HEADER, token);
  }
  const range = request.headers.get('Range') || '';
  if (!range) {
    return new Response(bytes, { status: 200, headers });
  }
  const m = /^bytes=(\d+)-(\d+)?$/i.exec(range.trim());
  const start = m ? Number(m[1]) : 0;
  const end = start + bytes.byteLength - 1;
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Content-Range', `bytes ${start}-${end}/*`);
  headers.set('Content-Length', String(bytes.byteLength));
  return new Response(bytes, { status: 206, headers });
}

async function proxy(request, clientId) {
  const id = nextId++;
  const client = await pageClient();
  if (!client) {
    return new Response('', { status: 503 });
  }
  const range = request.headers.get('Range') || '';
  const contextId = (clientId && ctxByClient.get(clientId)) || 1;
  const reply = new Promise((resolve) => {
    pending.set(id, resolve);
  });
  client.postMessage({
    type: 'asset-fetch',
    id,
    url: request.url,
    dest: request.destination,
    range,
    contextId,
    tokenHeader: TOKEN_HEADER,
    token,
  });
  const msg = await reply;
  if (!msg.ok) {
    return new Response('', { status: 404, statusText: String(msg.error || 'denied') });
  }
  return assetResponse(request, msg.bytes, msg.contentType || '');
}
