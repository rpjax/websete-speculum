import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CONSOLE_LEVELS,
  collapseConsoleRepeats,
  formatConsoleResult,
  isDefaultConsoleLevels,
  lineMatchesFilter,
  type LabConsoleLine,
} from './labConsole'

function line(partial: Partial<LabConsoleLine> & Pick<LabConsoleLine, 'kind' | 'text'>): LabConsoleLine {
  return {
    id: 1,
    at: Date.now(),
    ...partial,
  }
}

describe('lineMatchesFilter', () => {
  it('keeps input echoes even when errors-only is on', () => {
    const levels = { ...DEFAULT_CONSOLE_LEVELS, info: false, warning: false, verbose: false }
    expect(
      lineMatchesFilter(line({ kind: 'input', text: '1+1' }), levels, ''),
    ).toBe(true)
  })

  it('filters by severity and text', () => {
    const errorLine = line({ kind: 'log', level: 2, text: 'boom' })
    const infoLine = line({ kind: 'log', level: 0, text: 'hello' })
    expect(lineMatchesFilter(errorLine, DEFAULT_CONSOLE_LEVELS, '')).toBe(true)
    expect(lineMatchesFilter(infoLine, { ...DEFAULT_CONSOLE_LEVELS, info: false }, '')).toBe(false)
    expect(lineMatchesFilter(errorLine, DEFAULT_CONSOLE_LEVELS, 'bo')).toBe(true)
    expect(lineMatchesFilter(errorLine, DEFAULT_CONSOLE_LEVELS, 'nope')).toBe(false)
  })
})

describe('formatConsoleResult', () => {
  it('pretty-prints JSON results', () => {
    expect(formatConsoleResult('{"a":1}')).toContain('\n')
  })
})

describe('isDefaultConsoleLevels', () => {
  it('detects Chrome default level set', () => {
    expect(isDefaultConsoleLevels(DEFAULT_CONSOLE_LEVELS)).toBe(true)
    expect(isDefaultConsoleLevels({ ...DEFAULT_CONSOLE_LEVELS, verbose: true })).toBe(false)
  })
})

describe('collapseConsoleRepeats', () => {
  it('collapses consecutive identical logs', () => {
    const rows = collapseConsoleRepeats([
      line({ id: 1, kind: 'log', level: 0, text: 'ping' }),
      line({ id: 2, kind: 'log', level: 0, text: 'ping' }),
      line({ id: 3, kind: 'log', level: 0, text: 'pong' }),
    ])
    expect(rows).toHaveLength(2)
    expect(rows[0]?.count).toBe(2)
    expect(rows[1]?.count).toBe(1)
  })
})
