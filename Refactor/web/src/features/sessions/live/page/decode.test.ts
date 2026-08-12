import { describe, expect, it } from 'vitest'
import { FramePartAssembler, decodeFramePart } from './decode'
import { PAGE_PROJECTION_MAGIC, PAGE_PROJECTION_VERSION, PageProjectionChildRefKind, PageProjectionNodeKind, PageProjectionOp } from './opcodes'

/** Minimal little-endian writer mirroring the §5.5 wire layout for test fixtures. */
class TestWriter {
  private bytes: number[] = []
  u8(v: number): this {
    this.bytes.push(v & 0xff)
    return this
  }
  u16(v: number): this {
    return this.u8(v & 0xff).u8((v >>> 8) & 0xff)
  }
  u32(v: number): this {
    return this.u16(v & 0xffff).u16((v >>> 16) & 0xffff)
  }
  raw(bytes: Uint8Array): this {
    this.bytes.push(...bytes)
    return this
  }
  toUint8Array(): Uint8Array {
    return Uint8Array.from(this.bytes)
  }
}

function buildFrame(params: {
  version?: number
  flags?: number
  generation: number
  sequence: number
  partIndex?: number
  partCount?: number
  strings: string[]
  ops: Array<{ code: number; write: (w: TestWriter) => void }>
}): Uint8Array {
  const w = new TestWriter()
  w.u16(PAGE_PROJECTION_MAGIC)
  w.u8(params.version ?? PAGE_PROJECTION_VERSION)
  w.u8(params.flags ?? 0)
  w.u32(params.generation)
  w.u32(params.sequence)
  w.u16(params.partIndex ?? 0)
  w.u16(params.partCount ?? 1)
  w.u32(params.strings.length)
  const encoder = new TextEncoder()
  for (const s of params.strings) {
    const bytes = encoder.encode(s)
    w.u32(bytes.length)
    w.raw(bytes)
  }
  w.u32(params.ops.length)
  for (const op of params.ops) {
    w.u8(op.code)
    op.write(w)
  }
  return w.toUint8Array()
}

/** `strings = ['div', 'class', 'x']`; encodes `patch(node=42, <div class="x">)`. */
function patchFrame(sequence: number, generation = 1) {
  return buildFrame({
    generation,
    sequence,
    strings: ['div', 'class', 'x'],
    ops: [
      {
        code: PageProjectionOp.patch,
        write: (w) => {
          w.u32(42)
          w.u8(PageProjectionNodeKind.Element)
          w.u32(0) // tag -> 'div'
          w.u16(1) // attrCount
          w.u32(1) // name -> 'class'
          w.u32(2) // value -> 'x'
        },
      },
    ],
  })
}

