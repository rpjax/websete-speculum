"use strict";
/**
 * Server-side capture of a structural DOM snapshot from the Virtual Chromium page.
 * `projected/domTreeSnapshot.ts` is DOM-typed and esbuild-only (see its header) and must never be
 * imported from tsc-checked code, so this loads its prebuilt standalone bundle
 * (`npm run build:snapshot`) as text and hands it to Patchright's `page.evaluate(string)` —
 * the same "load a prebuilt bundle, inject as a string" pattern already used for the whole
 * Virtual producer (`inject/loadInpageScript.ts`).
 *
 * Session RPC evaluate expressions live in `session/snapshotEvaluate.ts`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.snapshotContextEvaluateExpression = exports.snapshotAllContextsEvaluateExpression = exports.loadSnapshotScriptForEvaluate = exports.coherentSnapshotExpression = void 0;
exports.captureVirtualSnapshot = captureVirtualSnapshot;
const snapshotEvaluate_1 = require("../../session/snapshotEvaluate");
var snapshotEvaluate_2 = require("../../session/snapshotEvaluate");
Object.defineProperty(exports, "coherentSnapshotExpression", { enumerable: true, get: function () { return snapshotEvaluate_2.coherentSnapshotExpression; } });
Object.defineProperty(exports, "loadSnapshotScriptForEvaluate", { enumerable: true, get: function () { return snapshotEvaluate_2.loadSnapshotScriptForEvaluate; } });
Object.defineProperty(exports, "snapshotAllContextsEvaluateExpression", { enumerable: true, get: function () { return snapshotEvaluate_2.snapshotAllContextsEvaluateExpression; } });
Object.defineProperty(exports, "snapshotContextEvaluateExpression", { enumerable: true, get: function () { return snapshotEvaluate_2.snapshotContextEvaluateExpression; } });
/** Captures a structural snapshot of the Virtual page's live `document` (no pixels, no CSSOM). */
async function captureVirtualSnapshot(page) {
    const source = (0, snapshotEvaluate_1.loadSnapshotScriptForEvaluate)();
    const expression = `(() => {\n${source}\nreturn __speculumSnapshot.snapshotTree();\n})()`;
    return page.evaluate(expression);
}
//# sourceMappingURL=virtualSnapshot.js.map