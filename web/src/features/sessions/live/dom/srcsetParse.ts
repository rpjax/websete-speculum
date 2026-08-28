/**
 * WHATWG-ish image-candidate parse for `srcset` / `imagesrcset`.
 * URL runs through commas until ASCII whitespace; candidates split only after
 * descriptors (or a trailing comma on a URL-only candidate).
 * Keep in sync with sidecar `mirror/dom/srcsetParse.ts`.
 * @see https://html.spec.whatwg.org/multipage/images.html#parsing-a-srcset-attribute
 */

export type SrcsetCandidate = {
  url: string
  /** Descriptor tokens joined by a single space (may be empty). */
  descriptor: string
}

function isAsciiWhitespace(c: string): boolean {
  return c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f'
}

export function parseSrcset(input: string): SrcsetCandidate[] {
  const candidates: SrcsetCandidate[] = []
  let pos = 0
  const len = input.length

  while (pos < len) {
    while (pos < len && (input[pos] === ',' || isAsciiWhitespace(input[pos]!))) pos += 1
    if (pos >= len) break

    const urlStart = pos
    while (pos < len && !isAsciiWhitespace(input[pos]!)) pos += 1
    let url = input.slice(urlStart, pos)
    if (url.endsWith(',')) {
      url = url.replace(/,+$/, '')
      if (url) candidates.push({ url, descriptor: '' })
      continue
    }

    while (pos < len && isAsciiWhitespace(input[pos]!)) pos += 1

    const descParts: string[] = []
    let current = ''
    let state: 'in' | 'after' | 'parens' = 'in'
    while (pos < len) {
      const c = input[pos]!
      if (state === 'in') {
        if (isAsciiWhitespace(c)) {
          if (current) {
            descParts.push(current)
            current = ''
            state = 'after'
          }
          pos += 1
        } else if (c === ',') {
          if (current) descParts.push(current)
          current = ''
          pos += 1
          break
        } else if (c === '(') {
          current += c
          state = 'parens'
          pos += 1
        } else {
          current += c
          pos += 1
        }
      } else if (state === 'parens') {
        current += c
        if (c === ')') state = 'in'
        pos += 1
      } else if (isAsciiWhitespace(c)) {
        pos += 1
      } else {
        state = 'in'
      }
    }
    if (current) descParts.push(current)
    if (url) candidates.push({ url, descriptor: descParts.join(' ') })
  }

  return candidates
}

/** Map each candidate URL; preserve descriptors and `, ` separators. */
export function mapSrcset(input: string, mapUrl: (url: string) => string): string {
  return parseSrcset(input)
    .map((c) => {
      const u = mapUrl(c.url)
      return c.descriptor ? `${u} ${c.descriptor}` : u
    })
    .join(', ')
}
