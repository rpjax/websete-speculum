/**
 * What counts as a **subresource** — a byte the page needs in order to render —
 * versus a place the page can take you.
 *
 * Pure and dependency-free on purpose: it runs inside the injected agent and is
 * asserted in `npm test` without a browser.
 *
 * Getting this wrong is not cosmetic. An `<a href>` swept up as an asset makes the
 * closure check (C-4) demand that Imago fetch every link on the page — App Store
 * pages, Discord invites, the whole outbound web — and then report the session as
 * non-closed because it did not. The closed world is about **bytes the bundle
 * needs**, never about where the site points.
 */

export type RefKind = 'url' | 'srcset'

export interface RefAttr { attr: string; kind: RefKind }

/** `<link rel>` values that name a subresource. Everything else is a relationship. */
const ASSET_REL = new Set([
  'stylesheet', 'icon', 'shortcut icon', 'apple-touch-icon', 'apple-touch-icon-precomposed',
  'mask-icon', 'manifest', 'preload', 'modulepreload', 'prefetch',
])

/** Never a subresource, whatever the attribute looks like. */
const NAVIGATION_ONLY = new Set(['a', 'area', 'base'])

const BY_TAG: Record<string, RefAttr[]> = {
  img: [{ attr: 'src', kind: 'url' }, { attr: 'srcset', kind: 'srcset' }],
  source: [{ attr: 'src', kind: 'url' }, { attr: 'srcset', kind: 'srcset' }],
  video: [{ attr: 'src', kind: 'url' }, { attr: 'poster', kind: 'url' }],
  audio: [{ attr: 'src', kind: 'url' }],
  track: [{ attr: 'src', kind: 'url' }],
  script: [{ attr: 'src', kind: 'url' }],
  iframe: [{ attr: 'src', kind: 'url' }],
  frame: [{ attr: 'src', kind: 'url' }],
  embed: [{ attr: 'src', kind: 'url' }],
  object: [{ attr: 'data', kind: 'url' }],
  input: [{ attr: 'src', kind: 'url' }],
  image: [{ attr: 'href', kind: 'url' }, { attr: 'xlink:href', kind: 'url' }],
  use: [{ attr: 'href', kind: 'url' }, { attr: 'xlink:href', kind: 'url' }],
}

/** Lazy-loading conventions. Heuristic, but they are genuinely image sources. */
const DATA_ATTRS: RefAttr[] = [
  { attr: 'data-src', kind: 'url' },
  { attr: 'data-srcset', kind: 'srcset' },
  { attr: 'data-bg', kind: 'url' },
  { attr: 'data-background', kind: 'url' },
  { attr: 'data-background-image', kind: 'url' },
]

/**
 * Which attributes of this element hold subresource URLs.
 * `tag` lowercase; `rel` only matters for `<link>`.
 */
export function subresourceAttrs(tag: string, rel?: string | null): RefAttr[] {
  const name = tag.toLowerCase()
  if (NAVIGATION_ONLY.has(name)) return []
  if (name === 'link') return isAssetRel(rel) ? [{ attr: 'href', kind: 'url' }] : []
  return [...(BY_TAG[name] ?? []), ...DATA_ATTRS]
}

export function isAssetRel(rel?: string | null): boolean {
  if (!rel) return false
  return rel.toLowerCase().split(/\s+/).some((r) => ASSET_REL.has(r))
}

/** Schemes and shapes that are never a fetchable subresource. */
export function isFetchable(raw: string): boolean {
  const v = raw.trim()
  if (!v || v.startsWith('#')) return false
  return !/^(data|blob|javascript|mailto|tel|sms|about|chrome|file|ws|wss):/i.test(v)
}
