import type { LabChassis } from '../../host/chassis';
import type { LabVerdict } from '../../dossier/types';
import { foldNestedHostReady } from '../../probes/nestedHostReady';

/** Closed-shadow cross-port iframe — nested must bind on Projected before click parity counts. */
export function foldInputIframeXoShadow(chassis: LabChassis): LabVerdict[] {
  const probe = (chassis.journal as { nestedHostReady?: { contextId: number } }).nestedHostReady;
  const contextId = probe?.contextId ?? 2;
  return foldNestedHostReady(chassis, contextId);
}
