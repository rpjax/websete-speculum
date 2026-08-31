import type { BrowserUrlMatchRule } from '../BrowserSession';
import { domainMatches, pathMatches } from '../patchright/Navigation';
import type { NavigationPolicy, UrlResolveResult } from './navigationPolicy';

interface NavigationState {
  host: string;
}

/**
 * Sidecar URL resolution — Resolve (client → upstream) and ProjectToClient (upstream → client).
 * Config is immutable {@link NavigationPolicy} injected at Launch (motor-migration.md M1).
 */
export class UrlResolver {
  private readonly policy: NavigationPolicy;
  private readonly nsoParam: string;

  constructor(policy: NavigationPolicy) {
    this.policy = policy;
    this.nsoParam = policy.navigationStateParam.trim() || '_w7s_nso';
  }

  resolve(path: string, query: string, requestHost?: string): UrlResolveResult {
    const hostResult = tryNormalizeRequestHost(requestHost ?? this.policy.requestHost);
    if (!hostResult.ok) {
      return { ok: false, errors: ['Request host is invalid'] };
    }
    const clientHost = hostResult.value;

    if (!path || path[0] !== '/' || path.includes('?')) {
      return { ok: false, errors: ['Navigation path must be absolute and contain no query'] };
    }

    const defaultTargetHost = this.policy.defaultTargetHost.trim().toLowerCase();
    if (!isValidHost(defaultTargetHost)) {
      return { ok: false, errors: ['Navigation.DefaultTargetHost is invalid'] };
    }

    const navigationState = tryExtractNavigationState(query, this.nsoParam);
    if (!navigationState.ok) {
      return { ok: false, errors: navigationState.errors };
    }

    const targetHost = resolveTargetHost(
      clientHost,
      defaultTargetHost,
      this.policy.domains,
      this.policy.allowedMainFrameUrls,
      navigationState.value,
      path,
    );
    if (!targetHost.ok) {
      return targetHost;
    }

    const targetQuery = stripNavigationState(query, this.nsoParam);
    const uri = new URL('https://placeholder.test');
    uri.protocol = 'https:';
    uri.hostname = targetHost.value;
    uri.pathname = path;
    uri.search = targetQuery ? `?${targetQuery}` : '';
    return { ok: true, value: uri.href };
  }

  projectToClient(targetUrl: string, requestHost?: string): UrlResolveResult {
    const hostResult = tryNormalizeRequestHost(requestHost ?? this.policy.requestHost);
    if (!hostResult.ok) {
      return { ok: false, errors: ['Request host is invalid'] };
    }
    const clientHost = hostResult.value;

    let targetUri: URL;
    try {
      targetUri = new URL(targetUrl);
    } catch {
      return { ok: false, errors: ['Target URL must be absolute http(s)'] };
    }
    if (targetUri.protocol !== 'http:' && targetUri.protocol !== 'https:') {
      return { ok: false, errors: ['Target URL must be absolute http(s)'] };
    }
    if (!targetUri.hostname.trim()) {
      return { ok: false, errors: ['Target URL must be absolute http(s)'] };
    }

    const defaultTargetHost = this.policy.defaultTargetHost.trim().toLowerCase();
    if (!isValidHost(defaultTargetHost)) {
      return { ok: false, errors: ['Navigation.DefaultTargetHost is invalid'] };
    }

    const targetHost = targetUri.hostname.toLowerCase();
    const allowedUrls = this.policy.allowedMainFrameUrls;

    for (const profile of this.policy.domains) {
      const sessionDomain = profile.domain.trim().toLowerCase();
      if (!isValidHost(sessionDomain)) {
        continue;
      }
      if (!isRequestOnSessionDomain(clientHost, sessionDomain)) {
        continue;
      }

      if (profile.isSubdomainMirroringEnabled) {
        return projectMirroredToClient(
          targetUri,
          targetHost,
          sessionDomain,
          defaultTargetHost,
          allowedUrls,
        );
      }

      const sessionHost = resolveSessionHostForRequest(clientHost, sessionDomain);
      return projectApexToClient(
        targetUri,
        targetHost,
        sessionHost,
        defaultTargetHost,
        allowedUrls,
        this.nsoParam,
      );
    }

    return projectApexToClient(
      targetUri,
      targetHost,
      clientHost,
      defaultTargetHost,
      allowedUrls,
      this.nsoParam,
    );
  }
}

