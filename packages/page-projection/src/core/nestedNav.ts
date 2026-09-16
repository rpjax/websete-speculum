/** Phase 2 must not apply these as navigation on a nested-context host. */
export function isNestedHostNavAttr(name: string): boolean {
  const n = name.toLowerCase();
  return n === 'src' || n === 'srcdoc';
}

/**
 * K4 establish requires the parent to read the stamped srcdoc (`contentDocument`).
 * A replicated `sandbox` without `allow-same-origin` makes the nested doc opaque — the skeleton
 * waiter times out (`projected_standards_ready_timeout`). K5 stays CSP meta; never add
 * `allow-scripts` here.
 */
export function ensureNestedHostSandboxAccess(iframe: HTMLIFrameElement): void {
  if (iframe.localName.toLowerCase() !== 'iframe') return;
  const raw = iframe.getAttribute('sandbox');
  if (raw === null) return;
  const tokens = raw
    .split(/\s+/)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0 && t !== 'allow-scripts');
  if (!tokens.includes('allow-same-origin')) {
    tokens.push('allow-same-origin');
  }
  iframe.setAttribute('sandbox', tokens.join(' '));
}
