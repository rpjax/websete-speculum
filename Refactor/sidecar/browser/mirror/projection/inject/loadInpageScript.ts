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

function candidatePaths(): string[] {
  return [
    path.join(__dirname, '..', BUNDLE_NAME),
    path.join(process.cwd(), 'dist', 'browser', 'mirror', 'projection', BUNDLE_NAME),
  ];
}

/** Autocontained Virtual projection JS source (cached after first read). */
export function loadInpageScript(): string {
  if (cached !== undefined) return cached;

  const tried: string[] = [];
  for (const candidate of candidatePaths()) {
    tried.push(candidate);
    if (!fs.existsSync(candidate)) continue;
    cached = fs.readFileSync(candidate, 'utf8');
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
}
