/**
 * Builds a single CDP inject source string for PageProjection runtime (no HTML tags).
 *
 * Order (inside arm): prelude (scrub/CSP/config/plane/single-tab) → virtual.js →
 * custom launch scripts (each independently try/catch + TargetRules). Customs never
 * run before the producer boot path.
 */

import { PROJECTION_CONFIG_GLOBAL } from '@speculum/page-projection/virtual/config/projectionConfig';
import {
  buildConfigPayload,
  type ProjectionConfigPreScriptOptions,
} from './buildConfigPreScript';
import { loadInpageScript } from './loadInpageScript';
import {
  INJECT_SENTINEL_COMMENT,
  wrapInjectWithArm,
  buildScrubPreludeJs,
} from './injectSentinel';
import {
  META_CSP_NEUTRALIZE_BODY,
  SINGLE_TAB_BODY,
  CSP_DIAG_PROBE_BODY,
} from './injectScriptBodies';
import {
  buildLaunchUrlMatcherJs,
  type ResolvedLaunchScript,
} from './resolveLaunchScripts';
import { buildExtensionPlaneMainShimJs } from './extensionPlaneMainShim';

export type BuildProjectionInjectBundleOptions = {
  config: ProjectionConfigPreScriptOptions;
  launchScripts?: readonly ResolvedLaunchScript[];
  includeCspDiag?: boolean;
  /** When set, only launch scripts matching this URL are inlined (plus always-on runtime). */
  frameUrl?: string;
};

function buildConfigAssignmentJs(config: ProjectionConfigPreScriptOptions): string {
  const payload = buildConfigPayload(config);
  return `globalThis.${PROJECTION_CONFIG_GLOBAL}=${JSON.stringify(payload)};`;
}

function wrapPreludeIife(innerParts: string[]): string {
  const body = innerParts.filter(Boolean).join('\n');
  return `(function speculum_pp_inject_boot() {\n'use strict';\n${body}\n})();`;
}

function buildCustomLaunchTail(launchScripts: readonly ResolvedLaunchScript[]): string {
  if (launchScripts.length === 0) return '';
  const parts: string[] = [buildLaunchUrlMatcherJs()];
  for (const s of launchScripts) {
    parts.push(s.wrappedSource);
  }
  return parts.join('\n');
}

export function buildProjectionInjectBundle(opts: BuildProjectionInjectBundleOptions): string {
  const launchScripts = opts.launchScripts ?? [];
  const preludeParts: string[] = [
    buildScrubPreludeJs(),
    `(function speculum_csp_meta_neutralize() {${META_CSP_NEUTRALIZE_BODY}})();`,
    buildConfigAssignmentJs(opts.config),
  ];

  if ((opts.config.transport ?? 'loopback') === 'loopback') {
    preludeParts.push(buildExtensionPlaneMainShimJs());
  }

  preludeParts.push(`(function speculum_single_tab() {${SINGLE_TAB_BODY}})();`);

  if (opts.includeCspDiag) {
    preludeParts.push(`(function speculum_csp_diag_probe() {${CSP_DIAG_PROBE_BODY}})();`);
  }

  const generation = opts.config.generation ?? 1;
  const prelude = wrapPreludeIife(preludeParts);
  const virtual = loadInpageScript();
  const customs = buildCustomLaunchTail(launchScripts);
  // Arm wrapper: legal `return` inside function; second evaluate on same heap is no-op.
  // Virtual before customs so a broken launch script cannot block producer boot.
  const body = customs ? `${prelude}\n${virtual}\n${customs}` : `${prelude}\n${virtual}`;
  return `${INJECT_SENTINEL_COMMENT}\n${wrapInjectWithArm(generation, body)}`;
}
