/**
 * The bundle's own service worker.
 *
 * Rewriting HTML and CSS reaches the URLs that are written down. It cannot reach the
 * ones a minified application builds at runtime — and blanket-replacing strings
 * inside a JS bundle is banned (emit E2), because it corrupts unrelated data.
 *
 * So the bundle carries a worker that intercepts every request and answers it from
 * the route map. That is also what makes E2 true rather than aspirational: nothing
 * leaves for the real origin, because nothing is allowed to.
 *
 * The origin's own service worker is not shipped (OPEN-4); this replaces it.
 */
export const SERVICE_WORKER = `/* imago bundle worker — generated, do not edit */
let ROUTES = null
let PRIMARY = ''

async function routes() {
  if (ROUTES) return ROUTES
  const res = await fetch('/imago-routes.json', { cache: 'no-store' })
  const data = await res.json()
  ROUTES = data.routes
  PRIMARY = data.primaryHost
  return ROUTES
}

function stripQuery(u) { const i = u.indexOf('?'); return i < 0 ? u : u.slice(0, i) }

// An asset the bundle lacks and an API call with no backend are different failures.
// Lumping them together hides bundle incompleteness inside "blocked by policy".
var ASSET_DESTINATIONS = ['image', 'font', 'style', 'script', 'audio', 'video', 'track', 'embed', 'object', 'manifest']
function isAsset(request) {
  var d = request.destination || ''
  return ASSET_DESTINATIONS.indexOf(d) !== -1
}

function log(entry) {
  try {
    fetch('/__imago/log', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(entry), keepalive: true,
    })
  } catch (e) { /* logging must never break the page */ }
}

self.addEventListener('install', (e) => { self.skipWaiting() })
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()) })

self.addEventListener('fetch', (event) => {
  var url = event.request.url
  if (url.indexOf('/__imago/') !== -1 || url.indexOf('/imago-routes.json') !== -1) return

  event.respondWith((async () => {
    var map = await routes()
    var selfOrigin = self.location.origin
    var isNav = event.request.mode === 'navigate'
    var local = url.indexOf(selfOrigin) === 0

    // The bundle is served from our origin, so the application's own API — which it
    // calls with a relative path — arrives here looking exactly like a local file
    // request. Treating it as one is why a bundle renders the server-rendered page
    // and then blanks a moment later: hydration asks for data, gets a 404 from the
    // static server, and replaces the content with empty state. A data request is
    // routed to the preview's API layer under the URL the recording knows it by.
    var target = url
    if (local) {
      var u = new URL(url)
      target = 'https://' + PRIMARY + u.pathname + u.search
    }

    var hit = map[target] || map[stripQuery(target)] || map[url] || map[stripQuery(url)]
    var wantsBytes = isNav || isAsset(event.request)

    if (wantsBytes) {
      if (hit) { log({ kind: 'bundle', url: url }); return fetch(hit) }
      if (local) {
        var res = await fetch(event.request).catch(function () { return null })
        if (res && res.status !== 404) return res
        log({ kind: 'missing-asset', url: url })
        return res || new Response('not in bundle', { status: 404 })
      }
      log({ kind: 'missing-asset', url: url })
      return new Response('asset not in bundle', { status: 404 })
    }

    // a data request: the preview decides what happens (D-018)
    if (hit && event.request.method === 'GET') { log({ kind: 'bundle', url: url }); return fetch(hit) }
    return apiCall(target, event.request)
  })())
})

async function apiCall(target, request) {
  var proxied = '/__imago/api?u=' + encodeURIComponent(target) + '&m=' + request.method
  var body
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    body = await request.clone().arrayBuffer()
  }
  var headers = { 'x-imago-method': request.method }
  var ct = request.headers.get('content-type')
  if (ct) headers['content-type'] = ct
  var res = await fetch(proxied, {
    method: request.method === 'GET' || request.method === 'HEAD' ? 'GET' : 'POST',
    headers: headers,
    body: body,
  }).catch(function () { return null })
  if (res) return res
  log({ kind: 'blocked', url: target })
  return new Response('blocked by imago (E2 closed world)', { status: 503 })
}
`

/**
 * Registers the worker — and never reloads.
 *
 * The worker is an optimisation now, not a requirement: the preview resolves a data
 * request no file answers, whichever way the bundle addresses it (E-11), and the
 * generator has already pointed the application's own origins at us (E-10). So the
 * page works on its very first paint, with or without a controller.
 *
 * That matters because the reload was itself a symptom generator: it fired a moment
 * after first paint, which is exactly what "it loads and then breaks" looks like.
 */
export function bootScript(): string {
  return `<script>/* imago boot */(function(){
  if (!('serviceWorker' in navigator)) return
  navigator.serviceWorker.getRegistrations().then(function (rs) {
    var foreign = rs.filter(function (r) {
      return !(r.active && r.active.scriptURL.indexOf('imago-sw.js') !== -1)
    })
    return Promise.all(foreign.map(function (r) { return r.unregister() }))
  }).then(function () {
    return navigator.serviceWorker.register('/imago-sw.js', { scope: '/' })
  }).catch(function () { /* the bundle serves its own files either way */ })
})()</script>`
}
