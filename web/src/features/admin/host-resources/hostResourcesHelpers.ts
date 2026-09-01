/** Pure helpers for Host resources Admin (GiB UX, plan estimate, presets). */

export const GIB = 1024 ** 3

export type HostResourceProvisionParams = {
  maxRamBytes?: number | null
  reservePercent?: number
  reserveMinBytes?: number
  shmMinBytes?: number
  shmMaxPercentOfBudget?: number
  raiseUlimits?: boolean
  nofile?: number
  nproc?: number
}

export type HostResourceHostSnapshot = {
  memoryTotalBytes?: number
  memoryAvailableBytes?: number
  cpuCount?: number
  source?: string
  diskTotalBytes?: number
  diskFreeBytes?: number
}

export type HostResourceSidecarSnapshot = {
  shmSizeBytes?: number | null
  nofile?: number | null
  nproc?: number | null
  error?: string | null
}

export type HostResourceLastApplySnapshot = {
  params?: HostResourceProvisionParams
  budgetBytes?: number
  reserveBytes?: number
  shmTargetBytes?: number
  shmAppliedBytes?: number
  hostMemoryTotalBytes?: number
  hostCpuCount?: number
  hostSource?: string
  ulimitsRaised?: boolean
  warnings?: string[]
  appliedAtUtc?: string
}

export type HostResourceStatus = {
  host?: HostResourceHostSnapshot | null
  sidecar?: HostResourceSidecarSnapshot | null
  lastApply?: HostResourceLastApplySnapshot | null
  hostError?: string | null
}

export type HostResourceProvisionPlan = {
  budgetBytes: number
  reserveBytes: number
  shmTargetBytes: number
  hostMemoryTotalBytes: number
  hostCpuCount: number
  hostSource?: string
  raiseUlimits: boolean
  nofile: number
  nproc: number
}

export type HostResourceApplyResult = {
  appliedAtUtc: string
  shmAppliedBytes: number
  shmBeforeBytes?: number
  ulimitsRaised?: boolean
  nofileApplied?: number | null
  nprocApplied?: number | null
  warnings?: string[]
  plan?: HostResourceProvisionPlan
}

export type EstimatedPlan = {
  budgetBytes: number
  reserveBytes: number
  shmTargetBytes: number
  availableForShmBytes: number
}

export type PlanPresetId = 'dev-machine' | 'prod-vps' | 'balanced'

export type PlanPreset = {
  id: PlanPresetId
  label: string
  /** When to pick this posture. */
  description: string
  /** What the click changes in the plan knobs. */
  effect: string
}

/** Soft defaults that still fit a ~4 GiB host; presets scale further to the live total.
 * shmMaxPercent 100% = after OS reserve, the rest of the budget goes to browsers (no idle remainder).
 */
export const DEFAULT_PARAMS: HostResourceProvisionParams = {
  maxRamBytes: null,
  reservePercent: 15,
  reserveMinBytes: 1 * GIB,
  shmMinBytes: 1 * GIB,
  shmMaxPercentOfBudget: 100,
  raiseUlimits: true,
  nofile: 1_048_576,
  nproc: 65_535,
}

export const PLAN_PRESETS: PlanPreset[] = [
  {
    id: 'dev-machine',
    label: 'Dev machine',
    description: 'This PC also runs your IDE, browser, and other apps.',
    effect:
      'Caps Speculum’s RAM budget so the rest of the host stays for your IDE. Inside that budget, OS reserve is taken first and browsers get everything left.',
  },
  {
    id: 'prod-vps',
    label: 'Production VPS',
    description: 'Dedicated Speculum box — unlock the hardware.',
    effect:
      'Uses the full host RAM, a low OS reserve, and gives browsers everything left in the budget.',
  },
  {
    id: 'balanced',
    label: 'Balanced',
    description: 'Semi-dedicated host without going aggressive.',
    effect: 'Full host budget, a middle OS reserve, and browsers get everything left after that.',
  },
]

export const RESERVE_PERCENT_CHIPS = [5, 10, 15, 20, 25, 30] as const
export const SHM_PERCENT_CHIPS = [50, 60, 75, 85, 90, 100] as const
export const RAM_GIB_CHIP_CANDIDATES = [2, 4, 8, 16, 24, 32, 48, 64] as const
export const RESERVE_MIN_GIB_CHIPS = [0.5, 1, 2, 4, 8] as const
export const SHM_MIN_GIB_CHIPS = [0.5, 1, 2, 4, 8] as const

export const MIB = 1024 ** 2

export function bytesToGibInput(bytes?: number | null): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes === 0) return '0'
  const gib = bytes / GIB
  return Number.isInteger(gib) || Math.abs(gib - Math.round(gib)) < 1e-9
    ? String(Math.round(gib))
    : Number(gib.toFixed(2)).toString()
}

