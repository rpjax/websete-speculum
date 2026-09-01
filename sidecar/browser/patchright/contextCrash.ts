/**
 * Context 'close' decision for PatchrightBrowserSession.
 * Stale listeners (prior recreate/stop) and intentional teardown must not crash the session.
 */
export function shouldEmitContextCrash(args: {
  listenerEpoch: number;
  currentEpoch: number;
  suppress: boolean;
}): boolean {
  if (args.listenerEpoch !== args.currentEpoch) return false;
  if (args.suppress) return false;
  return true;
}
