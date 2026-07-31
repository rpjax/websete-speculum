/** Helpers for Journal configuration — catalog grouping, presets, events map hygiene. */

export type JsonObject = Record<string, unknown>

export type JournalCatalogEntry = {
  type: string
  name: string
  description: string
  isCanonical: boolean
  enabled: boolean
  owner?: string | null
  schemaVersion?: number
  publishPolicy?: string
}

export type JournalEventsMap = Record<string, boolean>

/** Matches `TelemetryJournalFacts.Owns` — Telemetry section owns these toggles. */
export function isTelemetryOwned(type: string): boolean {
  return type.startsWith('Telemetry.')
}

export function asEventsMap(value: unknown): JournalEventsMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: JournalEventsMap = {}
  for (const [key, flag] of Object.entries(value as Record<string, unknown>)) {
    if (!key) continue
    out[key] = Boolean(flag)
  }
  return out
}

/** Category for grouping: Owner when present, else domain segment before first `.`. */
export function factCategory(entry: Pick<JournalCatalogEntry, 'type' | 'owner'>): string {
  const owner = entry.owner?.trim()
  if (owner) return owner
  const dot = entry.type.indexOf('.')
  return dot > 0 ? entry.type.slice(0, dot) : entry.type || 'Other'
}

export function isJournalToggleable(entry: JournalCatalogEntry): boolean {
  return !entry.isCanonical && !isTelemetryOwned(entry.type)
}

export function optionalCatalog(catalog: JournalCatalogEntry[]): JournalCatalogEntry[] {
  return catalog.filter((entry) => !entry.isCanonical)
}

export function toggleableCatalog(catalog: JournalCatalogEntry[]): JournalCatalogEntry[] {
  return catalog.filter(isJournalToggleable)
}

export function telemetryOwnedOptional(catalog: JournalCatalogEntry[]): JournalCatalogEntry[] {
  return catalog.filter((entry) => !entry.isCanonical && isTelemetryOwned(entry.type))
}

export function canonicalCatalog(catalog: JournalCatalogEntry[]): JournalCatalogEntry[] {
  return catalog.filter((entry) => entry.isCanonical)
}

const HIGH_SIGNAL =
  /Failed|Rejected|Faulted|Crashed|Aborted|Blocked|TimedOut|NoSlot|Abandoned|Pressure|Degraded|AllocationFault/i

export function isHighSignalFact(entry: JournalCatalogEntry): boolean {
  return HIGH_SIGNAL.test(entry.type) || HIGH_SIGNAL.test(entry.name ?? '')
}

export function matchesJournalQuery(entry: JournalCatalogEntry, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const hay = [entry.type, entry.name, entry.description, factCategory(entry), entry.owner ?? '']
    .join(' ')
    .toLowerCase()
  return hay.includes(q)
}

export function filterCatalog(
  catalog: JournalCatalogEntry[],
  query: string,
): JournalCatalogEntry[] {
  return catalog.filter((entry) => matchesJournalQuery(entry, query))
}

export type JournalCategoryGroup = {
  category: string
  entries: JournalCatalogEntry[]
}

export function groupByCategory(entries: JournalCatalogEntry[]): JournalCategoryGroup[] {
  const buckets = new Map<string, JournalCatalogEntry[]>()
  for (const entry of entries) {
    const key = factCategory(entry)
    const list = buckets.get(key)
    if (list) list.push(entry)
    else buckets.set(key, [entry])
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, group]) => ({
      category,
      entries: [...group].sort((a, b) => a.type.localeCompare(b.type)),
    }))
}

export type JournalSummary = {
  catalogSize: number
  canonicalCount: number
  optionalCount: number
  toggleableCount: number
  telemetryOwnedCount: number
  enabledOptIns: number
  categoryCount: number
  categories: string[]
  statusLabel: string
}

/** Enabled opt-ins: Journal events map for toggleable types; catalog.enabled for Telemetry-owned. */
export function summarizeJournal(
  catalog: JournalCatalogEntry[] | null,
  events: JournalEventsMap,
): JournalSummary {
  if (!catalog) {
    return {
      catalogSize: 0,
      canonicalCount: 0,
      optionalCount: 0,
      toggleableCount: 0,
      telemetryOwnedCount: 0,
      enabledOptIns: 0,
      categoryCount: 0,
      categories: [],
      statusLabel: 'Loading catalog',
    }
  }

  const optional = optionalCatalog(catalog)
  const toggleable = toggleableCatalog(catalog)
  const telemetryOwned = telemetryOwnedOptional(catalog)
  const categories = [...new Set(catalog.map(factCategory))].sort((a, b) => a.localeCompare(b))

  let enabledOptIns = 0
  for (const entry of toggleable) {
    if (events[entry.type] ?? entry.enabled) enabledOptIns += 1
  }
  for (const entry of telemetryOwned) {
    if (entry.enabled) enabledOptIns += 1
  }

  return {
    catalogSize: catalog.length,
    canonicalCount: canonicalCatalog(catalog).length,
    optionalCount: optional.length,
    toggleableCount: toggleable.length,
    telemetryOwnedCount: telemetryOwned.length,
    enabledOptIns,
    categoryCount: categories.length,
    categories,
    statusLabel:
      enabledOptIns > 0
        ? `${enabledOptIns} opt-in${enabledOptIns === 1 ? '' : 's'} on`
        : 'Lean · opt-ins off',
  }
}

