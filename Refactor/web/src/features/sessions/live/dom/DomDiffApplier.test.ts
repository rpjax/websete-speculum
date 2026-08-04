import { afterEach, describe, expect, it, vi } from 'vitest'
import { DomDiffApplier } from './DomDiffApplier'

describe('DomDiffApplier', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('applies snapshot then setText patch inside rAF', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const applier = new DomDiffApplier(host)

    let rafCb: FrameRequestCallback | null = null
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafCb = cb
      return 1
    })

    applier.enqueue({
      sequence: 1,
      generation: 1,
      timestamp: 0,
      kind: 'snapshot',
      root: {
        id: 1,
        tag: 'div',
        children: [{ id: 2, tag: '#text', text: 'hello' }],
      },
    })
    expect(rafCb).toBeTruthy()
    rafCb!(0)
    expect(host.querySelector('[data-speculum-id="1"]')?.textContent).toBe('hello')

    applier.enqueue({
      sequence: 2,
      generation: 1,
      timestamp: 0,
      kind: 'patch',
      ops: [{ op: 'setText', id: 2, text: 'world' }],
    })
    rafCb!(0)
    expect(host.textContent).toBe('world')

    applier.reset()
    host.remove()
  })

  it('reports sequence gaps and skips blind patches', () => {
    const host = document.createElement('div')
    const gaps: Array<[number, number]> = []
    const applier = new DomDiffApplier(host, undefined, (expected, got) => {
      gaps.push([expected, got])
    })

    let rafCb: FrameRequestCallback | null = null
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafCb = cb
      return 1
    })

    applier.enqueue({
      sequence: 1,
      generation: 1,
      timestamp: 0,
      kind: 'snapshot',
      root: { id: 1, tag: 'div', children: [{ id: 2, tag: '#text', text: 'a' }] },
    })
    rafCb!(0)

    applier.enqueue({
      sequence: 4,
      generation: 1,
      timestamp: 0,
      kind: 'patch',
      ops: [{ op: 'setText', id: 2, text: 'skip' }],
    })
    rafCb!(0)

    expect(gaps).toEqual([[2, 4]])
    expect(host.textContent).toBe('a')
  })

  it('flattens html/head/body into the host without nesting documentElement', () => {
    const host = document.createElement('div')
    const resolve = (hash: string) => `/assets/${hash}`
    const applier = new DomDiffApplier(host, resolve)

    let rafCb: FrameRequestCallback | null = null
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafCb = cb
      return 1
    })

    applier.enqueue({
      sequence: 1,
      generation: 1,
      timestamp: 0,
      kind: 'snapshot',
      root: {
        id: 1,
        tag: 'html',
        children: [
          {
            id: 2,
            tag: 'head',
            children: [
              {
                id: 3,
                tag: 'link',
                attrs: { rel: 'stylesheet', href: 'speculum-asset:abc' },
              },
            ],
          },
          {
            id: 4,
            tag: 'body',
            children: [
              { id: 5, tag: 'h1', children: [{ id: 6, tag: '#text', text: 'Hello' }] },
            ],
          },
        ],
      },
    })
    rafCb!(0)

    expect(host.querySelector('html')).toBeNull()
    expect(host.querySelector('body')).toBeNull()
    expect(host.querySelector('link')?.getAttribute('href')).toBe('/assets/abc')
    expect(host.querySelector('h1')?.textContent).toBe('Hello')
  })

  it('skips insert when parent id resolves to a text node', () => {
    const host = document.createElement('div')
    const applier = new DomDiffApplier(host)

    let rafCb: FrameRequestCallback | null = null
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafCb = cb
      return 1
    })

    applier.enqueue({
      sequence: 1,
      generation: 1,
      timestamp: 0,
      kind: 'snapshot',
      root: {
        id: 1,
        tag: 'div',
        children: [{ id: 2, tag: '#text', text: 'x' }],
      },
    })
    rafCb!(0)

    expect(() => {
      applier.enqueue({
        sequence: 2,
        generation: 1,
        timestamp: 0,
        kind: 'patch',
        ops: [
          {
            op: 'insert',
            id: 3,
            parentId: 2,
            index: 0,
            node: { id: 3, tag: 'span', children: [{ id: 4, tag: '#text', text: 'y' }] },
          },
        ],
      })
      rafCb!(0)
    }).not.toThrow()
    expect(host.querySelector('span')).toBeNull()
  })

  it('drops preload links without as', () => {
    const host = document.createElement('div')
    const applier = new DomDiffApplier(host)

    let rafCb: FrameRequestCallback | null = null
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafCb = cb
      return 1
    })

    applier.enqueue({
      sequence: 1,
      generation: 1,
      timestamp: 0,
      kind: 'snapshot',
      root: {
        id: 1,
        tag: 'div',
        children: [
          { id: 2, tag: 'link', attrs: { rel: 'preload', href: 'speculum-asset:x' } },
          { id: 3, tag: 'link', attrs: { rel: 'stylesheet', href: 'speculum-asset:y' } },
        ],
      },
    })
    rafCb!(0)

    expect(host.querySelectorAll('link')).toHaveLength(1)
    expect(host.querySelector('link')?.getAttribute('rel')).toBe('stylesheet')
  })
})
