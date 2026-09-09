/**
 * Reference discovery beyond the DOM (C-4c).
 *
 * A snapshot's refs are the URLs written down in markup and CSS. A real
 * application does not keep its asset URLs there: it builds them in JavaScript, and
 * it receives them inside API payloads — an image proxy URL in a GraphQL response is
 * an asset the bundle needs and no `<img src>` ever mentioned.
 *
 * So every recorded text body is swept for absolute URLs. Pure and dependency-free
 * so the extraction and the fencing are asserted without a browser.
 */

/** Absolute and protocol-relative URLs, as they appear inside text. */
export function extractUrls(text: string, cap = 20_000): string[] {
  // JSON string literals escape their slashes (`https:\/\/host\/path`), which is
  // exactly where API payloads keep the image URLs. Unescape first, match after.
  const source = text.includes('\\/') ? text.replace(/\\\//g, '/') : text

  const out = new Set<string>()
  // A domain (dot + letter TLD), an IPv4 authority, or `localhost` — each with an
  // optional port. The alternatives are explicit on purpose: matching any `//…`
  // would swallow every line comment in a minified bundle, and requiring a letter
  // TLD (the first version) silently ignored `127.0.0.1` and `localhost`, which is
  // exactly where a locally served asset lives.
  const re = /(?:https?:)?\/\/(?:[A-Za-z0-9._~-]+\.[A-Za-z]{2,}|\d{1,3}(?:\.\d{1,3}){3}|localhost)(?::\d{2,5})?(?:\/[^\s"'`<>\\)\]}]*)?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) && out.size < cap) {
    // trailing punctuation belongs to the surrounding source, not the URL
    let url = m[0].replace(/[),;.'"]+$/, '')
    if (url.startsWith('//')) url = 'https:' + url
    if (url.length < 12 || url.length > 2000) continue
    // a bare host (`https://cdn.test`) is not a subresource
    try {
      const parsed = new URL(url)
      if (!parsed.pathname || parsed.pathname === '/') continue
    } catch { continue }
    out.add(url)
  }
  return [...out]
}

const TEXTUAL = /(text\/|application\/(javascript|json|xml|graphql|manifest)|\+json|\+xml|javascript)/i

export function isTextual(contentType: string | undefined): boolean {
  return !!contentType && TEXTUAL.test(contentType)
}

/**
 * URL shape that is almost certainly a byte the bundle needs, not a page or an API
 * call. **Shape only — never a vendor name.** An image CDN is recognised by
 * evidence (what its bytes come back as), not by having "imgproxy" in its
 * hostname: that would work for exactly one target and silently miss Cloudinary,
 * imgix, Akamai, an S3 signed URL, or `/_next/image`.
 *
 * This is a fast path, not a fence: a host already proven to serve subresources
 * sweeps every URL on it regardless of shape (`sweepable`), and an unknown host is
 * promoted by probing one candidate and reading its content-type.
 */
export function looksLikeAsset(url: string): boolean {
  try {
    const p = new URL(url)
    const path = p.pathname.toLowerCase()
    if (/\.(png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|eot|mp4|webm|mp3|m4a|wav)(\?|$)/i.test(path)) return true
    if (/\/cdn\/|\/assets\/|\/static\/|\/media\/|\/fonts?\//i.test(path)) return true
    return false
  } catch { return false }
}

/**
 * Hosts named inside payloads before they ever served a byte — an image proxy URL
 * inside GraphQL is the common case. Only asset-shaped URLs count; a docs link
 * does not promote its host.
 */
export function expandAssetHosts(hosts: Set<string>, urls: Iterable<string>): void {
  for (const url of urls) {
    if (!looksLikeAsset(url)) continue
    try { hosts.add(new URL(url).host) } catch { /* not a url we can use */ }
  }
}

/**
 * The fence, in two parts — and the second part is what keeps this a sweep instead
 * of a crawler.
 *
 * **Which hosts.** A swept URL is only fetched when its host already delivered a
 * subresource in this session, or was named by an asset-shaped URL the sweep read
 * from a recorded body (C-4c). A host the page merely mentioned in a docs link is
 * out.
 *
 * **Which URLs on those hosts.** A site's own host serves *both* its pages and its
 * assets, so "any URL on a proven host" means every link on every page — and each
 * fetched page yields more links. That is a crawl: on a real storefront it reached
 * ~8800 URLs and hundreds of megabytes before anyone could stop it.
 *
 * So the two kinds of host are separated by evidence:
 *
 * | host | what it served | what the sweep takes |
 * |---|---|---|
 * | **document host** | at least one `text/html` body | asset-shaped URLs only — never its pages |
 * | **asset-only host** | never HTML (an image proxy, a CDN) | everything, extension-less included |
 *
 * That is what lets an extension-less image URL through without letting a product
 * page through, and neither rule needs to know a vendor's name.
 */
export function sweepable(
  url: string,
  assetHosts: ReadonlySet<string>,
  alreadyFetched: ReadonlySet<string>,
  alreadyFailed?: ReadonlySet<string>,
  documentHosts?: ReadonlySet<string>,
): boolean {
  if (alreadyFetched.has(url)) return false
  if (alreadyFailed?.has(url)) return false
  let parsed: URL
  try { parsed = new URL(url) } catch { return false }
  if (!/^https?:$/.test(parsed.protocol)) return false
  if (!assetHosts.has(parsed.host)) return false
  // a hash fragment is never part of what the server sees
  if (url.includes('#')) return false
  // a document host's pages are not assets — following them is a crawl
  if (documentHosts?.has(parsed.host) && !looksLikeAsset(url)) return false
  return true
}

/** Hosts that served a document. Their pages are off limits to the sweep. */
export function documentHostsOf(
  records: readonly { url: string; contentType?: string }[],
): Set<string> {
  const hosts = new Set<string>()
  for (const r of records) {
    if (!r.contentType || !/^text\/html/i.test(r.contentType)) continue
    try {
      const parsed = new URL(r.url)
      if (/^https?:$/.test(parsed.protocol)) hosts.add(parsed.host)
    } catch { /* not a url we can use */ }
  }
  return hosts
}

/** A body the sweep fetched that is a page — stored, but never mined for more links. */
export function isDocumentBody(contentType: string | undefined): boolean {
  return !!contentType && /^text\/html/i.test(contentType)
}

/**
 * Which candidate to spend an unknown host's one probe on. Asset-shaped first, then
 * the deepest path (a bare `/` tells you nothing), then lexical order so a session
 * probes deterministically and O5a stays reachable.
 */
export function probeCandidate(urls: Iterable<string>): string | null {
  let best: string | null = null
  let bestScore = -1
  for (const url of urls) {
    const score = (looksLikeAsset(url) ? 100 : 0) + Math.min(50, segments(url))
    if (score > bestScore || (score === bestScore && best !== null && url < best)) {
      best = url
      bestScore = score
    }
  }
  return best
}

function segments(url: string): number {
  try { return new URL(url).pathname.split('/').filter(Boolean).length } catch { return 0 }
}

/** Hosts that served something the page rendered with — never telemetry or challenge. */
export function assetHostsOf(
  records: readonly { url: string; kind: string; contentType?: string }[],
): Set<string> {
  const hosts = new Set<string>()
  for (const r of records) {
    if (r.kind === 'telemetry' || r.kind === 'challenge') continue
    if (r.contentType && !isAssetLike(r.contentType) && r.kind !== 'asset') continue
    try {
      const parsed = new URL(r.url)
      // trees and stylesheets are indexed under `tree://<hash>` markers; a hash is
      // not a host, and letting one in would forge evidence for a host that
      // never existed.
      if (!/^https?:$/.test(parsed.protocol)) continue
      hosts.add(parsed.host)
    } catch { /* not a url we can use */ }
  }
  return hosts
}

function isAssetLike(contentType: string): boolean {
  return /^(image|font|video|audio)\/|text\/css|javascript|application\/(javascript|font|octet-stream)/i
    .test(contentType)
}
