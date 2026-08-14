/**
 * Lab static / fixture roots for ts-node and compiled dist layouts.
 */

import fs from 'node:fs';
import path from 'node:path';

export function labAssetRoots(): { staticDir: string; fixturesDir: string } {
  const candidates = [
    path.join(__dirname, 'static'),
    path.join(process.cwd(), 'browser', 'mirror', 'projection', 'lab', 'static'),
    path.join(process.cwd(), 'dist', 'browser', 'mirror', 'projection', 'lab', 'static'),
  ];
  const staticDir =
    candidates.find((p) => fs.existsSync(p)) ??
    path.join(process.cwd(), 'browser', 'mirror', 'projection', 'lab', 'static');
  return {
    staticDir,
    fixturesDir: path.join(staticDir, 'fixtures'),
  };
}
