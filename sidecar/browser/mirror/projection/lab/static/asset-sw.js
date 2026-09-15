/* Speculum — SW do Projected Gecko. URL original. Token no header. Sem rewrite. */
const TOKEN_HEADER = 'x-speculum-session-token';
let token = '';
let nextId = 1;
const pending = new Map();

self.addEventListener('message', (event) => {
  const msg = event.data;
  if (!msg || typeof msg !== 'object') {
    return;
  }
  if (msg.type === 'token' && typeof msg.token === 'string') {
    token = msg.token;
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
  event.respondWith(proxy(event.request));
});

async function proxy(request) {
  const id = nextId++;
  const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const client = clientList[0];
  if (!client) {
    return new Response('', { status: 503 });
  }
  const range = request.headers.get('Range') || '';
  const reply = new Promise((resolve) => {
    pending.set(id, resolve);
  });
  client.postMessage({
    type: 'asset-fetch',
    id,
    url: request.url,
    dest: request.destination,
    range,
    tokenHeader: TOKEN_HEADER,
    token,
  });
  const msg = await reply;
  if (!msg.ok) {
    return new Response('', { status: 404, statusText: String(msg.error || 'denied') });
  }
  const headers = new Headers();
  if (token) {
    headers.set(TOKEN_HEADER, token);
  }
  return new Response(msg.bytes, { status: 200, headers });
}
