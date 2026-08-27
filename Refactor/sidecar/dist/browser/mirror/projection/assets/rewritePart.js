"use strict";
/**
 * D-SPEC-7 — Node rewrite hop: decode → rewrite URL strings → rehash CHECK/preTableHash → re-encode.
 *
 * Rewriting attr/CSS URL strings changes `contentHash`. Emitting the producer's original
 * `preTableHash`/`CHECK` would desync every client. After rewrite we apply into a session-scoped
 * sidecar `ReplicatedTable` and stamp hashes that match the rewritten ops.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FrameRewriteHop = void 0;
exports.rewritePart = rewritePart;
const decode_1 = require("@speculum/page-projection/core/decode");
const frame_1 = require("@speculum/page-projection/core/frame");
const opcodes_1 = require("@speculum/page-projection/core/opcodes");
const replicatedTable_1 = require("@speculum/page-projection/core/replicatedTable");
const replicatedTableApply_1 = require("@speculum/page-projection/core/replicatedTableApply");
const binaryFrameEncoder_1 = require("@speculum/page-projection/virtual/frame/binaryFrameEncoder");
const urlForms_1 = require("./urlForms");
function evaluateCheck(table, op) {
    return op.scope === frame_1.CHECK_SCOPE_RANGE ? table.hashRange(op.lo, op.hi) : table.tableHash;
}
/**
 * Session-scoped rewrite hop. Buffer multi-part frames until complete, then emit rehashed parts.
 * OPEN-6: one replicated table + assembler per `contextId` — nested frames must not poison root
 * `preTableHash`/`CHECK`.
 */
class FrameRewriteHop {
    contexts = new Map();
    encoder = new binaryFrameEncoder_1.BinaryFrameEncoder();
    contextState(contextId) {
        let state = this.contexts.get(contextId);
        if (state === undefined) {
            state = {
                table: new replicatedTable_1.ReplicatedTable(),
                persistent: new decode_1.PersistentStringTable(),
                assembler: new decode_1.FramePartAssembler(),
            };
            this.contexts.set(contextId, state);
        }
        return state;
    }
    /** Call on navigate / session stop — producer table identity resets with the page. */
    reset() {
        this.contexts.clear();
    }
    /**
     * Ingest one wire part. Returns zero or more rewritten parts to relay (empty while buffering
     * a multi-part frame).
     */
    push(input, ctx) {
        const hdr = (0, decode_1.peekFrameHeader)(input);
        if (hdr === null)
            return [input];
        const scope = this.contextState(hdr.contextId);
        const decoded = (0, decode_1.decodeFramePart)(input, scope.persistent);
        if (!decoded.ok)
            return [input];
        const pageBase = ctx.pageUrl || 'https://invalid.local/';
        const seen = new Set();
        const onRewrite = (result) => {
            const dedupeKey = result.kind === 'http'
                ? result.key
                : result.kind === 'data' || result.kind === 'blob'
                    ? result.id
                    : result.value;
            if (seen.has(dedupeKey))
                return;
            seen.add(dedupeKey);
            ctx.assets.materializeRewrite(result);
        };
        const part = {
            ...decoded.part,
            ops: decoded.part.ops.map((op) => rewriteOp(op, pageBase, onRewrite)),
        };
        const assembled = scope.assembler.ingest(part);
        if (assembled === null)
            return [];
        if (assembled === 'missing_part' || assembled === 'malformed') {
            // Fall back to original bytes for this part only — better a single corrupt part than silence.
            return [input];
        }
        const { preTableHash, ops } = rehashFrame(scope.table, assembled.resync, assembled.sequence, assembled.ops);
        const frame = {
            version: frame_1.FRAME_WIRE_VERSION,
            flags: { resync: assembled.resync },
            contextId: assembled.contextId,
            generation: assembled.generation,
            sequence: assembled.sequence,
            preTableHash,
            ops,
        };
        return this.encoder.encode(frame);
    }
}
exports.FrameRewriteHop = FrameRewriteHop;
function rehashFrame(table, resync, sequence, ops) {
    if (resync)
        table.reset();
    table.setSequence(sequence);
    const preTableHash = table.tableHash;
    const out = new Array(ops.length);
    for (let i = 0; i < ops.length; i++) {
        const op = ops[i];
        if (op.op === opcodes_1.OpCode.Check) {
            out[i] = { ...op, hash: evaluateCheck(table, op) };
            continue;
        }
        (0, replicatedTableApply_1.applyOpToTable)(table, op);
        out[i] = op;
    }
    return { preTableHash, ops: out };
}
function rewriteOp(op, pageBase, onRewrite) {
    switch (op.op) {
        case opcodes_1.OpCode.NodeNew:
            if (op.kind === opcodes_1.NodeKind.Element && op.attrs.length > 0) {
                return { ...op, attrs: rewriteAttrs(op.attrs, pageBase, onRewrite) };
            }
            return op;
        case opcodes_1.OpCode.AttrSet:
            return { ...op, attrs: rewriteAttrs(op.attrs, pageBase, onRewrite) };
        case opcodes_1.OpCode.RuleNew:
            return { ...op, text: (0, urlForms_1.rewriteCssText)(op.text, pageBase, onRewrite) };
        case opcodes_1.OpCode.RuleSet:
            return { ...op, text: (0, urlForms_1.rewriteCssText)(op.text, pageBase, onRewrite) };
        default:
            return op;
    }
}
function rewriteAttrs(attrs, pageBase, onRewrite) {
    return attrs.map(({ name, value }) => {
        if (!urlForms_1.URL_ATTR_NAMES.has(name.toLowerCase()))
            return { name, value };
        return { name, value: (0, urlForms_1.rewriteAttrValue)(name, value, pageBase, onRewrite) };
    });
}
/** @deprecated use {@link FrameRewriteHop} — kept for unit imports that only need string rewrite. */
function rewritePart(input, ctx) {
    const hop = new FrameRewriteHop();
    const out = hop.push(input, ctx);
    return out[0] ?? input;
}
//# sourceMappingURL=rewritePart.js.map