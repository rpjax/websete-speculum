/**
 * Binary frame reader — docs/page-projection-engine-redesign.md §5.5 (wire format).
 *
 * Decodes one frame *part* fully (strings substituted, ops resolved to typed
 * values) and assembles multi-part frames into one atomic unit. No
 * `JSON.parse` anywhere on this path (`PP-WIRE-3`).
 */
import {
  PAGE_PROJECTION_MAGIC,
  PAGE_PROJECTION_VERSION,
  PageProjectionChildListMode,
  PageProjectionChildRefKind,
  PageProjectionCssomScope,
  PageProjectionFrameFlag,
  PageProjectionNodeKind,
  PageProjectionOp,
} from './opcodes'

export interface DecodedNode {
  id: number
  kind: 'element' | 'text' | 'comment'
  tag?: string /** element only */
  attrs?: Record<string, string> /** element only */
  value?: string /** text / comment only */
  children?: DecodedNode[] /** element only */
}

/** `patch` full snapshot — same shape as `DecodedNode` minus `id` and `children` (§5.4.1). */
export type PatchSnapshot = Omit<DecodedNode, 'children' | 'id'>

export type ScrollElementRef = { id: number; scrollTop: number; scrollLeft: number }
export interface EstablishBeginOp { op: 'establishBegin'; generation: number; viewportWidth: number; viewportHeight: number; scrollX: number; scrollY: number; scrollElements: ScrollElementRef[] }
export interface EstablishChunkOp { op: 'establishChunk'; html: string }
export interface EstablishEndOp { op: 'establishEnd'; nodeCount: number; checksum: number }
export type ChildRef = { kind: 'existing'; id: number } | { kind: 'fresh'; node: DecodedNode }
export interface ChildListOp { op: 'childList'; parent: number; mode: 'full' | 'append'; children: ChildRef[] }
export interface PatchOp { op: 'patch'; node: number; snapshot: PatchSnapshot }
export interface ScrollViewportOp { op: 'scrollViewport'; scrollX: number; scrollY: number }
export interface ScrollElementOp { op: 'scrollElement'; node: number; scrollTop: number; scrollLeft: number }
export interface CssomRuleWire { id: number; cssText: string }
/** `hostAnchor` is the registry id of the pierce host element; `null` for `scope === 'main'` (C7). */
export interface CssomSheetWire { id: number; scope: 'main' | 'pierceHost'; hostAnchor: number | null; rules: CssomRuleWire[] }
export interface CssomInstallOp { op: 'cssomInstall'; sheets: CssomSheetWire[] }
export interface CssomSheetListOp { op: 'cssomSheetList'; removed: number[]; added: Array<{ index: number; sheet: CssomSheetWire }> }
export interface CssomRuleListOp { op: 'cssomRuleList'; sheet: number; removed: number[]; added: Array<{ index: number; rule: CssomRuleWire }> }
export interface CssomPatchOp { op: 'cssomPatch'; rule: number; cssText: string }

export type DecodedOp =
  | EstablishBeginOp | EstablishChunkOp | EstablishEndOp
  | ChildListOp | PatchOp | ScrollViewportOp | ScrollElementOp
  | CssomInstallOp | CssomSheetListOp | CssomRuleListOp | CssomPatchOp

export interface DecodedFramePart { version: number; establish: boolean; resync: boolean; generation: number; sequence: number; partIndex: number; partCount: number; ops: DecodedOp[] }
/** One or more parts assembled into the atomic unit the client applies (§5.5.3). */
export interface AssembledFrame { version: number; establish: boolean; resync: boolean; generation: number; sequence: number; ops: DecodedOp[] }

/** Every §5.7.1 trigger reachable from this module. */
export type DecodeError = 'unknown_version' | 'malformed'
export type DecodeResult = { ok: true; part: DecodedFramePart } | { ok: false; reason: DecodeError; message: string }

const textDecoder = new TextDecoder('utf-8')

class ByteReader {
  private readonly view: DataView
  private readonly bytes: Uint8Array
  offset = 0
  constructor(bytes: Uint8Array) {
    this.bytes = bytes
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }
  get remaining(): number { return this.bytes.byteLength - this.offset }
  u8(): number { const v = this.view.getUint8(this.offset); this.offset += 1; return v }
  u16(): number { const v = this.view.getUint16(this.offset, true); this.offset += 2; return v }
  u32(): number { const v = this.view.getUint32(this.offset, true); this.offset += 4; return v }
  bytes_(len: number): Uint8Array { const v = this.bytes.subarray(this.offset, this.offset + len); this.offset += len; return v }
  utf8(len: number): string { return textDecoder.decode(this.bytes_(len)) }
}

