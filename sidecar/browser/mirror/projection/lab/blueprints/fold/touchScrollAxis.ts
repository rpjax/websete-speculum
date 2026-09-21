import type { LabChassis } from '../../host/chassis';
import type { LabVerdict } from '../../dossier/types';
import { foldTouchScrollAxis } from '../../probes/touchScrollAxis';

export function foldTouchScrollAxisBlueprint(chassis: LabChassis): LabVerdict[] {
  return foldTouchScrollAxis(chassis);
}
