/** Phase 2 must not apply these as navigation on a nested-context host. */
export function isNestedHostNavAttr(name: string): boolean {
  const n = name.toLowerCase();
  return n === 'src' || n === 'srcdoc';
}

export function isNestedHostSandboxAttr(name: string): boolean {
  return name.toLowerCase() === 'sandbox';
}

/**
 * Effective sandbox token set for a nested host: drop `allow-scripts` (K5 is CSP meta),
 * require `allow-same-origin` so the parent can read the stamped srcdoc.
 * `null` = no sandbox attribute.
 */
export function nestedHostSandboxAttrValue(raw: string | null): string | null {
  if (raw === null) return null;
  const tokens = raw
    .split(/\s+/)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0 && t !== 'allow-scripts');
  if (!tokens.includes('allow-same-origin')) {
    tokens.push('allow-same-origin');
  }
  return tokens.join(' ');
}

function sandboxTokenSet(raw: string): Set<string> {
  const value = nestedHostSandboxAttrValue(raw);
  if (value === null || value.length === 0) return new Set(['allow-same-origin']);
  return new Set(value.split(' ').filter((t) => t.length > 0));
}

function sandboxSetsEqual(a: string | null, b: string | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  const sa = sandboxTokenSet(a);
  const sb = sandboxTokenSet(b);
  if (sa.size !== sb.size) return false;
  for (const t of sa) {
    if (!sb.has(t)) return false;
  }
  return true;
}

/**
 * Write replicated sandbox only when the effective token set changes, or when
 * `allow-scripts` is still on the live attribute (must strip — K5 is CSP meta).
 * `setAttribute('sandbox')` after srcdoc orphans the browsing context — a no-op write
 * is a product defect (waiter stays on the dead document).
 * Returns true when the live attribute was written (caller must reincarnate srcdoc).
 */
export function applyNestedHostSandboxAttr(
  iframe: HTMLIFrameElement,
  raw: string | null,
): boolean {
  const current = iframe.getAttribute('sandbox');
  const next = nestedHostSandboxAttrValue(raw);
  if (next === null) {
    if (current === null) return false;
    iframe.removeAttribute('sandbox');
    return true;
  }
  if (current === next) return false;
  if (current !== null) {
    const liveTokens = current
      .split(/\s+/)
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length > 0);
    if (
      !liveTokens.includes('allow-scripts')
      && liveTokens.includes('allow-same-origin')
      && sandboxSetsEqual(current, next)
    ) {
      return false;
    }
  }
  iframe.setAttribute('sandbox', next);
  return true;
}

/**
 * K4 establish requires the parent to read the stamped srcdoc (`contentDocument`).
 * A replicated `sandbox` without `allow-same-origin` makes the nested doc opaque — the skeleton
 * waiter times out (`projected_standards_ready_timeout`). K5 stays CSP meta; never add
 * `allow-scripts` here.
 *
 * Idempotent: does not rewrite an already-effective sandbox (would orphan after srcdoc).
 * Returns whether the attribute was written.
 */
export function ensureNestedHostSandboxAccess(iframe: HTMLIFrameElement): boolean {
  if (iframe.localName.toLowerCase() !== 'iframe') return false;
  const raw = iframe.getAttribute('sandbox');
  if (raw === null) return false;
  return applyNestedHostSandboxAttr(iframe, raw);
}
