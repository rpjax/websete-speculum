/**
 * Loads the prebuilt Virtual-side projection IIFE for Chromium injection.
 * Run `npm run build:virtual` (also part of `npm run build`).
 *
 * Prefer {@link loadVirtualInjectionScripts} so the config pre-script runs first.
 */

import fs from 'node:fs';
import path from 'node:path';

const BUNDLE_NAME = 'virtual.js';

let cached: string | undefined;
let cachedPath: string | undefined;
let cachedMtimeMs = 0;

function candidatePaths(): string[] {
  return [
    path.join(__dirname, '..', BUNDLE_NAME),
    path.join(process.cwd(), 'dist', 'browser', 'mirror', 'projection', BUNDLE_NAME),
  ];
}

/** Autocontained Virtual projection JS source (re-read when the bundle file changes). */
export function loadInpageScript(): string {
  const tried: string[] = [];
  for (const candidate of candidatePaths()) {
    tried.push(candidate);
    if (!fs.existsSync(candidate)) continue;
    const mtimeMs = fs.statSync(candidate).mtimeMs;
    if (cached !== undefined && cachedPath === candidate && cachedMtimeMs === mtimeMs) return cached;
    cached = fs.readFileSync(candidate, 'utf8');
    cachedPath = candidate;
    cachedMtimeMs = mtimeMs;
    return cached;
  }

  throw new Error(
    `PageProjection virtual bundle missing (${BUNDLE_NAME}). ` +
      `Run \`npm run build:virtual\` from the sidecar package. Looked in:\n` +
      tried.map((p) => `  - ${p}`).join('\n'),
  );
}

export function clearInpageScriptCache(): void {
  cached = undefined;
  cachedPath = undefined;
  cachedMtimeMs = 0;
}
