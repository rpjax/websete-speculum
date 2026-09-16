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

function assetResponse(request, bytes, contentType) {
  const headers = new Headers();
  if (contentType) {
    headers.set('Content-Type', contentType);
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
