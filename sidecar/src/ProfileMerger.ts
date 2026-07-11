import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { archiveProfile, extractProfile } from './ProfileArchive';

const DENYLIST_EXACT = new Set([
    'SingletonLock',
    'SingletonCookie',
    'SingletonSocket',
    'lockfile',
    'LOCK',
    'DevToolsActivePort',
    'chrome_debug.log',
]);

const DENYLIST_PREFIXES = [
    'Crashpad/',
    'BrowserMetrics/',
    'ShaderCache/',
    'GrShaderCache/',
    'GPUCache/',
];

function isVolatile(relPath: string): boolean {
    const normalized = relPath.replace(/\\/g, '/');
    if (DENYLIST_EXACT.has(normalized)) return true;
    return DENYLIST_PREFIXES.some(p => normalized === p || normalized.startsWith(p));
}

function listFiles(dir: string, base = ''): string[] {
    const results: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const rel = base ? `${base}/${entry.name}` : entry.name;
        const full = path.join(dir, rel);
        if (entry.isDirectory()) {
            results.push(...listFiles(full, rel));
        } else if (entry.isFile()) {
            results.push(rel.replace(/\\/g, '/'));
        }
    }
    return results;
}

function sha256File(filePath: string): string {
    const hash = crypto.createHash('sha256');
    hash.update(fs.readFileSync(filePath));
    return hash.digest('hex');
}

function copyFile(src: string, dest: string): void {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
}

/**
 * Merges two Chrome profile archives:
 * - complement: paths only in one tree are kept
 * - identical SHA-256: skip
 * - conflict: LWW by file mtime after extract
 * - volatile paths from incoming are ignored
 */
export async function mergeProfiles(baseBlob: Buffer, incomingBlob: Buffer): Promise<Buffer> {
    const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'speculum-merge-'));
    const baseDir      = path.join(workRoot, 'base');
    const incomingDir  = path.join(workRoot, 'incoming');
    const outDir       = path.join(workRoot, 'out');

    try {
        await extractProfile(baseDir, baseBlob);
        await extractProfile(incomingDir, incomingBlob);
        fs.mkdirSync(outDir, { recursive: true });

        const baseFiles      = new Set(listFiles(baseDir));
        const incomingFiles  = listFiles(incomingDir).filter(p => !isVolatile(p));
        const allPaths       = new Set([...baseFiles, ...incomingFiles]);

        for (const rel of allPaths) {
            if (isVolatile(rel)) continue;

            const basePath     = path.join(baseDir, rel);
            const incomingPath = path.join(incomingDir, rel);
            const outPath      = path.join(outDir, rel);
            const hasBase      = baseFiles.has(rel) && fs.existsSync(basePath) && fs.statSync(basePath).isFile();
            const hasIncoming  = incomingFiles.includes(rel) && fs.existsSync(incomingPath) && fs.statSync(incomingPath).isFile();

            if (hasBase && !hasIncoming) {
                copyFile(basePath, outPath);
                continue;
            }

            if (!hasBase && hasIncoming) {
                copyFile(incomingPath, outPath);
                continue;
            }

            if (!hasBase && !hasIncoming) continue;

            const baseHash     = sha256File(basePath);
            const incomingHash = sha256File(incomingPath);
            if (baseHash === incomingHash) {
                copyFile(basePath, outPath);
                continue;
            }

            const baseMtime     = fs.statSync(basePath).mtimeMs;
            const incomingMtime = fs.statSync(incomingPath).mtimeMs;
            const winner        = incomingMtime >= baseMtime ? incomingPath : basePath;
            copyFile(winner, outPath);
        }

        return await archiveProfile(outDir);
    } finally {
        fs.rmSync(workRoot, { recursive: true, force: true });
    }
}
