"use strict";
/**
 * Lab caller table apply — Phase 1 only (`applyFrameToTableChecked`).
 * Not a BrowserSession primitive; not a second Chromium page.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.NodeTableApplier = void 0;
const decode_1 = require("../../models/decode");
const replicatedTable_1 = require("../../models/replicatedTable");
const replicatedTableApply_1 = require("../../models/replicatedTableApply");
const tableDigest_1 = require("../../models/tableDigest");
function formatApplyError(result) {
    if (result.opName === 'check') {
        return `check mismatch expected=${result.expected} actual=${result.actual}`;
    }
    return result.message;
}
class NodeTableApplier {
    persistent = new decode_1.PersistentStringTable();
    assembler = new decode_1.FramePartAssembler();
    table = new replicatedTable_1.ReplicatedTable();
    lastSequence = 0;
    lastError = null;
    get sequence() {
        return this.lastSequence;
    }
    get lastApplyError() {
        return this.lastError;
    }
    digest() {
        return (0, tableDigest_1.digestReplicatedTable)(this.table);
    }
    snapshot() {
        return {
            tree: null,
            table: this.digest(),
            sequence: this.lastSequence,
            applyError: this.lastError,
        };
    }
    observeFrameBytes(buf) {
        const decoded = (0, decode_1.decodeFramePart)(buf, this.persistent);
        if (!decoded.ok) {
            this.lastError = `${decoded.reason}: ${decoded.message}`;
            return;
        }
        const assembled = this.assembler.ingest(decoded.part);
        if (assembled === 'missing_part') {
            this.lastError = 'missing_part';
            return;
        }
        if (assembled === null)
            return;
        const result = (0, replicatedTableApply_1.applyFrameToTableChecked)(this.table, assembled.resync, assembled.ops, assembled.sequence);
        if (!result.ok) {
            this.lastError = formatApplyError(result);
            return;
        }
        this.lastError = null;
        this.lastSequence = assembled.sequence;
    }
}
exports.NodeTableApplier = NodeTableApplier;
//# sourceMappingURL=nodeTableApply.js.map