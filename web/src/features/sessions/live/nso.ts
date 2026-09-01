/** Wire/client navigation state param (W7S boundary only). */
export const NSO_PARAM = '_w7s_nso'

/** Dev / V1 plaintext NSO: base64 JSON `{ v: 1, h }`. */
export function encodeNavigationState(host: string): string {
  const json = JSON.stringify({ v: 1, h: host.trim().toLowerCase() })
  const bytes = new TextEncoder().encode(json)
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

export function decodeNavigationState(encoded: string): string | null {
  try {
    const binary = atob(UriDecode(encoded))
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0))
    const json = new TextDecoder().decode(bytes)
    const parsed = JSON.parse(json) as { v?: unknown; h?: unknown }
    if (parsed.v !== 1 || typeof parsed.h !== 'string') {
      return null
    }
    return parsed.h.trim().toLowerCase()
  } catch {
    return null
  }
}

function UriDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function withNavigationState(query: string, host: string): string {
  const parts = query
    .trim()
    .replace(/^\?/, '')
    .split('&')
    .filter((part) => part.length > 0 && !part.startsWith(`${NSO_PARAM}=`))
  parts.push(`${NSO_PARAM}=${encodeURIComponent(encodeNavigationState(host))}`)
  return parts.join('&')
}

/**
 * True when the token looks like a host (or host:port), not a path segment.
 * `google.com`, `www.google.com`, `localhost:8080` — not `/search` or `search`.
 */
export function looksLikeHost(token: string): boolean {
  const trimmed = token.trim()
  if (!trimmed || trimmed.includes('/') || trimmed.includes('?') || trimmed.includes(' ')) {
    return false
  }
  if (trimmed.includes(':')) {
    const [hostPart, portPart] = trimmed.split(':')
    if (!hostPart || !/^\d+$/.test(portPart ?? '')) {
      return false
    }
    return looksLikeHost(hostPart)
  }
  if (trimmed === 'localhost') {
    return true
  }
  // Require a dot so bare words stay path-like (`search` → `/search`).
  return trimmed.includes('.') && /^[a-z0-9.-]+$/i.test(trimmed)
}
