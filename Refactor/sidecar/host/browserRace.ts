/**
 * Patchright races that must not kill the sidecar process.
 * Keep this narrow — "protocol error" and friends are real faults.
 */
export function isBenignBrowserRace(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? '');
  return /frame was detached|target closed|has been closed/i.test(message);
}