/** Decodes one wire frame part. Never throws — malformed input is a typed result. */
export function decodeFramePart(input: Uint8Array | ArrayBuffer): DecodeResult {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  try {
    const r = new ByteReader(bytes)
    if (r.remaining < 20) return malformed('frame shorter than the fixed header')
    if (r.u16() !== PAGE_PROJECTION_MAGIC) return malformed('bad magic')
    const version = r.u8()
    if (version !== PAGE_PROJECTION_VERSION) {
      return { ok: false, reason: 'unknown_version', message: `unsupported wire version ${version}` }
    }
    const flags = r.u8()
    const generation = r.u32()
    const sequence = r.u32()
    const partIndex = r.u16()
    const partCount = r.u16()

    const strCount = r.u32()
    const strings: string[] = new Array(strCount)
    for (let i = 0; i < strCount; i++) strings[i] = r.utf8(r.u32())

    const opCount = r.u32()
    const ops: DecodedOp[] = new Array(opCount)
    for (let i = 0; i < opCount; i++) {
      const opCode = r.u8()
      const op = decodeOp(opCode, r, strings)
      if (!op) return malformed(`unknown opcode ${opCode}`)
      ops[i] = op
    }

    return {
      ok: true,
      part: {
        version,
        establish: (flags & PageProjectionFrameFlag.Establish) !== 0,
        resync: (flags & PageProjectionFrameFlag.Resync) !== 0,
        generation,
        sequence,
        partIndex,
        partCount,
        ops,
      },
    }
  } catch (err) {
    return malformed(err instanceof Error ? err.message : String(err))
  }
}

function malformed(message: string): { ok: false; reason: 'malformed'; message: string } {
  return { ok: false, reason: 'malformed', message }
}

function decodeOp(opCode: number, r: ByteReader, strings: string[]): DecodedOp | null {
  switch (opCode) {
    case PageProjectionOp.establishBegin: {
      const generation = r.u32()
      const viewportWidth = r.u32()
      const viewportHeight = r.u32()
      const scrollX = r.u32()
      const scrollY = r.u32()
      const count = r.u32()
      const scrollElements: ScrollElementRef[] = new Array(count)
      for (let i = 0; i < count; i++) scrollElements[i] = { id: r.u32(), scrollTop: r.u32(), scrollLeft: r.u32() }
      return { op: 'establishBegin', generation, viewportWidth, viewportHeight, scrollX, scrollY, scrollElements }
    }
    case PageProjectionOp.establishChunk:
      return { op: 'establishChunk', html: r.utf8(r.u32()) }
    case PageProjectionOp.establishEnd:
      return { op: 'establishEnd', nodeCount: r.u32(), checksum: r.u32() }
    case PageProjectionOp.childList: {
      const parent = r.u32()
      const mode = r.u8() === PageProjectionChildListMode.Append ? 'append' : 'full'
      const count = r.u32()
      const children: ChildRef[] = new Array(count)
      for (let i = 0; i < count; i++) {
        children[i] =
          r.u8() === PageProjectionChildRefKind.Fresh
            ? { kind: 'fresh', node: decodeNode(r, strings) }
            : { kind: 'existing', id: r.u32() }
      }
      return { op: 'childList', parent, mode, children }
    }
    case PageProjectionOp.patch:
      return { op: 'patch', node: r.u32(), snapshot: decodePatchSnapshot(r, strings) }
    case PageProjectionOp.scrollViewport:
      return { op: 'scrollViewport', scrollX: r.u32(), scrollY: r.u32() }
    case PageProjectionOp.scrollElement:
      return { op: 'scrollElement', node: r.u32(), scrollTop: r.u32(), scrollLeft: r.u32() }
    case PageProjectionOp.cssomInstall:
      return { op: 'cssomInstall', sheets: decodeList(r, strings, decodeSheet) }
    case PageProjectionOp.cssomSheetList:
      return { op: 'cssomSheetList', removed: decodeIds(r), added: decodeIndexed(r, strings, decodeSheet, 'sheet') }
    case PageProjectionOp.cssomRuleList: {
      const sheet = r.u32()
      return { op: 'cssomRuleList', sheet, removed: decodeIds(r), added: decodeIndexed(r, strings, decodeRule, 'rule') }
    }
    case PageProjectionOp.cssomPatch:
      return { op: 'cssomPatch', rule: r.u32(), cssText: strings[r.u32()] ?? '' }
    default:
      return null
  }
}

