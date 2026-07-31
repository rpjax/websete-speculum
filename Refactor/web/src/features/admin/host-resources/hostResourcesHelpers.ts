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

export type PlanPresetId = 'shared-desktop' | 'dedicated' | 'conservative-reserve' | 'aggressive-shm'

export type PlanPreset = {
  id: PlanPresetId
  label: string
  /** When to pick this posture. */
  description: string
  /** What the click changes in the plan knobs. */
  effect: string
}

export const DEFAULT_PARAMS: HostResourceProvisionParams = {
  maxRamBytes: null,
  reservePercent: 15,
  reserveMinBytes: 2 * GIB,
  shmMinBytes: 2 * GIB,
  shmMaxPercentOfBudget: 75,
  raiseUlimits: true,
  nofile: 1_048_576,
  nproc: 65_535,
}

export const PLAN_PRESETS: PlanPreset[] = [
  {
    id: 'shared-desktop',
    label: 'Shared desktop',
    description: 'This PC also runs your IDE, browser, and other apps.',
    effect: 'Caps the RAM budget so Speculum leaves room for everything else.',
  },
  {
    id: 'dedicated',
    label: 'Dedicated host',
    description: 'This machine is mostly Speculum.',
    effect: 'Plans against the full host RAM total (no budget cap).',
  },
  {
    id: 'conservative-reserve',
    label: 'Safer for the OS',
    description: 'You want a larger cushion for the operating system.',
    effect: 'Raises host reserve to 25% with a 4 GiB floor.',
  },
  {
    id: 'aggressive-shm',
    label: 'More session memory',
    description: 'You expect heavier or more concurrent browser sessions.',
    effect: 'Raises shared-memory floor to 4 GiB and the ceiling to 90%.',
  },
]

export const RESERVE_PERCENT_CHIPS = [10, 15, 20, 25, 30] as const
export const SHM_PERCENT_CHIPS = [50, 60, 75, 85, 90] as const
export const RAM_GIB_CHIP_CANDIDATES = [4, 8, 16, 24, 32, 48, 64] as const
export const RESERVE_MIN_GIB_CHIPS = [1, 2, 4, 8] as const
export const SHM_MIN_GIB_CHIPS = [1, 2, 4, 8] as const

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

/** Suggested RAM cap for a shared / multi-workload host (never exceeds host total). */
export function suggestedSharedDesktopCapBytes(hostMemoryTotalBytes?: number | null): number {
  const fallback = 8 * GIB
  if (hostMemoryTotalBytes == null || hostMemoryTotalBytes <= 0) return fallback
  if (hostMemoryTotalBytes <= 8 * GIB) {
    // Leave room for OS when the machine is already small.
    return Math.max(4 * GIB, Math.floor(hostMemoryTotalBytes / 2))
  }
  if (hostMemoryTotalBytes <= 16 * GIB) return 8 * GIB
  return 16 * GIB
}

/**
 * Merge a plan preset into current params without wiping process limits
 * unless the preset intentionally changes memory knobs only.
 */
export function applyPlanPreset(
  current: HostResourceProvisionParams,
  presetId: PlanPresetId,
  hostMemoryTotalBytes?: number | null,
): HostResourceProvisionParams {
  switch (presetId) {
    case 'shared-desktop':
      return {
        ...current,
        maxRamBytes: suggestedSharedDesktopCapBytes(hostMemoryTotalBytes),
      }
    case 'dedicated':
      return { ...current, maxRamBytes: null }
    case 'conservative-reserve':
      return {
        ...current,
        reservePercent: 25,
        reserveMinBytes: 4 * GIB,
      }
    case 'aggressive-shm':
      return {
        ...current,
        shmMinBytes: 4 * GIB,
        shmMaxPercentOfBudget: 90,
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
    return `Budget after reserve (${formatGibLabel(estimate.availableForShmBytes)}) is below the shared-memory minimum (${formatGibLabel(shmMin)}). Raise the RAM cap or lower the reserve.`
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
  return `Speculum plans against ${capped}. It keeps ${formatGibLabel(estimate.reserveBytes)} free for the operating system, then targets ${formatGibLabel(estimate.shmTargetBytes)} of shared memory for browser sessions.`
}

/** True when `current` is not represented by any chip (within a small GiB/percent epsilon). */
export function isCustomChipValue(
  current: number,
  chips: readonly number[],
  epsilon = 0.05,
): boolean {
  return !chips.some((chip) => Math.abs(chip - current) < epsilon)
}
