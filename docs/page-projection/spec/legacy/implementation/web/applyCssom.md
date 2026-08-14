# Implementation — `applyCssom.ts` (web)

**Future path:** `Refactor/web/src/features/sessions/live/page/applyCssom.ts`  
**LOC ceiling:** 300  
**Contracts:** [06-cssom.md](../../contracts/06-cssom.md), [09-apply.md](../../contracts/09-apply.md), [04-wire.md](../../contracts/04-wire.md)  
**Decisions:** D-SPEC-8 (Cssom id range `[0x80000001 .. 0xFFFFFFFF]`)  
**Norm:** redesign §5.10; sealed cssom C1–C9 (owned CSSOM, scope C7, anti-flicker C3.1)

---

## Purpose

Apply Cssom-plane ops to an **owned** CSSOM on the Projected surface — not by reloading stylesheet URLs as authority (C6). Enforce scope `main | pierceHost` so flattened pierce trees do not leak pierced CSS into the parent (C7). Participate in ACID: unresolved Cssom id ⇒ desync (`cssom_id_unresolved`).

---

## Invariants

1. Sheet/rule ids are u32 in Cssom range (D-SPEC-8). Dom registry NEVER stores these ids.
2. `cssomInstall` MUST complete before any `establishChunk` paints unstyled content (PP-EST-6 / C3.1). Orchestrator orders calls; this module installs synchronously when invoked.
3. Owned sheets: constructed via `document.adoptedStyleSheets` and/or dedicated `<style>` owners under Speculum control — **authoritative rules are the installed CSSOM objects**, not a second fetch of Virtual `href`.
4. Scope:
   - `main` → applies to the surface document root / main style scope.
   - `pierceHost` → applies only under the pierce host element identified by `pierceHostId` (Dom node id); MUST NOT match selectors outside that subtree’s shadow-or-scope boundary as defined by sealed cssom C7.
5. ACID with Dom: ProjectionClient preflight resolves Dom + Cssom addresses before either mutates; or applyCssom preflight runs before its writes within the same rAF transaction after Dom preflight — **whole frame one transaction**.
6. On buffer retire: dispose all owned sheets/rules maps (PP-NAV-3).

---

## Bans

- Redesigning the Cssom plane beyond encoding/chronology/order/coalesce (contract 06).
- Sharing Cssom across sessions (K2).
- Using URL stylesheet reload as the source of truth for mirrored rules.
- Silently ignoring unknown sheet/rule ids.
- Applying pierced sheet rules into `main` scope.
- CSS **text rewriting** of selectors (`html`/`body` stand-ins) — deleted (PP-SURF-4); scope isolation replaces it.

---

## Types and signatures

```ts
export type CssomScope = 'main' | 'pierceHost';

export type CssomSheetRecord = {
  id: number;
  scope: CssomScope;
  pierceHostId?: number;
  /** Underlying CSSStyleSheet or constructable sheet handle. */
  sheet: CSSStyleSheet;
};

export type CssomRuleRecord = {
  id: number;
  sheetId: number;
  /** Index in owning sheet’s cssRules at last apply, if tracked. */
  index: number;
};

export class CssomApplyDesyncError extends Error {
  constructor(
    readonly errorCode: 'cssom_id_unresolved',
    readonly phase: 'live_apply' | 'establish' | 'resync',
    message: string,
  ) { super(message); }
}

export interface CssomRegistry {
  getSheet(id: number): CssomSheetRecord | undefined;
  getRule(id: number): CssomRuleRecord | undefined;
  clear(): void;
}

export type ApplyCssomContext = {
  document: Document;
  domRegistry: Registry; // resolve pierceHostId
  cssom: CssomRegistry;
};

export function createCssomRegistry(): CssomRegistry;

export function applyCssomOps(
  ops: WireOp[],
  ctx: ApplyCssomContext,
  phase: CssomApplyDesyncError['phase'],
): { applied: number };

export function resolveAllCssomAddresses(ops: WireOp[], cssom: CssomRegistry): void;
```

---

