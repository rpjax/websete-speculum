"use strict";
/**
 * Lab dossier schema (lab-design.md §7) — types + pointer shape.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LAB_DOSSIER_POINTER = exports.LAB_NDJSON_ROTATE_BYTES = void 0;
exports.reportExitCode = reportExitCode;
/** NDJSON rotate threshold (L6). */
exports.LAB_NDJSON_ROTATE_BYTES = 32 * 1024 * 1024;
exports.LAB_DOSSIER_POINTER = {
    schema: 'lab-dossier/v1',
    session: 'session.json',
    manifest: 'manifest.json',
    verdicts: 'verdicts.json',
};
function reportExitCode(verdicts) {
    return verdicts.some((v) => v.status === 'fail') ? 1 : 0;
}
//# sourceMappingURL=types.js.map