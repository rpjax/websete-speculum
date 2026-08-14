"use strict";
/**
 * Benchmark / lab-run report — always start diagnosis at report.json.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.urlSlug = urlSlug;
exports.defaultLabRunsDir = defaultLabRunsDir;
exports.reportExitCode = reportExitCode;
exports.writeRunReport = writeRunReport;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
function jsonSafeReplacer(_key, value) {
    return typeof value === 'bigint' ? value.toString() : value;
}
function urlSlug(url) {
    let host = url;
    try {
        host = new URL(url).host || url;
    }
    catch {
        // not a full URL
    }
    const slug = host.replace(/[^a-zA-Z0-9.-]+/g, '-').replace(/^-+|-+$/g, '');
    return slug.length > 0 ? slug : 'run';
}
function defaultLabRunsDir() {
    return node_path_1.default.join(process.cwd(), 'lab-runs');
}
function reportExitCode(report) {
    const verdicts = report.verdicts ?? [];
    return verdicts.some((v) => v.status === 'fail') ? 1 : 0;
}
async function writeRunReport(baseDir, report, rawCpuProfile) {
    const timestamp = report.meta.timestamp.replace(/[:.]/g, '-');
    const reportDir = node_path_1.default.join(baseDir, `${timestamp}-${urlSlug(report.meta.url)}`);
    await node_fs_1.default.promises.mkdir(reportDir, { recursive: true });
    let cpuProfilePath = null;
    const artifacts = [...(report.artifacts ?? [])];
    if (rawCpuProfile !== null && report.cpuProfile !== null) {
        cpuProfilePath = node_path_1.default.join(reportDir, report.cpuProfile.profileFile);
        await node_fs_1.default.promises.writeFile(cpuProfilePath, JSON.stringify(rawCpuProfile), 'utf8');
        artifacts.push({ kind: 'cpuProfile', path: report.cpuProfile.profileFile });
    }
    const finalReport = { ...report, artifacts };
    const reportPath = node_path_1.default.join(reportDir, 'report.json');
    await node_fs_1.default.promises.writeFile(reportPath, JSON.stringify(finalReport, jsonSafeReplacer, 2), 'utf8');
    return { reportDir, reportPath, cpuProfilePath };
}
//# sourceMappingURL=runReport.js.map