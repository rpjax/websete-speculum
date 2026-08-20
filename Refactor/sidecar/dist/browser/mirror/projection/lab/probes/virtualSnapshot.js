"use strict";
/**
 * Server-side capture of a structural DOM snapshot from the Virtual Chromium page.
 * `client/domTreeSnapshot.ts` is DOM-typed and esbuild-only (see its header) and must never be
 * imported from tsc-checked code, so this loads its prebuilt standalone bundle
 * (`npm run build:snapshot`) as text and hands it to Patchright's `page.evaluate(string)` —
 * the same "load a prebuilt bundle, inject as a string" pattern already used for the whole
 * Virtual producer (`inject/loadInpageScript.ts`).
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.coherentSnapshotExpression = coherentSnapshotExpression;
exports.loadSnapshotScriptForEvaluate = loadSnapshotScriptForEvaluate;
exports.snapshotContextEvaluateExpression = snapshotContextEvaluateExpression;
exports.snapshotAllContextsEvaluateExpression = snapshotAllContextsEvaluateExpression;
exports.captureVirtualSnapshot = captureVirtualSnapshot;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const BUNDLE_NAME = 'domTreeSnapshot.js';
let cached;
function candidatePaths() {
    return [
        node_path_1.default.join(__dirname, '..', BUNDLE_NAME),
        node_path_1.default.join(process.cwd(), 'dist', 'browser', 'mirror', 'projection', BUNDLE_NAME),
    ];
}
function loadSnapshotScript() {
    if (cached !== undefined)
        return cached;
    const tried = [];
    for (const candidate of candidatePaths()) {
        tried.push(candidate);
        if (!node_fs_1.default.existsSync(candidate))
            continue;
        cached = node_fs_1.default.readFileSync(candidate, 'utf8');
        return cached;
    }
    throw new Error(`PageProjection snapshot bundle missing (${BUNDLE_NAME}). ` +
        `Run \`npm run build:snapshot\` from the sidecar package. Looked in:\n` +
        tried.map((p) => `  - ${p}`).join('\n'));
}
/** Expression: flush+O2 (+ optional tree) in one document JS turn — DOM cannot mutate mid-call. */
function coherentSnapshotExpression(includeTree, cssom = 'none') {
    const treePart = includeTree
        ? `${loadSnapshotScript()}\n    tree = __speculumSnapshot.snapshotTree();\n`
        : '';
    const cssomLit = JSON.stringify(cssom);
    const includeTreeLit = includeTree ? 'true' : 'false';
    return `(async () => {
    const p = globalThis.__speculumProjection;
    if (p && typeof p.snapshotContext === 'function') {
      const r = await p.snapshotContext(1, { cssom: ${cssomLit}, includeTree: ${includeTreeLit} });
      if (!r.ok) return { ok: false, reason: r.reason ?? 'snapshotContext failed' };
      const v = r.value;
      let tree = v.tree ?? null;
      ${includeTree ? treePart.replace('tree = ', 'if (tree == null) tree = ') : ''}
      return {
        ok: true,
        generation: v.generation,
        sequence: v.sequence,
        tableSize: p.table.size,
        o2: v.o2,
        table: v.table,
        cssom: v.cssom,
        cssomO2: v.cssomO2,
        nodeNewConnected: v.nodeNewConnected,
        cascade: v.cascade,
        formProps: v.formProps,
        tree,
      };
    }
    if (!p || typeof p.flushAndSnapshot !== 'function') {
      return { ok: false, reason: 'flushAndSnapshot missing' };
    }
    const flushed = p.flushAndSnapshot({ cssom: ${cssomLit} });
    let tree = null;
    ${treePart}
    return {
      ok: true,
      generation: flushed.generation,
      sequence: flushed.sequence,
      tableSize: p.table.size,
      o2: flushed.o2,
      table: flushed.table,
      cssom: flushed.cssom,
      cssomO2: flushed.cssomO2,
      nodeNewConnected: flushed.nodeNewConnected,
      cascade: flushed.cascade,
      formProps: flushed.formProps,
      tree,
    };
  })()`;
}
/** Load snapshot bundle as a string suitable for in-page eval (root tree capture). */
function loadSnapshotScriptForEvaluate() {
    return loadSnapshotScript();
}
function snapshotContextEvaluateExpression() {
    return `(async (contextId, opts, treeSrc) => {
    if (treeSrc) { eval(treeSrc); }
    const p = globalThis.__speculumProjection;
    if (!p || typeof p.snapshotContext !== 'function') {
      return { ok: false, reason: 'snapshotContext missing' };
    }
    const r = await p.snapshotContext(contextId, opts);
    if (!r.ok) return r;
    let tree = r.value.tree ?? null;
    if (opts.includeTree && tree == null && typeof __speculumSnapshot?.snapshotTree === 'function') {
      tree = __speculumSnapshot.snapshotTree();
    }
    return { ok: true, value: { ...r.value, tree } };
  })`;
}
function snapshotAllContextsEvaluateExpression() {
    return `(async (contextIds, opts, treeSrc) => {
    if (treeSrc) { eval(treeSrc); }
    const p = globalThis.__speculumProjection;
    if (!p || typeof p.snapshotAllKnown !== 'function') return {};
    const raw = await p.snapshotAllKnown(contextIds, opts);
    const out = {};
    for (const id of contextIds) {
      const entry = raw[id];
      if (!entry || entry.ok === false) {
        out[id] = entry ?? { ok: false, reason: 'missing' };
        continue;
      }
      let tree = entry.tree ?? null;
      if (opts.includeTree && id === 1 && tree == null && typeof __speculumSnapshot?.snapshotTree === 'function') {
        tree = __speculumSnapshot.snapshotTree();
      }
      out[id] = { ok: true, value: { ...entry, tree } };
    }
    return out;
  })`;
}
/** Captures a structural snapshot of the Virtual page's live `document` (no pixels, no CSSOM). */
async function captureVirtualSnapshot(page) {
    const source = loadSnapshotScript();
    const expression = `(() => {\n${source}\nreturn __speculumSnapshot.snapshotTree();\n})()`;
    return page.evaluate(expression);
}
//# sourceMappingURL=virtualSnapshot.js.map