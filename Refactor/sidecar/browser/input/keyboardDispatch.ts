/**
 * Map wire `intent.key` / `intent.code` to Playwright `keyboard.down/up` names.
 * Never trim `intent.key` — `' '` (Space) becomes empty after trim and was dropped silently.
 */

export function resolveKeyboardDispatchKey(
  key: string | undefined,
  code: string | undefined,
): string | null {
  if (key === ' ') return 'Space';
  if (key != null && key !== '') return key;
  const c = (code ?? '').trim();
  if (c) return c;
  return null;
}
