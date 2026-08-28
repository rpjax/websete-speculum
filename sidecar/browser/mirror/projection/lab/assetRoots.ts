/**
 * Lab static / fixture roots for ts-node and compiled dist layouts.
 */

import fs from 'node:fs';
import path from 'node:path';

export function labAssetRoots(): { staticDir: string; fixturesDir: string; labRoot: string } {
  const labRootCandidates = [
    path.join(__dirname), // lab/ when assetRoots lives at lab root
    path.join(__dirname, '..'), // when imported from host/ or runner/
    path.join(process.cwd(), 'browser', 'mirror', 'projection', 'lab'),
    path.join(process.cwd(), 'dist', 'browser', 'mirror', 'projection', 'lab'),
  ];
  const labRoot =
    labRootCandidates.find(
      (p) => fs.existsSync(path.join(p, 'fixtures')) || fs.existsSync(path.join(p, 'static')),
    ) ?? path.join(process.cwd(), 'browser', 'mirror', 'projection', 'lab');

  const staticDir = [
    path.join(labRoot, 'static'),
    path.join(process.cwd(), 'browser', 'mirror', 'projection', 'lab', 'static'),
  ].find((p) => fs.existsSync(p)) ?? path.join(labRoot, 'static');

  const fixturesDir = [
    path.join(labRoot, 'fixtures'),
    path.join(process.cwd(), 'browser', 'mirror', 'projection', 'lab', 'fixtures'),
  ].find((p) => fs.existsSync(p)) ?? path.join(labRoot, 'fixtures');

  return { staticDir, fixturesDir, labRoot };
}
