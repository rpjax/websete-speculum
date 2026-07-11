import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { WebSocket } from 'ws';

const CHUNK_SIZE = 256 * 1024;

/**
 * Creates a gzip-compressed tar archive of a Chrome userDataDir.
 */
export function archiveProfile(userDataDir: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        const proc = spawn('tar', ['-czf', '-', '-C', userDataDir, '.'], {
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        proc.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
        proc.stderr.on('data', (data: Buffer) => {
            console.warn('[ProfileArchive] tar stderr:', data.toString('utf8').trim());
        });

        proc.on('error', reject);
        proc.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(`tar exited with code ${code}`));
                return;
            }
            resolve(Buffer.concat(chunks));
        });
    });
}

/**
 * Extracts a gzip tar archive into a clean target directory.
 */
export async function extractProfile(targetDir: string, blob: Buffer): Promise<void> {
    fs.mkdirSync(targetDir, { recursive: true });

    return new Promise((resolve, reject) => {
        const proc = spawn('tar', ['-xzf', '-', '-C', targetDir], {
            stdio: ['pipe', 'ignore', 'pipe'],
        });

        proc.stdin.write(blob);
        proc.stdin.end();

        proc.stderr.on('data', (data: Buffer) => {
            console.warn('[ProfileArchive] tar extract stderr:', data.toString('utf8').trim());
        });

        proc.on('error', reject);
        proc.on('close', (code) => {
            if (code !== 0) reject(new Error(`tar extract exited with code ${code}`));
            else resolve();
        });
    });
}

/**
 * Streams profile archive chunks over WebSocket as MSG_PROFILE_CHUNK (0x0B) frames.
 */
export function sendProfileChunks(ws: WebSocket, blob: Buffer): void {
    const MSG_PROFILE_CHUNK = 0x0B;
    let offset = 0;

    while (offset < blob.length) {
        const end   = Math.min(offset + CHUNK_SIZE, blob.length);
        const slice = blob.subarray(offset, end);
        const frame = Buffer.allocUnsafe(1 + slice.length);
        frame[0] = MSG_PROFILE_CHUNK;
        slice.copy(frame, 1);
        ws.send(frame, { binary: true });
        offset = end;
    }
}

export function profileDirForSession(sessionId: string): string {
    return path.join('/tmp', `speculum-profile-${sessionId}`);
}
