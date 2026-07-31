import { describe, expect, it } from 'vitest'
import {
  JOURNAL_PRESETS,
  applyJournalPreset,
  asEventsMap,
  customKeysOutsideCatalog,
  factCategory,
  filterCatalog,
  groupByCategory,
  isFactEnabled,
  isHighSignalFact,
  isJournalToggleable,
  isTelemetryOwned,
  sanitizeJournalEvents,
  setFilteredOptIns,
  setJournalEvent,
  summarizeJournal,
  type JournalCatalogEntry,
} from './journalHelpers'

const catalog: JournalCatalogEntry[] = [
  {
    type: 'Sessions.SessionStarted',
    name: 'Session started',
    description: 'Canonical lifecycle',
    isCanonical: true,
    enabled: true,
    owner: 'sessions',
  },
  {
    type: 'Sessions.FeatureLoopFaulted',
    name: 'Feature loop faulted',
    description: 'Future Journal opt-in',
    isCanonical: false,
    enabled: false,
    owner: 'sessions',
  },
  {
    type: 'Sessions.Capacity.NoSlotAvailable',
    name: 'No slot',
    description: 'Admission pressure',
    isCanonical: false,
    enabled: false,
  },
  {
    type: 'Telemetry.Sessions.Input.Rejected',
    name: 'Input rejected',
    description: 'Telemetry-owned',
    isCanonical: false,
    enabled: true,
    owner: 'telemetry',
  },
  {
    type: 'Telemetry.Sampling.SampleCollected',
    name: 'Sample collected',
    description: 'Sampler',
    isCanonical: false,
    enabled: false,
    owner: 'telemetry',
  },
]

describe('journalHelpers', () => {
  it('detects Telemetry ownership and categories', () => {
    expect(isTelemetryOwned('Telemetry.Sessions.Input.Rejected')).toBe(true)
    expect(isTelemetryOwned('Sessions.FeatureLoopFaulted')).toBe(false)
    expect(factCategory(catalog[0]!)).toBe('sessions')
    expect(factCategory({ type: 'Profiles.ProfileCreated', owner: null })).toBe('Profiles')
  })

  it('classifies toggleable vs Telemetry vs canonical', () => {
    expect(isJournalToggleable(catalog[0]!)).toBe(false)
    expect(isJournalToggleable(catalog[1]!)).toBe(true)
    expect(isJournalToggleable(catalog[3]!)).toBe(false)
    expect(isHighSignalFact(catalog[1]!)).toBe(true)
    expect(isHighSignalFact(catalog[2]!)).toBe(true)
  })

  it('summarizes catalog posture', () => {
    const summary = summarizeJournal(catalog, {
      'Sessions.FeatureLoopFaulted': true,
      'Telemetry.Sessions.Input.Rejected': true,
    })
    expect(summary.catalogSize).toBe(5)
    expect(summary.canonicalCount).toBe(1)
    expect(summary.toggleableCount).toBe(2)
    expect(summary.telemetryOwnedCount).toBe(2)
    expect(summary.enabledOptIns).toBe(2) // FeatureLoopFaulted + Telemetry Rejected (catalog.enabled)
    expect(summary.categoryCount).toBeGreaterThanOrEqual(2)
    expect(summary.statusLabel).toContain('opt-in')
  })

  it('sanitizes events and never writes Telemetry or canonical keys', () => {
    const dirty = asEventsMap({
      'Sessions.FeatureLoopFaulted': true,
      'Telemetry.Sessions.Input.Rejected': true,
      'Sessions.SessionStarted': false,
      '': true,
    })
    const clean = sanitizeJournalEvents(dirty, catalog)
    expect(clean).toEqual({ 'Sessions.FeatureLoopFaulted': true })
    expect(setJournalEvent(dirty, 'Telemetry.Sessions.Input.Rejected', true, catalog)).toEqual({
      'Sessions.FeatureLoopFaulted': true,
    })
  })

  it('applies investigation and clear presets without touching Telemetry', () => {
    const investigation = JOURNAL_PRESETS.find((preset) => preset.id === 'investigation')!
    const cleared = JOURNAL_PRESETS.find((preset) => preset.id === 'clear')!
    const next = applyJournalPreset(
      { 'Telemetry.Sessions.Input.Rejected': true, 'Sessions.FeatureLoopFaulted': false },
      investigation.id,
      catalog,
    )
    expect(next['Sessions.FeatureLoopFaulted']).toBe(true)
    expect(next['Sessions.Capacity.NoSlotAvailable']).toBe(true)
    expect(next['Telemetry.Sessions.Input.Rejected']).toBeUndefined()

    const empty = applyJournalPreset(next, cleared.id, catalog)
    expect(empty['Sessions.FeatureLoopFaulted']).toBe(false)
    expect(empty['Sessions.Capacity.NoSlotAvailable']).toBe(false)
  })

  it('filters, groups, and bulk-toggles filtered Journal opt-ins', () => {
    const filtered = filterCatalog(catalog, 'fault')
    expect(filtered.map((entry) => entry.type)).toEqual(['Sessions.FeatureLoopFaulted'])
    const groups = groupByCategory(filterCatalog(catalog, ''))
    expect(groups.some((group) => group.category === 'sessions' || group.category === 'telemetry')).toBe(
      true,
    )
    const next = setFilteredOptIns({}, filterCatalog(catalog, 'slot'), true, catalog)
    expect(next['Sessions.Capacity.NoSlotAvailable']).toBe(true)
    expect(isFactEnabled(catalog[0]!, {})).toBe(true)
    expect(isFactEnabled(catalog[3]!, {})).toBe(true)
    expect(customKeysOutsideCatalog({ 'Custom.Fact': true }, catalog)).toEqual(['Custom.Fact'])
  })
})