export function gibInputToBytes(raw: string): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.round(n * GIB)
}

export function formatGibLabel(bytes?: number | null, digits = 1): string {
  if (bytes == null || !Number.isFinite(bytes)) return 'Not reported'
  const gib = bytes / GIB
  const rounded =
    Number.isInteger(gib) || Math.abs(gib - Math.round(gib)) < 1e-9
      ? String(Math.round(gib))
      : gib.toFixed(digits)
  return `${rounded} GiB`
}

export function formatCompactCount(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return 'Not reported'
  return value.toLocaleString()
}

/** Floor bytes that always leave room for shm on this host total (not free RAM). */
export function scaledHostFloors(hostMemoryTotalBytes: number): {
  reserveMinBytes: number
  shmMinBytes: number
} {
  const host = Math.max(0, hostMemoryTotalBytes)
  const maxSum = Math.floor(host * 0.85)
  let reserveMin = Math.min(2 * GIB, Math.max(512 * MIB, Math.floor(host * 0.12)))
  let shmMin = Math.min(2 * GIB, Math.max(512 * MIB, Math.floor(host * 0.25)))
  if (reserveMin + shmMin > maxSum && maxSum > 0) {
    reserveMin = Math.floor(maxSum * 0.35)
    shmMin = Math.max(512 * MIB, maxSum - reserveMin)
  }
  return { reserveMinBytes: reserveMin, shmMinBytes: shmMin }
}

/** Suggested RAM cap for a shared / multi-workload host (never exceeds host total). */
export function suggestedSharedDesktopCapBytes(hostMemoryTotalBytes?: number | null): number {
  const fallback = 8 * GIB
  if (hostMemoryTotalBytes == null || hostMemoryTotalBytes <= 0) return fallback
  if (hostMemoryTotalBytes <= 8 * GIB) {
    // Half the box, but never above the host and at least 2 GiB when the host allows it.
    return Math.min(
      hostMemoryTotalBytes,
      Math.max(Math.min(2 * GIB, hostMemoryTotalBytes), Math.floor(hostMemoryTotalBytes / 2)),
    )
  }
  if (hostMemoryTotalBytes <= 16 * GIB) return 8 * GIB
  return 16 * GIB
}

/**
 * Clamp floors so reserve + shmMin fit the planning budget from host *total*
 * (never from currently free RAM — the engine already holds memory).
 */
export function fitParamsToHost(
  parameters: HostResourceProvisionParams,
  hostMemoryTotalBytes: number,
): HostResourceProvisionParams {
  if (!Number.isFinite(hostMemoryTotalBytes) || hostMemoryTotalBytes <= 0) return parameters
  const next = { ...parameters }
  const budget =
    next.maxRamBytes != null && next.maxRamBytes > 0
      ? Math.min(hostMemoryTotalBytes, next.maxRamBytes)
      : hostMemoryTotalBytes
  const floors = scaledHostFloors(budget)
  const reserveMin = next.reserveMinBytes ?? DEFAULT_PARAMS.reserveMinBytes!
  const shmMin = next.shmMinBytes ?? DEFAULT_PARAMS.shmMinBytes!
  if (reserveMin + shmMin > budget) {
    next.reserveMinBytes = floors.reserveMinBytes
    next.shmMinBytes = floors.shmMinBytes
  } else if (validateAgainstHost(next, hostMemoryTotalBytes)) {
    // Percent reserve alone can still starve shm — drop floors to scaled values.
    next.reserveMinBytes = Math.min(reserveMin, floors.reserveMinBytes)
    next.shmMinBytes = Math.min(shmMin, floors.shmMinBytes)
    if (validateAgainstHost(next, hostMemoryTotalBytes)) {
      next.reservePercent = Math.min(next.reservePercent ?? 15, 10)
      next.reserveMinBytes = floors.reserveMinBytes
      next.shmMinBytes = floors.shmMinBytes
    }
  }
  return next
}

/**
 * Merge a plan preset into current params without wiping process limits.
 */
