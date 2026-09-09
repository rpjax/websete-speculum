import { appendFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { hashBytes } from './hash.js'

/**
 * Append-only journal + content-addressed blob store (S-4).
 *
 * "In memory" is the hot path, not the durability story: events and bodies land on
 * disk as they arrive, so a renderer crash costs the tail of a session and not the
 * whole browse. Close promotes; it does not re-hash.
 */
export class Journal {
  readonly dir: string
  private readonly stream: ReturnType<typeof createWriteStream>
  private readonly seen = new Set<string>()

  constructor(dir: string) {
    this.dir = dir
    mkdirSync(join(dir, 'blobs'), { recursive: true })
    this.stream = createWriteStream(join(dir, 'journal.jsonl'), { flags: 'a' })
  }

  append(event: unknown): void {
    this.stream.write(JSON.stringify(event) + '\n')
  }

  /** Store bytes content-addressed. Returns the hash. Re-storing is free. */
  putBlob(data: Buffer | string): string {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8')
    const hash = hashBytes(buf)
    if (this.seen.has(hash)) return hash
    const path = join(this.dir, 'blobs', hash)
    if (!existsSync(path)) writeFileSync(path, buf)
    this.seen.add(hash)
    return hash
  }

  hasBlob(hash: string): boolean {
    return existsSync(join(this.dir, 'blobs', hash))
  }

  readBlob(hash: string): Buffer {
    return readFileSync(join(this.dir, 'blobs', hash))
  }

  /** Sidecar documents written next to the journal during recording. */
  writeDoc(name: string, value: unknown): void {
    const path = join(this.dir, name)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(value, null, 2))
  }

  /** Write exact bytes (hashed artifacts must never be pretty-printed). */
  writeRaw(name: string, text: string): void {
    const path = join(this.dir, name)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, text)
  }

  appendDocLine(name: string, value: unknown): void {
    appendFileSync(join(this.dir, name), JSON.stringify(value) + '\n')
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => this.stream.end(resolve))
  }
}
