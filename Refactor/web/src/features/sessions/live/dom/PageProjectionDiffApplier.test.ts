import { describe, expect, it, vi } from 'vitest'
import { PageProjectionDiffApplier, pageProjectionLagMs } from './PageProjectionDiffApplier'
import type { PageProjectionDiff } from '@/lib/speculum'

function documentDiff(overrides: Partial<PageProjectionDiff> = {}): PageProjectionDiff {
  return {
    sequence: 1,
    generation: 1,
    timestamp: 1,
    plane: 'dom',
    operation: 'document',
    document: {
      root: {
        anchor: 'html1',
        tag: 'html',
        attrs: { 'speculum-anchor': 'html1' },
        children: [
          {
            anchor: 'body1',
            tag: 'body',
            attrs: { 'speculum-anchor': 'body1' },
            children: [
              {
                anchor: 'p1',
                tag: 'p',
                attrs: { 'speculum-anchor': 'p1', class: 'x' },
                children: [{ tag: '#text', text: 'hello' }],
              },
            ],
          },
        ],
      },
    },
    ...overrides,
  }
}

describe('PageProjectionDiffApplier', () => {
  it('applies document and mounts body content', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const applier = new PageProjectionDiffApplier(host)
    applier.enqueue(documentDiff())
    applier.flush()
    expect(applier.getGeneration()).toBe(1)
    expect(host.querySelector('[speculum-anchor="p1"]')?.textContent).toBe('hello')
    host.remove()
  })

  it('applies childList add then remove', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const applier = new PageProjectionDiffApplier(host)
    applier.enqueue(documentDiff())
    applier.flush()

    applier.enqueue({
      sequence: 2,
      generation: 1,
      timestamp: 2,
      plane: 'dom',
      operation: 'childList',
      childList: {
        selector: { kind: 'element', query: '[speculum-anchor="body1"]' },
        removed: [],
        added: [
          {
            index: 1,
            node: {
              anchor: 'span1',
              tag: 'span',
              attrs: { 'speculum-anchor': 'span1' },
              children: [{ tag: '#text', text: 'added' }],
            },
          },
        ],
      },
    })
    applier.flush()
    expect(host.querySelector('[speculum-anchor="span1"]')?.textContent).toBe('added')

    applier.enqueue({
      sequence: 3,
      generation: 1,
      timestamp: 3,
      plane: 'dom',
      operation: 'childList',
      childList: {
        selector: { kind: 'element', query: '[speculum-anchor="body1"]' },
        removed: [{ selector: { kind: 'element', query: '[speculum-anchor="span1"]' } }],
        added: [],
      },
    })
    applier.flush()
    expect(host.querySelector('[speculum-anchor="span1"]')).toBeNull()
    host.remove()
  })

  it('applies patch attrs without wiping children', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const applier = new PageProjectionDiffApplier(host)
    applier.enqueue(documentDiff())
    applier.flush()
    applier.enqueue({
      sequence: 2,
      generation: 1,
      timestamp: 2,
      plane: 'dom',
      operation: 'patch',
      patch: {
        selector: { kind: 'element', query: '[speculum-anchor="p1"]' },
        node: {
          anchor: 'p1',
          tag: 'p',
          attrs: { 'speculum-anchor': 'p1', class: 'y', 'data-x': '1' },
        },
      },
    })
    applier.flush()
    const p = host.querySelector('[speculum-anchor="p1"]')
    expect(p?.getAttribute('class')).toBe('y')
    expect(p?.getAttribute('data-x')).toBe('1')
    expect(p?.textContent).toBe('hello')
    host.remove()
  })

  it('reports sequence gap and marks desynced', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const onGap = vi.fn()
    const applier = new PageProjectionDiffApplier(host, undefined, onGap)
    applier.enqueue(documentDiff())
    applier.flush()
    applier.enqueue({
      sequence: 4,
      generation: 1,
      timestamp: 4,
      plane: 'dom',
      operation: 'patch',
      patch: {
        selector: { kind: 'element', query: '[speculum-anchor="p1"]' },
        node: { anchor: 'p1', tag: 'p', attrs: { 'speculum-anchor': 'p1' } },
      },
    })
    applier.flush()
    expect(onGap).toHaveBeenCalledWith(
      expect.objectContaining({
        expected: 2,
        got: 4,
        reason: 'sequence_gap',
        generation: 1,
        operation: 'patch',
        plane: 'dom',
      }),
    )
    expect(applier.isDesynced()).toBe(true)
    host.remove()
  })

  it('applies cssom install into owned styles', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const applier = new PageProjectionDiffApplier(host)
    applier.enqueue(documentDiff())
    applier.flush()
    applier.enqueue({
      sequence: 2,
      generation: 1,
      timestamp: 2,
      plane: 'cssom',
      operation: 'install',
      install: {
        sheets: [
          {
            id: 's1',
            scope: { kind: 'main' },
            rules: [{ id: 'r1', cssText: 'p { color: rgb(255, 0, 0); }' }],
          },
        ],
      },
    })
    applier.flush()
    const style = host.querySelector('style[data-speculum-cssom-id="s1"]')
    expect(style).toBeTruthy()
    expect((style as HTMLStyleElement).sheet?.cssRules.length).toBeGreaterThan(0)
    host.remove()
  })

  it('patches a text run addressed by childAt', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const applier = new PageProjectionDiffApplier(host)
    applier.enqueue(documentDiff())
    applier.flush()
    applier.enqueue({
      sequence: 2,
      generation: 1,
      timestamp: 2,
      plane: 'dom',
      operation: 'patch',
      patch: {
        selector: { kind: 'childAt', query: '[speculum-anchor="p1"]', index: 0 },
        node: { tag: '#text', text: 'edited' },
      },
    })
    applier.flush()
    expect(host.querySelector('[speculum-anchor="p1"]')?.textContent).toBe('edited')
    host.remove()
  })

  it('desyncs the whole childList when one address misses (no partial apply)', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const onGap = vi.fn()
    const applier = new PageProjectionDiffApplier(host, undefined, onGap)
    applier.enqueue(documentDiff())
    applier.flush()
    applier.enqueue({
      sequence: 2,
      generation: 1,
      timestamp: 2,
      plane: 'dom',
      operation: 'childList',
      childList: {
        selector: { kind: 'element', query: '[speculum-anchor="body1"]' },
        removed: [
          { selector: { kind: 'element', query: '[speculum-anchor="p1"]' } },
          { selector: { kind: 'element', query: '[speculum-anchor="ghost"]' } },
        ],
        added: [
          {
            index: 0,
            node: {
              anchor: 'span9',
              tag: 'span',
              attrs: { 'speculum-anchor': 'span9' },
              children: [{ tag: '#text', text: 'nine' }],
            },
          },
        ],
      },
    })
    applier.flush()
    expect(onGap).toHaveBeenCalledWith(
      expect.objectContaining({
        expected: 2,
        got: 2,
        reason: 'address_miss',
        phase: 'removed',
        generation: 1,
        matchCount: 0,
        selector: expect.objectContaining({
          kind: 'element',
          query: '[speculum-anchor="ghost"]',
        }),
      }),
    )
    expect(applier.isDesynced()).toBe(true)
    expect(host.querySelector('[speculum-anchor="p1"]')?.textContent).toBe('hello')
    expect(host.querySelector('[speculum-anchor="span9"]')).toBeNull()
    host.remove()
  })

  it('applies scrollElement to the addressed scroller', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const applier = new PageProjectionDiffApplier(host)
    applier.enqueue(documentDiff())
    applier.flush()
    applier.enqueue({
      sequence: 2,
      generation: 1,
      timestamp: 2,
      plane: 'dom',
      operation: 'scrollElement',
      scrollElement: {
        selector: { kind: 'element', query: '[speculum-anchor="p1"]' },
        scrollTop: 40,
        scrollLeft: 12,
      },
    })
    applier.flush()
    const p = host.querySelector('[speculum-anchor="p1"]') as HTMLElement
    expect(p.scrollTop).toBe(40)
    expect(p.scrollLeft).toBe(12)
    host.remove()
  })

  it('mutates owned cssom rules in place for ruleList and patch', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const applier = new PageProjectionDiffApplier(host)
    applier.enqueue(documentDiff())
    applier.flush()
    applier.enqueue({
      sequence: 2,
      generation: 1,
      timestamp: 2,
      plane: 'cssom',
      operation: 'install',
      install: {
        sheets: [
          {
            id: 's1',
            scope: { kind: 'main' },
            rules: [{ id: 'r1', cssText: '.a { color: rgb(255, 0, 0); }' }],
          },
        ],
      },
    })
    applier.flush()
    applier.enqueue({
      sequence: 3,
      generation: 1,
      timestamp: 3,
      plane: 'cssom',
      operation: 'ruleList',
      ruleList: {
        selector: { kind: 'sheet', id: 's1' },
        removed: [],
        added: [{ index: 1, rule: { id: 'r2', cssText: '.b { color: rgb(0, 0, 255); }' } }],
      },
    })
    applier.flush()
    applier.enqueue({
      sequence: 4,
      generation: 1,
      timestamp: 4,
      plane: 'cssom',
      operation: 'patch',
      cssomPatch: {
        selector: { kind: 'rule', id: 'r1' },
        rule: { id: 'r1', cssText: '.a { color: rgb(0, 128, 0); }' },
      },
    })
    applier.flush()
    const sheet = (host.querySelector('style[data-speculum-cssom-id="s1"]') as HTMLStyleElement)
      .sheet!
    const rules = Array.from(sheet.cssRules).map((r) => r.cssText)
    expect(rules).toHaveLength(2)
    expect(rules[0]).toContain('rgb(0, 128, 0)')
    expect(rules[1]).toContain('rgb(0, 0, 255)')
    host.remove()
  })

  it('desyncs when a cssom op addresses an unknown sheet id', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const onGap = vi.fn()
    const applier = new PageProjectionDiffApplier(host, undefined, onGap)
    applier.enqueue(documentDiff())
    applier.flush()
    applier.enqueue({
      sequence: 2,
      generation: 1,
      timestamp: 2,
      plane: 'cssom',
      operation: 'ruleList',
      ruleList: {
        selector: { kind: 'sheet', id: 'missing' },
        removed: [],
        added: [{ index: 0, rule: { id: 'r1', cssText: '.a { color: rgb(255, 0, 0); }' } }],
      },
    })
    applier.flush()
    expect(onGap).toHaveBeenCalledWith(
      expect.objectContaining({
        expected: 2,
        got: 2,
        reason: 'address_miss',
        phase: 'parent',
        generation: 1,
      }),
    )
    expect(applier.isDesynced()).toBe(true)
    host.remove()
  })

  it('desyncs on a superseded (lower) generation instead of silent drop', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const onGap = vi.fn()
    const applier = new PageProjectionDiffApplier(host, undefined, onGap)
    applier.enqueue(documentDiff({ generation: 2 }))
    applier.flush()
    applier.enqueue({
      sequence: 2,
      generation: 1,
      timestamp: 2,
      plane: 'dom',
      operation: 'patch',
      patch: {
        selector: { kind: 'element', query: '[speculum-anchor="p1"]' },
        node: { anchor: 'p1', tag: 'p', attrs: { 'speculum-anchor': 'p1', class: 'stale' } },
      },
    })
    applier.flush()
    expect(applier.isDesynced()).toBe(true)
    expect(onGap).toHaveBeenCalled()
    expect(host.querySelector('[speculum-anchor="p1"]')?.getAttribute('class')).toBe('x')
    host.remove()
  })

  it('buffers live envelopes while desynced until OOB joint resync', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const applier = new PageProjectionDiffApplier(host)
    applier.enqueue(documentDiff())
    applier.flush()
    applier.enqueue({
      sequence: 4,
      generation: 1,
      timestamp: 4,
      plane: 'dom',
      operation: 'patch',
      patch: {
        selector: { kind: 'element', query: '[speculum-anchor="p1"]' },
        node: { anchor: 'p1', tag: 'p', attrs: { 'speculum-anchor': 'p1', class: 'late' } },
      },
    })
    applier.flush()
    expect(applier.isDesynced()).toBe(true)
    expect(host.querySelector('[speculum-anchor="p1"]')?.getAttribute('class')).toBe('x')

    // Live document alone must not clear desync (C8 — joint OOB only).
    applier.enqueue(documentDiff({ sequence: 5 }))
    applier.flush()
    expect(applier.isDesynced()).toBe(true)

    applier.applyOobResync({
      generation: 1,
      coversThroughSequence: 5,
      root: documentDiff().document!.root,
      sheets: [],
    })
    expect(applier.isDesynced()).toBe(false)
    host.remove()
  })

  it('ignores duplicate or late sequences without desync', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const dropped: string[] = []
    const applier = new PageProjectionDiffApplier(
      host,
      undefined,
      undefined,
      undefined,
      undefined,
      (reason) => {
        dropped.push(reason)
      },
    )
    applier.enqueue(documentDiff())
    applier.flush()
    applier.enqueue({
      sequence: 2,
      generation: 1,
      timestamp: 2,
      plane: 'dom',
      operation: 'patch',
      patch: {
        selector: { kind: 'element', query: '[speculum-anchor="p1"]' },
        node: {
          anchor: 'p1',
          tag: 'p',
          attrs: { 'speculum-anchor': 'p1', class: 'once' },
          children: [{ tag: '#text', text: 'hello' }],
        },
      },
    })
    applier.flush()
    expect(applier.isDesynced()).toBe(false)
    expect(host.querySelector('[speculum-anchor="p1"]')?.getAttribute('class')).toBe('once')
    applier.enqueue({
      sequence: 2,
      generation: 1,
      timestamp: 3,
      plane: 'dom',
      operation: 'patch',
      patch: {
        selector: { kind: 'element', query: '[speculum-anchor="p1"]' },
        node: {
          anchor: 'p1',
          tag: 'p',
          attrs: { 'speculum-anchor': 'p1', class: 'dup' },
          children: [{ tag: '#text', text: 'hello' }],
        },
      },
    })
    applier.flush()
    expect(applier.isDesynced()).toBe(false)
    expect(dropped).toContain('stale_sequence')
    expect(host.querySelector('[speculum-anchor="p1"]')?.getAttribute('class')).toBe('once')
    host.remove()
  })

  it('buffers generation_ahead frames and applies them after OOB resync', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const onGap = vi.fn()
    const applier = new PageProjectionDiffApplier(host, undefined, onGap)
    applier.enqueue(documentDiff({ generation: 1 }))
    applier.flush()
    applier.enqueue({
      sequence: 2,
      generation: 2,
      timestamp: 2,
      plane: 'dom',
      operation: 'patch',
      patch: {
        selector: { kind: 'element', query: '[speculum-anchor="p1"]' },
        node: { anchor: 'p1', tag: 'p', attrs: { 'speculum-anchor': 'p1', class: 'ahead' } },
      },
    })
    applier.flush()
    expect(onGap).toHaveBeenCalledWith(
      expect.objectContaining({
        expected: 2,
        got: 2,
        reason: 'generation_ahead',
        generation: 1,
        operation: 'patch',
        plane: 'dom',
      }),
    )
    expect(applier.isDesynced()).toBe(true)

    applier.applyOobResync({
      generation: 2,
      coversThroughSequence: 1,
      root: documentDiff({ generation: 2 }).document!.root,
      sheets: [],
    })
    expect(applier.isDesynced()).toBe(false)
    expect(host.querySelector('[speculum-anchor="p1"]')?.getAttribute('class')).toBe('ahead')
    host.remove()
  })

  it('does not notify onGeneration when OOB drain re-desyncs', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const onGeneration = vi.fn()
    const onGap = vi.fn()
    const applier = new PageProjectionDiffApplier(host, undefined, onGap, onGeneration)
    applier.enqueue(documentDiff())
    applier.flush()
    expect(onGeneration).toHaveBeenCalledWith(1)
    onGeneration.mockClear()

    // Sequence gap buffers a frame that will address-miss on drain.
    applier.enqueue({
      sequence: 4,
      generation: 1,
      timestamp: 4,
      plane: 'dom',
      operation: 'patch',
      patch: {
        selector: { kind: 'element', query: '[speculum-anchor="missing"]' },
        node: { anchor: 'missing', tag: 'p', attrs: { 'speculum-anchor': 'missing' } },
      },
    })
    applier.flush()
    expect(applier.isDesynced()).toBe(true)

    applier.applyOobResync({
      generation: 1,
      coversThroughSequence: 3,
      root: documentDiff().document!.root,
      sheets: [],
    })
    expect(applier.isDesynced()).toBe(true)
    expect(onGeneration).not.toHaveBeenCalled()
    host.remove()
  })

  it('discards mid-wipe buffer after address_miss OOB resync (SoftNav-safe)', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const onGap = vi.fn()
    const onGeneration = vi.fn()
    const applier = new PageProjectionDiffApplier(host, undefined, onGap, onGeneration)
    applier.enqueue(documentDiff())
    applier.flush()
    onGeneration.mockClear()

    // Contiguous sequence address_miss (SoftNav orphan selector) — not a gap.
    applier.enqueue({
      sequence: 2,
      generation: 1,
      timestamp: 2,
      plane: 'dom',
      operation: 'childList',
      childList: {
        selector: { kind: 'element', query: '[speculum-anchor="orphan-parent"]' },
        removed: [{ selector: { kind: 'element', query: '[speculum-anchor="orphan-child"]' } }],
        added: [],
      },
    })
    applier.flush()
    expect(onGap).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'address_miss', got: 2, expected: 2 }),
    )
    expect(applier.isDesynced()).toBe(true)

    // Mid-wipe history still buffered while desynced.
    applier.enqueue({
      sequence: 3,
      generation: 1,
      timestamp: 3,
      plane: 'dom',
      operation: 'childList',
      childList: {
        selector: { kind: 'element', query: '[speculum-anchor="orphan-parent"]' },
        removed: [],
        added: [
          {
            index: 0,
            node: {
              anchor: 'stale',
              tag: 'div',
              attrs: { 'speculum-anchor': 'stale' },
            },
          },
        ],
      },
    })
    applier.flush()

    applier.applyOobResync({
      generation: 1,
      coversThroughSequence: 5,
      root: documentDiff().document!.root,
      sheets: [],
    })
    // SoftNav-safe: do not replay orphan childList → stay synced, one recovery.
    expect(applier.isDesynced()).toBe(false)
    expect(applier.getLastSequence()).toBe(5)
    expect(onGeneration).toHaveBeenCalledWith(1)
    expect(host.querySelector('[speculum-anchor="stale"]')).toBeNull()
    expect(onGap.mock.calls.filter((c) => c[0]?.reason === 'address_miss')).toHaveLength(1)
    host.remove()
  })

  it('keeps T8 desync when buffered live head is past coversThrough (no sequence jump)', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const onGap = vi.fn()
    const onGeneration = vi.fn()
    const applier = new PageProjectionDiffApplier(host, undefined, onGap, onGeneration)
    applier.enqueue(documentDiff())
    applier.flush()
    onGeneration.mockClear()
    onGap.mockClear()

    // Gap while live — buffers the far-ahead frame.
    applier.enqueue({
      sequence: 100,
      generation: 1,
      timestamp: 100,
      plane: 'dom',
      operation: 'patch',
      patch: {
        selector: { kind: 'element', query: '[speculum-anchor="p1"]' },
        node: {
          anchor: 'p1',
          tag: 'p',
          attrs: { 'speculum-anchor': 'p1', class: 'far' },
        },
      },
    })
    applier.flush()
    expect(applier.isDesynced()).toBe(true)
    expect(onGap).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'sequence_gap', got: 100, expected: 2 }),
    )
    onGap.mockClear()

    applier.applyOobResync({
      generation: 1,
      coversThroughSequence: 50,
      root: documentDiff().document!.root,
      sheets: [],
    })
    // Buffer head 100 > covers+1 → drain hits sequence_gap → stay desynced (T8).
    expect(applier.isDesynced()).toBe(true)
    expect(applier.getLastSequence()).toBe(50)
    expect(onGeneration).not.toHaveBeenCalled()
    expect(host.querySelector('[speculum-anchor="p1"]')?.getAttribute('class')).toBe('x')
    expect(onGap).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'sequence_gap',
        expected: 51,
        got: 100,
        generation: 1,
      }),
    )
    host.remove()
  })

  it('stamps auth on Cloudinary srcset without truncating f_avif transforms', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const applier = new PageProjectionDiffApplier(host, (u) => `${u}?auth=1`)
    const cloud =
      '/w7s/virtual-assets/https%3A%2F%2Fres.cloudinary.com%2Fdemo%2Fimage%2Fupload%2Ff_avif%2Cq_auto%2Cw_1920%2Fhero.jpg'
    applier.enqueue(
      documentDiff({
        document: {
          root: {
            anchor: 'html1',
            tag: 'html',
            attrs: { 'speculum-anchor': 'html1' },
            children: [
              {
                anchor: 'body1',
                tag: 'body',
                attrs: { 'speculum-anchor': 'body1' },
                children: [
                  {
                    anchor: 'img1',
                    tag: 'img',
                    attrs: {
                      'speculum-anchor': 'img1',
                      srcset: `${cloud} 1920w, ${cloud.replace('w_1920', 'w_800')} 800w`,
                    },
                  },
                ],
              },
            ],
          },
        },
      }),
    )
    applier.flush()
    const srcset = host.querySelector('[speculum-anchor="img1"]')?.getAttribute('srcset') ?? ''
    expect(srcset).toContain('f_avif%2Cq_auto%2Cw_1920')
    expect(srcset).toContain('?auth=1')
    expect(srcset).not.toMatch(/f_avif\?auth=1/)
    host.remove()
  })

  it('rewrites legacy html/body/head tag roots onto stand-in anchors', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const onGap = vi.fn()
    const applier = new PageProjectionDiffApplier(host, undefined, onGap)
    applier.enqueue({
      ...documentDiff(),
      document: {
        root: {
          anchor: 'html1',
          tag: 'html',
          attrs: { 'speculum-anchor': 'html1' },
          children: [
            {
              anchor: 'head1',
              tag: 'head',
              attrs: { 'speculum-anchor': 'head1' },
              children: [],
            },
            {
              anchor: 'body1',
              tag: 'body',
              attrs: { 'speculum-anchor': 'body1' },
              children: [
                {
                  anchor: 'p1',
                  tag: 'p',
                  attrs: { 'speculum-anchor': 'p1' },
                  children: [{ tag: '#text', text: 'hello' }],
                },
              ],
            },
          ],
        },
      },
    })
    applier.flush()

    applier.enqueue({
      sequence: 2,
      generation: 1,
      timestamp: 2,
      plane: 'dom',
      operation: 'childList',
      childList: {
        selector: { kind: 'element', query: 'body' },
        removed: [],
        added: [
          {
            index: 1,
            node: {
              anchor: 'span-body',
              tag: 'span',
              attrs: { 'speculum-anchor': 'span-body' },
              children: [{ tag: '#text', text: 'via-body' }],
            },
          },
        ],
      },
    })
    applier.flush()
    expect(onGap).not.toHaveBeenCalled()
    expect(host.querySelector('[speculum-anchor="span-body"]')?.textContent).toBe('via-body')

    applier.enqueue({
      sequence: 3,
      generation: 1,
      timestamp: 3,
      plane: 'dom',
      operation: 'childList',
      childList: {
        selector: { kind: 'element', query: 'head' },
        removed: [],
        added: [
          {
            index: 0,
            node: {
              anchor: 'meta1',
              tag: 'meta',
              attrs: { 'speculum-anchor': 'meta1', name: 'x', content: 'y' },
            },
          },
        ],
      },
    })
    applier.flush()
    expect(onGap).not.toHaveBeenCalled()
    expect(host.querySelector('[data-speculum-dom-head] [speculum-anchor="meta1"]')).toBeTruthy()
    host.remove()
  })

  it('skips stand-in base style from F-visible childAt index space', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const onGap = vi.fn()
    const applier = new PageProjectionDiffApplier(host, undefined, onGap)
    applier.enqueue(documentDiff())
    applier.flush()
    // Host F children: head (optional) + body stand-in — not the base <style>.
    applier.enqueue({
      sequence: 2,
      generation: 1,
      timestamp: 2,
      plane: 'dom',
      operation: 'patch',
      patch: {
        selector: {
          kind: 'childAt',
          query: '[speculum-anchor="html1"]',
          index: 0,
        },
        node: {
          anchor: 'body1',
          tag: 'body',
          attrs: { 'speculum-anchor': 'body1', class: 'patched' },
        },
      },
    })
    applier.flush()
    // Without head, index 0 is body stand-in.
    expect(onGap).not.toHaveBeenCalled()
    expect(host.querySelector('[data-speculum-dom-body]')?.getAttribute('class')).toBe('patched')
    host.remove()
  })

  it('childList F-indexes flatten open shadow after light children', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const applier = new PageProjectionDiffApplier(host)
    applier.enqueue(documentDiff())
    applier.flush()

    const body = host.querySelector('[speculum-anchor="body1"]')
    expect(body).toBeTruthy()
    const shadow = body!.attachShadow({ mode: 'open' })
    const prior = document.createElement('span')
    prior.setAttribute('speculum-anchor', 'shadow1')
    prior.textContent = 'old'
    shadow.appendChild(prior)

    // Light: p1 @0; shadow: shadow1 @1 — replace shadow slot via F index.
    applier.enqueue({
      sequence: 2,
      generation: 1,
      timestamp: 2,
      plane: 'dom',
      operation: 'childList',
      childList: {
        selector: { kind: 'element', query: '[speculum-anchor="body1"]' },
        removed: [{ selector: { kind: 'childAt', query: '[speculum-anchor="body1"]', index: 1 } }],
        added: [
          {
            index: 1,
            node: {
              anchor: 'shadow2',
              tag: 'span',
              attrs: { 'speculum-anchor': 'shadow2' },
              children: [{ tag: '#text', text: 'sh' }],
            },
          },
        ],
      },
    })
    applier.flush()
    expect(applier.isDesynced()).toBe(false)
    expect(body!.querySelector('[speculum-anchor="p1"]')).toBeTruthy()
    expect(shadow.querySelector('[speculum-anchor="shadow1"]')).toBeNull()
    expect(shadow.querySelector('[speculum-anchor="shadow2"]')?.textContent).toBe('sh')
    host.remove()
  })

  it('applyScrollViewport notes echo mark that consumeScrollEcho matches after apply', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const applier = new PageProjectionDiffApplier(host)
    applier.enqueue(documentDiff())
    applier.flush()
    Object.defineProperty(host, 'scrollLeft', { configurable: true, writable: true, value: 0 })
    Object.defineProperty(host, 'scrollTop', { configurable: true, writable: true, value: 0 })
    host.scrollTo = ((x?: number, y?: number) => {
      host.scrollLeft = Number(x ?? 0)
      host.scrollTop = Number(y ?? 0)
    }) as typeof host.scrollTo
    applier.enqueue({
      sequence: 2,
      generation: 1,
      timestamp: 2,
      plane: 'dom',
      operation: 'scrollViewport',
      scrollViewport: { scrollX: 0, scrollY: 80 },
    })
    applier.flush()
    expect(applier.isDesynced()).toBe(false)
    // After apply returns, mark remains until a scroll event consumes it (async-safe).
    expect(applier.consumeScrollEcho('viewport', { scrollX: 0, scrollY: 80 })).toBe(true)
    expect(applier.consumeScrollEcho('viewport', { scrollX: 0, scrollY: 80 })).toBe(false)
    host.remove()
  })

  it('consumeScrollEcho clears stale mark on position mismatch', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const applier = new PageProjectionDiffApplier(host)
    applier.enqueue(documentDiff())
    applier.flush()
    host.scrollTo = (() => {}) as typeof host.scrollTo
    applier.enqueue({
      sequence: 2,
      generation: 1,
      timestamp: 2,
      plane: 'dom',
      operation: 'scrollViewport',
      scrollViewport: { scrollX: 0, scrollY: 80 },
    })
    applier.flush()
    expect(applier.consumeScrollEcho('viewport', { scrollX: 0, scrollY: 40 })).toBe(false)
    expect(applier.consumeScrollEcho('viewport', { scrollX: 0, scrollY: 80 })).toBe(false)
    host.remove()
  })

  it('stand-in base CSS zeros surface/body margin and padding', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const applier = new PageProjectionDiffApplier(host)
    applier.enqueue(documentDiff())
    applier.flush()
    const base = host.querySelector('style[data-speculum-standin-base]')?.textContent ?? ''
    expect(base).toContain('[data-speculum-dom-surface]')
    expect(base).toMatch(/\[data-speculum-dom-surface\]\{[^}]*margin:0/)
    expect(base).toMatch(/\[data-speculum-dom-surface\]\{[^}]*padding:0/)
    expect(base).toMatch(/\[data-speculum-dom-body\]\{[^}]*margin:0/)
    expect(base).toMatch(/\[data-speculum-dom-body\]\{[^}]*padding:0/)
    expect(base).toContain('[data-speculum-dom-head]{display:none!important;}')
    expect(base).toContain('div[speculum-projected-tag="noscript"]')
    expect(base).toContain('div[speculum-projected-tag="script"]')
    expect(base).toContain(
      'div[speculum-projected-tag="script"],div[speculum-projected-tag="noscript"],div[speculum-projected-tag="template"],div[speculum-projected-tag="base"],div[speculum-projected-tag="object"],div[speculum-projected-tag="embed"],div[speculum-projected-tag="applet"]{display:none!important;}',
    )
    host.remove()
  })

  it('keeps empty non-iframe placeholder hosts non-painting against author CSS', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const applier = new PageProjectionDiffApplier(host)
    applier.enqueue({
      sequence: 1,
      generation: 1,
      timestamp: 1,
      plane: 'dom',
      operation: 'document',
      document: {
        root: {
          anchor: 'html1',
          tag: 'html',
          attrs: { 'speculum-anchor': 'html1' },
          children: [
            {
              anchor: 'body1',
              tag: 'body',
              attrs: { 'speculum-anchor': 'body1' },
              children: [
                {
                  anchor: 'ns1',
                  tag: 'div',
                  attrs: {
                    'speculum-anchor': 'ns1',
                    'speculum-projected-tag': 'noscript',
                    class: 'noJs',
                  },
                },
                {
                  anchor: 'app1',
                  tag: 'div',
                  attrs: { 'speculum-anchor': 'app1', id: 'app' },
                  children: [{ tag: '#text', text: 'app' }],
                },
              ],
            },
          ],
        },
      },
    })
    applier.flush()
    const base = host.querySelector('style[data-speculum-standin-base]')?.textContent ?? ''
    expect(base).toContain(
      'div[speculum-projected-tag="noscript"]',
    )
    expect(base).toMatch(/div\[speculum-projected-tag="noscript"\][^}]*display:none!important/)
    const ns = host.querySelector('[speculum-projected-tag="noscript"]') as HTMLElement
    expect(ns).toBeTruthy()
    expect(ns.className).toBe('noJs')
    // Slot remains addressable (T13 — no hard-delete).
    expect(ns.getAttribute('speculum-anchor')).toBe('ns1')
    host.remove()
  })

  it('rewrites inline style rem/vh with the same root as sheets', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const applier = new PageProjectionDiffApplier(host)
    // Establish with 62.5% root so rem→px uses 10px (same as prepareCss).
    applier.enqueue({
      sequence: 1,
      generation: 1,
      timestamp: 1,
      plane: 'dom',
      operation: 'document',
      document: {
        root: {
          anchor: 'html1',
          tag: 'html',
          attrs: { 'speculum-anchor': 'html1' },
          children: [
            {
              anchor: 'body1',
              tag: 'body',
              attrs: { 'speculum-anchor': 'body1' },
              children: [],
            },
          ],
        },
      },
    })
    applier.flush()
    applier.enqueue({
      sequence: 2,
      generation: 1,
      timestamp: 2,
      plane: 'cssom',
      operation: 'install',
      install: {
        sheets: [
          {
            id: 's1',
            scope: { kind: 'main' },
            rules: [{ id: 'seed:s1', cssText: 'html{font-size:62.5%}body{margin:0}' }],
          },
        ],
      },
    })
    applier.flush()
    applier.enqueue({
      sequence: 3,
      generation: 1,
      timestamp: 3,
      plane: 'dom',
      operation: 'childList',
      childList: {
        selector: { kind: 'element', query: '[speculum-anchor="body1"]' },
        removed: [],
        added: [
          {
            index: 0,
            node: {
              anchor: 'box1',
              tag: 'div',
              attrs: {
                'speculum-anchor': 'box1',
                style: 'padding-top:2rem;width:100vw',
              },
            },
          },
        ],
      },
    })
    applier.flush()
    expect(applier.isDesynced()).toBe(false)
    const box = host.querySelector('[speculum-anchor="box1"]')
    expect(box?.getAttribute('style')).toContain('padding-top:20px')
    expect(box?.getAttribute('style')).toContain('width:100cqw')
    host.remove()
  })
})

describe('pageProjectionLagMs', () => {
  it('uses wall clock vs sidecar epoch ms', () => {
    const now = 1_700_000_000_000
    expect(pageProjectionLagMs(now - 40, now)).toBe(40)
    expect(pageProjectionLagMs(12345, now)).toBeNull()
    expect(pageProjectionLagMs(null, now)).toBeNull()
  })
})
