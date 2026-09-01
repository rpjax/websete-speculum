import type { BrowserSessionEvents } from '../BrowserSession';
import type { UrlResolver } from './urlResolver';
import { projectOutboundUrl } from './urlResolver';

/**
 * Wraps location notifications with sidecar ProjectToClient (M1).
 * Uses a Proxy so class-backed sinks (e.g. EventBridge) keep prototype methods
 * such as onPageProjectionFrame — object spread would drop them.
 */
export function wrapBrowserSessionEvents(
  events: BrowserSessionEvents,
  resolver: UrlResolver | null,
): BrowserSessionEvents {
  if (!resolver) {
    return events;
  }

  return new Proxy(events, {
    get(target, prop, receiver) {
      if (prop === 'onLocationChanged') {
        return (url: string) => {
          const projected = projectOutboundUrl(resolver, url);
          if (projected) {
            target.onLocationChanged(projected);
          }
        };
      }

      if (prop === 'onMainFrameNavigationBlocked') {
        return (url: string) => {
          // Allowlist blocks are external hosts — passthrough (no rewrite per M1 rule).
          target.onMainFrameNavigationBlocked(url);
        };
      }

      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
