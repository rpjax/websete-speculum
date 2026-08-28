/**
 * O2 — Structural self-check (redesign §7).
 * CI full: F(Virtual) ↔ Node mirror ↔ client tree must be isomorphic.
 * Production cheap path (Q20): nodeCount + rolling checksum — implemented separately in engine.
 */
'use strict'

/**
 * @typedef {{ kind: string, id?: number, tag?: string, attrs?: Record<string,string>, children?: NodeSnap[], value?: string }} NodeSnap
 */

/**
 * @param {NodeSnap|null|undefined} a
 * @param {NodeSnap|null|undefined} b
 * @param {string} path
 * @returns {string[]}
 */
function diffTrees(a, b, path = '/') {
  /** @type {string[]} */
  const errs = []
  if (!a && !b) return errs
  if (!a || !b) {
    errs.push(`${path}: missing side (${a ? 'b' : 'a'})`)
    return errs
  }
  if (a.kind !== b.kind) errs.push(`${path}: kind ${a.kind}≠${b.kind}`)
  if (a.id != null && b.id != null && a.id !== b.id) errs.push(`${path}: id ${a.id}≠${b.id}`)
  if (a.kind === 'element') {
    if (a.tag !== b.tag) errs.push(`${path}: tag ${a.tag}≠${b.tag}`)
    const ak = Object.keys(a.attrs || {}).sort()
    const bk = Object.keys(b.attrs || {}).sort()
    if (ak.join(',') !== bk.join(',')) errs.push(`${path}: attr keys differ`)
    else {
      for (const k of ak) {
        if ((a.attrs || {})[k] !== (b.attrs || {})[k]) errs.push(`${path}: attr ${k}`)
      }
    }
    const ac = a.children || []
    const bc = b.children || []
    if (ac.length !== bc.length) errs.push(`${path}: childCount ${ac.length}≠${bc.length}`)
    const n = Math.min(ac.length, bc.length)
    for (let i = 0; i < n; i++) errs.push(...diffTrees(ac[i], bc[i], `${path}${a.tag || 'n'}[${i}]/`))
  } else if (a.kind === 'text' || a.kind === 'comment') {
    if (a.value !== b.value) errs.push(`${path}: value diverge`)
  }
  return errs
}

/**
 * Compare three trees: F(Virtual), mirror, client.
 * @returns {{ ok: boolean, results: import('./budgets.cjs').GateResult[], errors: string[] }}
 */
function compareTriple(fVirtual, mirror, client) {
  const e1 = diffTrees(fVirtual, mirror, 'F↔mirror/')
  const e2 = diffTrees(mirror, client, 'mirror↔client/')
  const e3 = diffTrees(fVirtual, client, 'F↔client/')
  const errors = [...e1, ...e2, ...e3]
  const ok = errors.length === 0
  return {
    ok,
    errors,
    results: [
      {
        id: 'O2.isomorphic',
        ok,
        measured: errors.length,
        target: '0 diffs',
        detail: errors.slice(0, 8).join('; ') || undefined,
      },
    ],
  }
}

/** Cheap production variant inputs. */
function compareChecksums(mirrorNodeCount, mirrorChecksum, clientNodeCount, clientChecksum) {
  const countOk = mirrorNodeCount === clientNodeCount
  const sumOk = mirrorChecksum === clientChecksum
  const ok = countOk && sumOk
  return {
    ok,
    results: [
      {
        id: 'O2.prod.nodeCount',
        ok: countOk,
        measured: `${mirrorNodeCount} vs ${clientNodeCount}`,
        target: 'equal',
      },
      {
        id: 'O2.prod.checksum',
        ok: sumOk,
        measured: `${mirrorChecksum} vs ${clientChecksum}`,
        target: 'equal',
      },
    ],
  }
}

module.exports = { diffTrees, compareTriple, compareChecksums }