function isRequestOnSessionDomain(requestHost: string, sessionDomain: string): boolean {
  if (requestHost === sessionDomain || requestHost === `www.${sessionDomain}`) {
    return true;
  }
  const suffix = `.${sessionDomain}`;
  return requestHost.endsWith(suffix) && requestHost.length > suffix.length;
}

function resolveSessionHostForRequest(requestHost: string, sessionDomain: string): string {
  return requestHost === `www.${sessionDomain}` ? requestHost : sessionDomain;
}

function projectMirroredToClient(
  targetUri: URL,
  targetHost: string,
  sessionDomain: string,
  defaultTargetHost: string,
  allowedUrls: readonly BrowserUrlMatchRule[],
): UrlResolveResult {
  const apexResult = tryGetTargetApex(defaultTargetHost, allowedUrls);
  if (!apexResult.ok) {
    return {
      ok: false,
      errors: ['Navigation.AllowedMainFrameUrls must define the target apex for subdomain mirroring'],
    };
  }
  const targetApex = apexResult.value;

  let clientHost: string;
  if (targetHost === targetApex || targetHost === defaultTargetHost) {
    if (
      targetHost === defaultTargetHost
      && defaultTargetHost !== targetApex
      && defaultTargetHost.endsWith(`.${targetApex}`)
    ) {
      const sub = defaultTargetHost.slice(0, -(targetApex.length + 1));
      clientHost = sub.length === 0 ? sessionDomain : `${sub}.${sessionDomain}`;
    } else {
      clientHost = sessionDomain;
    }
  } else if (targetHost.endsWith(`.${targetApex}`)) {
    const sub = targetHost.slice(0, -(targetApex.length + 1));
    clientHost = sub.length === 0 ? sessionDomain : `${sub}.${sessionDomain}`;
  } else {
    return { ok: false, errors: ['Target host is outside the mirrored apex'] };
  }

  const out = new URL('https://placeholder.test');
  out.protocol = 'https:';
  out.hostname = clientHost;
  out.pathname = targetUri.pathname;
  out.search = targetUri.search;
  return { ok: true, value: out.href };
}

function projectApexToClient(
  targetUri: URL,
  targetHost: string,
  sessionHost: string,
  defaultTargetHost: string,
  allowedUrls: readonly BrowserUrlMatchRule[],
  nsoParam: string,
): UrlResolveResult {
  const stateHost = buildNavigationStateHost(
    targetHost,
    targetUri.pathname,
    defaultTargetHost,
    allowedUrls,
  );
  if (!stateHost.ok) {
    return stateHost;
  }

  const siteQuery = stripNavigationState(targetUri.search.replace(/^\?/, ''), nsoParam);
  const nso = encodeNavigationState(stateHost.value);
  const query = siteQuery.length === 0
    ? `${nsoParam}=${nso}`
    : `${siteQuery}&${nsoParam}=${nso}`;

  const out = new URL('https://placeholder.test');
  out.protocol = 'https:';
  out.hostname = sessionHost;
  out.pathname = targetUri.pathname;
  out.search = query ? `?${query}` : '';
  return { ok: true, value: out.href };
}

function buildNavigationStateHost(
  targetHost: string,
  path: string,
  defaultTargetHost: string,
  allowedUrls: readonly BrowserUrlMatchRule[],
): UrlResolveResult {
  if (targetHost === defaultTargetHost) {
    return { ok: true, value: '' };
  }

  const apexResult = tryGetTargetApex(defaultTargetHost, allowedUrls);
  if (!apexResult.ok) {
    if (isAllowedTarget(targetHost, path, defaultTargetHost, allowedUrls)) {
      return { ok: true, value: targetHost };
    }
    return {
      ok: false,
      errors: ['Navigation.AllowedMainFrameUrls must define the target apex for navigation state'],
    };
  }
  const apex = apexResult.value;

  if (targetHost === apex) {
    return { ok: true, value: '' };
  }

  const suffix = `.${apex}`;
  if (targetHost.endsWith(suffix)) {
    return { ok: true, value: targetHost.slice(0, -suffix.length) };
  }

  if (isAllowedTarget(targetHost, path, defaultTargetHost, allowedUrls)) {
    return { ok: true, value: targetHost };
  }

  return { ok: false, errors: ['Target host is not allowlisted for SyncUrl projection'] };
}

function encodeNavigationState(host: string): string {
  const json = JSON.stringify({ v: 1, h: host });
  return encodeURIComponent(Buffer.from(json, 'utf8').toString('base64'));
}