describe('decodeFramePart', () => {
  it('decodes a patch op with attrs resolved through the string table', () => {
    const result = decodeFramePart(patchFrame(7, 3))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.part.generation).toBe(3)
    expect(result.part.sequence).toBe(7)
    expect(result.part.partIndex).toBe(0)
    expect(result.part.partCount).toBe(1)
    expect(result.part.ops).toEqual([
      { op: 'patch', node: 42, snapshot: { kind: 'element', tag: 'div', attrs: { class: 'x' } } },
    ])
  })

  it('decodes establishChunk as a raw UTF-8 blob, not string-table indirect', () => {
    const html = '<div id="root"></div>'
    const bytes = buildFrame({
      generation: 1,
      sequence: 0,
      flags: 0b01,
      strings: [],
      ops: [
        {
          code: PageProjectionOp.establishChunk,
          write: (w) => {
            const encoded = new TextEncoder().encode(html)
            w.u32(encoded.length)
            w.raw(encoded)
          },
        },
      ],
    })
    const result = decodeFramePart(bytes)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.part.establish).toBe(true)
    expect(result.part.ops).toEqual([{ op: 'establishChunk', html }])
  })

  it('decodes a childList FULL op mixing existing and fresh children', () => {
    const bytes = buildFrame({
      generation: 1,
      sequence: 2,
      strings: ['span'],
      ops: [
        {
          code: PageProjectionOp.childList,
          write: (w) => {
            w.u32(1) // parent
            w.u8(0) // mode = full
            w.u32(2) // children count
            w.u8(PageProjectionChildRefKind.Existing)
            w.u32(9)
            w.u8(PageProjectionChildRefKind.Fresh)
            w.u8(PageProjectionNodeKind.Element)
            w.u32(10) // id
            w.u32(0) // tag -> 'span'
            w.u16(0) // attrCount
            w.u32(0) // childCount
          },
        },
      ],
    })
    const result = decodeFramePart(bytes)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.part.ops).toEqual([
      {
        op: 'childList',
        parent: 1,
        mode: 'full',
        children: [
          { kind: 'existing', id: 9 },
          { kind: 'fresh', node: { id: 10, kind: 'element', tag: 'span', attrs: {}, children: [] } },
        ],
      },
    ])
  })

  it('returns unknown_version on an unsupported wire version — never a best-effort parse', () => {
    const result = decodeFramePart(patchFrame(1, 1).map((b, i) => (i === 2 ? 99 : b)))
    expect(result).toEqual({ ok: false, reason: 'unknown_version', message: 'unsupported wire version 99' })
  })

  it('rejects bad magic as malformed', () => {
    const bytes = patchFrame(1, 1)
    bytes[0] = 0
    const result = decodeFramePart(bytes)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('malformed')
  })

  it('decodes cssomInstall main+pierceHost with fixed hostId layout (W0)', () => {
    const bytes = buildFrame({
      generation: 1,
      sequence: 1,
      strings: ['body{margin:0}', '.x{color:red}'],
      ops: [
        {
          code: PageProjectionOp.cssomInstall,
          write: (w) => {
            w.u32(2) // sheet count
            // main sheet — hostId always present (0)
            w.u32(1)
            w.u8(0)
            w.u32(0)
            w.u32(1) // rules
            w.u32(10)
            w.u32(0) // cssText idx
            // pierceHost
            w.u32(2)
            w.u8(1)
            w.u32(99)
            w.u32(1)
            w.u32(11)
            w.u32(1)
          },
        },
      ],
    })
    const result = decodeFramePart(bytes)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.part.ops).toEqual([
      {
        op: 'cssomInstall',
        sheets: [
          { id: 1, scope: 'main', hostAnchor: null, rules: [{ id: 10, cssText: 'body{margin:0}' }] },
          { id: 2, scope: 'pierceHost', hostAnchor: 99, rules: [{ id: 11, cssText: '.x{color:red}' }] },
        ],
      },
    ])
  })

  it('decodes documentState with a present lang and absent dir/viewportContent (§5.2.6)', () => {
    const bytes = buildFrame({
      generation: 1,
      sequence: 3,
      strings: ['Example', 'en'],
      ops: [
        {
          code: PageProjectionOp.documentState,
          write: (w) => {
            w.u32(0) // title -> 'Example'
            w.u8(1).u32(1) // lang present -> 'en'
            w.u8(0) // dir absent
            w.u8(0) // viewportContent absent
          },
        },
      ],
    })
    const result = decodeFramePart(bytes)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.part.ops).toEqual([
      { op: 'documentState', title: 'Example', lang: 'en', dir: null, viewportContent: null },
    ])
  })
})

describe('FramePartAssembler', () => {
  it('passes a single-part frame straight through', () => {
    const assembler = new FramePartAssembler()
    const decoded = decodeFramePart(patchFrame(1))
    if (!decoded.ok) throw new Error('fixture decode failed')
    const assembled = assembler.ingest(decoded.part)
    expect(assembled).not.toBe('missing_part')
    expect(assembled).not.toBeNull()
    if (!assembled || assembled === 'missing_part') return
    expect(assembled.ops).toHaveLength(1)
  })

  it('assembles a two-part frame once the final part arrives, concatenating ops in order', () => {
    const assembler = new FramePartAssembler()
    const partA = buildFrame({
      generation: 5,
      sequence: 12,
      partIndex: 0,
      partCount: 2,
      strings: ['a'],
      ops: [{ code: PageProjectionOp.establishChunk, write: (w) => { w.u32(1); w.raw(Uint8Array.of(97)) } }],
    })
    const partB = buildFrame({
      generation: 5,
      sequence: 12,
      partIndex: 1,
      partCount: 2,
      strings: [],
      ops: [{ code: PageProjectionOp.establishEnd, write: (w) => { w.u32(3); w.u32(0xdeadbeef >>> 0) } }],
    })
    const decodedA = decodeFramePart(partA)
    const decodedB = decodeFramePart(partB)
    if (!decodedA.ok || !decodedB.ok) throw new Error('fixture decode failed')

    expect(assembler.ingest(decodedA.part)).toBeNull()
    const assembled = assembler.ingest(decodedB.part)
    expect(assembled).not.toBe('missing_part')
    if (!assembled || assembled === 'missing_part') return
    expect(assembled.generation).toBe(5)
    expect(assembled.sequence).toBe(12)
    expect(assembled.ops).toEqual([
      { op: 'establishChunk', html: 'a' },
      { op: 'establishEnd', nodeCount: 3, checksum: 0xdeadbeef >>> 0 },
    ])
  })

  it('reports missing_part when the final part arrives without every earlier part', () => {
    const assembler = new FramePartAssembler()
    const partB = buildFrame({
      generation: 5,
      sequence: 12,
      partIndex: 1,
      partCount: 2,
      strings: [],
      ops: [{ code: PageProjectionOp.establishEnd, write: (w) => { w.u32(0); w.u32(0) } }],
    })
    const decodedB = decodeFramePart(partB)
    if (!decodedB.ok) throw new Error('fixture decode failed')
    expect(assembler.ingest(decodedB.part)).toBe('missing_part')
  })
})