/**
 * Drop Telemetry-owned, empty, and canonical keys so Journal PUT can succeed.
 * Unknown non-Telemetry keys are kept for operator correction (server still validates).
 */
export function sanitizeJournalEvents(
  events: JournalEventsMap,
  catalog: JournalCatalogEntry[] | null,
): JournalEventsMap {
  const next: JournalEventsMap = {}
  const canonical = catalog
    ? new Set(catalog.filter((entry) => entry.isCanonical).map((entry) => entry.type))
    : null

  for (const [key, enabled] of Object.entries(events)) {
    if (!key.trim() || isTelemetryOwned(key)) continue
    if (canonical?.has(key)) continue
    next[key] = Boolean(enabled)
  }
  return next
}

export function setJournalEvent(
  events: JournalEventsMap,
  type: string,
  enabled: boolean,
  catalog: JournalCatalogEntry[] | null,
): JournalEventsMap {
  if (!type.trim() || isTelemetryOwned(type)) {
    return sanitizeJournalEvents(events, catalog)
  }
  if (catalog?.some((entry) => entry.type === type && entry.isCanonical)) {
    return sanitizeJournalEvents(events, catalog)
  }
  return sanitizeJournalEvents({ ...events, [type]: enabled }, catalog)
}

export function removeJournalEvent(
  events: JournalEventsMap,
  type: string,
  catalog: JournalCatalogEntry[] | null,
): JournalEventsMap {
  const next = { ...events }
  delete next[type]
  return sanitizeJournalEvents(next, catalog)
}

export function setFilteredOptIns(
  events: JournalEventsMap,
  filtered: JournalCatalogEntry[],
  enabled: boolean,
  catalog: JournalCatalogEntry[] | null,
): JournalEventsMap {
  let next = { ...events }
  for (const entry of filtered) {
    if (!isJournalToggleable(entry)) continue
    next[entry.type] = enabled
  }
  return sanitizeJournalEvents(next, catalog)
}

export type JournalPresetId = 'investigation' | 'clear'

export type JournalPreset = {
  id: JournalPresetId
  label: string
  description: string
}

export const JOURNAL_PRESETS: JournalPreset[] = [
  {
    id: 'investigation',
    label: 'Investigation',
    description:
      'Enable high-signal Journal-owned opt-ins (failures, rejects, faults). Telemetry event facts stay under Telemetry.',
  },
  {
    id: 'clear',
    label: 'Clear opt-ins',
    description:
      'Turn off all Journal-owned opt-ins and strip invalid Telemetry keys from this section. Canonical facts stay on.',
  },
]

export function applyJournalPreset(
  events: JournalEventsMap,
  presetId: JournalPresetId,
  catalog: JournalCatalogEntry[] | null,
): JournalEventsMap {
  if (!catalog) return sanitizeJournalEvents(events, catalog)

  if (presetId === 'clear') {
    const next: JournalEventsMap = {}
    for (const entry of toggleableCatalog(catalog)) {
      next[entry.type] = false
    }
    return next
  }

  // investigation
  let next = sanitizeJournalEvents(events, catalog)
  for (const entry of toggleableCatalog(catalog)) {
    if (isHighSignalFact(entry)) next[entry.type] = true
  }
  return next
}

export function isFactEnabled(
  entry: JournalCatalogEntry,
  events: JournalEventsMap,
): boolean {
  if (entry.isCanonical) return true
  if (isTelemetryOwned(entry.type)) return entry.enabled
  return events[entry.type] ?? entry.enabled
}

export function customKeysOutsideCatalog(
  events: JournalEventsMap,
  catalog: JournalCatalogEntry[] | null,
): string[] {
  if (!catalog) {
    return Object.keys(events).filter((key) => !isTelemetryOwned(key)).sort()
  }
  const known = new Set(catalog.map((entry) => entry.type))
  return Object.keys(events)
    .filter((key) => !known.has(key) && !isTelemetryOwned(key))
    .sort()
}
