/**
 * Virtual injection helpers (Node side).
 * CDP-only path: {@link ProjectionRuntimeInstaller} + {@link buildProjectionInjectBundle}.
 */

import { buildConfigPreScript, type ProjectionConfigPreScriptOptions } from './buildConfigPreScript';
import { loadInpageScript } from './loadInpageScript';
import { buildProjectionInjectBundle } from './buildProjectionInjectBundle';
import { ProjectionRuntimeInstaller } from './projectionRuntimeInstaller';
import { resolveLaunchScripts } from './resolveLaunchScripts';
import { INJECT_SENTINEL_MARKER, INJECT_SENTINEL_COMMENT } from './injectSentinel';

export { buildConfigPreScript, type ProjectionConfigPreScriptOptions } from './buildConfigPreScript';
export { loadInpageScript, clearInpageScriptCache } from './loadInpageScript';
export { buildProjectionInjectBundle, type BuildProjectionInjectBundleOptions } from './buildProjectionInjectBundle';
export { ProjectionRuntimeInstaller, type ProjectionRuntimeInstallerOptions } from './projectionRuntimeInstaller';
export {
  resolveLaunchScripts,
  filterLaunchScriptsForUrl,
  type ResolvedLaunchScript,
} from './resolveLaunchScripts';
export { INJECT_SENTINEL_MARKER, INJECT_SENTINEL_COMMENT, INJECT_ARM_GLOBAL } from './injectSentinel';

export type VirtualInjectionScripts = {
  /** Assigns `globalThis.__SPECULUM_PROJECTION__`. Inject first. */
  configPreScript: string;
  /** Bundled Virtual endpoint. Inject second. */
  mainScript: string;
};

export function loadVirtualInjectionScripts(
  config: ProjectionConfigPreScriptOptions,
): VirtualInjectionScripts {
  return {
    configPreScript: buildConfigPreScript(config),
    mainScript: loadInpageScript(),
  };
}
