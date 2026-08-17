import type { LabChassis } from '../../host/chassis';
import type { LabVerdict } from '../../dossier/types';
import type { HostileKind } from '../../runner/hostileFrames';

const EXPECTED_OP: Record<HostileKind, string> = {
  attr: 'nodeNew',
  ruleset: 'ruleSet',
  eof: 'ruleNew',
};

const EXPECTED_REASON: Record<HostileKind, string> = {
  attr: 'malformed',
  ruleset: 'bad_target',
  eof: 'address_miss',
};

export function foldApplyHonestyDesync(chassis: LabChassis, kind: HostileKind): LabVerdict[] {
  const id = `apply.desync.${kind}`;
  const injects = chassis.journal.injects;
  const row = injects.find((x) => x.kind === kind) ?? injects[0];
  if (!row) {
    return [{ id, status: 'fail', reason: 'inject journal missing' }];
  }
  if (row.skipped) {
    return [{ id, status: 'skipped', reason: row.skipReason ?? 'no DOM client' }];
  }
  if (!row.desynced) {
    return [{ id, status: 'fail', reason: 'client snapshot not desynced after inject' }];
  }
  const err = (row.applyError ?? '').toLowerCase();
  const wantReason = EXPECTED_REASON[kind];
  const wantOp = EXPECTED_OP[kind];
  if (!err.includes(wantReason) && !err.includes(wantOp)) {
    return [
      {
        id,
        status: 'fail',
        reason: `desynced but applyError=${row.applyError ?? 'null'} want ${wantReason}/${wantOp}`,
      },
    ];
  }
  return [
    {
      id,
      status: 'pass',
      reason: `desynced applyError=${row.applyError ?? wantReason}`,
    },
  ];
}
