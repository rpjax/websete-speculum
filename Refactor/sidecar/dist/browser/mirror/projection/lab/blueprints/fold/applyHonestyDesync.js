"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.foldApplyHonestyDesync = foldApplyHonestyDesync;
const EXPECTED_OP = {
    attr: 'nodeNew',
    ruleset: 'ruleSet',
    eof: 'ruleNew',
};
const EXPECTED_REASON = {
    attr: 'malformed',
    ruleset: 'bad_target',
    eof: 'address_miss',
};
function foldApplyHonestyDesync(chassis, kind) {
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
        return [
            {
                id,
                status: 'fail',
                reason: row.applyError ?? 'client snapshot not desynced after inject',
            },
        ];
    }
    const err = (row.applyError ?? '').toLowerCase();
    const wantReason = EXPECTED_REASON[kind];
    const wantOp = EXPECTED_OP[kind];
    if (!err.includes(wantReason.toLowerCase()) || !err.includes(wantOp.toLowerCase())) {
        return [
            {
                id,
                status: 'fail',
                reason: `desynced but applyError=${row.applyError ?? 'null'} want ${wantReason} and ${wantOp}`,
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
//# sourceMappingURL=applyHonestyDesync.js.map