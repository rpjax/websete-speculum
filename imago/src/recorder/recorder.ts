import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { BrowserContext, Page } from 'playwright-core'
import { Journal } from '../core/journal.js'
import { canonicalJson, hashJson } from '../core/hash.js'
import { SESSION_SCHEMA, ensureDirs, newSessionId, writeMeta } from '../core/store.js'
import type {
  ImagoError, NetworkRecord, SessionConfig, SessionMeta, SnapshotRecord, SnapshotTrigger, TimelineEvent,
} from '../core/types.js'
import { classify, safeHost } from './classify.js'
import { persistedQueryHash } from '../shared/fixture.js'
import { captureOracleReferences } from '../parity/reference.js'
import { agentSource, launch } from './launcher.js'
import { decideSettle, explainStall, type StallReason } from './settle.js'
import { AssetResolver, DEFAULT_LIMITS } from '../ir/resolver.js'

const DEFAULTS: Required<Pick<SessionConfig, 'settleMs' | 'maxBodyBytes'>> = {
  settleMs: 500,
  maxBodyBytes: 8 * 1024 * 1024,
}

/** Older than this in flight = a stream, a poll or a beacon, not page load (A-11). */
const STALL_MS = 5_000
/** Safety-net snapshot cadence for a page that never settles (A-12). */
const INTERVAL_MS = 20_000
/** Upper bound on sweep rounds — each round can fetch bodies that name more assets (C-4c). */
/** How often the tape may repeat why nothing is being captured. */
const STALL_REPORT_MS = 10_000

interface AgentState {
  lastMutationAt: number
  now: number
  fontsPending: boolean
  readyState: string
  url: string
}

interface AgentSheet {
  text: string | null
  href: string | null
  crossOrigin: boolean
  meta: { order: number; media: string; disabled: boolean; origin: string }
}

interface AgentSnapshot {
  url: string
  title: string
  viewport: { width: number; height: number; dpr: number }
  tree: unknown
  sheets: AgentSheet[]
  refs: string[]
}

/**
 * Records a manual browsing session (flow.md §2). Passive: it never navigates,
 * clicks, pauses or dialogs — the human owns the browser (C-0).
 */
export class Recorder {
  private context!: BrowserContext
  private journal!: Journal
  private meta!: SessionMeta
  private timer?: NodeJS.Timeout
  /** request → started at. Counting events leaks; ages do not (A-11). */
  private readonly pending = new Map<object, number>()
  private lastSnapshotAt = 0
  private lastStallReport = 0
  private lastStallReason: StallReason | null = null
  private browserAlive = false
  private snapCount = 0
  private lastTreeHash: string | null = null
  private readonly errors: ImagoError[] = []
  private readonly seenRefs = new Set<string>()
  private readonly fetchedUrls = new Set<string>()
  /** Light index of stored bodies, for the closing sweep (C-4c). */
  private readonly stored: { url: string; kind: string; contentType?: string; hash: string }[] = []
  /** Resolve failures are not retried — 429 on a hub link stays failed (C-4c). */
  private busy = false
  private closed = false

  /** Panel subscription — the GUI is the only interface (D-024). */
  onEvent?: (event: TimelineEvent, stats: SessionMeta['stats']) => void

  constructor(private readonly config: SessionConfig = {}, private readonly name = 'session') {}

  get metadata(): SessionMeta { return this.meta }
  get inflightCount(): number { return this.freshInflight().fresh }
  get alive(): boolean { return this.browserAlive }
  get stall(): string | null {
    return this.lastStallReason ? this.lastStallReason : null
  }

  /** Split in-flight by age: fresh blocks settle, long-lived never does. */
  private freshInflight(): { fresh: number; longLived: number } {
    const now = Date.now()
    let fresh = 0
    let longLived = 0
    for (const started of this.pending.values()) {
      if (now - started < STALL_MS) fresh++
      else longLived++
    }
    return { fresh, longLived }
  }

  /** Panel "Mark" button — same effect as Ctrl+Shift+M in the page. */
  async markActive(): Promise<SnapshotRecord | null> {
    const page = this.activePage()
    if (!page) return null
    return this.snapshot(page, 'mark')
  }

