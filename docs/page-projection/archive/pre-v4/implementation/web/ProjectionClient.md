# Implementation — `ProjectionClient.ts` (web)

**Future path:** `web/src/features/sessions/live/page/ProjectionClient.ts`  
**LOC ceiling:** 300  
**Contracts:** orchestration across 04, 05, 07, 08, 09, 10  
**Norm:** redesign §5.6–5.9, §5.7; module map: **orchestration only — no algorithm**  
**Peers:** decode, registry, applyDom, applyCssom, surface, interaction, clientState

---

## Purpose

Wire the client pipe: **receive → decode/assemble → sequence/generation checks → rAF apply → surface/arm → desync/resync**. Contains **no** binary layout logic, no childList move algorithm, no Cssom insertRule details, no iframe sandbox setup internals — those live in peer modules. This file only sequences calls and holds session-scoped state machine.

---

## Invariants

1. LOC ≤ 300; no inlined apply/decode algorithms (call peers).
2. Frame is the unit: apply assembled frames only, in `sequence` order, all pending in one rAF (E9).
3. ACID: peer preflight before mutate; on any desync trigger → enter desync path.
4. Arm only after establishEnd + registry verify + cssomInstall (+ swap if double-buffer).
5. Live `sequence` contiguous within `generation`; empty frames never observed (producer does not emit).
6. Resync MUST NOT be confused with live sequence advancement; watermark drain per contract 07.
7. Soft-nav: no epoch; hard-nav / resync: `surface.beginEpoch`.

---

## Bans

- Reimplementing decode/apply/registry inside this file.
- Best-effort apply on gap / unknown version.
- Arming early.
- Dropping frames under load (buffer; ClientState reports queue depth).
- Full DomMap bootstrap / ad-hoc second path after stream seed.
- JSON parse of frame bodies.

---

## Types and signatures

```ts
export type ProjectionClientConfig = {
  applyBudgetMs: number;      // 4
  swapTimeoutMs: number;      // 1500
  clientStateMs: number;      // 1000
};

export type ProjectionClientDeps = {
  surface: SurfaceHandle;
  decodePart: typeof decodePart;
  assembler: PartAssembler;
  applyDomOps: typeof applyDomOps;
  applyCssomOps: typeof applyCssomOps;
  interaction: InteractionController;
  clientState: ClientStateTracker;
  requestResync: (cursor: { generation: number; sequence: number }) => void;
  /** Optional watermark channel alongside resync stream */
  onResyncWatermark?: (wm: { generation: number; coversThroughSequence: number }) => void;
};

export type ProjectionClient = {
  /** Hub delivers opaque Body bytes (one part). */
  onFramePart(bytes: Uint8Array): void;
  onResyncPart(bytes: Uint8Array): void;
  onResyncWatermark(wm: { generation: number; coversThroughSequence: number }): void;
  /** Soft vs hard — from session navigation signals */
  onHardNavigation(generation: number): void;
  onSoftNavigation(): void;
  dispose(): void;
  /** Test/debug */
  getCursor(): { generation: number; sequence: number; armed: boolean; desynced: boolean };
};

export function createProjectionClient(
  config: ProjectionClientConfig,
  deps: ProjectionClientDeps,
): ProjectionClient;
```

---

## State machine

```
generation: u32
lastAppliedSequence: u32          // 0 before first live frame; establish may use sequence 0
desynced: bool
armed: bool
pending: AssembledFrame[]         // ordered queue
bufferedWhileDesync: AssembledFrame[]
resyncWatermark: { generation, coversThroughSequence } | null
rafScheduled: bool
```

---

## Algorithm — receive live part

```
onFramePart(bytes):
  try:
    part = decodePart(bytes, desynced ? 'resync' : phaseHint)
    assembled = assembler.push(part)
  catch DecodeError:
    enterDesync(errorCode)
    return
  if !assembled: return

  if desynced:
    bufferedWhileDesync.push(assembled)
    return

  validateCursor(assembled) or enterDesync
  pending.push(assembled)
  clientState.noteApplied(lastAppliedSequence, pending.length) // queue depth update
  scheduleRaf()
```

### `validateCursor`

```
h = assembled.header
if h.flags & FLAG_ESTABLISH:
  // establish/resync establish handled in establish path
  return ok for establish pipeline
if h.generation !== generation → generation_mismatch
if h.sequence !== lastAppliedSequence + 1 → sequence_gap
  // first live after establish: expect sequence 1 (or documented handoff); lock with producer
```

---

## Algorithm — rAF apply (E9)

```
scheduleRaf:
  if rafScheduled return
  rafScheduled = true
  requestAnimationFrame(runApply)

runApply:
  rafScheduled = false
  t0 = now()
  while pending.length:
    frame = pending.shift()
    applyAssembledFrame(frame)
    lastAppliedSequence = frame.header.sequence  // if live
  dt = now() - t0
  clientState.noteApplyDuration(dt)
  if dt > applyBudgetMs: clientState.noteOverrun(); // telemetry Frame.ApplyOverrun via API when reported
  clientState.noteApplied(lastAppliedSequence, pending.length)
  clientState.tick()
```

