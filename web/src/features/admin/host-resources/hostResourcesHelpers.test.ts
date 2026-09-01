import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PARAMS,
  GIB,
  MIB,
  PLAN_PRESETS,
  RESERVE_PERCENT_CHIPS,
  applyPlanPreset,
  bytesToGibInput,
  describeLastApply,
  describePlanRecipe,
  diskUsePercent,
  estimatePlan,
  fitParamsToHost,
  formatGibLabel,
  gibInputToBytes,
  isCustomChipValue,
  isShmBelowFloor,
  memoryUsePercent,
  planBreakdownPercents,
  ramGibChips,
  scaledHostFloors,
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
    // Default shm ceiling is 100% → browsers get everything left after reserve.
    expect(plan?.shmTargetBytes).toBe(host - expectedReserve)
    expect(plan?.availableForShmBytes).toBe(host - expectedReserve)
  })

  it('validates against host total — not free RAM — and explains the starvation case', () => {
    expect(validateParams({ ...DEFAULT_PARAMS, reservePercent: 95 })).toMatch(/reserve/i)
    const msg = validateAgainstHost(
      {
        ...DEFAULT_PARAMS,
        maxRamBytes: 3 * GIB,
        reserveMinBytes: 2 * GIB,
        shmMinBytes: 2 * GIB,
      },
      32 * GIB,
    )
    expect(msg).toMatch(/host RAM total/i)
    expect(msg).toMatch(/not free RAM/i)
    expect(validateAgainstHost(DEFAULT_PARAMS, 32 * GIB)).toBeNull()
    expect(validateAgainstHost(DEFAULT_PARAMS, 3.8 * GIB)).toBeNull()
  })

  it('scales floors and fits impossible knobs to a small host', () => {
    const host = Math.round(3.8 * GIB)
    const floors = scaledHostFloors(host)
    expect(floors.reserveMinBytes + floors.shmMinBytes).toBeLessThanOrEqual(Math.floor(host * 0.85) + 1)

    const broken = {
      ...DEFAULT_PARAMS,
      reserveMinBytes: 2 * GIB,
      shmMinBytes: 2 * GIB,
    }
    expect(validateAgainstHost(broken, host)).not.toBeNull()
    const fitted = fitParamsToHost(broken, host)
    expect(validateAgainstHost(fitted, host)).toBeNull()
  })

  it('applies Dev / Production / Balanced presets without wiping process limits', () => {
    const base = {
      ...DEFAULT_PARAMS,
      nofile: 2_000_000,
      nproc: 99_000,
      raiseUlimits: true,
    }
    const dev = applyPlanPreset(base, 'dev-machine', 64 * GIB)
    expect(dev.maxRamBytes).toBe(16 * GIB)
    expect(dev.nofile).toBe(2_000_000)
    expect(dev.shmMaxPercentOfBudget).toBe(100)

    const prod = applyPlanPreset(dev, 'prod-vps', 64 * GIB)
    expect(prod.maxRamBytes).toBeNull()
    expect(prod.shmMaxPercentOfBudget).toBe(100)
    expect(prod.reservePercent).toBe(8)
    expect(prod.shmMinBytes).toBe(4 * GIB)
    expect(prod.nofile).toBe(2_000_000)

    const balanced = applyPlanPreset(prod, 'balanced', 64 * GIB)
    expect(balanced.maxRamBytes).toBeNull()
    expect(balanced.shmMaxPercentOfBudget).toBe(100)
    expect(validateAgainstHost(applyPlanPreset(base, 'prod-vps', 3.8 * GIB), 3.8 * GIB)).toBeNull()
    expect(validateAgainstHost(applyPlanPreset(base, 'dev-machine', 3.8 * GIB), 3.8 * GIB)).toBeNull()
  })

  it('suggests shared-desktop caps and filters RAM chips by host size', () => {
    expect(suggestedSharedDesktopCapBytes(64 * GIB)).toBe(16 * GIB)
    expect(suggestedSharedDesktopCapBytes(12 * GIB)).toBe(8 * GIB)
    expect(suggestedSharedDesktopCapBytes(3.8 * GIB)).toBeLessThanOrEqual(3.8 * GIB)
    expect(ramGibChips(10 * GIB)).toEqual([2, 4, 8])
    expect(ramGibChips(null).length).toBeGreaterThan(3)
  })

  it('computes RAM and disk use percents', () => {
    expect(memoryUsePercent(10 * GIB, 4 * GIB)).toBeCloseTo(60)
    expect(diskUsePercent(10 * GIB, 2.5 * GIB)).toBeCloseTo(75)
    expect(diskUsePercent(0, 0)).toBeNull()
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
    expect(describePlanRecipe(estimate, 32 * GIB)).toMatch(/host total/)
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

  it('Dev preset leaves no idle remainder inside the budget — IDE headroom is the budget cap', () => {
    const host = Math.round(3.8 * GIB)
    const params = applyPlanPreset(DEFAULT_PARAMS, 'dev-machine', host)
    const plan = estimatePlan(params, host)!
    const remainder = plan.budgetBytes - plan.reserveBytes - plan.shmTargetBytes
    expect(remainder).toBeLessThanOrEqual(1024 ** 2)
    expect(plan.budgetBytes).toBeLessThan(host)
    expect(plan.shmTargetBytes).toBe(plan.budgetBytes - plan.reserveBytes)
  })

  it('exposes Dev / Production / Balanced presets with when/effect copy', () => {
    expect(PLAN_PRESETS.map((p) => p.id)).toEqual(['dev-machine', 'prod-vps', 'balanced'])
    for (const preset of PLAN_PRESETS) {
      expect(preset.label.length).toBeGreaterThan(3)
      expect(preset.description.length).toBeGreaterThan(10)
      expect(preset.effect.length).toBeGreaterThan(10)
    }
    expect(MIB).toBe(1024 ** 2)
  })
})
