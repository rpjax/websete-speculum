/**
 * Frozen dirty → logical Frame port (§5.3.3).
 * Impls in this folder: {@link NetEffectFrameBuilder}, …
 */

import type { Frame } from '../../models/frame';
import type { DirtySets } from '../models/dirtySets';
import type {
  ChildListDecisionFact,
  DirtyCard,
} from '../../models/telemetry';

export type FrameBuilderContext = {
  generation: number;
  sequence: number;
};

export type FrameBuildDecision = {
  ephemeralPruned: number;
  absorbed: number;
  orphaned: number;
  opCounts: Record<string, number>;
  publishedCount: number;
  lastChildListsParents: number;
  lastChildListsEmpty: boolean;
  dirtyIn: DirtyCard;
  dirtyOut: DirtyCard;
  childLists: ChildListDecisionFact[];
  childListsOmitted: number;
  patches: number;
  scrolls: number;
  appendFromEmptyCount: number;
};

export type FrameBuilder = {
  build(frozen: DirtySets, ctx: FrameBuilderContext): Frame | null;
  /** Optional §5.3.3 proof stats from the last successful build. */
  takeBuildStats?(): FrameBuildDecision | null;
  publishState?(): { publishedCount: number; lastChildListsParents: number };
};