export function applyPlanPreset(
  current: HostResourceProvisionParams,
  presetId: PlanPresetId,
  hostMemoryTotalBytes?: number | null,
): HostResourceProvisionParams {
  const host = hostMemoryTotalBytes != null && hostMemoryTotalBytes > 0 ? hostMemoryTotalBytes : null
  const floors = host != null ? scaledHostFloors(host) : null

  switch (presetId) {
    case 'dev-machine': {
      // Headroom for the IDE is the budget cap vs host total — not idle remainder inside the budget.
      const next: HostResourceProvisionParams = {
        ...current,
        maxRamBytes: suggestedSharedDesktopCapBytes(host),
        reservePercent: 20,
        reserveMinBytes: floors?.reserveMinBytes ?? 1 * GIB,
        shmMinBytes: floors?.shmMinBytes ?? 1 * GIB,
        shmMaxPercentOfBudget: 100,
      }
      return host != null ? fitParamsToHost(next, host) : next
    }
    case 'prod-vps': {
      const next: HostResourceProvisionParams = {
        ...current,
        maxRamBytes: null,
        reservePercent: 8,
        reserveMinBytes:
          host != null && host >= 16 * GIB
            ? 1 * GIB
            : (floors?.reserveMinBytes ?? 512 * MIB),
        shmMinBytes:
          host != null && host >= 16 * GIB
            ? 4 * GIB
            : host != null && host >= 8 * GIB
              ? 2 * GIB
              : (floors?.shmMinBytes ?? 1 * GIB),
        shmMaxPercentOfBudget: 100,
        raiseUlimits: true,
      }
      return host != null ? fitParamsToHost(next, host) : next
    }
    case 'balanced': {
      const next: HostResourceProvisionParams = {
        ...current,
        maxRamBytes: null,
        reservePercent: 15,
        reserveMinBytes: floors?.reserveMinBytes ?? 1 * GIB,
        shmMinBytes: floors?.shmMinBytes ?? 1 * GIB,
        shmMaxPercentOfBudget: 100,
      }
      return host != null ? fitParamsToHost(next, host) : next
    }
    default:
      return current
  }
}

export function ramGibChips(hostMemoryTotalBytes?: number | null): number[] {
  if (hostMemoryTotalBytes == null || hostMemoryTotalBytes <= 0) {
    return [...RAM_GIB_CHIP_CANDIDATES]
  }
  const hostGib = hostMemoryTotalBytes / GIB
  return RAM_GIB_CHIP_CANDIDATES.filter((gib) => gib < hostGib - 0.05)
}

/**
 * Client estimate matching `HostResourceCalculator.Compute` when host memory is known.
 * Authoritative plan still comes from POST preview on Review.
 */
export function estimatePlan(
  parameters: HostResourceProvisionParams,
  hostMemoryTotalBytes: number,
): EstimatedPlan | null {
  if (!Number.isFinite(hostMemoryTotalBytes) || hostMemoryTotalBytes <= 0) return null

  const reservePercent = parameters.reservePercent ?? DEFAULT_PARAMS.reservePercent!
  const reserveMinBytes = parameters.reserveMinBytes ?? DEFAULT_PARAMS.reserveMinBytes!
  const shmMinBytes = parameters.shmMinBytes ?? DEFAULT_PARAMS.shmMinBytes!
  const shmMaxPercent = parameters.shmMaxPercentOfBudget ?? DEFAULT_PARAMS.shmMaxPercentOfBudget!

  let budget =
    parameters.maxRamBytes != null && parameters.maxRamBytes > 0
      ? Math.min(hostMemoryTotalBytes, parameters.maxRamBytes)
      : hostMemoryTotalBytes
  budget = Math.max(0, budget)

  const reserveFromPercent = Math.ceil(budget * (reservePercent / 100))
  let reserve = Math.max(reserveMinBytes, reserveFromPercent)
  if (reserve > budget) reserve = budget

  const raw = Math.max(0, budget - reserve)
  const cap = Math.floor(budget * (shmMaxPercent / 100))
  const upper = Math.max(shmMinBytes, cap)
  const shmTarget = Math.min(Math.max(raw, shmMinBytes), upper)

  return {
    budgetBytes: budget,
    reserveBytes: reserve,
    shmTargetBytes: shmTarget,
    availableForShmBytes: Math.max(0, budget - reserve),
  }
}

export function validateParams(parameters: HostResourceProvisionParams): string | null {
  if (parameters.maxRamBytes != null && parameters.maxRamBytes <= 0) {
    return 'RAM budget cap must be greater than 0 when set.'
  }
  const reservePercent = parameters.reservePercent ?? DEFAULT_PARAMS.reservePercent!
  if (reservePercent < 0 || reservePercent > 90) {
    return 'Memory reserve must be between 0% and 90%.'
  }
  const shmMax = parameters.shmMaxPercentOfBudget ?? DEFAULT_PARAMS.shmMaxPercentOfBudget!
  if (shmMax <= 0 || shmMax > 100) {
    return 'Shared memory cap must be between 0% (exclusive) and 100%.'
  }
  if ((parameters.reserveMinBytes ?? 0) < 0) {
    return 'Minimum reserve must be ≥ 0.'
  }
  if ((parameters.shmMinBytes ?? 0) <= 0) {
    return 'Minimum shared memory must be greater than 0.'
  }
  if (parameters.raiseUlimits ?? true) {
    if ((parameters.nofile ?? 0) < 1024) {
      return 'Open-file limit must be ≥ 1024 when raising process limits.'
    }
    if ((parameters.nproc ?? 0) < 256) {
      return 'Process limit must be ≥ 256 when raising process limits.'
    }
  }
  return null
}

