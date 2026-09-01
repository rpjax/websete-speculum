import { describe, expect, it } from 'vitest'
import type { FrontDebugLogEntry } from '@/features/sessions/debug/frontDebugLog'
import type { LabConsoleLine } from './labConsole'
import { buildLabFrontLogExport } from './labLogExport'

describe('buildLabFrontLogExport', () => {
  it('reverses the newest-first activity ring into chronological order', () => {
    const entries: FrontDebugLogEntry[] = [
      { id: 3, at: 300, level: 'info', label: 'third' },
      { id: 2, at: 200, level: 'info', label: 'second' },
      { id: 1, at: 100, level: 'info', label: 'first' },
    ]
    const payload = buildLabFrontLogExport(entries, [], 's1')
    expect(payload.activity.map((e) => e.id)).toEqual([1, 2, 3])
  })

  it('keeps console lines in their existing append order', () => {
    const consoleLines: LabConsoleLine[] = [
      { id: 1, at: 100, kind: 'log', text: 'a' },
      { id: 2, at: 200, kind: 'log', text: 'b' },
    ]
    const payload = buildLabFrontLogExport([], consoleLines, null)
    expect(payload.console.map((c) => c.text)).toEqual(['a', 'b'])
  })

  it('stamps sessionId and an ISO exportedAt', () => {
    const payload = buildLabFrontLogExport([], [], 'sess-42')
    expect(payload.sessionId).toBe('sess-42')
    expect(payload.exportedAt).toBe(new Date(payload.exportedAt).toISOString())
  })

  it('does not include Journal data — Activity + Console only', () => {
    const payload = buildLabFrontLogExport([], [], null)
    expect(payload).not.toHaveProperty('journal')
    expect(Object.keys(payload).sort()).toEqual(
      ['activity', 'console', 'exportedAt', 'sessionId'].sort(),
    )
  })

  it('does not mutate the input arrays', () => {
    const entries: FrontDebugLogEntry[] = [{ id: 1, at: 100, level: 'info', label: 'x' }]
    const consoleLines: LabConsoleLine[] = [{ id: 1, at: 100, kind: 'log', text: 'y' }]
    buildLabFrontLogExport(entries, consoleLines, null)
    expect(entries).toHaveLength(1)
    expect(consoleLines).toHaveLength(1)
  })
})
