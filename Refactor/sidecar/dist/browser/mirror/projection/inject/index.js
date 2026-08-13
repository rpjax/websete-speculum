"use strict";
/**
 * Virtual injection helpers (Node side).
 * Order: config pre-script → main `virtual.js` bundle.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.clearInpageScriptCache = exports.loadInpageScript = exports.buildConfigPreScript = void 0;
exports.loadVirtualInjectionScripts = loadVirtualInjectionScripts;
const buildConfigPreScript_1 = require("./buildConfigPreScript");
const loadInpageScript_1 = require("./loadInpageScript");
var buildConfigPreScript_2 = require("./buildConfigPreScript");
Object.defineProperty(exports, "buildConfigPreScript", { enumerable: true, get: function () { return buildConfigPreScript_2.buildConfigPreScript; } });
var loadInpageScript_2 = require("./loadInpageScript");
Object.defineProperty(exports, "loadInpageScript", { enumerable: true, get: function () { return loadInpageScript_2.loadInpageScript; } });
Object.defineProperty(exports, "clearInpageScriptCache", { enumerable: true, get: function () { return loadInpageScript_2.clearInpageScriptCache; } });
function loadVirtualInjectionScripts(config) {
    return {
        configPreScript: (0, buildConfigPreScript_1.buildConfigPreScript)(config),
        mainScript: (0, loadInpageScript_1.loadInpageScript)(),
    };
}
//# sourceMappingURL=index.js.map