function resolveTargetHost(
  requestHost: string,
  defaultTargetHost: string,
  hostingDomains: readonly { domain: string; isSubdomainMirroringEnabled: boolean }[],
  allowedUrls: readonly BrowserUrlMatchRule[],
  navigationState: NavigationState | null,
  path: string,
): UrlResolveResult {
  for (const profile of hostingDomains) {
    const sessionDomain = profile.domain.trim().toLowerCase();
    if (!isValidHost(sessionDomain)) {
      continue;
    }

    const isApex = requestHost === sessionDomain;
    const isWww = requestHost === `www.${sessionDomain}`;
    const suffix = `.${sessionDomain}`;
    const isSubdomain = requestHost.endsWith(suffix) && requestHost.length > suffix.length;

    if (profile.isSubdomainMirroringEnabled) {
      if (isApex) {
        return isAllowedTarget(defaultTargetHost, path, defaultTargetHost, allowedUrls)
          ? { ok: true, value: defaultTargetHost }
          : { ok: false, errors: ['Target path is not allowed'] };
      }

      if (isWww || isSubdomain) {
        const subdomain = isWww ? 'www' : requestHost.slice(0, -suffix.length);
        return resolveMirroredTarget(subdomain, defaultTargetHost, allowedUrls, path);
      }

      continue;
    }

    if (isApex || isWww) {
      return resolveApexTarget(defaultTargetHost, allowedUrls, navigationState, path);
    }
  }

  return resolveApexTarget(defaultTargetHost, allowedUrls, navigationState, path);
}

function resolveMirroredTarget(
  subdomain: string,
  defaultTargetHost: string,
  allowedUrls: readonly BrowserUrlMatchRule[],
  path: string,
): UrlResolveResult {
  const apexResult = tryGetTargetApex(defaultTargetHost, allowedUrls);
  if (!apexResult.ok) {
    return {
      ok: false,
      errors: ['Navigation.AllowedMainFrameUrls must define the target apex for subdomain mirroring'],
    };
  }
  const candidate = `${subdomain}.${apexResult.value}`;
  return isAllowedTarget(candidate, path, defaultTargetHost, allowedUrls)
    ? { ok: true, value: candidate }
    : { ok: false, errors: ['Mirrored target host or path is not allowed'] };
}

function resolveApexTarget(
  defaultTargetHost: string,
  allowedUrls: readonly BrowserUrlMatchRule[],
  navigationState: NavigationState | null,
  path: string,
): UrlResolveResult {
  const stateHost = navigationState?.host.trim().toLowerCase() ?? '';
  if (stateHost.length === 0) {
    return isAllowedTarget(defaultTargetHost, path, defaultTargetHost, allowedUrls)
      ? { ok: true, value: defaultTargetHost }
      : { ok: false, errors: ['Target path is not allowed'] };
  }

  let candidate: string;
  if (stateHost.includes('.')) {
    candidate = stateHost;
  } else {
    const apexResult = tryGetTargetApex(defaultTargetHost, allowedUrls);
    if (!apexResult.ok) {
      return {
        ok: false,
        errors: ['Navigation.AllowedMainFrameUrls must define the target apex for navigation state'],
      };
    }
    candidate = `${stateHost}.${apexResult.value}`;
  }

  return isValidHost(candidate)
    && isAllowedTarget(candidate, path, defaultTargetHost, allowedUrls)
    ? { ok: true, value: candidate }
    : { ok: false, errors: ['Navigation state target host or path is invalid or not allowed'] };
}

function stripNavigationState(query: string, nsoParam: string): string {
  if (!query.trim()) {
    return '';
  }
  return query
    .trim()
    .replace(/^\?/, '')
    .split('&')
    .filter((part) => part.length > 0 && !part.startsWith(`${nsoParam}=`))
    .join('&');
}

function tryExtractNavigationState(
  query: string,
  nsoParam: string,
): { ok: true; value: NavigationState | null } | { ok: false; errors: string[] } {
  for (const part of query.trim().replace(/^\?/, '').split('&')) {
    if (!part.startsWith(`${nsoParam}=`)) {
      continue;
    }
    const encoded = part.slice(nsoParam.length + 1);
    if (!encoded.trim()) {
      return { ok: false, errors: ['Navigation state is empty'] };
    }
    try {
      const json = Buffer.from(decodeURIComponent(encoded), 'base64').toString('utf8');
      const root = JSON.parse(json) as { v?: unknown; h?: unknown };
      if (
        typeof root.v !== 'number'
        || root.v !== 1
        || typeof root.h !== 'string'
      ) {
        return { ok: false, errors: ['Navigation state is invalid'] };
      }
      return { ok: true, value: { host: root.h } };
    } catch {
      return { ok: false, errors: ['Navigation state is invalid'] };
    }
  }
  return { ok: true, value: null };
}