### `applyAssembledFrame` (orchestration only)

```
ops = frame.ops
flags = frame.header.flags

if flags & FLAG_ESTABLISH (or FLAG_RESYNC establish stream):
  handleEstablishFrame(frame)
  return

// LIVE
domOps = ops filter dom
cssomOps = ops filter cssom
try:
  resolveAllDomAddresses(domOps, active.registry)
  resolveAllCssomAddresses(cssomOps, active.cssom)
  applyDomOps(domOps, ctx, 'live_apply')
  applyCssomOps(cssomOps, ctx, 'live_apply')
catch ApplyDesyncError / CssomApplyDesyncError:
  enterDesync(errorCode)
```

Partition by opcode; preserve relative order when applying Dom then Cssom per contract 04 (Dom including documentState, then Cssom list/patch; scrolls are Dom and run after patches inside applyDom when ops ordered — **if single list preserved**, call applyDom once for all Dom ops in order, then applyCssom for Cssom ops in order — scrolls after documentState already in Dom list).

---

## Algorithm — establish / arm

```
handleEstablishFrame:
  for op in ops in order:
    cssomInstall → applyCssomOps; surface.markCssomInstallApplied()
    establishBegin → stash scrolls; surface.beginEpoch if needed; set generation
    establishChunk → surface.writeEstablishChunk
    establishEnd →
      surface mark end
      result = registry.buildFromDocument(doc)
      if result.nodeCount != op.nodeCount → desync establish_node_count_mismatch
      if result.checksum != op.checksum → desync establish_checksum_mismatch
      apply stashed scrolls (PP-EST-4)
      surface.maybeSwap() / wait threshold via surface timers
      tryArm()

tryArm:
  if establish verified ∧ cssomInstall ∧ (swap done or cold):
    armed = true
    interaction.setArmed(true)
    surface.setArmed(true)
```

Handoff live frames after establish arrive as normal sequences; apply in order (PP-EST-3).

---

## Algorithm — desync / resync (PP-REC-*)

```
enterDesync(errorCode):
  if desynced: return
  desynced = true
  armed = false
  interaction.setDesynced(true); setArmed(false)
  surface.setPhase('desynced')
  assembler.reset()
  // keep inbound in bufferedWhileDesync
  requestResync({ generation, sequence: lastAppliedSequence })

onResyncPart:
  decode/assemble with FLAG_RESYNC
  apply into building buffer via establish path (surface.beginEpoch resync:true)

onResyncWatermark(wm):
  resyncWatermark = wm
  // after establishEnd on resync buffer + swap:
  drainBuffer()

drainBuffer:
  wm = resyncWatermark
  keep = buffered.filter(f =>
    f.generation === wm.generation && f.sequence > wm.coversThroughSequence)
  drop older generation or sequence ≤ coversThroughSequence
  sort/ensure sequence order
  pending = keep
  buffered.clear()
  desynced = false
  tryArm()
  scheduleRaf()
```

Resync stream MUST NOT advance live sequence counter on server; client sets `lastAppliedSequence = wm.coversThroughSequence` after successful resync apply so next live expects `+1`.

---

## Algorithm — navigation

```
onHardNavigation(newGen):
  generation = newGen
  lastAppliedSequence = 0
  surface.beginEpoch(newGen, { resync:false })
  disarm until establish completes
  // Diff.GenerationBumped telemetry server-side

onSoftNavigation:
  // no-op for epoch; live frames continue (PP-NAV-2)
```

---

## Tests

| ID | Assert |
|----|--------|
| `PP-FR-6` | Orchestrated apply matches O2 soak |
| `PP-FR-8` | Parts assemble once; missing → desync |
| `PP-EST-3` | Handoff frames after establish neither lost nor double-applied |
| `PP-EST-5` | Unarmed until verify |
| `PP-EST-7` | Checksum fail → desync |
| `PP-REC-1` | Each trigger path calls enterDesync; overload does not |
| `PP-REC-2` | Resync path rebuilds surface |
| `PP-REC-3` | Watermark drain; live sequence not fabricated |
| `PP-NAV-1..3` | Hard/soft/retire via surface APIs |
| LOC | File contains no childList/FULL algorithm bodies |

---

## Module boundary checklist

| Concern | Owner |
|---------|-------|
| Binary read | `decode.ts` |
| Map u32→Node | `registry.ts` |
| Dom mutate | `applyDom.ts` |
| Cssom mutate | `applyCssom.ts` |
| iframe/sandbox/swap | `surface.tsx` |
| intents/caret | `interaction.ts` |
| ClientState send | `clientState.ts` |
| Order, cursor, desync, rAF | **this file** |
