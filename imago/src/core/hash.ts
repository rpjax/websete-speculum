import { createHash } from 'node:crypto'

/** Content address: SHA-256, first 16 hex. Same bytes → same path (IR-1). */
export function hashBytes(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex').slice(0, 16)
}

/**
 * Deterministic JSON — object keys sorted at every level. Without this, two
 * identical trees can hash differently and O5a is unreachable.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value))
}

function sortValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortValue)
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = sortValue((v as Record<string, unknown>)[k])
    }
    return out
  }
  return v
}

export function hashJson(value: unknown): string {
  return hashBytes(canonicalJson(value))
}
