/**
 * Virtual injection helpers (Node side).
 * Order: config pre-script → main `virtual.js` bundle.
 */

import { buildConfigPreScript, type ProjectionConfigPreScriptOptions } from './buildConfigPreScript';
import { loadInpageScript } from './loadInpageScript';

export { buildConfigPreScript, type ProjectionConfigPreScriptOptions } from './buildConfigPreScript';
export { loadInpageScript, clearInpageScriptCache } from './loadInpageScript';

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
