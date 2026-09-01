/**
 * SEAL-DOM-P0-ATTR / PP-APPLY-2 — failed setAttribute must not be swallowed.
 * Injectable setter keeps this DOM-free for sidecar unit.ts (client/ is tsc-excluded).
 */

export function applyAttrPairs(
  setAttribute: (name: string, value: string) => void,
  attrs: readonly { name: string; value: string }[],
): boolean {
  for (let i = 0; i < attrs.length; i++) {
    const { name, value } = attrs[i]!;
    try {
      setAttribute(name, value);
    } catch {
      return false;
    }
  }
  return true;
}
