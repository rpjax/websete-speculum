# Contract 07 — Recovery and Node mirror

**Norm:** redesign §5.7. **Tests:** PP-REC-1..3. **Impl:** `node-mirror.md`, client orchestration.

## Desync triggers (exhaustive) — PP-REC-1

Client MUST desync on **and only on**:

1. Id does not resolve in registry  
2. `sequence` gap  
3. `generation` mismatch  
4. Missing frame part  
5. Unknown wire `version` or decode error  
6. `establishEnd` `nodeCount`/`checksum` mismatch  
7. Cssom id does not resolve  

**Not** a desync trigger: overload / backpressure (rate degrade only).

## On desync

1. Mark desynced; buffer inbound frames; disarm input.  
2. OOB `PageProjection.Resync` with last contiguous `{ generation, sequence }`.  
3. Await resync stream.

## Resync response — PP-REC-2, PP-REC-3

1. Normal frame stream with **resync** flag: `cssomInstall`, `establishBegin`, `establishChunk`*, `establishEnd`.  
2. Watermark `{ generation, coversThroughSequence }` as **hub/gRPC control metadata** alongside the stream — **not** inside the binary body (D-SPEC-10).  
3. Produced from **Node mirror** HTML serialize — page not involved.  
4. MUST NOT allocate or advance live `sequence`.  
5. Client: build into **second** iframe buffer; apply stream; drain buffer dropping `generation` older or `sequence ≤ coversThroughSequence`; apply rest in order; set `lastAppliedSequence = coversThroughSequence`; re-arm.

## Node mirror (§5.7.3)

- Decoded projected tree; apply every frame relayed (after rewrite).  
- Resync source + O2 source.  
- Budget E7: ≤ 4 MiB for ~25k nodes → **flat** decoded form, not heavy object graphs.  
- `mirrorMaxBytes` default 4 MiB (config 15).

## Interface sketch

```ts
interface NodeMirror {
  applyFrame(ops: WireOp[]): void; // throws MirrorDesyncError on address miss
  serializeHtml(): string;         // speculum-anchor ids
  clear(): void;                   // generation bump
  byteSize(): number;
}
```
