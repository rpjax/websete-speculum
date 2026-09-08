import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { hashJson } from '../core/hash.js'
import { readMeta, runDir, sessionDir } from '../core/store.js'
import type { NetworkRecord, SnapshotRecord } from '../core/types.js'
import { emitDocument, rewriteCssUrls, type ElementNode } from './flatHtml.js'
import { extensionForType } from './rehost.js'
import { DEFAULT_PROFILE, type GenerationProfile, type RunManifest } from './types.js'

/**
 * `flat` — one document per snapshot, our markup, their authored cascade, no script
 * (emit.md §3).
 *
 * The asymmetry that makes this the safe emitter: `rehost` has to guess what the
 * application will ask for at runtime, because the application is still running.
 * `flat` knows, because the reference set was **enumerated from the render tree** at
 * capture time — `img/src`, `srcset`, `url()` in the rules we kept, `@font-face`,
 * `poster`, the icon. That set is finite and closed, so there is nothing to sweep,
 * no host to promote by probe, no budget to blow, and no page to accidentally crawl.
 * A reference we do not hold is a **capture gap** with a name, never a fetch to go
 * make at build time (E4).
 *
 * Assets are content-addressed under `assets/<hash><ext>`. That is not an escape
 * hatch here as it was in `rehost` (C-4d, E-14) — it is the only layout, so a path
 * collision and an over-long Windows path are both impossible by construction
 * rather than handled.
 */
