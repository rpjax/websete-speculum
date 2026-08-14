# Implementation — opaque frame relay (API)

**Future path:** `Refactor/Speculum.Api/` Sessions hub + gRPC/fan-out DTO for PageProjection frames  
**Suggested types:** `PageProjectionFrameRelay` (MessagePack hub) / protobuf sibling if sidecar→API uses gRPC  
**LOC ceiling:** keep relay handlers thin (≤ ~150 LOC per type+handler file; no payload parsers)  
**Contracts:** [04-wire.md](../../contracts/04-wire.md), [14-telemetry.md](../../contracts/14-telemetry.md)  
**Norm:** redesign §5.5.5 — **API MUST NOT parse the body**; header fields only; cost **O(1)** in payload size (PP-WIRE-1)

---

## Purpose

Relay PageProjection frame **parts** from sidecar to subscribed web clients. The API reads a fixed-size / fixed-field **header** for routing, sequencing metadata for admission/telemetry, and treats `Body` as opaque bytes.

---

## Invariants

1. `Body` is `byte[]` / `ReadOnlyMemory<byte>` — never `JsonDocument`, never opcode walk, never string-table parse.
2. Header fields the API MAY read:

| Field | Use |
|-------|-----|
| `SessionId` | routing |
| `generation` | admission / telemetry / fan-out metadata |
| `sequence` | telemetry aggregates; NOT correctness apply (client owns ACID) |
| `partIndex`, `partCount` | telemetry; optional metrics |
| `flags` | establish/resync bits for telemetry phase |
| `Body.Length` | bytes accounting, `maxFrameBytes` enforcement at edge if needed |

3. Relay CPU + allocations per message = O(1) w.r.t. Body length aside from the unavoidable buffer copy/send of the opaque span (zero-copy preferred).
4. No `JSON.stringify`/`JSON.parse` of projection trees on this path (PP-WIRE-3).
5. Compression, if any, is transport-level; relay MUST NOT depend on interpreting compressed Body structure.

---

## Bans

- Parsing opcodes, strings, or Node trees in C#.
- Per-op Journal facts on the relay hot path (telemetry is frame-unit — see telemetry.md).
- Using Body content for authorization decisions (session binding is out-of-band).
- Soft-skipping missing header fields — missing required header ⇒ fail the message (effect assert).

---

## Signatures (C#)

```csharp
[MessagePackObject]
public sealed class PageProjectionFramePartMessage
{
    [Key("sessionId")] public Guid SessionId { get; set; }
    [Key("generation")] public uint Generation { get; set; }
    [Key("sequence")] public uint Sequence { get; set; }
    [Key("partIndex")] public ushort PartIndex { get; set; }
    [Key("partCount")] public ushort PartCount { get; set; }
    [Key("flags")] public byte Flags { get; set; }  // bit0 establish, bit1 resync
    /// <summary>Opaque PP binary (§5.5). MUST NOT be parsed by API.</summary>
    [Key("body")] public byte[] Body { get; set; } = Array.Empty<byte>();
}

public interface IPageProjectionFrameRelay
{
    /// <summary>Sidecar ingress → fan-out to session viewers. O(1) header work.</summary>
    ValueTask RelayPartAsync(PageProjectionFramePartMessage msg, CancellationToken ct);
}
```

Hub client event name: stable Sessions hub method e.g. `PageProjectionFramePart` delivering the same shape to the browser (MessagePack).

gRPC ingress from sidecar SHOULD map 1:1 (`bytes body` field).

---

## Algorithm — relay

```
RelayPartAsync(msg):
  1. Validate session binding / viewer set (existing Sessions machinery) — O(subscribers), not O(body)
  2. If Body is null → reject
  3. Optional: if Body.Length > maxFrameBytes (config) → fault metric; still MUST NOT parse;
     producer should already split — oversized single part is a producer bug / genuine fault
  4. Emit frame-unit telemetry hooks (early-return if disabled) with header fields only
  5. Fan-out msg to subscribers (pass through Body reference/copy per transport)
  6. Return

MUST NOT:
  Encoding.UTF8.GetString(Body)
  MessagePackSerializer.Deserialize<OpTree>(Body)
  for-loop scanning opcodes
```

---

## Header vs Body boundary

The **wire format** (§5.5) includes magic/version inside Body. The API does **not** need to re-read magic for relay correctness — sidecar already produced a valid part. If a thin integrity check is ever added, it MUST be O(1) peek of first 2–3 bytes only and still not parse ops; prefer leaving validation to the client (PP-WIRE-2).

Duplicate metadata: hub header fields SHOULD match the Body’s generation/sequence/part fields as written by sidecar (sidecar copies into envelope). API trusts envelope for routing; client trusts Body for apply. Mismatch is a sidecar bug detected by client desync / O2 — API does not reconcile by parsing Body.

---

## Tests

| ID | Assert |
|----|--------|
| `PP-WIRE-1` | Relay handler / DTO path has no Body parser; benchmark: time(~) flat vs Body size 1 KiB..1 MiB |
| `PP-WIRE-3` | No JSON tree ferry in API projection path |
| Fan-out | N subscribers receive identical Body length and header fields |
| Fault | Null Body rejected with catalogued failure `errorCode`+`phase` if published |
