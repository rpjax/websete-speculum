/**
 * Lab behind ngrok — public browser origin vs local loopback for Virtual Chrome.
 * Virtual navigates fixtures on localOrigin (same machine); clients may use ngrok.
 */

import type { IncomingHttpHeaders } from 'node:http';

export const NGROK_SKIP_BROWSER_WARNING = 'ngrok-skip-browser-warning';

/** Header ngrok free tier accepts to skip the "Visit Site" interstitial. */
export const NGROK_SKIP_HEADERS: Readonly<Record<string, string>> = {
  [NGROK_SKIP_BROWSER_WARNING]: '1',
};

export function labLocalOrigin(host: string, port: number): string {
  return `http://${host}:${port}`;
}

export function resolveLabPublicOrigin(
  localOrigin: string,
  req?: { headers: IncomingHttpHeaders },
): string {
  const fromEnv = process.env.SPECULUM_LAB_PUBLIC_ORIGIN?.trim().replace(/\/+$/, '');
  if (fromEnv) return fromEnv;

  const forwardedHost = req?.headers['x-forwarded-host'];
  const hostRaw =
    (typeof forwardedHost === 'string' ? forwardedHost.split(',')[0] : req?.headers.host)?.trim() ?? '';
  if (!hostRaw) return localOrigin;

  const localHost = new URL(localOrigin).host;
  if (hostRaw === localHost) return localOrigin;

  const protoHdr = req?.headers['x-forwarded-proto'];
  const proto =
    (typeof protoHdr === 'string' ? protoHdr.split(',')[0]?.trim() : '') || 'http';
  return `${proto}://${hostRaw}`;
}

/** Same-machine Virtual must not fetch fixtures through ngrok (interstitial HTML). */
export function rewriteVirtualFixtureUrl(
  absoluteUrl: string,
  publicOrigin: string,
  localOrigin: string,
): string {
  try {
    const u = new URL(absoluteUrl);
    const pub = new URL(publicOrigin);
    const loc = new URL(localOrigin);
    if (u.origin === pub.origin && u.pathname.startsWith('/fixtures/')) {
      return `${loc.origin}${u.pathname}${u.search}`;
    }
  } catch {
    /* ignore */
  }
  return absoluteUrl;
}
