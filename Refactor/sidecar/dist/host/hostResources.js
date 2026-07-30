"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.readShmSizeBytes = readShmSizeBytes;
exports.applyHostResources = applyHostResources;
exports.getHostResourcesStatus = getHostResourcesStatus;
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const SHM_PATH = '/dev/shm';
/** Read current tmpfs size for /dev/shm (bytes). Falls back to 0 when unavailable. */
function readShmSizeBytes() {
    try {
        if (typeof fs.statfsSync === 'function' && fs.existsSync(SHM_PATH)) {
            const st = fs.statfsSync(SHM_PATH);
            const bsize = Number(st.bsize ?? 0);
            const blocks = Number(st.blocks ?? 0);
            if (bsize > 0 && blocks > 0)
                return bsize * blocks;
        }
    }
    catch {
        // fall through
    }
    try {
        const out = (0, child_process_1.execFileSync)('df', ['-B1', '--output=size', SHM_PATH], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const lines = out
            .trim()
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean);
        const sizeLine = lines.length >= 2 ? lines[1] : lines[0];
        const n = Number(sizeLine);
        if (Number.isFinite(n) && n > 0)
            return n;
    }
    catch {
        // fall through
    }
    return 0;
}
function remountShm(sizeBytes, warnings) {
    const before = readShmSizeBytes();
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
        warnings.push('shm_size_bytes must be > 0');
        return before;
    }
    if (process.platform !== 'linux') {
        warnings.push(`shm remount skipped on platform ${process.platform}`);
        return before;
    }
    if (!fs.existsSync(SHM_PATH)) {
        warnings.push('/dev/shm is missing');
        return before;
    }
    // mount size= is in KiB (Linux mount(8)).
    const sizeKiB = Math.max(1, Math.floor(sizeBytes / 1024));
    try {
        (0, child_process_1.execFileSync)('mount', ['-o', `remount,size=${sizeKiB}k`, SHM_PATH], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        warnings.push(`shm remount failed: ${msg}`);
        return readShmSizeBytes() || before;
    }
    const after = readShmSizeBytes();
    if (after > 0 && after + 1024 * 1024 < sizeBytes) {
        warnings.push(`shm remount reported ${after} bytes (requested ${sizeBytes}); kernel may have clamped size`);
    }
    return after > 0 ? after : before;
}
function raiseUlimits(nofile, nproc, warnings) {
    if (process.platform !== 'linux') {
        warnings.push(`ulimit raise skipped on platform ${process.platform}`);
        return { raised: false };
    }
    let raised = false;
    let nofileApplied;
    let nprocApplied;
    const pid = process.pid;
    try {
        (0, child_process_1.execFileSync)('prlimit', [`--pid=${pid}`, `--nofile=${nofile}:${nofile}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        nofileApplied = nofile;
        raised = true;
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        warnings.push(`nofile raise failed: ${msg}`);
    }
    try {
        (0, child_process_1.execFileSync)('prlimit', [`--pid=${pid}`, `--nproc=${nproc}:${nproc}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        nprocApplied = nproc;
        raised = true;
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        warnings.push(`nproc raise failed: ${msg}`);
    }
    return { raised, nofileApplied, nprocApplied };
}
function applyHostResources(input) {
    const warnings = [];
    const shmBeforeBytes = readShmSizeBytes();
    const shmAppliedBytes = remountShm(Number(input.shmSizeBytes), warnings);
    let ulimitsRaised = false;
    let nofileApplied;
    let nprocApplied;
    if (input.raiseUlimits) {
        const u = raiseUlimits(Number(input.nofile), Number(input.nproc), warnings);
        ulimitsRaised = u.raised;
        nofileApplied = u.nofileApplied;
        nprocApplied = u.nprocApplied;
    }
    return {
        shmBeforeBytes,
        shmAppliedBytes,
        ulimitsRaised,
        nofileApplied,
        nprocApplied,
        warnings,
    };
}
function getHostResourcesStatus() {
    return { shmSizeBytes: readShmSizeBytes() };
}
//# sourceMappingURL=hostResources.js.map