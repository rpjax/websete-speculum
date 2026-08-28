"use strict";
/**
 * Builds a single CDP inject source string for PageProjection runtime (no HTML tags).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildProjectionInjectBundle = buildProjectionInjectBundle;
const projectionConfig_1 = require("@speculum/page-projection/virtual/config/projectionConfig");
const buildConfigPreScript_1 = require("./buildConfigPreScript");
const loadInpageScript_1 = require("./loadInpageScript");
const injectSentinel_1 = require("./injectSentinel");
const injectScriptBodies_1 = require("./injectScriptBodies");
const resolveLaunchScripts_1 = require("./resolveLaunchScripts");
const extensionPlaneMainShim_1 = require("./extensionPlaneMainShim");
function buildConfigAssignmentJs(config) {
    const payload = (0, buildConfigPreScript_1.buildConfigPayload)(config);
    return `globalThis.${projectionConfig_1.PROJECTION_CONFIG_GLOBAL}=${JSON.stringify(payload)};`;
}
function wrapPreludeIife(innerParts) {
    const body = innerParts.filter(Boolean).join('\n');
    return `(function speculum_pp_inject_boot() {\n'use strict';\n${body}\n})();`;
}
function buildProjectionInjectBundle(opts) {
    const launchScripts = opts.launchScripts ?? [];
    const preludeParts = [
        (0, injectSentinel_1.buildScrubPreludeJs)(),
        `(function speculum_csp_meta_neutralize() {${injectScriptBodies_1.META_CSP_NEUTRALIZE_BODY}})();`,
        buildConfigAssignmentJs(opts.config),
    ];
    if ((opts.config.transport ?? 'loopback') === 'loopback') {
        preludeParts.push((0, extensionPlaneMainShim_1.buildExtensionPlaneMainShimJs)());
    }
    preludeParts.push(`(function speculum_single_tab() {${injectScriptBodies_1.SINGLE_TAB_BODY}})();`);
    if (opts.includeCspDiag) {
        preludeParts.push(`(function speculum_csp_diag_probe() {${injectScriptBodies_1.CSP_DIAG_PROBE_BODY}})();`);
    }
    if (launchScripts.length > 0) {
        preludeParts.push((0, resolveLaunchScripts_1.buildLaunchUrlMatcherJs)());
        for (const s of launchScripts) {
            preludeParts.push(s.wrappedSource);
        }
    }
    const generation = opts.config.generation ?? 1;
    const prelude = wrapPreludeIife(preludeParts);
    const virtual = (0, loadInpageScript_1.loadInpageScript)();
    // Arm wrapper: legal `return` inside function; second evaluate on same heap is no-op.
    return `${injectSentinel_1.INJECT_SENTINEL_COMMENT}\n${(0, injectSentinel_1.wrapInjectWithArm)(generation, `${prelude}\n${virtual}`)}`;
}
//# sourceMappingURL=buildProjectionInjectBundle.js.map