  get sessionId(): string { return this.meta.id }
  get dir(): string { return join(ensureDirs(this.meta.id)) }

  async start(url?: string): Promise<void> {
    const id = newSessionId()
    const dir = ensureDirs(id)
    this.journal = new Journal(dir)
    this.meta = {
      schema: SESSION_SCHEMA,
      id,
      name: this.name,
      status: 'recording',
      origins: [],
      openedAt: new Date().toISOString(),
      config: { ...DEFAULTS, ...this.config },
      versions: { imago: '0.0.0', node: process.version },
      stats: { snapshots: 0, requests: 0, bytes: 0, atoms: 0, errors: 0 },
    }
    writeMeta(this.meta)
    this.event({ t: 'session.open', at: now(), session: id })

    this.context = await launch(this.config)
    await this.context.addInitScript({ content: agentSource() })
    await this.context.exposeBinding('__imagoMark', async (source) => {
      await this.snapshot(source.page, 'mark')
    })

    this.context.on('response', (res) => { void this.onResponse(res) })
    this.context.on('requestfailed', (req) => {
      this.record({
        reqId: `req-${this.meta.stats.requests++}`,
        at: now(), method: req.method(), url: req.url(), host: safeHost(req.url()) ?? '',
        resourceType: req.resourceType(), requestHeaders: {},
        kind: classify(req.url(), req.resourceType(), null),
        error: req.failure()?.errorText ?? 'failed',
      })
    })
    this.context.on('request', (req) => { this.pending.set(req, Date.now()) })
    this.context.on('requestfinished', (req) => { this.pending.delete(req) })
    this.context.on('requestfailed', (req) => { this.pending.delete(req) })
    // S-8 — the browser dying is a state, not a crash. The session stays open and
    // closable so whatever was captured is still persisted.
    this.context.on('close', () => {
      if (!this.browserAlive) return
      this.browserAlive = false
      this.fail('browser_gone', 'Chrome closed or crashed — close the sandbox to persist the session')
    })
    this.context.on('page', (page) => this.wirePage(page))
    for (const page of this.context.pages()) this.wirePage(page)

    this.browserAlive = true
    const page = this.context.pages()[0] ?? (await this.context.newPage())
    if (url) await page.goto(url, { waitUntil: 'commit' }).catch((e) => this.fail('navigate', String(e)))

    this.lastSnapshotAt = Date.now()
    this.timer = setInterval(() => { void this.tick() }, 300)
  }

  private wirePage(page: Page): void {
    page.on('framenavigated', (frame) => {
      if (frame !== page.mainFrame()) return
      this.event({ t: 'navigation', at: now(), url: frame.url(), kind: 'hard' })
      const host = safeHost(frame.url())
      if (host && !this.meta.origins.includes(host)) this.meta.origins.push(host)
    })
    page.on('crash', () => this.fail('page_crash', page.url()))
  }

  // ── network ──────────────────────────────────────────────────────────────────
  private async onResponse(res: import('playwright-core').Response): Promise<void> {
    const req = res.request()
    const url = req.url()
    const host = safeHost(url) ?? ''
    if ((this.config.captureFilters ?? []).some((f) => host.includes(f))) return

    const reqId = `req-${this.meta.stats.requests++}`
    const headers = await res.allHeaders().catch(() => ({} as Record<string, string>))
    const rec: NetworkRecord = {
      reqId, at: now(), method: req.method(), url, host,
      resourceType: req.resourceType(),
      status: res.status(),
      requestHeaders: await req.allHeaders().catch(() => ({})),
      responseHeaders: headers,
      kind: classify(url, req.resourceType(), this.pageHost(req, res), headers['content-type']),
    }
    try {
      const postData = req.postData()
      if (postData) {
        rec.requestBodyHash = this.journal.putBlob(postData)
        const pq = persistedQueryHash(Buffer.from(postData))
        if (pq) rec.persistedQueryHash = pq
      }
      const body = await res.body()
      if (body.byteLength <= (this.config.maxBodyBytes ?? DEFAULTS.maxBodyBytes)) {
        rec.responseBodyHash = this.journal.putBlob(body)
        rec.bytes = body.byteLength
        this.meta.stats.bytes += body.byteLength
        this.stored.push({ url, kind: rec.kind, contentType: headers['content-type'], hash: rec.responseBodyHash })
      } else {
        rec.error = 'body_too_large'
      }
    } catch (e) {
      rec.error = `body_unavailable: ${String(e).slice(0, 120)}`
    }
    this.fetchedUrls.add(url)
    this.record(rec)
  }

