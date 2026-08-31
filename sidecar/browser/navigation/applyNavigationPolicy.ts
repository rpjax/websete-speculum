import type { BrowserLaunchOptions, BrowserSessionEvents } from '../BrowserSession';
import type { NavigationPolicy } from './navigationPolicy';
import { navigationPolicyFromLaunch } from './navigationPolicy';
import { UrlResolver } from './urlResolver';
import { wrapBrowserSessionEvents } from './wrapSessionEvents';

export function applyNavigationPolicyAtLaunch(
  events: BrowserSessionEvents,
  options: BrowserLaunchOptions,
): { events: BrowserSessionEvents; urlResolver: UrlResolver | null } {
  const policy = options.navigationPolicy;
  if (!policy) {
    return { events, urlResolver: null };
  }
  const urlResolver = new UrlResolver(policy);
  return {
    events: wrapBrowserSessionEvents(events, urlResolver),
    urlResolver,
  };
}

export function navigationPolicyFromLaunchRequest(raw: unknown): NavigationPolicy | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }
  return navigationPolicyFromLaunch(raw as Parameters<typeof navigationPolicyFromLaunch>[0]);
}
