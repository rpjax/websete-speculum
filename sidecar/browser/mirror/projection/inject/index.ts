/**
 * SessionConfig payload + launch-script resolve helpers.
 * Virtual runtime is delivered by the unified extension (`speculum-pp`), not CDP inject.
 */

export {
  buildConfigPreScript,
  buildConfigPayload,
  type ProjectionConfigPreScriptOptions,
} from './buildConfigPreScript';
export {
  resolveLaunchScripts,
  filterLaunchScriptsForUrl,
  type ResolvedLaunchScript,
} from './resolveLaunchScripts';