  /** Service worker responses have no frame — fall back to the page origin. */
  private pageHost(req: import('playwright-core').Request, res: import('playwright-core').Response): string | null {
    try { return safeHost(res.frame().url()) } catch { /* SW / detached */ }
    try { return safeHost(req.frame().url()) } catch { /* SW / detached */ }
    const page = this.activePage()
    if (page && !page.isClosed()) return safeHost(page.url())
    const primary = this.meta?.origins?.[0]
    return primary ?? null
  }

  private record(rec: NetworkRecord): void {
    this.journal.writeDoc(join('network', `${rec.reqId}.json`), rec)
    this.event({ t: 'request', at: rec.at, reqId: rec.reqId })
  }

  // ── settle → snapshot (atoms.md §4) ──────────────────────────────────────────
  /**
   * One poll. Nothing in here may throw: an escaping rejection kills the process
   * and takes the panel with it, which is exactly how a browser crash turned into
   * a dead server and a panel frozen on "recording".
   */
  private async tick(): Promise<void> {
    if (this.busy || this.closed || !this.browserAlive) return
    const page = this.activePage()
    if (!page || page.isClosed()) return
    this.busy = true
    try {
      const state = (await page.evaluate(() => window.__imago?.state()).catch(() => null)) as AgentState | null
      if (!state) return

      const { fresh, longLived } = this.freshInflight()
      const input = {
        readyState: state.readyState,
        quietMs: state.now - state.lastMutationAt,
        settleMs: this.config.settleMs ?? DEFAULTS.settleMs,
        fontsPending: state.fontsPending,
        freshInflight: fresh,
        longLived,
        msSinceLastSnapshot: Date.now() - this.lastSnapshotAt,
        intervalMs: INTERVAL_MS,
      }
      const decision = decideSettle(input)
      if (!decision.take) {
        this.reportStall(decision.reason, input)
        return
      }
      this.lastStallReason = null
      await this.snapshot(page, decision.trigger, decision.trigger === 'interval')
    } catch (e) {
      this.fail('tick_failed', String(e).slice(0, 200))
    } finally {
      this.busy = false
    }
  }

  /** Say why nothing is being captured — throttled, so the tape stays readable. */
  private reportStall(reason: StallReason, input: Parameters<typeof explainStall>[1]): void {
    this.lastStallReason = reason
    const now = Date.now()
    if (now - this.lastStallReport < STALL_REPORT_MS) return
    this.lastStallReport = now
    this.event({ t: 'stall', at: new Date().toISOString(), reason, detail: explainStall(reason, input) })
  }

  private activePage(): Page | null {
    const pages = this.context.pages().filter((p) => !p.isClosed())
    return pages[pages.length - 1] ?? null
  }

