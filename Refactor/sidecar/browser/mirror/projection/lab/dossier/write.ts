/**
 * Sharded lab dossier writers (lab-design.md §7).
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  LAB_DOSSIER_POINTER,
  LAB_NDJSON_ROTATE_BYTES,
  type LabManifest,
  type LabMeta,
  type LabSessionRecord,
  type LabVerdict,
  type ManifestEntry,
} from './types';

export function defaultLabRunsDir(): string {
  return path.join(process.cwd(), 'lab-runs');
}

export function urlSlug(url: string): string {
  let host = url;
  try {
    host = new URL(url).host || url;
  } catch {
    // not a full URL
  }
  const slug = host.replace(/[^a-zA-Z0-9.-]+/g, '-').replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'run';
}

export function dossierDirName(createdAt: string, slug: string): string {
  const timestamp = createdAt.replace(/[:.]/g, '-');
  return `${timestamp}-${slug}`;
}

export type DossierHandle = {
  dir: string;
  sessionId: string;
  artifacts: ManifestEntry[];
  privateNdjsonPath: string;
  privateNdjsonBytes: number;
  privateNdjsonIndex: number;
};

export async function createDossier(opts: {
  baseDir: string;
  createdAt: string;
  slug: string;
  session: LabSessionRecord;
}): Promise<DossierHandle> {
  const dir = path.join(opts.baseDir, dossierDirName(opts.createdAt, opts.slug));
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.mkdir(path.join(dir, 'telemetry'), { recursive: true });
  await fs.promises.mkdir(path.join(dir, 'wire'), { recursive: true });
  await fs.promises.mkdir(path.join(dir, 'probes'), { recursive: true });
  await fs.promises.mkdir(path.join(dir, 'probes', 'snaps'), { recursive: true });
  await fs.promises.mkdir(path.join(dir, 'probes', 'cpu'), { recursive: true });
  await fs.promises.mkdir(path.join(dir, 'journal'), { recursive: true });
  await fs.promises.mkdir(path.join(dir, 'wire', 'op-windows'), { recursive: true });

  const handle: DossierHandle = {
    dir,
    sessionId: opts.session.sessionId,
    artifacts: [],
    privateNdjsonPath: path.join(dir, 'telemetry', 'events.ndjson'),
    privateNdjsonBytes: 0,
    privateNdjsonIndex: 0,
  };

  await writeJson(handle, 'session.json', opts.session, 'session');
  return handle;
}

function jsonSafeReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

export async function writeJson(
  handle: DossierHandle,
  relPath: string,
  data: unknown,
  kind: string,
): Promise<void> {
  const full = path.join(handle.dir, relPath);
  await fs.promises.mkdir(path.dirname(full), { recursive: true });
  const body = JSON.stringify(data, jsonSafeReplacer, 2);
  await fs.promises.writeFile(full, body, 'utf8');
  const existing = handle.artifacts.findIndex((a) => a.path === relPath);
  const entry: ManifestEntry = { kind, path: relPath, bytes: Buffer.byteLength(body), contentType: 'application/json' };
  if (existing >= 0) handle.artifacts[existing] = entry;
  else handle.artifacts.push(entry);
}

/** Sync write for crash / process-fault sinks (must land before process exit). */
export function writeJsonSync(
  handle: DossierHandle,
  relPath: string,
  data: unknown,
  kind: string,
): void {
  const full = path.join(handle.dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  const body = JSON.stringify(data, jsonSafeReplacer, 2);
  fs.writeFileSync(full, body, 'utf8');
  const existing = handle.artifacts.findIndex((a) => a.path === relPath);
  const entry: ManifestEntry = { kind, path: relPath, bytes: Buffer.byteLength(body), contentType: 'application/json' };
  if (existing >= 0) handle.artifacts[existing] = entry;
  else handle.artifacts.push(entry);
}

export async function appendTelemetryEvent(handle: DossierHandle, event: unknown): Promise<void> {
  const line = `${JSON.stringify(event, jsonSafeReplacer)}\n`;
  const bytes = Buffer.byteLength(line);
  if (handle.privateNdjsonBytes > 0 && handle.privateNdjsonBytes + bytes > LAB_NDJSON_ROTATE_BYTES) {
    handle.privateNdjsonIndex += 1;
    const name = `events-${String(handle.privateNdjsonIndex).padStart(4, '0')}.ndjson`;
    handle.privateNdjsonPath = path.join(handle.dir, 'telemetry', name);
    handle.privateNdjsonBytes = 0;
    handle.artifacts.push({
      kind: 'telemetry.events',
      path: `telemetry/${name}`,
      contentType: 'application/x-ndjson',
    });
  }
  await fs.promises.appendFile(handle.privateNdjsonPath, line, 'utf8');
  handle.privateNdjsonBytes += bytes;
  if (!handle.artifacts.some((a) => a.path === path.relative(handle.dir, handle.privateNdjsonPath).replace(/\\/g, '/'))) {
    handle.artifacts.push({
      kind: 'telemetry.events',
      path: path.relative(handle.dir, handle.privateNdjsonPath).replace(/\\/g, '/'),
      contentType: 'application/x-ndjson',
    });
  }
}

export async function appendNdjsonArtifact(
  handle: DossierHandle,
  relPath: string,
  event: unknown,
  kind: string,
): Promise<void> {
  const full = path.join(handle.dir, relPath);
  await fs.promises.mkdir(path.dirname(full), { recursive: true });
  const line = `${JSON.stringify(event, jsonSafeReplacer)}\n`;
  await fs.promises.appendFile(full, line, 'utf8');
  if (!handle.artifacts.some((a) => a.path === relPath)) {
    handle.artifacts.push({
      kind,
      path: relPath,
      contentType: 'application/x-ndjson',
    });
  }
}

export async function finalizeDossier(
  handle: DossierHandle,
  opts: {
    session: LabSessionRecord;
    verdicts: LabVerdict[];
    meta: LabMeta;
    counts?: Record<string, number>;
  },
): Promise<{ dossierDir: string }> {
  await writeJson(handle, 'session.json', opts.session, 'session');
  await writeJson(handle, 'verdicts.json', opts.verdicts, 'verdicts');
  await writeJson(handle, 'meta.json', opts.meta, 'meta');
  if (opts.counts) {
    await writeJson(handle, 'telemetry/counts.json', opts.counts, 'telemetry.counts');
  }
  const manifest: LabManifest = {
    schema: 'lab-dossier/v1',
    sessionId: handle.sessionId,
    artifacts: [...handle.artifacts],
  };
  await writeJson(handle, 'manifest.json', manifest, 'manifest');
  await writeJson(handle, 'report.json', LAB_DOSSIER_POINTER, 'report.pointer');
  return { dossierDir: handle.dir };
}

export async function writeBinaryArtifact(
  handle: DossierHandle,
  relPath: string,
  data: Uint8Array | Buffer | string,
  kind: string,
  contentType?: string,
): Promise<void> {
  const full = path.join(handle.dir, relPath);
  await fs.promises.mkdir(path.dirname(full), { recursive: true });
  await fs.promises.writeFile(full, data);
  const bytes = typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength;
  handle.artifacts.push({ kind, path: relPath, bytes, contentType });
}
