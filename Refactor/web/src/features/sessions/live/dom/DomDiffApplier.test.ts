import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DomDiffApplier } from './DomDiffApplier'
import { appendSessionAuth } from '@/lib/speculum/sessionBindingAuth'
import type { DomDiff, DomNode } from '@/lib/speculum'

function documentDiff(sequence: number, generation: number, root: DomNode, timestamp = 0): DomDiff {
  return {
    sequence,
    generation,
    timestamp,
    kind: 'diff',
    target: 'document',
    nodes: [root],
  }
}

function anchorsDiff(sequence: number, generation: number, nodes: DomNode[], timestamp = 1): DomDiff {
  return {
    sequence,
    generation,
    timestamp,
    kind: 'diff',
    target: 'anchors',
    nodes,
  }
}

describe('DomDiffApplier', () => {
  let host: HTMLDivElement
  let applier: DomDiffApplier

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0)
      return 1
    })
    applier = new DomDiffApplier(host, (url) => appendSessionAuth(url, 't'))
  })

  afterEach(() => {
    applier.reset()
    host.remove()
    vi.unstubAllGlobals()
  })

  it('remounts document under host and stamps anchors', () => {
    applier.enqueue(
      documentDiff(1, 1, {
        anchor: 'html1',
        tag: 'html',
        children: [
          {
            anchor: 'body1',
            tag: 'body',
            children: [
              {
                anchor: 'btn1',
                tag: 'button',
                attrs: { 'speculum-anchor': 'btn1' },
                children: [{ tag: '#text', text: 'Go' }],
              },
            ],
          },
        ],
      }),
    )
    applier.flush()
    const btn = host.querySelector('[speculum-anchor="btn1"]')
    expect(btn?.tagName.toLowerCase()).toBe('button')
    expect(btn?.textContent).toBe('Go')
  })

  it('replaces anchors nodes by anchor', () => {
    applier.enqueue(
      documentDiff(1, 1, {
        tag: 'html',
        children: [
          {
            tag: 'body',
            children: [
              {
                anchor: 'p1',
                tag: 'p',
                attrs: { 'speculum-anchor': 'p1' },
                children: [{ tag: '#text', text: 'old' }],
              },
            ],
          },
        ],
      }),
    )
    applier.flush()
    applier.enqueue(
      anchorsDiff(2, 1, [
        {
          anchor: 'p1',
          tag: 'p',
          attrs: { 'speculum-anchor': 'p1' },
          children: [{ tag: '#text', text: 'new' }],
        },
      ]),
    )
    applier.flush()
    expect(host.querySelector('[speculum-anchor="p1"]')?.textContent).toBe('new')
  })

  it('appends token to virtual-asset attrs', () => {
    applier.enqueue(
      documentDiff(1, 1, {
        tag: 'html',
        children: [
          {
            tag: 'body',
            children: [
              {
                anchor: 'img1',
                tag: 'img',
                attrs: {
                  'speculum-anchor': 'img1',
                  src: '/w7s/virtual-assets/cdn.example.com/a.png',
                },
              },
            ],
          },
        ],
      }),
    )
    applier.flush()
    const img = host.querySelector('img')
    expect(img?.getAttribute('src')).toBe(
      '/w7s/virtual-assets/cdn.example.com/a.png?speculum-session-token=t',
    )
  })

  it('stamps auth on every fetchable url sink, not just src/href', () => {
    applier.enqueue(
      documentDiff(1, 1, {
        tag: 'html',
        children: [
          {
            tag: 'body',
            children: [
              {
                anchor: 'use1',
                tag: 'use',
                attrs: {
                  'speculum-anchor': 'use1',
                  'xlink:href': '/w7s/virtual-assets/cdn.example.com/s.svg#i',
                },
              },
              {
                anchor: 'img2',
                tag: 'img',
                attrs: {
                  'speculum-anchor': 'img2',
                  'data-src': '/w7s/virtual-assets/cdn.example.com/lazy.png',
                  srcset: '/w7s/virtual-assets/cdn.example.com/a.png 1x, /w7s/virtual-assets/cdn.example.com/b.png 2x',
                  style: 'background:url("/w7s/virtual-assets/cdn.example.com/bg.png")',
                },
              },
            ],
          },
        ],
      }),
    )
    applier.flush()
    const use = host.querySelector('use')
    expect(use?.getAttribute('xlink:href')).toContain('speculum-session-token=t')
    const img = host.querySelector('img[data-src]')
    expect(img?.getAttribute('data-src')).toContain('speculum-session-token=t')
    const srcset = img?.getAttribute('srcset') ?? ''
    expect(srcset.match(/speculum-session-token=t/g)).toHaveLength(2)
    expect(srcset).toContain('1x')
    expect(img?.getAttribute('style')).toContain('speculum-session-token=t')
  })

  it('stamps auth on css url(), @import and image-set string forms', () => {
    applier.enqueue(
      documentDiff(1, 1, {
        tag: 'html',
        children: [
          {
            tag: 'head',
            children: [
              {
                anchor: 'st1',
                tag: 'style',
                attrs: { 'speculum-anchor': 'st1' },
                text: [
                  '@import "/w7s/virtual-assets/cdn.example.com/base.css";',
                  '.a{background:url(/w7s/virtual-assets/cdn.example.com/a.png)}',
                  '.b{background-image:image-set("/w7s/virtual-assets/cdn.example.com/b.png" 1x)}',
                  '.c{background:url(https://other.example.com/keep.png)}',
                ].join('\n'),
              },
            ],
          },
          { tag: 'body', children: [] },
        ],
      }),
    )
    applier.flush()
    const css = host.querySelector('style[speculum-anchor="st1"]')?.textContent ?? ''
    expect(css).toContain('@import url("/w7s/virtual-assets/cdn.example.com/base.css?speculum-session-token=t")')
    expect(css).toContain('url(/w7s/virtual-assets/cdn.example.com/a.png?speculum-session-token=t)')
    expect(css).toContain('image-set(url("/w7s/virtual-assets/cdn.example.com/b.png?speculum-session-token=t")')
    // Off-plane urls are left exactly as they came in.
    expect(css).toContain('url(https://other.example.com/keep.png)')
  })

  it('debounces control attrs after local edit', () => {
    applier.enqueue(
      documentDiff(1, 1, {
        tag: 'html',
        children: [
          {
            tag: 'body',
            children: [
              {
                anchor: 'in1',
                tag: 'input',
                attrs: {
                  'speculum-anchor': 'in1',
                  'speculum-input-value': 'server',
                },
              },
            ],
          },
        ],
      }),
    )
    applier.flush()
    const input = host.querySelector('input') as HTMLInputElement
    expect(input.value).toBe('server')
    input.value = 'local'
    applier.noteLocalEdit('in1')
    applier.enqueue(
      anchorsDiff(2, 1, [
        {
          anchor: 'in1',
          tag: 'input',
          attrs: {
            'speculum-anchor': 'in1',
            'speculum-input-value': 'server2',
          },
        },
      ]),
    )
    applier.flush()
    const again = host.querySelector('input') as HTMLInputElement
    // Debounced: local edit keeps pending upstream attr on element; value apply deferred.
    expect(again.getAttribute('speculum-input-value')).toBe('server2')
  })

  it('does not duplicate when replacing body after html document', () => {
    applier.enqueue(
      documentDiff(1, 1, {
        anchor: 'html1',
        tag: 'html',
        children: [
          {
            tag: 'head',
            children: [
              {
                anchor: 'l1',
                tag: 'link',
                attrs: { rel: 'stylesheet', href: '/w7s/virtual-assets/x/a.css' },
              },
            ],
          },
          {
            anchor: 'body1',
            tag: 'body',
            children: [
              {
                anchor: 'p1',
                tag: 'p',
                attrs: { 'speculum-anchor': 'p1' },
                children: [{ tag: '#text', text: 'one' }],
              },
            ],
          },
        ],
      }),
    )
    applier.flush()
    expect(host.querySelectorAll('p').length).toBe(1)

    applier.enqueue(
      anchorsDiff(2, 1, [
        {
          anchor: 'body1',
          tag: 'body',
          attrs: { 'speculum-anchor': 'body1' },
          children: [
            {
              anchor: 'p1',
              tag: 'p',
              attrs: { 'speculum-anchor': 'p1' },
              children: [{ tag: '#text', text: 'two' }],
            },
          ],
        },
      ]),
    )
    applier.flush()
    expect(host.querySelectorAll('p').length).toBe(1)
    expect(host.querySelector('p')?.textContent).toBe('two')
    expect(host.querySelector('style[data-speculum-css-href]')).not.toBeNull()
    expect(host.querySelector('[data-speculum-dom-body]')).not.toBeNull()
  })

  it('does not stack head assets when html document is remounted twice', () => {
    const htmlTree: DomNode = {
      anchor: 'html1',
      tag: 'html',
      children: [
        {
          tag: 'head',
          children: [
            {
              anchor: 'l1',
              tag: 'link',
              attrs: { rel: 'stylesheet', href: '/w7s/virtual-assets/x/a.css' },
            },
          ],
        },
        {
          anchor: 'body1',
          tag: 'body',
          children: [
            {
              anchor: 'p1',
              tag: 'p',
              attrs: { 'speculum-anchor': 'p1' },
              children: [{ tag: '#text', text: 'one' }],
            },
          ],
        },
      ],
    }
    applier.enqueue(documentDiff(1, 1, htmlTree))
    applier.flush()
    expect(host.querySelectorAll('style[data-speculum-css-href]').length).toBe(1)

    applier.enqueue(documentDiff(2, 1, htmlTree, 1))
    applier.flush()
    expect(host.querySelectorAll('style[data-speculum-css-href]').length).toBe(1)
    expect(host.querySelectorAll('p').length).toBe(1)
  })

  it('does not wipe loaded CSS when html arrives as anchors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        text: async () => '.x{color:red}',
      })),
    )
    const htmlTree: DomNode = {
      anchor: 'html1',
      tag: 'html',
      children: [
        {
          tag: 'head',
          children: [
            {
              anchor: 'l1',
              tag: 'link',
              attrs: { rel: 'stylesheet', href: '/w7s/virtual-assets/x/a.css' },
            },
          ],
        },
        {
          anchor: 'body1',
          tag: 'body',
          children: [
            {
              anchor: 'p1',
              tag: 'p',
              attrs: { 'speculum-anchor': 'p1' },
              children: [{ tag: '#text', text: 'one' }],
            },
          ],
        },
      ],
    }
    applier.enqueue(documentDiff(1, 1, htmlTree))
    applier.flush()
    await Promise.resolve()
    await Promise.resolve()
    const sheet = host.querySelector('style[data-speculum-css-href]') as HTMLStyleElement
    expect(sheet?.textContent).toContain('color:red')
    const before = sheet!.textContent

    applier.enqueue(
      anchorsDiff(2, 1, [
        {
          ...htmlTree,
          children: [
            htmlTree.children![0]!,
            {
              anchor: 'body1',
              tag: 'body',
              children: [
                {
                  anchor: 'p1',
                  tag: 'p',
                  attrs: { 'speculum-anchor': 'p1' },
                  children: [{ tag: '#text', text: 'two' }],
                },
              ],
            },
          ],
        },
      ]),
    )
    applier.flush()
    const again = host.querySelector('style[data-speculum-css-href]') as HTMLStyleElement
    expect(again?.textContent).toBe(before)
    expect(host.querySelector('p')?.textContent).toBe('two')
  })

  it('allows sequence gap when target is document', () => {
    const gaps: Array<[number, number]> = []
    applier = new DomDiffApplier(
      host,
      (url) => appendSessionAuth(url, 't'),
      (expected, got) => gaps.push([expected, got]),
    )
    applier.enqueue(
      documentDiff(1, 1, {
        tag: 'html',
        children: [{ tag: 'body', children: [{ tag: '#text', text: 'a' }] }],
      }),
    )
    applier.flush()
    applier.enqueue(
      documentDiff(5, 2, {
        tag: 'html',
        children: [{ tag: 'body', children: [{ tag: '#text', text: 'b' }] }],
      }),
    )
    applier.flush()
    expect(gaps).toEqual([[2, 5]])
    expect(host.textContent).toContain('b')
    expect(applier.getGeneration()).toBe(2)
  })

  it('drops anchors on generation mismatch', () => {
    const dropped: DomDiff[] = []
    applier = new DomDiffApplier(
      host,
      (url) => appendSessionAuth(url, 't'),
      undefined,
      undefined,
      undefined,
      (_reason, diff) => dropped.push(diff),
    )
    applier.enqueue(
      documentDiff(1, 1, {
        tag: 'html',
        children: [
          {
            tag: 'body',
            children: [
              {
                anchor: 'p1',
                tag: 'p',
                attrs: { 'speculum-anchor': 'p1' },
                children: [{ tag: '#text', text: 'old' }],
              },
            ],
          },
        ],
      }),
    )
    applier.flush()
    applier.enqueue(
      anchorsDiff(2, 9, [
        {
          anchor: 'p1',
          tag: 'p',
          attrs: { 'speculum-anchor': 'p1' },
          children: [{ tag: '#text', text: 'new' }],
        },
      ]),
    )
    applier.flush()
    expect(dropped).toHaveLength(1)
    expect(host.querySelector('[speculum-anchor="p1"]')?.textContent).toBe('old')
  })
})
