/**
 * Server-side capture of a structural DOM snapshot from the Virtual Chromium page.
 * `client/domTreeSnapshot.ts` is DOM-typed and esbuild-only (see its header) and must never be
 * imported from tsc-checked code, so this loads its prebuilt standalone bundle
 * (`npm run build:snapshot`) as text and hands it to Patchright's `page.evaluate(string)` —
 * the same "load a prebuilt bundle, inject as a string" pattern already used for the whole
 * Virtual producer (`inject/loadInpageScript.ts`).
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Page } from 'patchright';
import type { TreeNode } from '../models/treeNode';

const BUNDLE_NAME = 'domTreeSnapshot.js';

let cached: string | undefined;

function candidatePaths(): string[] {
  return [
    path.join(__dirname, '..', BUNDLE_NAME),
    path.join(process.cwd(), 'dist', 'browser', 'mirror', 'projection', BUNDLE_NAME),
  ];
}

function loadSnapshotScript(): string {
  if (cached !== undefined) return cached;

  const tried: string[] = [];
  for (const candidate of candidatePaths()) {
    tried.push(candidate);
    if (!fs.existsSync(candidate)) continue;
    cached = fs.readFileSync(candidate, 'utf8');
    return cached;
  }

  throw new Error(
    `PageProjection snapshot bundle missing (${BUNDLE_NAME}). ` +
      `Run \`npm run build:snapshot\` from the sidecar package. Looked in:\n` +
      tried.map((p) => `  - ${p}`).join('\n'),
  );
}

/** Captures a structural snapshot of the Virtual page's live `document` (no pixels, no CSSOM). */
export async function captureVirtualSnapshot(page: Page): Promise<TreeNode> {
  const source = loadSnapshotScript();
  const expression = `(() => {\n${source}\nreturn __speculumSnapshot.snapshotTree();\n})()`;
  return page.evaluate<TreeNode>(expression);
}
