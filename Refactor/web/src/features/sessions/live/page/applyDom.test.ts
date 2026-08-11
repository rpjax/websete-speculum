import { describe, expect, it, vi } from 'vitest'
import type { AssembledFrame, ChildListOp } from './decode'
import { DomFrameApplier } from './applyDom'
import { PageProjectionRegistry } from './registry'

function frameOf(ops: AssembledFrame['ops'], sequence = 1, generation = 1): AssembledFrame {
  return { version: 1, establish: false, resync: false, generation, sequence, ops }
}

function childListOp(overrides: Partial<ChildListOp>): ChildListOp {
  return { op: 'childList', parent: 1, mode: 'full', children: [], ...overrides }
}

describe('DomFrameApplier — childList FULL (§5.4.2)', () => {
  it('moves an existing node instead of destroying and recreating it', () => {
    const registry = new PageProjectionRegistry()
    const parent = document.createElement('div')
    const first = document.createElement('span')
    const second = document.createElement('span')
    parent.append(first, second)
    registry.register(1, parent)
    registry.register(2, first)
    registry.register(3, second)
    // Marker only survives a real DOM move — destroy+recreate would lose it (§5.4.2 rationale).
    ;(second as unknown as { __marker: string }).__marker = 'kept'

    const applier = new DomFrameApplier(document, registry)
    applier.enqueue(
      frameOf([
        childListOp({
          children: [{ kind: 'existing', id: 3 }, { kind: 'existing', id: 2 }],
        }),
      ]),
    )
    applier.flush()

    expect(Array.from(parent.childNodes)).toEqual([second, first])
    expect((parent.firstChild as unknown as { __marker: string }).__marker).toBe('kept')
  })

  it('removes nodes absent from the declared list and unregisters their subtree', () => {
    const registry = new PageProjectionRegistry()
    const parent = document.createElement('div')
    const kept = document.createElement('span')
    const removedRoot = document.createElement('div')
    const removedChild = document.createElement('em')
    removedRoot.appendChild(removedChild)
    parent.append(kept, removedRoot)
    registry.register(1, parent)
    registry.register(2, kept)
    registry.register(3, removedRoot)
    registry.register(4, removedChild)

    const applier = new DomFrameApplier(document, registry)
    applier.enqueue(frameOf([childListOp({ children: [{ kind: 'existing', id: 2 }] })]))
    applier.flush()

    expect(Array.from(parent.childNodes)).toEqual([kept])
    expect(removedRoot.parentNode).toBeNull()
    expect(registry.get(3)).toBeUndefined()
    expect(registry.get(4)).toBeUndefined() // subtree unregistered, not just the root (§5.9.1)
  })

  it('constructs fresh entries and registers every id in the materialized subtree', () => {
    const registry = new PageProjectionRegistry()
    const parent = document.createElement('div')
    registry.register(1, parent)

    const applier = new DomFrameApplier(document, registry)
    applier.enqueue(
      frameOf([
        childListOp({
          children: [
            {
              kind: 'fresh',
              node: {
                id: 10,
                kind: 'element',
                tag: 'p',
                attrs: { class: 'x' },
                children: [{ id: 11, kind: 'text', value: 'hi' }],
              },
            },
          ],
        }),
      ]),
    )
    applier.flush()

    const p = parent.firstElementChild
    expect(p?.tagName).toBe('P')
    expect(p?.getAttribute('class')).toBe('x')
    expect(p?.textContent).toBe('hi')
    expect(registry.get(10)).toBe(p)
    expect(registry.get(11)).toBe(p?.firstChild)
  })

  it('is ACID: an unresolved address desyncs and mutates nothing', () => {
    const registry = new PageProjectionRegistry()
    const parent = document.createElement('div')
    const existing = document.createElement('span')
    parent.appendChild(existing)
    registry.register(1, parent)
    registry.register(2, existing)

    const onDesync = vi.fn()
    const applier = new DomFrameApplier(document, registry, { onDesync })
    applier.enqueue(
      frameOf([
        childListOp({
          children: [{ kind: 'existing', id: 2 }, { kind: 'existing', id: 999 }],
        }),
      ]),
    )
    applier.flush()

    expect(onDesync).toHaveBeenCalledWith({ reason: 'address_miss', op: 'childList', id: 999 })
    // Nothing mutated — the resolve pass failed before any DOM write (§5.4.3).
    expect(Array.from(parent.childNodes)).toEqual([existing])
  })

  it('APPEND adds entries at the end without touching existing children', () => {
    const registry = new PageProjectionRegistry()
    const parent = document.createElement('div')
    const existing = document.createElement('span')
    parent.appendChild(existing)
    registry.register(1, parent)
    registry.register(2, existing)

    const applier = new DomFrameApplier(document, registry)
    applier.enqueue(
      frameOf([
        childListOp({
          mode: 'append',
          children: [{ kind: 'fresh', node: { id: 20, kind: 'element', tag: 'i', attrs: {}, children: [] } }],
        }),
      ]),
    )
    applier.flush()

    expect(Array.from(parent.childNodes)).toEqual([existing, parent.lastChild])
    expect(parent.lastChild?.nodeName).toBe('I')
    expect(registry.get(20)).toBe(parent.lastChild)
  })

  it('applies a patch full snapshot without touching children', () => {
    const registry = new PageProjectionRegistry()
    const parent = document.createElement('div')
    const target = document.createElement('p')
    target.appendChild(document.createTextNode('inner'))
    parent.appendChild(target)
    registry.register(1, target)

    const applier = new DomFrameApplier(document, registry)
    applier.enqueue(
      frameOf([{ op: 'patch', node: 1, snapshot: { kind: 'element', tag: 'p', attrs: { 'data-x': '1' } } }]),
    )
    applier.flush()

    expect(target.getAttribute('data-x')).toBe('1')
    expect(target.textContent).toBe('inner')
  })
})
