import {
  assetHostsOf, documentHostsOf, expandAssetHosts, extractUrls, isDocumentBody, isTextual,
  looksLikeAsset, probeCandidate, sweepable,
} from '../shared/sweep.js'

/**
 * The closing asset resolver (C-4c/C-4e).
 *
 * Separated from the recorder on purpose: this is the logic that decides whether a
 * bundle is complete, so it must be provable without a browser. Everything it
 * touches arrives through `ResolveDeps`, and the smoke drives it against a real
 * HTTP server that imitates a JavaScript application — runtime-built URLs, an API
 * payload full of extension-less CDN links, a docs link that must not be crawled.
 */

export interface StoredBody {
  url: string
  kind: string
  contentType?: string
  hash: string
  /** Fetched by the resolver rather than loaded by the browser (harvest rule). */
  fromSweep?: boolean
}

export interface FetchResult {
  ok: boolean
  status: number
  contentType?: string
  body?: Buffer
  error?: string
}

export interface ResolveDeps {
  fetch(url: string): Promise<FetchResult>
  /** Everything already on disk with a body — the sweep reads these. */
  bodies(): readonly StoredBody[]
  readBody(hash: string): string | null
  /** Called for every byte the resolver brings in, so it joins the next round. */
  onStored(entry: StoredBody): void
  /**
   * Store the bytes. Returning the content hash lets a fetched stylesheet or
   * payload join the next sweep round; returning nothing is fine for a host app
   * that indexes stored bodies itself.
   */
  onFetched(url: string, result: FetchResult): string | void
  onProgress(e: { label: string; done: number; total: number; failed: number }): void
  onNote(code: string, detail: string): void
  alreadyFetched?: Iterable<string>
}

export interface ResolveLimits {
  budget: number
  maxRounds: number
  maxProbes: number
  concurrency: number
  /** Hard ceiling on downloaded bytes. A runaway sweep is measured in gigabytes. */
  byteBudget: number
}

export const DEFAULT_LIMITS: ResolveLimits = {
  budget: 3_000,
  maxRounds: 12,
  maxProbes: 60,
  concurrency: 3,
  byteBudget: 400 * 1024 * 1024,
}

export interface ResolveSummary {
  fetched: number
  bytes: number
  failed: number
  probed: number
  promoted: string[]
  rounds: number
  pendingLeft: number
  capped: boolean
}

export class AssetResolver {
  private readonly fetched = new Set<string>()
  private readonly failed = new Set<string>()
  private readonly swept = new Set<string>()
  /** host → candidate urls seen but not yet sweepable. Kept across rounds: a host
   *  promoted in round 3 must still sweep what round 1 found on it. */
  private readonly pending = new Map<string, Set<string>>()
  private readonly probed = new Set<string>()
  private readonly promoted: string[] = []
  /** Hosts a probe proved serve assets. Evidence the resolver produced itself, and
   *  therefore evidence it must also *act* on — reporting a promotion without
   *  sweeping the host is how a discovered CDN yields exactly one image. */
  private readonly provenByProbe = new Set<string>()
  private readonly extraBodies: StoredBody[] = []
  private spent = 0
  private bytes = 0
  private failures = 0
  private probes = 0
  private capped = false

  constructor(
    private readonly deps: ResolveDeps,
    private readonly limits: ResolveLimits = DEFAULT_LIMITS,
  ) {
    for (const url of deps.alreadyFetched ?? []) this.fetched.add(url)
  }

  async run(seedRefs: readonly string[]): Promise<ResolveSummary> {
    // 1 — what markup and CSS wrote down
    await this.fetchAll(seedRefs.filter((u) => !this.fetched.has(u)), 'refs')

    // 2 — what the source builds at runtime and what arrives inside payloads
    let round = 0
    for (; round < this.limits.maxRounds && !this.capped; round++) {
      const proven = this.provenHosts()
      this.harvest(proven)

      const documents = documentHostsOf(this.allBodies())
      const ready: string[] = []
      for (const [host, urls] of [...this.pending]) {
        if (!proven.has(host)) continue
        for (const url of urls) {
          if (sweepable(url, proven, this.fetched, this.failed, documents)) ready.push(url)
        }
        this.pending.delete(host)
      }
      if (ready.length > 0) {
        await this.fetchAll(ready, `sweep ${round + 1}`)
        continue
      }

      // 3 — an unknown host gets exactly one probe, and its **content-type**
      //     decides. This is how an extension-less image CDN is recognised without
      //     naming a vendor: if the bytes come back as an image, the host serves
      //     assets and the rest of its urls sweep on the next round.
      const probes = this.pickProbes(proven)
      if (probes.length === 0) break
      await this.fetchAll(probes, `probe ${round + 1}`)
    }

    let pendingLeft = 0
    for (const urls of this.pending.values()) pendingLeft += urls.size
    if (pendingLeft > 0) {
      this.deps.onNote('sweep_unpromoted',
        `${pendingLeft} url(s) on ${this.pending.size} host(s) never proved to serve assets`)
    }

    return {
      fetched: this.fetched.size,
      bytes: this.bytes,
      failed: this.failures,
      probed: this.probes,
      promoted: [...this.promoted],
      rounds: round,
      pendingLeft,
      capped: this.capped,
    }
  }

