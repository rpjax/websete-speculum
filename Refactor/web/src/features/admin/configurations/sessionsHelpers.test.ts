import { describe, expect, it } from 'vitest'
import {
  DETACHED_TIMEOUT_PRESETS,
  SESSIONS_FILL_GAPS_POSTURE,
  SESSIONS_GUIDED_PRESETS,
  applySessionsGuidedPreset,
  asObject,
  detachedTimeoutPresetId,
  fillSessionsGaps,
  summarizeSessions,
  validateClientEnvironment,
  validateDetachedTimeout,
  validateViewportOrdering,
  viewportSizePresetId,
} from './sessionsHelpers'

describe('sessionsHelpers', () => {
  it('resolves detached timeout presets', () => {
    expect(detachedTimeoutPresetId('00:15:00')).toBe('15m')
    expect(detachedTimeoutPresetId('00:07:00')).toBe('custom')
    expect(DETACHED_TIMEOUT_PRESETS.map((p) => p.id)).toEqual(['3s', '5m', '15m', '30m', '1h'])
    expect(detachedTimeoutPresetId('00:00:03')).toBe('3s')
  })

  it('matches viewport size chips', () => {
    expect(viewportSizePresetId(1280, 720)).toBe('720p')
    expect(viewportSizePresetId(1920, 1080)).toBe('1080p')
    expect(viewportSizePresetId(800, 600)).toBe('custom')
  })

  it('validates detached timeout and viewport ordering', () => {
    expect(validateDetachedTimeout('')).toBeTruthy()
    expect(validateDetachedTimeout('00:00:00')).toBeTruthy()
    expect(validateDetachedTimeout('00:30:00')).toBeUndefined()
    expect(
      validateViewportOrdering({
        viewportPolicy: {
          minimum: { width: 100, height: 100 },
          default: { width: 1280, height: 720 },
          maximum: { width: 4096, height: 2160 },
        },
      }),
    ).toBeUndefined()
    expect(
      validateViewportOrdering({
        viewportPolicy: {
          minimum: { width: 2000, height: 100 },
          default: { width: 1280, height: 720 },
          maximum: { width: 4096, height: 2160 },
        },
      }),
    ).toMatch(/Minimum/)
  })

  it('validates client environment completeness', () => {
    expect(validateClientEnvironment({ clientEnvironmentPolicy: {} })).toBeTruthy()
    expect(
      validateClientEnvironment({
        clientEnvironmentPolicy: {
          defaultLocale: 'en-US',
          defaultLanguage: 'en-US',
          defaultTimeZoneId: 'UTC',
          defaultColorScheme: 'light',
        },
      }),
    ).toBeUndefined()
  })

  it('fills gaps without wiping existing nests', () => {
    const next = fillSessionsGaps({
      detachedSessionTimeout: '01:00:00',
      isJsBridgeEnabled: false,
      viewportPolicy: { default: { width: 800, height: 600 } },
    })
    expect(next.detachedSessionTimeout).toBe('01:00:00')
    expect(next.isJsBridgeEnabled).toBe(false)
    expect(next.viewportPolicy).toEqual({ default: { width: 800, height: 600 } })
    expect(asObject(next.clientEnvironmentPolicy).defaultLocale).toBe('pt-BR')
    expect(asObject(next.inputMultiplexingPolicy).access).toBe('shared')
    expect(next.dataStreamTransport).toBe('webTransport')
    expect(asObject(next.screencastPolicy).maxEncodeScale).toBe(2)
  })

  it('applies guided presets without wiping unrelated keys', () => {
    const lab = SESSIONS_GUIDED_PRESETS.find((p) => p.id === 'lab')!
    const next = applySessionsGuidedPreset(
      {
        detachedSessionTimeout: '00:05:00',
        customOperatorNote: 'keep-me',
        clientEnvironmentPolicy: { defaultLocale: 'en-US', customTag: 'x' },
        deviceEmulationPolicy: { default: { mobile: true }, extraBound: 1 },
      },
      lab,
    )
    expect(next.customOperatorNote).toBe('keep-me')
    expect(next.detachedSessionTimeout).toBe('00:15:00')
    expect(next.isJsBridgeEnabled).toBe(true)
    expect(asObject(next.clientEnvironmentPolicy).defaultLocale).toBe('pt-BR')
    expect(asObject(next.clientEnvironmentPolicy).customTag).toBe('x')
    expect(asObject(next.deviceEmulationPolicy).extraBound).toBe(1)
    expect(asObject(asObject(next.deviceEmulationPolicy).default).mobile).toBe(false)
    expect(asObject(asObject(next.viewportPolicy).default).width).toBe(1280)
  })

  it('summarizes posture for status pills', () => {
    const incomplete = summarizeSessions({})
    expect(incomplete.complete).toBe(false)
    expect(incomplete.timeoutLabel).toBe('Not set')

    const locked = SESSIONS_GUIDED_PRESETS.find((p) => p.id === 'locked-down')!
    const ready = summarizeSessions(applySessionsGuidedPreset({}, locked))
    expect(ready.complete).toBe(true)
    expect(ready.jsBridge).toBe(false)
    expect(ready.access).toBe('exclusive')
    expect(ready.delivery).toBe('broadcast')
    expect(ready.viewportLabel).toBe('1280×720')
    expect(ready.timeoutLabel).toBe('15 min')
    expect(ready.dataStreamTransport).toBe('webTransport')
  })

  it('exposes when/effect copy on guided postures', () => {
    for (const preset of SESSIONS_GUIDED_PRESETS) {
      expect(preset.description.length).toBeGreaterThan(20)
      expect(preset.effect.length).toBeGreaterThan(10)
    }
    expect(SESSIONS_GUIDED_PRESETS.map((p) => p.id)).toEqual(['lab', 'shared', 'locked-down'])
    expect(SESSIONS_GUIDED_PRESETS.find((p) => p.id === 'shared')!.label).toBe('Shared viewing')
    expect(SESSIONS_FILL_GAPS_POSTURE.id).toBe('fill-gaps')
    expect(SESSIONS_FILL_GAPS_POSTURE.effect.length).toBeGreaterThan(10)
  })
})
