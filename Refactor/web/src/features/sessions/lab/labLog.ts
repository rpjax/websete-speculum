export type LabLogLevel = 'info' | 'wire' | 'warn' | 'error'

export interface LabLogEntry {
  id: number
  at: number
  level: LabLogLevel
  label: string
  detail?: string
}

export const LAB_LOG_LIMIT = 200

export function describe(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  if (typeof value === 'string') {
    return value
  }
  if (value instanceof Error) {
    return value.message
  }
  try {
    return JSON.stringify(value, (_key, raw) =>
      raw instanceof Uint8Array ? `<${raw.byteLength} bytes>` : raw,
    )
  } catch {
    return String(value)
  }
}