export function validateAgainstHost(
  parameters: HostResourceProvisionParams,
  hostMemoryTotalBytes?: number | null,
): string | null {
  const paramError = validateParams(parameters)
  if (paramError) return paramError
  if (hostMemoryTotalBytes == null || hostMemoryTotalBytes <= 0) return null

  const estimate = estimatePlan(parameters, hostMemoryTotalBytes)
  if (!estimate) return null
  const shmMin = parameters.shmMinBytes ?? DEFAULT_PARAMS.shmMinBytes!
  if (estimate.availableForShmBytes < shmMin) {
    return (
      `Planning uses host RAM total (${formatGibLabel(hostMemoryTotalBytes)}), not free RAM right now ` +
      `(the engine already holds memory). After keeping ${formatGibLabel(estimate.reserveBytes)} for the OS, ` +
      `${formatGibLabel(estimate.availableForShmBytes)} remains for shared memory, but the minimum is ` +
      `${formatGibLabel(shmMin)}. Lower the reserve, lower the shm minimum, or pick Production VPS / Dev machine.`
    )
  }
  return null
}

export function describeLastApply(last?: HostResourceLastApplySnapshot | null): string | null {
  if (!last) return null
  if (typeof last.appliedAtUtc !== 'string') return 'A resource plan was applied previously.'
  const parsed = new Date(last.appliedAtUtc)
  const when = Number.isNaN(parsed.valueOf()) ? last.appliedAtUtc : parsed.toLocaleString()
  const shm =
    last.shmAppliedBytes != null ? ` Shared memory applied: ${formatGibLabel(last.shmAppliedBytes)}.` : ''
  return `Last applied: ${when}.${shm}`
}

export function isShmBelowFloor(
  sidecarShmBytes?: number | null,
  shmMinBytes?: number | null,
): boolean {
  if (sidecarShmBytes == null || shmMinBytes == null) return false
  return sidecarShmBytes < shmMinBytes
}

export function memoryUsePercent(
  totalBytes?: number | null,
  availableBytes?: number | null,
): number | null {
  if (totalBytes == null || availableBytes == null || totalBytes <= 0) return null
  return (1 - availableBytes / totalBytes) * 100
}

export function diskUsePercent(
  totalBytes?: number | null,
  freeBytes?: number | null,
): number | null {
  if (totalBytes == null || freeBytes == null || totalBytes <= 0) return null
  return (1 - freeBytes / totalBytes) * 100
}

export function planBreakdownPercents(plan: {
  budgetBytes: number
  reserveBytes: number
  shmTargetBytes: number
}): { reservePct: number; shmPct: number; remainderPct: number } {
  const budget = Math.max(1, plan.budgetBytes)
  const reservePct = (plan.reserveBytes / budget) * 100
  const shmPct = (plan.shmTargetBytes / budget) * 100
  const remainderPct = Math.max(0, 100 - reservePct - shmPct)
  return { reservePct, shmPct, remainderPct }
}

/** Operator-facing recipe for the live estimate (GiB labels, no API jargon). */
export function describePlanRecipe(
  estimate: EstimatedPlan,
  hostMemoryTotalBytes: number,
): string {
  const capped =
    estimate.budgetBytes + GIB * 0.05 < hostMemoryTotalBytes
      ? `capped at ${formatGibLabel(estimate.budgetBytes)} of the ${formatGibLabel(hostMemoryTotalBytes)} host`
      : `the full ${formatGibLabel(estimate.budgetBytes)} host`
  if (estimate.availableForShmBytes <= 0) {
    return `Speculum plans against ${capped}, but the host reserve currently consumes the whole budget. Lower the reserve percent or the minimum reserve so shared memory can fit.`
  }
  return `Speculum plans against ${capped} (host total — not free RAM). It keeps ${formatGibLabel(estimate.reserveBytes)} for the operating system, then targets ${formatGibLabel(estimate.shmTargetBytes)} of shared memory for browser sessions.`
}

/** True when `current` is not represented by any chip (within a small GiB/percent epsilon). */
export function isCustomChipValue(
  current: number,
  chips: readonly number[],
  epsilon = 0.05,
): boolean {
  return !chips.some((chip) => Math.abs(chip - current) < epsilon)
}
