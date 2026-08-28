/**
 * Env-gated CSP / data-plane diagnostics (lab only).
 * Set SPECULUM_DIAG_CSP=1 — logs to stderr (docker logs) with [speculum-csp-diag] prefix.
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

/** Runs in Virtual main frame after config pre-script — logs to page console (lab Console tab). */
export const CSP_DIAG_PROBE_INIT_SCRIPT = `
(function speculum_csp_diag_probe() {
  'use strict';
  try {
    var cfg = globalThis.__SPECULUM_PROJECTION__;
    var rt = globalThis.__speculumProjection;
    var ft = rt && rt.frameTransport;
    var sock = ft && ft.dataPlane && ft.dataPlane.socket;
    var hasCfg = !!(cfg && cfg.dataPlaneUrl);
    console.log('[speculum-csp-diag] probe document=' + location.href);
    console.log('[speculum-csp-diag] probe config=' + (hasCfg ? cfg.dataPlaneUrl : 'missing'));
    console.log('[speculum-csp-diag] probe runtime wsOpen=' + (ft ? ft.isOpen : 'no-runtime') + ' readyState=' + (sock ? sock.readyState : 'no-socket'));
    var meta = document.querySelector('meta[http-equiv="Content-Security-Policy" i]');
    console.log('[speculum-csp-diag] probe metaCsp=' + (meta ? 'present len=' + (meta.content || '').length : 'absent'));
    if (!hasCfg) return;
    var ws = new WebSocket(cfg.dataPlaneUrl);
    var done = false;
    var finish = function (tag) {
      if (done) return;
      done = true;
      console.log('[speculum-csp-diag] probe ws ' + tag);
      try { ws.close(); } catch (_) {}
    };
    var t = setTimeout(function () { finish('TIMEOUT'); }, 4000);
    ws.addEventListener('open', function () { clearTimeout(t); finish('OPEN'); });
    ws.addEventListener('error', function () { clearTimeout(t); finish('ERROR'); });
  } catch (e) {
    console.log('[speculum-csp-diag] probe throw ' + (e && e.message ? e.message : String(e)));
  }
})();
`;
