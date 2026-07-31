import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PARAMS,
  GIB,
  PLAN_PRESETS,
  RESERVE_PERCENT_CHIPS,
  applyPlanPreset,
  bytesToGibInput,
  describeLastApply,
  describePlanRecipe,
  estimatePlan,
  formatGibLabel,
  gibInputToBytes,
  isCustomChipValue,
  isShmBelowFloor,
  planBreakdownPercents,
  ramGibChips,
  suggestedSharedDesktopCapBytes,
  validateAgainstHost,
  validateParams,
} from './hostResourcesHelpers'

describe('hostResourcesHelpers', () => {
  it('converts GiB inputs to bytes and back', () => {
    expect(gibInputToBytes('2')).toBe(2 * GIB)
    expect(bytesToGibInput(5 * GIB)).toBe('5')
    expect(bytesToGibInput(null)).toBe('')
    expect(formatGibLabel(2.5 * GIB)).toBe('2.5 GiB')
  })

  it('estimates plan matching HostResourceCalculator with a RAM ceiling', () => {
    const plan = estimatePlan(
      {
        ...DEFAULT_PARAMS,
        maxRamBytes: 8 * GIB,
        reservePercent: 15,
        reserveMinBytes: 2 * GIB,
        shmMinBytes: 2 * GIB,
        shmMaxPercentOfBudget: 75,
      },
      32 * GIB,
    )
    expect(plan).toEqual({
      budgetBytes: 8 * GIB,
      reserveBytes: 2 * GIB,
      shmTargetBytes: 6 * GIB,
      availableForShmBytes: 6 * GIB,
    })
  })

  it('estimates plan without maxRam using host total and percent reserve', () => {
    const host = 32 * GIB
    const expectedReserve = Math.ceil(host * 0.15)
    const plan = estimatePlan({ ...DEFAULT_PARAMS, maxRamBytes: null }, host)
    expect(plan?.reserveBytes).toBe(expectedReserve)
    const raw = host - expectedReserve
    const cap = Math.floor(host * 0.75)
    expect(plan?.shmTargetBytes).toBe(Math.min(Math.max(raw, 2 * GIB), Math.max(2 * GIB, cap)))
  })

  it('validates params and host budget headroom', () => {
    expect(validateParams({ ...DEFAULT_PARAMS, reservePercent: 95 })).toMatch(/reserve/i)
    expect(
      validateAgainstHost(
        {
          ...DEFAULT_PARAMS,
          maxRamBytes: 3 * GIB,
          reserveMinBytes: 2 * GIB,
          shmMinBytes: 2 * GIB,
        },
        32 * GIB,
      ),
    ).toMatch(/shared-memory minimum/i)
    expect(validateAgainstHost(DEFAULT_PARAMS, 32 * GIB)).toBeNull()
  })

  it('applies presets without wiping process limits', () => {
    const base = {
      ...DEFAULT_PARAMS,
      nofile: 2_000_000,
      nproc: 99_000,
      raiseUlimits: true,
    }
    const shared = applyPlanPreset(base, 'shared-desktop', 64 * GIB)
    expect(shared.maxRamBytes).toBe(16 * GIB)
    expect(shared.nofile).toBe(2_000_000)
    expect(shared.nproc).toBe(99_000)

    const dedicated = applyPlanPreset(shared, 'dedicated', 64 * GIB)
    expect(dedicated.maxRamBytes).toBeNull()
    expect(dedicated.nofile).toBe(2_000_000)

    const conservative = applyPlanPreset(dedicated, 'conservative-reserve')
    expect(conservative.reservePercent).toBe(25)
    expect(conservative.reserveMinBytes).toBe(4 * GIB)
    expect(conservative.maxRamBytes).toBeNull()

    const aggressive = applyPlanPreset(conservative, 'aggressive-shm')
    expect(aggressive.shmMaxPercentOfBudget).toBe(90)
    expect(aggressive.shmMinBytes).toBe(4 * GIB)
    expect(aggressive.reservePercent).toBe(25)
  })

  it('suggests shared-desktop caps and filters RAM chips by host size', () => {
    expect(suggestedSharedDesktopCapBytes(64 * GIB)).toBe(16 * GIB)
    expect(suggestedSharedDesktopCapBytes(12 * GIB)).toBe(8 * GIB)
    expect(ramGibChips(10 * GIB)).toEqual([4, 8])
    expect(ramGibChips(null).length).toBeGreaterThan(3)
  })

  it('describes last apply and shm floor checks', () => {
    expect(describeLastApply(null)).toBeNull()
    expect(
      describeLastApply({
        appliedAtUtc: '2026-01-15T12:00:00.000Z',
        shmAppliedBytes: 4 * GIB,
      }),
    ).toMatch(/Last applied/)
    expect(isShmBelowFloor(1 * GIB, 2 * GIB)).toBe(true)
    expect(isShmBelowFloor(4 * GIB, 2 * GIB)).toBe(false)
  })

  it('computes plan breakdown percents', () => {
    const parts = planBreakdownPercents({
      budgetBytes: 10 * GIB,
      reserveBytes: 2 * GIB,
      shmTargetBytes: 6 * GIB,
    })
    expect(parts.reservePct).toBeCloseTo(20)
    expect(parts.shmPct).toBeCloseTo(60)
    expect(parts.remainderPct).toBeCloseTo(20)
  })

  it('describes the plan recipe in operator language', () => {
    const estimate = estimatePlan(
      {
        ...DEFAULT_PARAMS,
        maxRamBytes: 8 * GIB,
        reservePercent: 15,
        reserveMinBytes: 2 * GIB,
        shmMinBytes: 2 * GIB,
        shmMaxPercentOfBudget: 75,
      },
      32 * GIB,
    )!
    expect(describePlanRecipe(estimate, 32 * GIB)).toMatch(/capped at 8 GiB/)
    expect(describePlanRecipe(estimate, 32 * GIB)).toMatch(/keeps 2 GiB/)
    expect(describePlanRecipe(estimate, 32 * GIB)).toMatch(/targets 6 GiB/)
    expect(isCustomChipValue(15, RESERVE_PERCENT_CHIPS)).toBe(false)
    expect(isCustomChipValue(17, RESERVE_PERCENT_CHIPS)).toBe(true)

    const tight = estimatePlan(
      {
        ...DEFAULT_PARAMS,
        maxRamBytes: null,
        reservePercent: 15,
        reserveMinBytes: 8 * GIB,
        shmMinBytes: 2 * GIB,
      },
      4 * GIB,
    )!
    expect(tight.availableForShmBytes).toBe(0)
    expect(describePlanRecipe(tight, 4 * GIB)).toMatch(/consumes the whole budget/)
  })

  it('exposes didactic plan presets with when/effect copy', () => {
    expect(PLAN_PRESETS.map((p) => p.id)).toEqual([
      'shared-desktop',
      'dedicated',
      'conservative-reserve',
      'aggressive-shm',
    ])
    for (const preset of PLAN_PRESETS) {
      expect(preset.label.length).toBeGreaterThan(3)
      expect(preset.description.length).toBeGreaterThan(10)
      expect(preset.effect.length).toBeGreaterThan(10)
    }
  })
})
