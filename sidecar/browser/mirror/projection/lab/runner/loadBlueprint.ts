/**
 * Load blueprint JSON from lab/blueprints.
 */

import fs from 'node:fs';
import path from 'node:path';
import { labAssetRoots } from '../assetRoots';
import type { LabBlueprint } from './types';

export function blueprintsDir(): string {
  const { labRoot } = labAssetRoots();
  const candidates = [
    path.join(labRoot, 'blueprints'),
    path.join(__dirname, '..', 'blueprints'),
    path.join(process.cwd(), 'browser', 'mirror', 'projection', 'lab', 'blueprints'),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? candidates[0]!;
}

export function listBlueprintIds(): string[] {
  const dir = blueprintsDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''));
}

export type BlueprintSummary = {
  id: string;
  description: string;
  /** Boot URL from the blueprint (relative fixture path or absolute). */
  defaultUrl: string | null;
  /** True when UI/CLI duration + cpu/iso flags apply. */
  acceptsSoakOverrides: boolean;
};

export function defaultUrlFromBlueprint(bp: LabBlueprint): string | null {
  for (const q of bp.queues) {
    for (const a of q.actions) {
      if (a.type === 'boot' && typeof a.params?.url === 'string') return a.params.url;
    }
  }
  return null;
}

export function summarizeBlueprint(bp: LabBlueprint): BlueprintSummary {
  return {
    id: bp.id,
    description: bp.description,
    defaultUrl: defaultUrlFromBlueprint(bp),
    acceptsSoakOverrides: bp.id === 'soak' || bp.fold === 'soak',
  };
}

export function listBlueprintSummaries(): BlueprintSummary[] {
  return listBlueprintIds()
    .map((id) => summarizeBlueprint(loadBlueprint(id)))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function loadBlueprint(id: string): LabBlueprint {
  const file = path.join(blueprintsDir(), `${id}.json`);
  if (!fs.existsSync(file)) throw new Error(`blueprint not found: ${id}`);
  return JSON.parse(fs.readFileSync(file, 'utf8')) as LabBlueprint;
}