export function generateFlat(
  sessionId: string,
  profile: GenerationProfile = DEFAULT_PROFILE,
): RunManifest {
  const meta = readMeta(sessionId)
  if (!meta) throw new Error(`unknown session ${sessionId}`)

  const dir = sessionDir(sessionId)
  const snapshots = readJsonDir<SnapshotRecord>(join(dir, 'snapshots'))
    .sort((a, b) => a.id.localeCompare(b.id))
  if (snapshots.length === 0) throw new Error('session has no snapshots — nothing to generate')

  const network = readJsonDir<NetworkRecord>(join(dir, 'network'))

  const profileHash = hashJson(profile)
  // A run is keyed on (session, profile) — the profile hash is in the id, not only
  // in the manifest. Without it two generations in the same second (two emitters,
  // two profiles) resolve to the same directory and silently write over each other,
  // which reads as "the emitter ignored my profile".
  const runId = `gen-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${profileHash.slice(0, 8)}`
  const out = runDir(sessionId, runId)
  mkdirSync(out, { recursive: true })

  const warnings: string[] = []
  const routes: Record<string, string> = {}
  const missing = new Set<string>()
  let files = 0
  let bytes = 0

  // ── the bytes we hold, by the URL the tree will name ─────────────────────────
  //
  // Keyed on the exact recorded URL and, separately, on the URL without its
  // fragment: a stylesheet may write `url(sprite.svg#icon)` for a file the network
  // fetched without the fragment, and those are the same byte.
  const byUrl = new Map<string, NetworkRecord>()
  for (const rec of network) {
    if (!rec.responseBodyHash) continue
    if (!byUrl.has(rec.url)) byUrl.set(rec.url, rec)
  }

  /** absolute URL → path inside the bundle, writing the file the first time. */
  const assetPaths = new Map<string, string | null>()
  const resolveAsset = (url: string): string | null => {
    const cached = assetPaths.get(url)
    if (cached !== undefined) return cached

    const rec = byUrl.get(url) ?? byUrl.get(stripFragment(url))
    if (!rec?.responseBodyHash) { assetPaths.set(url, null); return null }

    const ext = extensionForType(rec.responseHeaders?.['content-type'])
      ?? extensionFromPath(rec.url)
      ?? ''
    const local = `assets/${rec.responseBodyHash}${ext}`
    const target = join(out, local)

    if (!existsSync(target)) {
      let body: Buffer
      try { body = readFileSync(join(dir, 'blobs', rec.responseBodyHash)) } catch {
        // IR-3 says a dangling reference is a failure, not a warning. The byte was
        // recorded as stored and is not on disk, which is a broken session, not a
        // capture gap — say which it is.
        warnings.push(`recorded body missing from disk: ${rec.url}`)
        assetPaths.set(url, null)
        return null
      }
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, body)
      files++
      bytes += body.byteLength
    }

    routes[url] = '/' + local
    assetPaths.set(url, local)
    return local
  }

  // ── one document per page, not one per snapshot ──────────────────────────────
  //
  // A session holds many snapshots of the same URL: the operator marks a state, and
  // the recorder also takes one every time the page settles and every 20 s (A-12).
  // Emitting all of them would produce a pile of near-identical documents, so each
  // **URL** gets exactly one document, and the snapshot chosen for it is the last
  // one the operator **marked** — their curation wins over the recorder's sampling —
  // falling back to the most recent capture when they marked nothing.
  //
  // This grouping is also the fix for the bug that shipped a bundle with no entry:
  // the document path used to be keyed by URL while being *decided* per snapshot, so
  // several snapshots of one page overwrote each other's mapping and the entry
  // document was never written. A page is the unit; the key and the decision are now
  // the same thing.
  const byPage = new Map<string, SnapshotRecord[]>()
  for (const snap of snapshots) {
    const key = stripFragment(snap.url)
    const group = byPage.get(key)
    if (group) group.push(snap)
    else byPage.set(key, [snap])
  }
  const chosen = new Map<string, SnapshotRecord>()
  for (const [key, group] of byPage) {
    // Snapshots arrive sorted by id, so the last of a list is the most recent.
    const marked = group.filter((s) => s.trigger === 'mark')
    const candidates = marked.length > 0 ? marked : group
    const pick = candidates[candidates.length - 1]!
    chosen.set(key, pick)
    if (group.length > 1) {
      warnings.push(
        `${key}: ${group.length} snapshots captured, emitted ${pick.id} ` +
        `(${marked.length ? 'the last one you marked' : 'the most recent — you marked none'}); ` +
        'the others stay in the session — generation is repeatable, so mark a state and generate again',
      )
    }
  }

  // The entry is the page the operator marked first, or the first page captured.
  const entryKey = stripFragment(
    (snapshots.find((s) => s.trigger === 'mark') ?? snapshots[0]!).url,
  )
  const docPaths = new Map<string, string>()
  for (const key of chosen.keys()) {
    docPaths.set(key, key === entryKey ? 'index.html' : `${chosen.get(key)!.id}/index.html`)
  }
  const resolveDocument = (url: string): string | null =>
    docPaths.get(stripFragment(url)) ?? null

  const primaryHost = hostOf(entryKey) ?? meta.origins[0] ?? ''
  if (!primaryHost) throw new Error('cannot determine the primary host')

  for (const snap of chosen.values()) {
    const docPath = docPaths.get(stripFragment(snap.url))!
    const depth = docPath.includes('/') ? '../'.repeat(docPath.split('/').length - 1) : ''

    let tree: ElementNode
    try {
      tree = JSON.parse(readFileSync(join(dir, 'trees', `${snap.tree}.json`), 'utf8')) as ElementNode
    } catch (e) {
      warnings.push(`snapshot ${snap.id}: tree ${snap.tree} unreadable (${String(e).slice(0, 80)})`)
      continue
    }

    // ── the cascade, per source sheet, in source order (IR-4 / I3) ─────────────
    //
    // Never merged, never minified, never pruned by coverage — a rule that matched
    // nothing today is the rule that matches when the viewport changes.
    const sheetPaths: string[] = []
    snap.styles.forEach((hash, order) => {
      let css: string
      try { css = readFileSync(join(dir, 'blobs', hash), 'utf8') } catch {
        warnings.push(`snapshot ${snap.id}: stylesheet ${hash} unreadable`)
        return
      }
      const local = `styles/${String(order).padStart(3, '0')}-${hash}.css`
      const target = join(out, local)
      if (!existsSync(target)) {
        // A relative URL inside a stylesheet resolves against **the stylesheet's own
        // URL**, not the document's. Every sheet lives in `styles/`, so from inside
        // one the asset directory is always exactly one level up — regardless of how
        // deep the document referencing it happens to sit.
        //
        // Getting this wrong is invisible to a string assert and obvious to a
        // browser: the page rendered and three `@font-face` files 404ed at
        // `/styles/assets/…`, so the text fell back to a system font.
        const rewritten = rewriteCssUrls(
          css,
          (u) => prefix('../', resolveAsset(u)),
          snap.url,
          (u) => missing.add(u),
        )
        mkdirSync(dirname(target), { recursive: true })
        writeFileSync(target, rewritten)
        files++
        bytes += Buffer.byteLength(rewritten)
      }
      sheetPaths.push(depth + local)
    })

    const result = emitDocument(tree, {
      resolve: (u) => prefix(depth, resolveAsset(u)),
      document: (u) => {
        const target = resolveDocument(u)
        return target ? depth + target : null
      },
      stylesheets: sheetPaths,
      baseUrl: snap.url,
    })

    const target = join(out, docPath)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, result.html)
    files++
    bytes += Buffer.byteLength(result.html)
    routes[snap.url] = '/' + docPath

    for (const url of result.missing) missing.add(url)
    for (const w of result.warnings) warnings.push(`${snap.id}: ${w}`)
  }

  // A reference the tree named and the session never stored: the browse did not go
  // far enough, or the URL was built at runtime somewhere the tree cannot see.
  // Named as what it is, so nobody goes looking for a backend that was never here.
  for (const snap of snapshots) {
    for (const ref of snap.refs) if (!resolveAsset(ref)) missing.add(ref)
  }

  // E5 — loud failure. A bundle whose entry is not on disk serves a 404 at its own
  // root, which reads to the operator as "the tool produced nothing" and hides the
  // real fault. If this ever trips it is a bug in the emitter, not a capture gap.
  if (!existsSync(join(out, 'index.html'))) {
    throw new Error(
      `flat wrote no entry document for ${entryKey} — ` +
      `${snapshots.length} snapshot(s), ${chosen.size} page(s): ${warnings.join(' | ') || 'no warnings'}`,
    )
  }

  const manifest: RunManifest = {
    runId,
    sessionId,
    profileHash,
    profile,
    createdAt: new Date().toISOString(),
    emitter: 'flat',
    primaryHost,
    entry: '/index.html',
    files,
    bytes,
    routes,
    missing: [...missing].sort(),
    rewrites: [],
    warnings,
  }
  writeFileSync(join(out, 'imago-run.json'), JSON.stringify(manifest, null, 2))
  return manifest
}

/** A nested document reaches shared files by walking back up, never by an origin. */
function prefix(depth: string, local: string | null): string | null {
  return local === null ? null : depth + local
}

function stripFragment(url: string): string {
  const i = url.indexOf('#')
  return i < 0 ? url : url.slice(0, i)
}

function extensionFromPath(url: string): string | null {
  try {
    const path = new URL(url).pathname
    const base = path.slice(path.lastIndexOf('/') + 1)
    const dot = base.lastIndexOf('.')
    if (dot <= 0) return null
    const ext = base.slice(dot)
    return /^\.[A-Za-z0-9]{1,8}$/.test(ext) ? ext.toLowerCase() : null
  } catch { return null }
}

function hostOf(url: string): string | null {
  try { return new URL(url).host } catch { return null }
}

function readJsonDir<T>(dir: string): T[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as T)
}