function decodeNode(r: ByteReader, strings: string[]): DecodedNode {
  const kind = r.u8()
  const id = r.u32()
  if (kind === PageProjectionNodeKind.Text) return { id, kind: 'text', value: strings[r.u32()] ?? '' }
  if (kind === PageProjectionNodeKind.Comment) return { id, kind: 'comment', value: strings[r.u32()] ?? '' }
  const tag = strings[r.u32()] ?? ''
  const attrs = decodeAttrs(r, strings)
  const childCount = r.u32()
  const children: DecodedNode[] = new Array(childCount)
  for (let i = 0; i < childCount; i++) children[i] = decodeNode(r, strings)
  return { id, kind: 'element', tag, attrs, children }
}

/** Same as `decodeNode` minus `id` (address rides on the op) and `children` (§5.4.1). */
function decodePatchSnapshot(r: ByteReader, strings: string[]): PatchSnapshot {
  const kind = r.u8()
  if (kind === PageProjectionNodeKind.Text) return { kind: 'text', value: strings[r.u32()] ?? '' }
  if (kind === PageProjectionNodeKind.Comment) return { kind: 'comment', value: strings[r.u32()] ?? '' }
  return { kind: 'element', tag: strings[r.u32()] ?? '', attrs: decodeAttrs(r, strings) }
}

function decodeAttrs(r: ByteReader, strings: string[]): Record<string, string> {
  const count = r.u16()
  const attrs: Record<string, string> = {}
  for (let i = 0; i < count; i++) attrs[strings[r.u32()] ?? ''] = strings[r.u32()] ?? ''
  return attrs
}

function decodeSheet(r: ByteReader, strings: string[]): CssomSheetWire {
  const id = r.u32()
  const scopeByte = r.u8()
  const hostAnchorRaw = r.u32()
  return {
    id,
    scope: scopeByte === PageProjectionCssomScope.PierceHost ? 'pierceHost' : 'main',
    hostAnchor: hostAnchorRaw === 0 ? null : hostAnchorRaw,
    rules: decodeList(r, strings, decodeRule),
  }
}

function decodeRule(r: ByteReader, strings: string[]): CssomRuleWire {
  return { id: r.u32(), cssText: strings[r.u32()] ?? '' }
}

function decodeIds(r: ByteReader): number[] {
  const count = r.u32()
  const ids: number[] = new Array(count)
  for (let i = 0; i < count; i++) ids[i] = r.u32()
  return ids
}

function decodeList<T>(r: ByteReader, strings: string[], one: (r: ByteReader, strings: string[]) => T): T[] {
  const count = r.u32()
  const out: T[] = new Array(count)
  for (let i = 0; i < count; i++) out[i] = one(r, strings)
  return out
}

function decodeIndexed<T, K extends string>(
  r: ByteReader,
  strings: string[],
  one: (r: ByteReader, strings: string[]) => T,
  key: K,
): Array<{ index: number } & Record<K, T>> {
  const count = r.u32()
  const out: Array<{ index: number } & Record<K, T>> = new Array(count)
  for (let i = 0; i < count; i++) {
    const index = r.u32()
    out[i] = { index, [key]: one(r, strings) } as { index: number } & Record<K, T>
  }
  return out
}

/**
 * Buffers frame parts and assembles them into one atomic frame when
 * `partIndex === partCount - 1` arrives (§5.5.3). A gap in the part sequence
 * is reported as `'missing_part'` — a §5.7.1 desync trigger, never a partial apply.
 */
export class FramePartAssembler {
  private readonly pending = new Map<string, { parts: (DecodedFramePart | undefined)[]; received: number }>()

  ingest(part: DecodedFramePart): AssembledFrame | 'missing_part' | null {
    if (part.partCount <= 1) return assemble(part, [part])

    const key = `${part.generation}:${part.sequence}`
    let slot = this.pending.get(key)
    if (!slot || slot.parts.length !== part.partCount) {
      slot = { parts: new Array(part.partCount), received: 0 }
      this.pending.set(key, slot)
    }
    if (!slot.parts[part.partIndex]) slot.received += 1
    slot.parts[part.partIndex] = part

    if (part.partIndex !== part.partCount - 1) return null
    this.pending.delete(key)
    if (slot.received !== part.partCount) return 'missing_part'
    return assemble(part, slot.parts as DecodedFramePart[])
  }

  /** Drops every in-flight partial assembly (desync / generation bump). */
  reset(): void {
    this.pending.clear()
  }
}

function assemble(last: DecodedFramePart, parts: DecodedFramePart[]): AssembledFrame {
  const ops: DecodedOp[] = []
  for (const part of parts) ops.push(...part.ops)
  return { version: last.version, establish: last.establish, resync: last.resync, generation: last.generation, sequence: last.sequence, ops }
}