  async snapshot(page: Page, trigger: SnapshotTrigger, unsettled = false): Promise<SnapshotRecord | null> {
    if (!this.browserAlive || page.isClosed()) return null
    let raw: AgentSnapshot | null = null
    try {
      raw = (await page.evaluate(() => window.__imago?.snapshot())) as AgentSnapshot
    } catch (e) {
      this.fail('snapshot_failed', String(e).slice(0, 200))
      return null
    }
    if (!raw?.tree) return null

    const treeHash = hashJson(raw.tree)
    if (trigger !== 'mark' && treeHash === this.lastTreeHash) return null // A-3 dedupe

    // C-1 — a cross-origin sheet throws on cssRules; refetch it or fail loudly.
    const styles: string[] = []
    for (const sheet of raw.sheets) {
      let text = sheet.text
      if (text === null && sheet.href) {
        try {
          const res = await this.context.request.get(sheet.href)
          text = res.ok() ? await res.text() : null
          if (text === null) this.fail('sheet_refetch_status', `${res.status()} ${sheet.href}`)
        } catch (e) {
          this.fail('sheet_refetch_failed', `${sheet.href}: ${String(e).slice(0, 120)}`)
        }
      }
      if (text === null) continue
      styles.push(this.journal.putBlob(`/* imago sheet order=${sheet.meta.order} media=${sheet.meta.media} origin=${sheet.meta.origin} href=${sheet.href ?? '-'} */\n${text}`))
    }

    const snapId = `snap-${String(this.snapCount++).padStart(4, '0')}`
    const rec: SnapshotRecord = {
      id: snapId, trigger, at: now(), url: raw.url, title: raw.title,
      viewport: raw.viewport, tree: treeHash, styles, refs: raw.refs,
      ...(unsettled ? { unsettled: true } : {}),
    }
    // canonical bytes on disk under the canonical hash — IR-1, and the only way O5a
    // can ever hold. Never pretty-print a hashed artifact.
    this.journal.writeRaw(join('trees', `${treeHash}.json`), canonicalJson(raw.tree))
    this.journal.writeDoc(join('snapshots', `${snapId}.json`), rec)
    for (const r of raw.refs) this.seenRefs.add(r)
    this.lastTreeHash = treeHash
    this.lastSnapshotAt = Date.now()
    this.meta.stats.snapshots++
    this.event({ t: 'snapshot', at: rec.at, snapId, trigger })
    if (trigger === 'mark') this.event({ t: 'mark', at: rec.at, name: snapId })
    return rec
  }

  // ── bookkeeping ──────────────────────────────────────────────────────────────
  private event(e: TimelineEvent): void {
    this.journal.append(e)
    try { this.onEvent?.(e, this.meta.stats) } catch { /* a dead panel never breaks a recording */ }
  }

  private fail(code: string, detail: string): void {
    const err: ImagoError = { code, detail, at: now() }
    this.errors.push(err)
    this.meta.stats.errors++
    this.event({ t: 'error', at: err.at, code, detail })
  }

  /**
   * C-4 — the resolver **closes the world**; it does not merely complain about it.
   *
   * A page references far more than it fetches: images below the fold, `srcset`
   * densities the browser did not pick, fonts for scripts never rendered. Those are
   * bytes the bundle needs, so the resolver fetches them before the session closes.
   * Reporting them as "never fetched" and stopping there is the closure check doing
   * half its job and calling the session broken for it.
   */
  /**
   * C-4 — close the world. Delegated to {@link AssetResolver}, which is driven by
   * the smoke against a simulated site, so the logic that decides whether a bundle
   * is complete is not only exercised by hand on one real target.
   */
  private async resolveClosure(): Promise<void> {
    if (!this.browserAlive) {
      const missing = [...this.seenRefs].filter((r) => !this.fetchedUrls.has(r)).length
      if (missing) this.fail('resolve_skipped', `${missing} reference(s) unresolved — the browser is gone`)
      return
    }

    // The in-memory index can lag what is already on disk (S-4). Close reads the
    // session dir, not the recorder's working set — sweep every byte we have.
    this.rebuildStoredFromDisk()

    const resolver = new AssetResolver({
      alreadyFetched: this.fetchedUrls,
      bodies: () => this.stored,
      readBody: (hash) => {
        try { return this.journal.readBlob(hash).toString('utf8') } catch { return null }
      },
      fetch: async (url) => {
        const res = await this.context.request.get(url, { timeout: 15_000 })
        const headers = res.headers()
        if (!res.ok()) return { ok: false, status: res.status(), contentType: headers['content-type'] }
        const body = await res.body()
        return { ok: true, status: res.status(), contentType: headers['content-type'], body }
      },
      onFetched: (url, result): string | void => {
        const rec: NetworkRecord = {
          reqId: `res-${this.meta.stats.requests++}`,
          at: now(), method: 'GET', url, host: safeHost(url) ?? '',
          resourceType: 'other', requestHeaders: {},
          kind: classify(url, 'other', this.meta.origins[0] ?? null),
          resolvedAtClose: true,
          status: result.status || undefined,
          responseHeaders: result.contentType ? { 'content-type': result.contentType } : undefined,
        }
        if (result.ok && result.body) {
          rec.responseBodyHash = this.journal.putBlob(result.body)
          rec.bytes = result.body.byteLength
          this.meta.stats.bytes += result.body.byteLength
          this.fetchedUrls.add(url)
        } else {
          rec.error = result.error ?? `status ${result.status}`
        }
        this.journal.writeDoc(join('network', `${rec.reqId}.json`), rec)
        // the hash goes back to the resolver, so a stylesheet or payload we just
        // fetched joins the next sweep round
        return rec.responseBodyHash
      },
      onStored: (entry) => { this.stored.push(entry) },
      onProgress: (e) => {
        this.event({ t: 'resolve', at: now(), done: e.done, total: e.total, failed: e.failed, label: e.label })
      },
      onNote: (code, detail) => this.fail(code, detail),
    }, {
      ...DEFAULT_LIMITS,
      ...(this.config.maxResolveAtClose ? { budget: this.config.maxResolveAtClose } : {}),
    })

    const summary = await resolver.run([...this.seenRefs])
    this.event({
      t: 'resolve', at: now(), done: summary.fetched, total: summary.fetched,
      failed: summary.failed,
      label: `done · ${(summary.bytes / 1024 / 1024).toFixed(1)} MB · ${summary.probed} host probe(s)` +
        (summary.promoted.length ? ` · promoted ${[...new Set(summary.promoted)].join(', ')}` : ''),
    })
  }

