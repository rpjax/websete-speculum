"use strict";
/**
 * Virtual injection helpers (Node side).
 * CDP-only path: {@link ProjectionRuntimeInstaller} + {@link buildProjectionInjectBundle}.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.INJECT_SENTINEL_COMMENT = exports.INJECT_SENTINEL_MARKER = exports.filterLaunchScriptsForUrl = exports.resolveLaunchScripts = exports.ProjectionRuntimeInstaller = exports.buildProjectionInjectBundle = exports.clearInpageScriptCache = exports.loadInpageScript = exports.buildConfigPreScript = void 0;
exports.loadVirtualInjectionScripts = loadVirtualInjectionScripts;
const buildConfigPreScript_1 = require("./buildConfigPreScript");
const loadInpageScript_1 = require("./loadInpageScript");
var buildConfigPreScript_2 = require("./buildConfigPreScript");
Object.defineProperty(exports, "buildConfigPreScript", { enumerable: true, get: function () { return buildConfigPreScript_2.buildConfigPreScript; } });
var loadInpageScript_2 = require("./loadInpageScript");
Object.defineProperty(exports, "loadInpageScript", { enumerable: true, get: function () { return loadInpageScript_2.loadInpageScript; } });
Object.defineProperty(exports, "clearInpageScriptCache", { enumerable: true, get: function () { return loadInpageScript_2.clearInpageScriptCache; } });
var buildProjectionInjectBundle_1 = require("./buildProjectionInjectBundle");
Object.defineProperty(exports, "buildProjectionInjectBundle", { enumerable: true, get: function () { return buildProjectionInjectBundle_1.buildProjectionInjectBundle; } });
var projectionRuntimeInstaller_1 = require("./projectionRuntimeInstaller");
Object.defineProperty(exports, "ProjectionRuntimeInstaller", { enumerable: true, get: function () { return projectionRuntimeInstaller_1.ProjectionRuntimeInstaller; } });
var resolveLaunchScripts_1 = require("./resolveLaunchScripts");
Object.defineProperty(exports, "resolveLaunchScripts", { enumerable: true, get: function () { return resolveLaunchScripts_1.resolveLaunchScripts; } });
Object.defineProperty(exports, "filterLaunchScriptsForUrl", { enumerable: true, get: function () { return resolveLaunchScripts_1.filterLaunchScriptsForUrl; } });
var injectSentinel_1 = require("./injectSentinel");
Object.defineProperty(exports, "INJECT_SENTINEL_MARKER", { enumerable: true, get: function () { return injectSentinel_1.INJECT_SENTINEL_MARKER; } });
Object.defineProperty(exports, "INJECT_SENTINEL_COMMENT", { enumerable: true, get: function () { return injectSentinel_1.INJECT_SENTINEL_COMMENT; } });
function loadVirtualInjectionScripts(config) {
    return {
        configPreScript: (0, buildConfigPreScript_1.buildConfigPreScript)(config),
        mainScript: (0, loadInpageScript_1.loadInpageScript)(),
    };
}
//# sourceMappingURL=index.js.map