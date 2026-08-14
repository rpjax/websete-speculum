"use strict";
/**
 * Benchmark run report — the "export detailed results to a local folder" half of the
 * consolidation (per-run `report.json` + raw `.cpuprofile`), so a run can be diagnosed offline
 * without re-running it just to generate more Cursor-side tokens of ad-hoc script output.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.urlSlug = urlSlug;
exports.defaultLabRunsDir = defaultLabRunsDir;
exports.writeRunReport = writeRunReport;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
function jsonSafeReplacer(_key, value) {
    return typeof value === 'bigint' ? value.toString() : value;
}
/** Filesystem-safe slug from a run's target URL, for the report directory name. */
function urlSlug(url) {
    let host = url;
    try {
        host = new URL(url).host || url;
    }
    catch {
        // not a full URL (e.g. a bare fixture name) — fall through to the raw string
    }
    const slug = host.replace(/[^a-zA-Z0-9.-]+/g, '-').replace(/^-+|-+$/g, '');
    return slug.length > 0 ? slug : 'run';
}
function defaultLabRunsDir() {
    return node_path_1.default.join(process.cwd(), 'lab-runs');
}
async function writeRunReport(baseDir, report, rawCpuProfile) {
    const timestamp = report.meta.timestamp.replace(/[:.]/g, '-');
    const reportDir = node_path_1.default.join(baseDir, `${timestamp}-${urlSlug(report.meta.url)}`);
    await node_fs_1.default.promises.mkdir(reportDir, { recursive: true });
    let cpuProfilePath = null;
    const finalReport = report;
    if (rawCpuProfile !== null && report.cpuProfile !== null) {
        cpuProfilePath = node_path_1.default.join(reportDir, report.cpuProfile.profileFile);
        await node_fs_1.default.promises.writeFile(cpuProfilePath, JSON.stringify(rawCpuProfile), 'utf8');
    }
    const reportPath = node_path_1.default.join(reportDir, 'report.json');
    await node_fs_1.default.promises.writeFile(reportPath, JSON.stringify(finalReport, jsonSafeReplacer, 2), 'utf8');
    return { reportDir, reportPath, cpuProfilePath };
}
//# sourceMappingURL=runReport.js.map