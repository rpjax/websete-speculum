import type { LabChassis } from '../../host/chassis';
import type { LabVerdict } from '../../dossier/types';
import { foldTouchSurfaceParity } from '../../probes/touchSurfaceParity';

export function foldTouchSurfaceParityBlueprint(chassis: LabChassis): LabVerdict[] {
  return foldTouchSurfaceParity(chassis);
}
