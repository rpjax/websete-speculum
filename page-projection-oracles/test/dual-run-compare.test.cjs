'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { compareDualRun, compareDualRunJson } = require('../dual-run-compare.cjs')

function tree(overrides = {}) {
  return {
    kind: 'element',
    id: 1,
    tag: 'div',
    attrs: { class: 'root' },
    children: [
      { kind: 'text', id: 2, value: 'hello' },
    ],
    ...overrides,
  }
}

test('dual-run: identical old/new trees pass with zero diffs', () => {
  const result = compareDualRun(tree(), tree())
  assert.equal(result.ok, true)
  assert.deepEqual(result.errors, [])
  assert.equal(result.results[0].ok, true)
})

test('dual-run: a tag divergence between engines fails with a located diff', () => {
  const oldTree = tree()
  const newTree = tree({ tag: 'span' })
  const result = compareDualRun(oldTree, newTree)
  assert.equal(result.ok, false)
  assert.ok(result.errors.some((e) => e.includes('tag')))
  assert.equal(result.results[0].ok, false)
})

test('dual-run: a child-count divergence fails', () => {
  const oldTree = tree()
  const newTree = tree({ children: [] })
  const result = compareDualRun(oldTree, newTree)
  assert.equal(result.ok, false)
  assert.ok(result.errors.some((e) => e.includes('childCount')))
})

test('dual-run JSON: parses and compares captured harness fixtures', () => {
  const result = compareDualRunJson(JSON.stringify(tree()), JSON.stringify(tree()))
  assert.equal(result.ok, true)
})

test('dual-run JSON: malformed JSON fails loudly, never silently passes', () => {
  assert.throws(() => compareDualRunJson('{not json', JSON.stringify(tree())), /malformed/)
})
