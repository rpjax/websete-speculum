/**
 * Dual-run comparison fixture — docs/page-projection-engine-redesign.md §9.
 *
 * "Verification during the rewrite: run the old and the new producer against
 * the same page inside the harness and compare outputs node by node. This is
 * a test fixture, not a product shim, and does not violate the
 * no-V1-aliases rule."
 *
 * Both the current (`DomTreeSerializer.ts`) and redesigned (`fmap.ts`) DOM
 * producers publish the same `{ kind, id, tag, attrs, children, value }`
 * node shape, so this module is a thin adapter over `o2-structural.cjs`'s
 * `diffTrees` applied to exactly two trees instead of three. It carries no
 * product logic and is never imported outside the harness/tests.
 */
'use strict'

const { diffTrees } = require('./o2-structural.cjs')

/**
 * @typedef {import('./o2-structural.cjs').NodeSnap} NodeSnap
 */

/**
 * Compares the old-engine tree against the new-engine tree, node by node.
 * @param {NodeSnap|null|undefined} oldTree Serialized output of the current producer.
 * @param {NodeSnap|null|undefined} newTree Serialized output of the redesigned producer.
 * @returns {{ ok: boolean, errors: string[], results: import('./budgets.cjs').GateResult[] }}
 */
function compareDualRun(oldTree, newTree) {
  const errors = diffTrees(oldTree, newTree, 'old↔new/')
  const ok = errors.length === 0
  return {
    ok,
    errors,
    results: [
      {
        id: 'DualRun.isomorphic',
        ok,
        measured: errors.length,
        target: '0 diffs',
        detail: errors.slice(0, 8).join('; ') || undefined,
      },
    ],
  }
}

/**
 * Parses two JSON-serialized `NodeSnap` trees (as captured from the harness)
 * and compares them. Throws with a clear message on malformed JSON rather
 * than silently treating it as a pass — a fixture must fail loudly.
 * @param {string} oldJson
 * @param {string} newJson
 */
function compareDualRunJson(oldJson, newJson) {
  let oldTree
  let newTree
  try {
    oldTree = JSON.parse(oldJson)
  } catch (err) {
    throw new Error(`compareDualRunJson: old-engine JSON is malformed: ${err.message}`)
  }
  try {
    newTree = JSON.parse(newJson)
  } catch (err) {
    throw new Error(`compareDualRunJson: new-engine JSON is malformed: ${err.message}`)
  }
  return compareDualRun(oldTree, newTree)
}

module.exports = { compareDualRun, compareDualRunJson }
