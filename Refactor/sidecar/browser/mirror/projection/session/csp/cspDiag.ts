/**
 * Env-gated CSP / data-plane diagnostics (lab only).
 * Set SPECULUM_DIAG_CSP=1 — stderr + optional observe-only page probe.
 * Page probe must never open a page-origin WebSocket (LNA / EP-15).
 */

const ENABLED = process.env.SPECULUM_DIAG_CSP === '1';

export function cspDiagLog(message: string, detail?: Record<string, unknown>): void {
  if (!ENABLED) return;
  const suffix = detail ? ` ${JSON.stringify(detail)}` : '';
  process.stderr.write(`[speculum-csp-diag] ${message}${suffix}\n`);
}

export function isCspDiagEnabled(): boolean {
  return ENABLED;
}
