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
    return `(() => {
    const p = globalThis.__speculumProjection;
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
      tree,
    };
  })()`;
}
/** Captures a structural snapshot of the Virtual page's live `document` (no pixels, no CSSOM). */
async function captureVirtualSnapshot(page) {
    const source = loadSnapshotScript();
    const expression = `(() => {\n${source}\nreturn __speculumSnapshot.snapshotTree();\n})()`;
    return page.evaluate(expression);
}
//# sourceMappingURL=virtualSnapshot.js.map