  private rebuildStoredFromDisk(): void {
    const seen = new Set(this.stored.map((e) => e.hash))
    const add = (hash: string, url: string, kind: string, contentType?: string) => {
      if (seen.has(hash)) return
      seen.add(hash)
      this.stored.push({ url, kind, contentType, hash })
    }

    const netDir = join(this.dir, 'network')
    if (existsSync(netDir)) {
      for (const file of readdirSync(netDir)) {
        if (!file.endsWith('.json')) continue
        const rec = JSON.parse(readFileSync(join(netDir, file), 'utf8')) as NetworkRecord
        if (!rec.responseBodyHash) continue
        add(rec.responseBodyHash, rec.url, rec.kind, rec.responseHeaders?.['content-type'])
        this.fetchedUrls.add(rec.url)
      }
    }

    const snapDir = join(this.dir, 'snapshots')
    if (existsSync(snapDir)) {
      for (const file of readdirSync(snapDir)) {
        if (!file.endsWith('.json')) continue
        const snap = JSON.parse(readFileSync(join(snapDir, file), 'utf8')) as SnapshotRecord
        add(snap.tree, `tree://${snap.tree}`, 'asset', 'application/json')
        for (const hash of snap.styles) add(hash, `styles://${hash}`, 'asset', 'text/css')
      }
    }
  }

  /** Fetch a batch through the browser's own request context, so cookies apply. */
  /** "Close sandbox" (flow.md §2.5). Idempotent, and works after the browser died. */
  async close(): Promise<{ meta: SessionMeta; errors: ImagoError[]; unresolved: string[] }> {
    if (this.closed) return { meta: this.meta, errors: this.errors, unresolved: [] }
    this.closed = true
    if (this.timer) clearInterval(this.timer)
    this.meta.status = 'closing'
    writeMeta(this.meta)

    // Resolve while the browser is still up — the request context shares its cookies.
    try { await this.resolveClosure() } catch (e) { this.fail('resolve_failed', String(e).slice(0, 200)) }

    if (this.browserAlive) {
      try {
        await captureOracleReferences(this.context, this.meta.id, this.meta.config)
      } catch (e) {
        this.fail('oracle_ref_failed', String(e).slice(0, 200))
      }
    }
    this.browserAlive = false

    const unresolved = [...this.seenRefs].filter((r) => !this.fetchedUrls.has(r)) // authoritative count in close.ts
    this.event({ t: 'session.close', at: now() })
    this.journal.writeDoc('errors.json', this.errors)
    await this.journal.close()
    await this.context.close().catch(() => undefined)

    this.meta.closedAt = now()
    const fatal = this.errors.some((e) => e.code.startsWith('sheet_refetch') || e.code === 'browser_gone')
    this.meta.status = fatal ? 'failed' : 'closed'
    writeMeta(this.meta)
    return { meta: this.meta, errors: this.errors, unresolved }
  }
}

function now(): string { return new Date().toISOString() }
