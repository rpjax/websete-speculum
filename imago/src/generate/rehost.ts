import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { hashJson } from '../core/hash.js'
import { readMeta, runDir, sessionDir } from '../core/store.js'
import type { NetworkRecord, SnapshotRecord } from '../core/types.js'
import { isFixtureResponse } from '../shared/fixture.js'
import { DEFAULT_PROFILE, type GenerationProfile, type RunManifest } from './types.js'
import { SERVICE_WORKER, bootScript } from './serviceWorker.js'

/**
 * `rehost` — serve the origin's own bytes from our origin (emit.md §2).
 *
 * It does not reproduce the application; it *is* the application, missing only its
 * server. Files are laid out under the primary host's own paths so root-absolute
 * references resolve, and cross-origin hosts live under `/__imago/h/<host>/`.
 *
 * HTML and CSS are rewritten. **JavaScript is not** — blanket search-and-replace
 * over a minified bundle corrupts unrelated strings (emit E2). What the rewrite
 * cannot reach, the bundle's service worker resolves at runtime from the route map,
 * which is also what keeps the bundle from leaving for the real origin.
 */
export function generateRehost(
  sessionId: string,
  profile: GenerationProfile = DEFAULT_PROFILE,
): RunManifest {
  const meta = readMeta(sessionId)
  if (!meta) throw new Error(`unknown session ${sessionId}`)

  const dir = sessionDir(sessionId)
  const network = readJsonDir<NetworkRecord>(join(dir, 'network'))
  const snapshots = readJsonDir<SnapshotRecord>(join(dir, 'snapshots'))
  if (snapshots.length === 0) throw new Error('session has no snapshots — nothing to generate')

  const stored = network.filter((r) => r.responseBodyHash)
  if (stored.length === 0) throw new Error('session stored no response bodies')

  const entrySnapshot = snapshots.find((s) => s.trigger === 'mark') ?? snapshots[0]!
  const primaryHost = hostOf(entrySnapshot.url) ?? meta.origins[0] ?? ''
  if (!primaryHost) throw new Error('cannot determine the primary host')

  const profileHash = hashJson(profile)
  // A run is keyed on (session, profile) — the profile hash is in the id, not only
  // in the manifest. Without it two generations in the same second (two emitters,
  // two profiles) resolve to the same directory and silently write over each other,
  // which reads as "the emitter ignored my profile".
  const runId = `gen-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${profileHash.slice(0, 8)}`
  const out = runDir(sessionId, runId)
  mkdirSync(out, { recursive: true })

  // ── lay files out by URL ─────────────────────────────────────────────────────
  const routes: Record<string, string> = {}
  const warnings: string[] = []
  let bytes = 0
  let files = 0

  for (const rec of stored) {
    // JSON API bodies are fixtures, not static files. Putting them in the route
    // map makes the worker return one GraphQL response for every POST.
    if (isFixtureResponse(rec)) continue
    const natural = localPath(rec.url, primaryHost, rec.responseHeaders?.['content-type'])
    if (!natural) { warnings.push(`unmappable url skipped: ${rec.url}`); continue }
    const body = readFileSync(join(dir, 'blobs', rec.responseBodyHash!))
    const written = writeArtifact(out, natural, rec.url, body)
    if (!written) { warnings.push(`could not write ${rec.url}`); continue }
    if (written !== natural) warnings.push(`path collision, stored content-addressed: ${rec.url}`)
    routes[rec.url] = '/' + written.replace(/\\/g, '/')
    bytes += body.byteLength
    files++
  }

  // ── rewrite what can be rewritten safely ─────────────────────────────────────
  const rewrites: { file: string; count: number }[] = []
  for (const [url, local] of Object.entries(routes)) {
    if (!/\.(html?|css)$/i.test(local)) continue
    const target = join(out, local.slice(1))
    let before: string
    try { before = readFileSync(target, 'utf8') } catch { continue }
    const { text, count } = rewriteUrls(before, routes, url)
    if (count > 0) { writeFileSync(target, text); rewrites.push({ file: local, count }) }
  }

  // ── point the application's own hosts at us (E-10) ───────────────────────────
  // The API of a real application is usually on its own host — `graphql.<site>` —
  // and that URL is built inside the JavaScript bundle. Left alone, the bundle
  // calls the real internet and the browser refuses it on CORS, so the app never
  // gets data no matter how complete the asset set is.
  //
  // This is not a blanket replacement (E2 still forbids that): only **complete
  // origins of hosts this session recorded** are substituted, each one enumerated
  // in the manifest, for a same-origin namespace the preview resolves.
  const originMap = originRewrites(stored, primaryHost)
  for (const local of new Set(Object.values(routes))) {
    if (!/\.(html?|css|js|mjs|json)$/i.test(local)) continue
    const target = join(out, local.slice(1))
    let text: string
    try { text = readFileSync(target, 'utf8') } catch { continue }
    let count = 0
    for (const [origin, replacement] of originMap) {
      if (!text.includes(origin)) continue
      text = text.split(origin).join(replacement)
      count++
      // the same origin with escaped slashes, as it appears inside JSON in JS
      const escaped = origin.replace(/\//g, '\\/')
      if (text.includes(escaped)) text = text.split(escaped).join(replacement.replace(/\//g, '\\/'))
    }
    if (count > 0) { writeFileSync(target, text); rewrites.push({ file: local, count }) }
  }

  // ── entry document ───────────────────────────────────────────────────────────
  const entryUrl = entrySnapshot.url
  const entryLocal = routes[entryUrl] ?? routes[stripQuery(entryUrl)] ?? findIndex(routes)
  if (!entryLocal) throw new Error('no HTML document was recorded — cannot build an entry point')

  // The origin's own service worker is not ours to ship (OPEN-4); ours replaces it.
  writeFileSync(join(out, 'imago-sw.js'), SERVICE_WORKER)
  writeFileSync(join(out, 'imago-routes.json'), JSON.stringify({ routes, primaryHost }, null, 0))
  // every document, not only the entry: any page can be the one that gets opened
  for (const local of new Set(Object.values(routes))) {
    if (/\.html?$/i.test(local)) injectBoot(join(out, local.slice(1)))
  }

  const referenced = new Set<string>()
  for (const snap of snapshots) for (const r of snap.refs) referenced.add(r)
  const missing = [...referenced].filter((u) => !routes[u]).sort()

  const manifest: RunManifest = {
    runId, sessionId, profileHash, profile, createdAt: new Date().toISOString(),
    emitter: 'rehost', primaryHost, entry: entryLocal, files, bytes, routes, missing, rewrites, warnings,
    rewrittenOrigins: originMap
      .map(([origin]) => origin)
      .filter((origin) => origin.startsWith('https://')),
  }
  writeFileSync(join(out, 'imago-run.json'), JSON.stringify(manifest, null, 2))
  return manifest
}

/**
 * A URL path and a directory path are the same string, and a site serves both:
 * `/api/v2/pixel` is a file, `/api/v2/pixel/track` needs `pixel` to be a folder.
 * Whichever arrives second cannot be written, and the whole generation fails on an
 * `EEXIST` from `mkdir`.
 *
 * So a collision is not an error: the loser is stored content-addressed, exactly
 * like an over-long path (C-4d), and the route map points at wherever it landed.
 * The manifest records the substitution.
 */
function writeArtifact(out: string, natural: string, url: string, body: Buffer): string | null {
  const attempt = (local: string): boolean => {
    const target = join(out, local)
    try {
      mkdirSync(dirname(target), { recursive: true })
      if (existsSync(target) && statSync(target).isDirectory()) return false
      writeFileSync(target, body)
      return true
    } catch {
      return false
    }
  }
  if (attempt(natural)) return natural
  const fallback = `__imago/a/${shortHash(url)}${extensionOf(natural)}`
  return attempt(fallback) ? fallback : null
}

/**
 * Complete origins → the namespace the preview resolves as file-or-API (E-10).
 *
 * Only hosts that appear in this session are listed, the primary host excluded (its
 * paths are already the web root). Both the absolute and protocol-relative forms
 * are covered, longest first so a prefix never eats a longer match.
 */
export function originRewrites(
  records: readonly { url: string }[],
  primaryHost: string,
): [string, string][] {
  const hosts = new Set<string>()
  for (const r of records) {
    try {
      const parsed = new URL(r.url)
      if (!/^https?:$/.test(parsed.protocol)) continue
      if (parsed.host === primaryHost) continue
      hosts.add(parsed.host)
    } catch { /* not a url we can use */ }
  }
  const out: [string, string][] = []
  for (const host of [...hosts].sort((a, b) => b.length - a.length)) {
    const local = `/__imago/h/${host}`
    out.push([`https://${host}`, local])
    out.push([`http://${host}`, local])
  }
  return out
}

/**
 * The protocol-relative form (`//host/path`) is deliberately **not** rewritten.
 *
 * Application code routinely prefixes a scheme onto it — `"https:" + url` — and a
 * root-relative replacement turns that into `https:/__imago/…`, which the browser
 * reads as the host `__imago`. The result is `ERR_NAME_NOT_RESOLVED` on a URL that
 * never existed, which is far worse than leaving the original alone: the worker and
 * the server fallback (E-11) still catch it at request time.
 */

/** Windows path budget, minus room for the run directory itself. */
const MAX_LOCAL_PATH = 120
const MAX_SEGMENT = 60

/**
 * `<host>/<pathname>` for the primary host at the root; other hosts namespaced.
 *
 * A URL whose path is too long — or has a segment too long — is stored under a
 * content-addressed name instead. Truncating was not an option: an image proxy
 * emits paths of a hundred-plus characters that differ only near the end, so
 * shortening them collides two different assets onto one file and the bundle
 * silently serves the wrong picture. Windows' path limit makes it worse, not
 * different.
 */
/**
 * A static server types a file by its extension, and a real site's URLs mostly have
 * none: `/steam-gift-terraria` serves HTML, `/api/v2/pixel` serves JavaScript. Saved
 * under those names the bundle is served as `application/octet-stream`, and the
 * browser **downloads the page instead of rendering it**.
 *
 * So the recorded content type decides the extension when the URL does not carry
 * one. A document becomes `…/index.html`, which keeps the original URL working as a
 * directory index and leaves client-side routing intact.
 */
export function extensionForType(contentType: string | undefined): string | null {
  if (!contentType) return null
  const ct = contentType.split(';')[0]!.trim().toLowerCase()
  const map: Record<string, string> = {
    'text/html': '.html', 'application/xhtml+xml': '.html',
    'text/css': '.css',
    'text/javascript': '.js', 'application/javascript': '.js', 'application/x-javascript': '.js',
    'application/json': '.json', 'application/manifest+json': '.json',
    'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/svg+xml': '.svg',
    'image/webp': '.webp', 'image/avif': '.avif', 'image/x-icon': '.ico', 'image/vnd.microsoft.icon': '.ico',
    'font/woff2': '.woff2', 'font/woff': '.woff', 'font/ttf': '.ttf', 'font/otf': '.otf',
    'video/mp4': '.mp4', 'video/webm': '.webm', 'text/plain': '.txt', 'text/xml': '.xml',
    'application/xml': '.xml',
  }
  return map[ct] ?? null
}

function hasUsableExtension(path: string): boolean {
  const base = path.slice(path.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot > 0 && /^\.[A-Za-z0-9]{1,8}$/.test(base.slice(dot))
}

export function localPath(url: string, primaryHost: string, contentType?: string): string | null {
  let parsed: URL
  try { parsed = new URL(url) } catch { return null }
  if (!/^https?:$/.test(parsed.protocol)) return null

  let path = parsed.pathname
  const typeExt = extensionForType(contentType)
  if (path.endsWith('/')) {
    path += typeExt && typeExt !== '.html' ? `index${typeExt}` : 'index.html'
  } else if (!hasUsableExtension(path) && typeExt) {
    // a document keeps its url working as a directory index; everything else just
    // gains the extension its bytes deserve
    path += typeExt === '.html' ? '/index.html' : typeExt
  }
  if (parsed.search) {
    const q = shortHash(parsed.search)
    const dot = path.lastIndexOf('.')
    path = dot > path.lastIndexOf('/') ? `${path.slice(0, dot)}__q${q}${path.slice(dot)}` : `${path}__q${q}`
  }

  const segments = path.split('/').filter(Boolean)
  const tooLong = segments.some((seg) => seg.length > MAX_SEGMENT)
  const clean = segments.map(safeSegment).join('/')
  const natural = parsed.host === primaryHost
    ? clean
    : ['__imago/h', safeSegment(parsed.host), clean].join('/')

  if (!tooLong && natural.length <= MAX_LOCAL_PATH) return natural

  // unique by construction, so two long urls can never land on one file
  const ext = extensionOf(path)
  return `__imago/a/${shortHash(url)}${ext}`
}

function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return ''
  const ext = base.slice(dot)
  return /^\.[A-Za-z0-9]{1,8}$/.test(ext) ? ext.toLowerCase() : ''
}

/** Absolute URLs we hold → their local path. HTML and CSS only. */
export function rewriteUrls(
  text: string,
  routes: Record<string, string>,
  base: string,
): { text: string; count: number } {
  let count = 0
  let out = text
  // longest first, so a prefix never eats a longer match
  for (const url of Object.keys(routes).sort((a, b) => b.length - a.length)) {
    if (!out.includes(url)) continue
    const local = routes[url]!
    out = out.split(url).join(local)
    count++
  }
  // protocol-relative form of the same URLs
  for (const url of Object.keys(routes)) {
    const rel = url.replace(/^https?:/, '')
    if (rel === url || !out.includes(rel)) continue
    out = out.split(rel).join(routes[url]!)
    count++
  }
  void base
  return { text: out, count }
}

function injectBoot(file: string): void {
  if (!existsSync(file)) return
  const html = readFileSync(file, 'utf8')
  const boot = bootScript()
  const out = /<head[^>]*>/i.test(html)
    ? html.replace(/<head[^>]*>/i, (m) => `${m}\n${boot}`)
    : boot + html
  writeFileSync(file, out)
}

function findIndex(routes: Record<string, string>): string | undefined {
  return Object.values(routes).find((p) => /(^\/index\.html$|\.html?$)/i.test(p))
}

function readJsonDir<T>(dir: string): T[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as T)
}

function hostOf(url: string): string | null {
  try { return new URL(url).host } catch { return null }
}

function stripQuery(url: string): string {
  const i = url.indexOf('?')
  return i < 0 ? url : url.slice(0, i)
}

function safeSegment(seg: string): string {
  return seg.replace(/[<>:"|?*\\]/g, '_').slice(0, 120) || '_'
}

/** 64-bit FNV-1a as two 32-bit halves — 8 hex is not enough for thousands of assets. */
function shortHash(text: string): string {
  let a = 2166136261
  let b = 405
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    a ^= c; a = Math.imul(a, 16777619)
    b ^= c + i; b = Math.imul(b, 2246822519)
  }
  return ((a >>> 0).toString(16).padStart(8, '0')) + ((b >>> 0).toString(16).padStart(8, '0'))
}
