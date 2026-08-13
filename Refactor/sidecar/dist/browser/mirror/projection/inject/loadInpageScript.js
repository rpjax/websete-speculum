"use strict";
/**
 * Loads the prebuilt Virtual-side projection IIFE for Chromium injection.
 * Run `npm run build:virtual` (also part of `npm run build`).
 *
 * Prefer {@link loadVirtualInjectionScripts} so the config pre-script runs first.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadInpageScript = loadInpageScript;
exports.clearInpageScriptCache = clearInpageScriptCache;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const BUNDLE_NAME = 'virtual.js';
let cached;
function candidatePaths() {
    return [
        node_path_1.default.join(__dirname, '..', BUNDLE_NAME),
        node_path_1.default.join(process.cwd(), 'dist', 'browser', 'mirror', 'projection', BUNDLE_NAME),
    ];
}
/** Autocontained Virtual projection JS source (cached after first read). */
function loadInpageScript() {
    if (cached !== undefined)
        return cached;
    const tried = [];
    for (const candidate of candidatePaths()) {
        tried.push(candidate);
        if (!node_fs_1.default.existsSync(candidate))
            continue;
        cached = node_fs_1.default.readFileSync(candidate, 'utf8');
        return cached;
    }
    throw new Error(`PageProjection virtual bundle missing (${BUNDLE_NAME}). ` +
        `Run \`npm run build:virtual\` from the sidecar package. Looked in:\n` +
        tried.map((p) => `  - ${p}`).join('\n'));
}
function clearInpageScriptCache() {
    cached = undefined;
}
//# sourceMappingURL=loadInpageScript.js.map