/**
 * Closed-mode ShadowRoot lookup — `element.shadowRoot` is null for closed roots.
 * Virtual capture (attachShadow hook) and Projected apply both register here.
 */

const closedByHost = new WeakMap<Element, ShadowRoot>();

export function registerClosedShadowRoot(host: Element, root: ShadowRoot): void {
  closedByHost.set(host, root);
}

export function lookupClosedShadowRoot(host: Element): ShadowRoot | null {
  return closedByHost.get(host) ?? null;
}

/** Open `.shadowRoot` or a registered closed root. */
export function resolveShadowRoot(host: Element): ShadowRoot | null {
  const open = host.shadowRoot;
  if (open !== null) return open;
  return lookupClosedShadowRoot(host);
}
