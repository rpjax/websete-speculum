import { execFileSync } from 'child_process';
import * as fs from 'fs';

const SHM_PATH = '/dev/shm';

export interface ApplyHostResourcesInput {
  shmSizeBytes: number;
  raiseUlimits: boolean;
  nofile: number;
  nproc: number;
}

export interface ApplyHostResourcesResult {
  shmBeforeBytes: number;
  shmAppliedBytes: number;
  ulimitsRaised: boolean;
  nofileApplied?: number;
  nprocApplied?: number;
  warnings: string[];
}

export interface HostResourcesStatus {
  shmSizeBytes: number;
  nofile?: number;
  nproc?: number;
}

/** Read current tmpfs size for /dev/shm (bytes). Falls back to 0 when unavailable. */
export function readShmSizeBytes(): number {
  try {
    if (typeof fs.statfsSync === 'function' && fs.existsSync(SHM_PATH)) {
      const st = fs.statfsSync(SHM_PATH);
      const bsize = Number(st.bsize ?? 0);
      const blocks = Number(st.blocks ?? 0);
      if (bsize > 0 && blocks > 0) return bsize * blocks;
    }
  } catch {
    // fall through
  }

  try {
    const out = execFileSync('df', ['-B1', '--output=size', SHM_PATH], {
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
    if (Number.isFinite(n) && n > 0) return n;
  } catch {
    // fall through
  }

  return 0;
}

function remountShm(sizeBytes: number, warnings: string[]): number {
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
    execFileSync('mount', ['-o', `remount,size=${sizeKiB}k`, SHM_PATH], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warnings.push(`shm remount failed: ${msg}`);
    return readShmSizeBytes() || before;
  }

  const after = readShmSizeBytes();
  if (after > 0 && after + 1024 * 1024 < sizeBytes) {
    warnings.push(
      `shm remount reported ${after} bytes (requested ${sizeBytes}); kernel may have clamped size`,
    );
  }
  return after > 0 ? after : before;
}

function raiseUlimits(nofile: number, nproc: number, warnings: string[]): {
  raised: boolean;
  nofileApplied?: number;
  nprocApplied?: number;
} {
  if (process.platform !== 'linux') {
    warnings.push(`ulimit raise skipped on platform ${process.platform}`);
    return { raised: false };
  }

  let raised = false;
  let nofileApplied: number | undefined;
  let nprocApplied: number | undefined;
  const pid = process.pid;

  try {
    execFileSync(
      'prlimit',
      [`--pid=${pid}`, `--nofile=${nofile}:${nofile}`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    nofileApplied = nofile;
    raised = true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warnings.push(`nofile raise failed: ${msg}`);
  }

  try {
    execFileSync(
      'prlimit',
      [`--pid=${pid}`, `--nproc=${nproc}:${nproc}`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    nprocApplied = nproc;
    raised = true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warnings.push(`nproc raise failed: ${msg}`);
  }

  return { raised, nofileApplied, nprocApplied };
}

export function applyHostResources(input: ApplyHostResourcesInput): ApplyHostResourcesResult {
  const warnings: string[] = [];
  const shmBeforeBytes = readShmSizeBytes();
  const shmAppliedBytes = remountShm(Number(input.shmSizeBytes), warnings);

  let ulimitsRaised = false;
  let nofileApplied: number | undefined;
  let nprocApplied: number | undefined;
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

export function getHostResourcesStatus(): HostResourcesStatus {
  return { shmSizeBytes: readShmSizeBytes() };
}
