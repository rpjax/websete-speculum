import type { BrowserUrlMatchRule } from '../BrowserSession';

/** Immutable navigation policy injected at Launch (motor-migration.md M1). */
export interface NavigationPolicy {
  requestHost: string;
  defaultTargetHost: string;
  domains: readonly NavigationPolicyDomain[];
  allowedMainFrameUrls: readonly BrowserUrlMatchRule[];
  navigationStateParam: string;
}

export interface NavigationPolicyDomain {
  domain: string;
  isSubdomainMirroringEnabled: boolean;
}

export type UrlResolveResult =
  | { ok: true; value: string }
  | { ok: false; errors: string[] };

export function navigationPolicyFromLaunch(raw: {
  requestHost?: string;
  request_host?: string;
  defaultTargetHost?: string;
  default_target_host?: string;
  domains?: Array<{
    domain?: string;
    isSubdomainMirroringEnabled?: boolean;
    is_subdomain_mirroring_enabled?: boolean;
  }>;
  allowedMainFrameUrls?: unknown[];
  allowed_main_frame_urls?: unknown[];
  navigationStateParam?: string;
  navigation_state_param?: string;
}): NavigationPolicy | undefined {
  const requestHost = (raw.requestHost ?? raw.request_host ?? '').trim();
  const defaultTargetHost = (raw.defaultTargetHost ?? raw.default_target_host ?? '').trim();
  if (!requestHost || !defaultTargetHost) {
    return undefined;
  }

  const rulesRaw = raw.allowedMainFrameUrls ?? raw.allowed_main_frame_urls ?? [];
  const domainsRaw = raw.domains ?? [];

  return {
    requestHost,
    defaultTargetHost: defaultTargetHost.toLowerCase(),
    domains: domainsRaw.map((d) => ({
      domain: (d.domain ?? '').trim().toLowerCase(),
      isSubdomainMirroringEnabled:
        d.isSubdomainMirroringEnabled === true || d.is_subdomain_mirroring_enabled === true,
    })),
    allowedMainFrameUrls: rulesRaw.map(toBrowserUrlMatchRule),
    navigationStateParam:
      (raw.navigationStateParam ?? raw.navigation_state_param ?? '_w7s_nso').trim() || '_w7s_nso',
  };
}

function toBrowserUrlMatchRule(rule: unknown) {
  const r = rule as {
    domain?: { scope?: string; labels?: Array<{ match?: string; value?: string }> };
    path?: {
      scope?: string;
      matchType?: string;
      match_type?: string;
      segments?: Array<{ match?: string; value?: string }>;
    };
  };
  return {
    domain: {
      scope: String(r.domain?.scope ?? ''),
      labels: (r.domain?.labels ?? []).map((label) => ({
        match: String(label.match ?? ''),
        value: String(label.value ?? ''),
      })),
    },
    path: {
      scope: String(r.path?.scope ?? ''),
      matchType: String(r.path?.matchType ?? r.path?.match_type ?? ''),
      segments: (r.path?.segments ?? []).map((segment) => ({
        match: String(segment.match ?? ''),
        value: String(segment.value ?? ''),
      })),
    },
  };
}