  /** Hosts with evidence: they served an asset-like body in this session. */
  private provenHosts(): Set<string> {
    const hosts = assetHostsOf(this.allBodies())
    for (const host of this.provenByProbe) hosts.add(host)
    // asset-*shaped* urls are evidence by themselves — no probe needed for a `.png`
    const shaped: string[] = []
    for (const urls of this.pending.values()) for (const url of urls) if (looksLikeAsset(url)) shaped.push(url)
    expandAssetHosts(hosts, shaped)
    return hosts
  }

  private allBodies(): readonly StoredBody[] {
    return this.extraBodies.length === 0
      ? this.deps.bodies()
      : [...this.deps.bodies(), ...this.extraBodies]
  }

  /**
   * Read every textual body not yet read, and queue what it mentions.
   *
   * Only bodies from hosts that serve this site are read. A page fetched from a
   * host that turned out not to serve assets is not a source of references — its
   * links are someone else's sitemap, and following them is how "download the
   * assets" quietly becomes a crawler.
   */
  private harvest(proven: ReadonlySet<string>): void {
    for (const entry of this.allBodies()) {
      if (this.swept.has(entry.hash)) continue
      if (!isTextual(entry.contentType)) { this.swept.add(entry.hash); continue }
      // A page the sweep itself fetched is stored but never mined: its links are the
      // site's other pages, and following them makes the sweep recursive. Only the
      // documents the browse actually loaded are sources of references.
      if (entry.fromSweep && isDocumentBody(entry.contentType)) { this.swept.add(entry.hash); continue }
      const host = hostOf(entry.url)
      if (host !== null && !proven.has(host)) continue // may become proven later
      this.swept.add(entry.hash)
      const text = this.deps.readBody(entry.hash)
      if (text === null) continue
      for (const url of extractUrls(text)) this.queue(url)
    }
  }

  private queue(url: string): void {
    if (this.fetched.has(url) || this.failed.has(url) || url.includes('#')) return
    let host: string
    try {
      const parsed = new URL(url)
      if (!/^https?:$/.test(parsed.protocol)) return
      host = parsed.host
    } catch { return }
    const bucket = this.pending.get(host) ?? new Set<string>()
    bucket.add(url)
    this.pending.set(host, bucket)
  }

  private pickProbes(proven: ReadonlySet<string>): string[] {
    const out: string[] = []
    for (const [host, urls] of this.pending) {
      if (proven.has(host) || this.probed.has(host)) continue
      if (this.probes + out.length >= this.limits.maxProbes) break
      const candidate = probeCandidate(urls)
      if (!candidate) continue
      this.probed.add(host)
      out.push(candidate)
    }
    return out
  }

  private async fetchAll(urls: readonly string[], label: string): Promise<void> {
    const unique = [...new Set(urls)].filter((u) => !this.fetched.has(u) && !this.failed.has(u))
    if (unique.length === 0) return

    if (this.capped) return
    const room = this.limits.budget - this.spent
    if (room <= 0) {
      this.capped = true
      this.deps.onNote('resolve_capped', `budget of ${this.limits.budget} fetches spent; ${unique.length} left`)
      return
    }
    const batch = unique.slice(0, room)
    if (batch.length < unique.length) {
      this.capped = true
      this.deps.onNote('resolve_capped',
        `${label}: budget of ${this.limits.budget} fetches reached, ${unique.length - batch.length} left`)
    }

    const queue = [...batch]
    let done = 0
    const before = this.probes
    const worker = async () => {
      for (;;) {
        if (this.capped) return
        const url = queue.pop()
        if (!url) return
        if (this.fetched.has(url) || this.failed.has(url)) continue
        this.spent++
        if (label.startsWith('probe')) this.probes++
        let result: FetchResult
        try {
          result = await this.deps.fetch(url)
        } catch (e) {
          result = { ok: false, status: 0, error: String(e).slice(0, 160) }
        }
        const hash = this.deps.onFetched(url, result)
        if (result.ok && result.body) {
          this.fetched.add(url)
          this.bytes += result.body.byteLength
          if (this.bytes >= this.limits.byteBudget && !this.capped) {
            this.capped = true
            this.deps.onNote('resolve_capped',
              `byte budget of ${Math.round(this.limits.byteBudget / 1024 / 1024)} MB reached`)
          }
          if (typeof hash === 'string') {
            // The kind comes from what came back, never from the fact that we asked
            // for it. Labelling every fetched body `asset` forges evidence: one
            // probe of a documentation page would promote its host and the sweep
            // would start downloading someone else's website.
            this.extraBodies.push({
              url,
              kind: isAssetType(result.contentType) ? 'asset' : 'other',
              contentType: result.contentType,
              hash,
              fromSweep: true,
            })
          }
          const host = hostOf(url)
          if (host && isAssetType(result.contentType) && !this.provenByProbe.has(host)) {
            this.provenByProbe.add(host)
            if (label.startsWith('probe')) this.promoted.push(host)
          }
        } else {
          this.failed.add(url)
          this.failures++
        }
        done++
        if (done % 25 === 0 || done === batch.length) {
          this.deps.onProgress({ label, done, total: batch.length, failed: this.failures })
        }
      }
    }
    await Promise.all(Array.from({ length: this.limits.concurrency }, worker))
    void before
  }
}

function hostOf(url: string): string | null {
  try { return new URL(url).host } catch { return null }
}

function isAssetType(contentType: string | undefined): boolean {
  return !!contentType && /^(image|font|video|audio)\/|text\/css|javascript|application\/(javascript|font|octet-stream)/i
    .test(contentType)
}
