/**
 * Unsolicited `resync`-flagged frames (producer dump, not a client request) remount
 * Projected. Late-join is one snapshot per navigation; extras are reconnect dumps.
 * Client-asked recovery always applies.
 */
export function shouldApplyUnsolicitedResync(
  clientAsked: boolean,
  unsolicitedSwapsThisGeneration: number,
): boolean {
  if (clientAsked) return true;
  return unsolicitedSwapsThisGeneration < 1;
}
