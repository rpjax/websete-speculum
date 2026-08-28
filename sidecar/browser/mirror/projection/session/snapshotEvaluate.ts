/**
 * Neutral in-page snapshot evaluate expressions — shared by session RPC and lab probes.
 * `projected/domTreeSnapshot.ts` stays esbuild-only; this loads its prebuilt bundle as text.
 */

import fs from 'node:fs';
import path from 'node:path';

const BUNDLE_NAME = 'domTreeSnapshot.js';

let cached: string | undefined;

function candidatePaths(): string[] {
  return [
    path.join(__dirname, '..', BUNDLE_NAME),
    path.join(process.cwd(), 'dist', 'browser', 'mirror', 'projection', BUNDLE_NAME),
  ];
}

function loadSnapshotScript(): string {
  if (cached !== undefined) return cached;

  const tried: string[] = [];
  for (const candidate of candidatePaths()) {
    tried.push(candidate);
    if (!fs.existsSync(candidate)) continue;
    cached = fs.readFileSync(candidate, 'utf8');
    return cached;
  }

  throw new Error(
    `PageProjection snapshot bundle missing (${BUNDLE_NAME}). ` +
      `Run \`npm run build:snapshot\` from the sidecar package. Looked in:\n` +
      tried.map((p) => `  - ${p}`).join('\n'),
  );
}

/** Expression: flush+O2 (+ optional tree) in one document JS turn — DOM cannot mutate mid-call. */
export function coherentSnapshotExpression(
  includeTree: boolean,
  cssom: 'none' | 'committed' | 'scan' = 'none',
): string {
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
export function loadSnapshotScriptForEvaluate(): string {
  return loadSnapshotScript();
}

export function snapshotContextEvaluateExpression(): string {
  return `(async (contextId, opts, treeSrc) => {
    if (treeSrc) { eval(treeSrc); }
    const p = globalThis.__speculumProjection;
    if (!p || typeof p.snapshotContext !== 'function') {
      return { ok: false, reason: 'snapshotContext missing' };
    }
    const r = await p.snapshotContext(contextId, opts);
    if (!r.ok) return r;
    return { ok: true, value: r.value };
  })`;
}
