/**
 * Unified launch budget — sub-deadlines are fractions of one budget, not independent sums.
 *
 * Default 25s is an initial guess (replacing the old 27s sum of independent sub-deadlines).
 * Calibrate via `npm run lab:document-churn-x10` histogram; override with SPECULUM_LAUNCH_BUDGET_MS.
 */

export const LAUNCH_BUDGET_MS = 25_000;

export function resolveLaunchBudgetMs(): number {
  const raw = process.env.SPECULUM_LAUNCH_BUDGET_MS;
  if (raw === undefined || raw === '') return LAUNCH_BUDGET_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : LAUNCH_BUDGET_MS;
}

export type LaunchSubPhase =
  | 'C2Connect'
  | 'SessionAck'
  | 'ConfigGate'
  | 'InitContext'
  | 'HelloEstablish';

/** Cumulative deadline offsets from budget start (ms). */
const SUB_PHASE_FRACTIONS: Record<LaunchSubPhase, number> = {
  C2Connect: 0.4,
  SessionAck: 0.6,
  ConfigGate: 0.68,
  InitContext: 0.8,
  HelloEstablish: 1,
};

/** Config gate slice — shared with extension SessionConfig (not an independent 2s guillotine). */
export function configGateTimeoutMs(budgetMs = LAUNCH_BUDGET_MS): number {
  return Math.max(1, Math.floor(budgetMs * SUB_PHASE_FRACTIONS.ConfigGate));
}

export function initContextTimeoutMs(budgetMs = LAUNCH_BUDGET_MS): number {
  return Math.max(1, Math.floor(budgetMs * SUB_PHASE_FRACTIONS.InitContext));
}

export class LaunchBudget {
  readonly startedAtMs: number;
  readonly budgetMs: number;

  constructor(budgetMs = LAUNCH_BUDGET_MS, startedAtMs = Date.now()) {
    this.budgetMs = budgetMs;
    this.startedAtMs = startedAtMs;
  }

  elapsedMs(now = Date.now()): number {
    return Math.max(0, now - this.startedAtMs);
  }

  remainingMs(now = Date.now()): number {
    return Math.max(0, this.budgetMs - this.elapsedMs(now));
  }

  /** Timeout for a sub-phase — min of phase slice and remaining budget. */
  deadlineMs(phase: LaunchSubPhase, now = Date.now()): number {
    const phaseEnd = this.budgetMs * SUB_PHASE_FRACTIONS[phase];
    const remaining = this.remainingMs(now);
    const untilPhaseEnd = Math.max(0, phaseEnd - this.elapsedMs(now));
    return Math.max(1, Math.min(remaining, untilPhaseEnd));
  }

  isExpired(now = Date.now()): boolean {
    return this.remainingMs(now) <= 0;
  }
}

export function mapBootReasonToErrorCode(reason: string): string {
  switch (reason) {
    case 'config_gate_timeout':
      return 'config_gate_timeout';
    case 'init_context_timeout':
      return 'init_context_timeout';
    case 'nested_host_mint_pending':
      return 'init_context_timeout';
    case 'bfcache_init_context_timeout':
      return 'init_context_timeout';
    case 'bootstrap_throw':
      return 'boot_failed';
    case 'established':
      return 'established';
    default:
      return reason || 'boot_failed';
  }
}
