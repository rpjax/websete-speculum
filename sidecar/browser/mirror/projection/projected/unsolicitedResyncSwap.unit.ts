import { shouldApplyUnsolicitedResync } from '@speculum/page-projection/projected/resyncSwapPolicy';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

export function runUnsolicitedResyncSwapUnitTests(): void {
  assert(shouldApplyUnsolicitedResync(false, 0) === true, 'first unsolicited dump must swap');
  assert(shouldApplyUnsolicitedResync(false, 1) === false, 'second unsolicited dump must not remount');
  assert(shouldApplyUnsolicitedResync(true, 1) === true, 'client-asked recovery still applies after a dump');
  assert(shouldApplyUnsolicitedResync(true, 0) === true, 'client-asked recovery applies with empty cap');
  console.log('[unit] unsolicitedResyncSwap ok');
}
