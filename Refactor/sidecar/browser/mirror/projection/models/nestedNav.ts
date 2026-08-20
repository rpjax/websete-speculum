/** Phase 2 must not apply these as navigation on a nested-context host. */
export function isNestedHostNavAttr(name: string): boolean {
  const n = name.toLowerCase();
  return n === 'src' || n === 'srcdoc';
}