function tryGetTargetApex(
  defaultTargetHost: string,
  allowedUrls: readonly BrowserUrlMatchRule[],
): { ok: true; value: string } | { ok: false } {
  const candidates: string[] = [];
  for (const rule of allowedUrls) {
    const candidate = tryGetConfiguredApex(rule.domain);
    if (!candidate) {
      continue;
    }
    if (
      defaultTargetHost === candidate
      || defaultTargetHost.endsWith(`.${candidate}`)
    ) {
      candidates.push(candidate);
    }
  }

  candidates.sort((a, b) => {
    const dotsA = (a.match(/\./g) ?? []).length;
    const dotsB = (b.match(/\./g) ?? []).length;
    if (dotsA !== dotsB) return dotsA - dotsB;
    return a.length - b.length;
  });

  const apex = candidates[0] ?? '';
  return apex.length > 0 ? { ok: true, value: apex } : { ok: false };
}

function tryGetConfiguredApex(domain: BrowserUrlMatchRule['domain']): string | null {
  const scope = normalizeScope(domain.scope);
  if (scope !== 'Pattern' || !domain.labels?.length) {
    return null;
  }

  const labels = domain.labels;
  const start = normalizeMatch(labels[0]?.match) === 'Any' ? 1 : 0;
  if (
    start === labels.length
    || labels.slice(start).some(
      (label) => normalizeMatch(label.match) !== 'Exact' || !(label.value ?? '').trim(),
    )
  ) {
    return null;
  }

  const host = labels
    .slice(start)
    .map((label) => label.value.trim().toLowerCase())
    .join('.');
  return isValidHost(host) ? host : null;
}

function isAllowedTarget(
  host: string,
  path: string,
  defaultTargetHost: string,
  allowedUrls: readonly BrowserUrlMatchRule[],
): boolean {
  if (allowedUrls.some((rule) => ruleMatches(rule, host, path))) {
    return true;
  }

  if (host.toLowerCase() !== defaultTargetHost.toLowerCase()) {
    return false;
  }

  return !allowedUrls.some(
    (rule) =>
      normalizeScope(rule.path.scope) === 'Pattern'
      && (normalizeScope(rule.domain.scope) === 'Any' || domainMatches(rule.domain, host)),
  );
}

function ruleMatches(rule: BrowserUrlMatchRule, host: string, path: string): boolean {
  const domainOk = normalizeScope(rule.domain.scope) === 'Any' || domainMatches(rule.domain, host);
  return domainOk && pathMatches(rule.path, path);
}

function tryNormalizeRequestHost(
  requestHost: string,
): { ok: true; value: string } | { ok: false } {
  if (!requestHost.trim()) {
    return { ok: false };
  }
  try {
    const uri = new URL(`https://${requestHost.trim()}`);
    if (
      !uri.hostname
      || uri.pathname !== '/'
      || uri.search.length > 0
      || uri.hash.length > 0
      || uri.username.length > 0
      || uri.password.length > 0
    ) {
      return { ok: false };
    }
    return { ok: true, value: uri.hostname.toLowerCase() };
  } catch {
    return { ok: false };
  }
}

function isValidHost(host: string): boolean {
  try {
    const uri = new URL(`https://${host}`);
    return uri.hostname.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

function normalizeScope(value: string | undefined): string {
  const v = (value ?? '').trim().toLowerCase();
  if (v === 'any') return 'Any';
  if (v === 'pattern') return 'Pattern';
  return value ?? '';
}

function normalizeMatch(value: string | undefined): string {
  const v = (value ?? '').trim().toLowerCase();
  if (v === 'any') return 'Any';
  if (v === 'exact') return 'Exact';
  return value ?? '';
}

/** Passthrough when projection fails — motor-migration M1 outbound rule. */
export function projectOutboundUrl(resolver: UrlResolver | null, targetUrl: string): string | null {
  if (!resolver) {
    return targetUrl;
  }
  const projected = resolver.projectToClient(targetUrl);
  return projected.ok ? projected.value : null;
}
