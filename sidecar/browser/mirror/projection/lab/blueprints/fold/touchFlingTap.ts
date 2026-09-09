import type { LabChassis } from '../../host/chassis';
import type { LabVerdict } from '../../dossier/types';
import { foldTouchFlingTap } from '../../probes/touchFlingTap';

export function foldTouchFlingTapBlueprint(chassis: LabChassis): LabVerdict[] {
  return foldTouchFlingTap(chassis);
}
