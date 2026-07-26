"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isBenignBrowserRace = isBenignBrowserRace;
/**
 * Patchright races that must not kill the sidecar process.
 * Keep this narrow — "protocol error" and friends are real faults.
 */
function isBenignBrowserRace(err) {
    const message = err instanceof Error ? err.message : String(err ?? '');
    return /frame was detached|target closed|has been closed/i.test(message);
}
//# sourceMappingURL=browserRace.js.map