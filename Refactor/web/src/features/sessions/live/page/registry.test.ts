import { describe, expect, it } from 'vitest'
import { PageProjectionRegistry } from './registry'

describe('PageProjectionRegistry', () => {
  it('resolves ids in both directions in O(1)', () => {
    const registry = new PageProjectionRegistry()
    const node = document.createElement('div')
    registry.register(5, node)
    expect(registry.get(5)).toBe(node)
    expect(registry.idOf(node)).toBe(5)
    expect(registry.size).toBe(1)
  })

  it('idOfNearest walks up to the nearest registered ancestor', () => {
    const registry = new PageProjectionRegistry()
    const parent = document.createElement('div')
    const child = document.createElement('span')
    parent.appendChild(child)
    registry.register(1, parent)
    expect(registry.idOfNearest(child)).toBe(1)
    expect(registry.idOfNearest(parent)).toBe(1)
    expect(registry.idOfNearest(null)).toBeUndefined()
  })

  it('unregister removes exactly one id without touching descendants', () => {
    const registry = new PageProjectionRegistry()
    const parent = document.createElement('div')
    const child = document.createElement('span')
    parent.appendChild(child)
    registry.register(1, parent)
    registry.register(2, child)
    registry.unregister(1)
    expect(registry.get(1)).toBeUndefined()
    expect(registry.get(2)).toBe(child)
  })

  it('unregisterSubtree drops the root and every descendant carrying an id (§5.9.1)', () => {
    const registry = new PageProjectionRegistry()
    const root = document.createElement('div')
    const mid = document.createElement('span')
    const leafText = document.createTextNode('hi')
    root.appendChild(mid)
    mid.appendChild(leafText)
    registry.register(1, root)
    registry.register(2, mid)
    registry.register(3, leafText)

    registry.unregisterSubtree(root)

    expect(registry.get(1)).toBeUndefined()
    expect(registry.get(2)).toBeUndefined()
    expect(registry.get(3)).toBeUndefined()
    expect(registry.size).toBe(0)
  })

  it('unregisterSubtree on a nested node only removes that subtree, not siblings', () => {
    const registry = new PageProjectionRegistry()
    const parent = document.createElement('div')
    const keep = document.createElement('span')
    const drop = document.createElement('span')
    parent.appendChild(keep)
    parent.appendChild(drop)
    registry.register(1, parent)
    registry.register(2, keep)
    registry.register(3, drop)

    registry.unregisterSubtree(drop)

    expect(registry.get(1)).toBe(parent)
    expect(registry.get(2)).toBe(keep)
    expect(registry.get(3)).toBeUndefined()
  })

  it('buildFromDocument walks once, registers every speculum-anchor id, and returns a stable checksum', () => {
    const registry = new PageProjectionRegistry()
    const root = document.createElement('html')
    root.setAttribute('speculum-anchor', '1')
    const body = document.createElement('body')
    body.setAttribute('speculum-anchor', '2')
    const p = document.createElement('p')
    p.setAttribute('speculum-anchor', '3')
    root.appendChild(body)
    body.appendChild(p)

    const first = registry.buildFromDocument(root)
    expect(first.nodeCount).toBe(3)
    expect(registry.get(1)).toBe(root)
    expect(registry.get(2)).toBe(body)
    expect(registry.get(3)).toBe(p)

    const registryAgain = new PageProjectionRegistry()
    const second = registryAgain.buildFromDocument(root)
    expect(second.checksum).toBe(first.checksum)
  })

  it('buildFromDocument ignores elements without a speculum-anchor attribute', () => {
    const registry = new PageProjectionRegistry()
    const root = document.createElement('div')
    root.setAttribute('speculum-anchor', '1')
    const noise = document.createElement('div')
    root.appendChild(noise)

    const { nodeCount } = registry.buildFromDocument(root)
    expect(nodeCount).toBe(1)
    expect(registry.idOf(noise)).toBeUndefined()
  })

  it('clear drops every entry', () => {
    const registry = new PageProjectionRegistry()
    registry.register(1, document.createElement('div'))
    registry.clear()
    expect(registry.size).toBe(0)
    expect(registry.get(1)).toBeUndefined()
  })
})
