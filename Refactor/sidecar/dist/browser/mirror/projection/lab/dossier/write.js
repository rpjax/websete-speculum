"use strict";
/**
 * Sharded lab dossier writers (lab-design.md §7).
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultLabRunsDir = defaultLabRunsDir;
exports.urlSlug = urlSlug;
exports.dossierDirName = dossierDirName;
exports.createDossier = createDossier;
exports.writeJson = writeJson;
exports.appendTelemetryEvent = appendTelemetryEvent;
exports.finalizeDossier = finalizeDossier;
exports.writeBinaryArtifact = writeBinaryArtifact;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const types_1 = require("./types");
function defaultLabRunsDir() {
    return node_path_1.default.join(process.cwd(), 'lab-runs');
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
function dossierDirName(createdAt, slug) {
    const timestamp = createdAt.replace(/[:.]/g, '-');
    return `${timestamp}-${slug}`;
}
async function createDossier(opts) {
    const dir = node_path_1.default.join(opts.baseDir, dossierDirName(opts.createdAt, opts.slug));
    await node_fs_1.default.promises.mkdir(dir, { recursive: true });
    await node_fs_1.default.promises.mkdir(node_path_1.default.join(dir, 'telemetry'), { recursive: true });
    await node_fs_1.default.promises.mkdir(node_path_1.default.join(dir, 'wire'), { recursive: true });
    await node_fs_1.default.promises.mkdir(node_path_1.default.join(dir, 'probes'), { recursive: true });
    await node_fs_1.default.promises.mkdir(node_path_1.default.join(dir, 'probes', 'snaps'), { recursive: true });
    await node_fs_1.default.promises.mkdir(node_path_1.default.join(dir, 'probes', 'cpu'), { recursive: true });
    await node_fs_1.default.promises.mkdir(node_path_1.default.join(dir, 'journal'), { recursive: true });
    await node_fs_1.default.promises.mkdir(node_path_1.default.join(dir, 'wire', 'op-windows'), { recursive: true });
    const handle = {
        dir,
        sessionId: opts.session.sessionId,
        artifacts: [],
        privateNdjsonPath: node_path_1.default.join(dir, 'telemetry', 'events.ndjson'),
        privateNdjsonBytes: 0,
        privateNdjsonIndex: 0,
    };
    await writeJson(handle, 'session.json', opts.session, 'session');
    return handle;
}
function jsonSafeReplacer(_key, value) {
    return typeof value === 'bigint' ? value.toString() : value;
}
async function writeJson(handle, relPath, data, kind) {
    const full = node_path_1.default.join(handle.dir, relPath);
    await node_fs_1.default.promises.mkdir(node_path_1.default.dirname(full), { recursive: true });
    const body = JSON.stringify(data, jsonSafeReplacer, 2);
    await node_fs_1.default.promises.writeFile(full, body, 'utf8');
    const existing = handle.artifacts.findIndex((a) => a.path === relPath);
    const entry = { kind, path: relPath, bytes: Buffer.byteLength(body), contentType: 'application/json' };
    if (existing >= 0)
        handle.artifacts[existing] = entry;
    else
        handle.artifacts.push(entry);
}
async function appendTelemetryEvent(handle, event) {
    const line = `${JSON.stringify(event, jsonSafeReplacer)}\n`;
    const bytes = Buffer.byteLength(line);
    if (handle.privateNdjsonBytes > 0 && handle.privateNdjsonBytes + bytes > types_1.LAB_NDJSON_ROTATE_BYTES) {
        handle.privateNdjsonIndex += 1;
        const name = `events-${String(handle.privateNdjsonIndex).padStart(4, '0')}.ndjson`;
        handle.privateNdjsonPath = node_path_1.default.join(handle.dir, 'telemetry', name);
        handle.privateNdjsonBytes = 0;
        handle.artifacts.push({
            kind: 'telemetry.events',
            path: `telemetry/${name}`,
            contentType: 'application/x-ndjson',
        });
    }
    await node_fs_1.default.promises.appendFile(handle.privateNdjsonPath, line, 'utf8');
    handle.privateNdjsonBytes += bytes;
    if (!handle.artifacts.some((a) => a.path === node_path_1.default.relative(handle.dir, handle.privateNdjsonPath).replace(/\\/g, '/'))) {
        handle.artifacts.push({
            kind: 'telemetry.events',
            path: node_path_1.default.relative(handle.dir, handle.privateNdjsonPath).replace(/\\/g, '/'),
            contentType: 'application/x-ndjson',
        });
    }
}
async function finalizeDossier(handle, opts) {
    await writeJson(handle, 'session.json', opts.session, 'session');
    await writeJson(handle, 'verdicts.json', opts.verdicts, 'verdicts');
    await writeJson(handle, 'meta.json', opts.meta, 'meta');
    if (opts.counts) {
        await writeJson(handle, 'telemetry/counts.json', opts.counts, 'telemetry.counts');
    }
    const manifest = {
        schema: 'lab-dossier/v1',
        sessionId: handle.sessionId,
        artifacts: [...handle.artifacts],
    };
    await writeJson(handle, 'manifest.json', manifest, 'manifest');
    await writeJson(handle, 'report.json', types_1.LAB_DOSSIER_POINTER, 'report.pointer');
    return { dossierDir: handle.dir };
}
async function writeBinaryArtifact(handle, relPath, data, kind, contentType) {
    const full = node_path_1.default.join(handle.dir, relPath);
    await node_fs_1.default.promises.mkdir(node_path_1.default.dirname(full), { recursive: true });
    await node_fs_1.default.promises.writeFile(full, data);
    const bytes = typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength;
    handle.artifacts.push({ kind, path: relPath, bytes, contentType });
}
//# sourceMappingURL=write.js.map