## Algorithm — id validation

```
function assertCssomId(id: number):
  if id < 0x80000001 || id > 0xFFFFFFFF → treat as unresolved / decode fault
  // 0x80000000 reserved (D-SPEC-8)
```

---

## Algorithm — ACID preflight

| Op | Resolve |
|----|---------|
| `cssomInstall` | none prior (defines sheets); pierceHostId Dom ids MUST resolve in `domRegistry` when scope is pierceHost **after** Dom establish registry exists; on cold establish, install may run **before** chunks — pierce hosts must already exist or install uses document-level placeholders per sealed C7 timing. **Normative cold order:** `cssomInstall` before chunks (sheets for `main` first); pierceHost-scoped sheets that need hosts MAY be installed after hosts exist in streaming establish — if producer emits pierceHost sheets only in live/install after hosts, follow producer. For single `cssomInstall` at start: `main` sheets only required before chunks; pierceHost entries in same install MUST carry host ids that will exist after first chunks — **fail closed** if host missing at apply time → desync. |
| `cssomSheetList` | every `removed` sheet id; added sheets are new |
| `cssomRuleList` | `sheet` id; every `removed` rule id |
| `cssomPatch` | `rule` id |

Any miss ⇒ `cssom_id_unresolved`.

---

## Algorithm — `cssomInstall`

```
1. Optionally clear prior owned CSSOM if install is epoch-defining (establish/resync).
2. For each sheet in sheets[]:
     assertCssomId(sheet.id)
     styleSheet = createEmptyConstructableSheet()
     if sheet.scope === 'main':
       adopt into document (adoptedStyleSheets append / Speculum owner)
     if sheet.scope === 'pierceHost':
       host = domRegistry.get(sheet.pierceHostId)
       if !host → desync
       attach sheet to host scope (shadow root adoptedStyleSheets if pierce materialized as shadow;
         or sealed C7 attachment point — MUST match sidecar cssom scope model)
     insert initial rules from install payload (order preserved)
     cssom.register sheet + each rule id
3. MUST be synchronous before paint of subsequent establish HTML (caller guarantees call order).
```

---

## Algorithm — `cssomSheetList`

```
for id in removed:
  sheet = cssom.getSheet(id) or desync
  detach from document/host
  unregister sheet and its rules
for { index, sheet } in added (ascending index):
  create + insert sheet at index in the ordered sheet list for its scope
  register
```

Producer coalescing: sheet added+removed same frame never sent — client does not special-case.

---

## Algorithm — `cssomRuleList`

```
sheetRec = cssom.getSheet(sheet) or desync
for id in removed:
  rule = cssom.getRule(id) or desync
  sheet.deleteRule(rule.index)  // or match by identity handle
  unregister
for { index, rule } in added:
  sheet.insertRule(rule.cssText, index)
  register rule id → handle/index
```

---

## Algorithm — `cssomPatch`

```
rec = cssom.getRule(ruleId) or desync
// In-place update per sealed cssom: typically replace cssText at index
sheet = sheet of rec
sheet.deleteRule(rec.index)
sheet.insertRule(newCssText, rec.index)
update registry fields
```

Idempotent patches safe.

---

## Ordering within mixed frames

ProjectionClient applies Dom ops (including `documentState`) then Cssom list/patch (contract 04). `cssomInstall` is applied before establish chunks. `applyCssomOps` SHOULD accept only Cssom opcodes; ignore others if a full list is passed.

---

## Buffer retire

```
cssom.clear()
// drop adoptedStyleSheets references; GC sheets
```

---

## Tests

| ID | Assert |
|----|--------|
| `PP-EST-6` | Install before first chunk; no FOUC (screenshot / computed style on first paint sample) |
| `PP-REC-1` | Bad Cssom id ⇒ desync |
| C7 | pierceHost sheet does not style main document nodes outside host |
| C6 | Killing network after install does not clear owned rules |
| `PP-NAV-3` | Retired buffer releases Cssom registry |
| Coalesce | N patches same rule in one frame already coalesced by producer — client applies one |
