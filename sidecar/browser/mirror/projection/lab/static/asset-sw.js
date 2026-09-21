/* Speculum — SW do Projected Gecko. URL original. Token no header. Sem rewrite. */
const TOKEN_HEADER = 'x-speculum-session-token';
let token = '';
let pageClientId = '';
let nextId = 1;
const pending = new Map();
const ctxByClient = new Map();
let traceAll = false;

function nowMs() {
  return Math.round(
    (typeof performance !== 'undefined' && performance.timeOrigin
      ? performance.timeOrigin + performance.now()
      : Date.now()),
  );
}

function bodyFnv16(bytes) {
  const u8 = !bytes
    ? new Uint8Array(0)
    : bytes instanceof Uint8Array
      ? bytes
      : new Uint8Array(bytes);
  let h = 14695981039346656037n;
  const prime = 1099511628211n;
  for (let i = 0; i < u8.length; i++) {
    h ^= BigInt(u8[i]);
    h = BigInt.asUintN(64, h * prime);
  }
  return h.toString(16).padStart(16, '0');
}

function urlWorthTracing(url) {
  return traceAll || /logo\.svg/i.test(url || '');
}

async function emitTrace(event) {
  const payload = { t: nowMs(), ...event };
  try {
    const client = await pageClient();
    if (client) {
      client.postMessage({ type: 'asset-trace', event: payload });
    }
  } catch (_) {
    /* ignore */
  }
}

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
  if (msg.type === 'asset-trace-enable') {
    traceAll = msg.enable !== false;
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
  if (urlWorthTracing(event.request.url)) {
    void emitTrace({
      hop: 'sw.intercept',
      url: event.request.url.slice(0, 300),
      range: event.request.headers.get('Range') || '',
      dest,
      controlled: true,
      clientId: event.clientId || '',
      escaped: false,
      contextId: (event.clientId && ctxByClient.get(event.clientId)) || 1,
    });
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

function isobmffImageBrand(u8) {
  // ISO BMFF: size(4) + 'ftyp'(4) + major_brand(4) … also scan compatible brands.
  if (!u8 || u8.byteLength < 12) return null;
  const brands = new Set(['avif', 'avis', 'mif1', 'msf1', 'heic', 'heif', 'heim', 'heis']);
  const ascii = (o) =>
    String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
  if (ascii(4) !== 'ftyp') return null;
  const major = ascii(8);
  if (brands.has(major)) return major;
  for (let o = 16; o + 4 <= Math.min(u8.byteLength, 64); o += 4) {
    const b = ascii(o);
    if (brands.has(b)) return b;
  }
  return null;
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
  if (isobmffImageBrand(u8)) return true;
  const head = new TextDecoder().decode(u8.slice(0, Math.min(256, u8.byteLength))).toLowerCase();
  if (head.includes('<svg') || head.includes('<!doctype svg')) return true;
  const ct = (contentType || '').toLowerCase();
  // Tipo image/* com corpo que não cheira — recusar (evita cache de decode falho).
  if (ct.startsWith('image/')) return false;
  return bytes.byteLength > 0;
}

function headHex16(bytes) {
  const u8 = !bytes
    ? new Uint8Array(0)
    : bytes instanceof Uint8Array
      ? bytes
      : new Uint8Array(bytes);
  const n = Math.min(16, u8.byteLength);
  let out = '';
  for (let i = 0; i < n; i++) out += u8[i].toString(16).padStart(2, '0');
  return out;
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
  const looks = looksLikeImageBody(bytes, contentType);
  const u8in = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (wantImage && !looks) {
    headers.set('Cache-Control', 'no-store');
    return {
      response: new Response('', { status: 502, statusText: 'speculum-bad-image', headers }),
      status: 502,
      looksLikeImage: false,
      byteLength: 0,
      bodySha16: bodyFnv16(null),
      inputByteLength: u8in.byteLength,
      inputHeadHex: headHex16(u8in),
      why: u8in.byteLength === 0 ? 'empty_body' : 'sniff_reject',
    };
  }
  if (token) {
    headers.set(TOKEN_HEADER, token);
  }
  const range = request.headers.get('Range') || '';
  const u8 = u8in;
  if (!range) {
    return {
      response: new Response(bytes, { status: 200, headers }),
      status: 200,
      looksLikeImage: looks,
      byteLength: u8.byteLength,
      bodySha16: bodyFnv16(u8),
      inputByteLength: u8.byteLength,
      inputHeadHex: headHex16(u8),
    };
  }
  const m = /^bytes=(\d+)-(\d+)?$/i.exec(range.trim());
  const start = m ? Number(m[1]) : 0;
  const end = start + u8.byteLength - 1;
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Content-Range', `bytes ${start}-${end}/*`);
  headers.set('Content-Length', String(u8.byteLength));
  return {
    response: new Response(bytes, { status: 206, headers }),
    status: 206,
    looksLikeImage: looks,
    byteLength: u8.byteLength,
    bodySha16: bodyFnv16(u8),
    inputByteLength: u8.byteLength,
    inputHeadHex: headHex16(u8),
  };
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
  const traceAlways = urlWorthTracing(request.url) || !msg.ok;
  if (!msg.ok) {
    if (traceAlways) {
      void emitTrace({
        hop: 'sw.respond',
        fetchId: id,
        contextId,
        url: request.url.slice(0, 300),
        range,
        dest: request.destination,
        status: 404,
        contentType: '',
        cacheControl: '',
        byteLength: 0,
        looksLikeImage: false,
        bodySha16: bodyFnv16(null),
        why: String(msg.error || 'denied'),
      });
    }
    return new Response('', { status: 404, statusText: String(msg.error || 'denied') });
  }
  const built = assetResponse(request, msg.bytes, msg.contentType || '');
  if (urlWorthTracing(request.url) || built.status >= 400) {
    void emitTrace({
      hop: 'sw.respond',
      fetchId: id,
      contextId,
      url: request.url.slice(0, 300),
      range,
      dest: request.destination,
      status: built.status,
      contentType: msg.contentType || '',
      cacheControl: 'no-store',
      byteLength: built.byteLength,
      looksLikeImage: built.looksLikeImage,
      bodySha16: built.bodySha16,
      inputByteLength: built.inputByteLength ?? null,
      inputHeadHex: built.inputHeadHex ?? null,
      why: built.why || null,
    });
  }
  return built.response;
}
