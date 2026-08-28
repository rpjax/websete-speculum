"use strict";
/**
 * Env-gated CSP / data-plane diagnostics (lab only).
 * Set SPECULUM_DIAG_CSP=1 — stderr + optional observe-only page probe.
 * Page probe must never open a page-origin WebSocket (LNA / EP-15).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.cspDiagLog = cspDiagLog;
exports.isCspDiagEnabled = isCspDiagEnabled;
const ENABLED = process.env.SPECULUM_DIAG_CSP === '1';
function cspDiagLog(message, detail) {
    if (!ENABLED)
        return;
    const suffix = detail ? ` ${JSON.stringify(detail)}` : '';
    process.stderr.write(`[speculum-csp-diag] ${message}${suffix}\n`);
}
function isCspDiagEnabled() {
    return ENABLED;
}
//# sourceMappingURL=cspDiag.js.map