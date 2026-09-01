# Implementation — Cssom plane (producer)

| Field | Value |
|-------|-------|
| **Future path** | `sidecar/browser/patchright/mirror/page/cssom.ts` **and** in-page fragment `inpage/cssom.frag.ts` |
| **LOC ceiling** | 400 |
| **Contracts implemented** | [06-cssom.md](../../contracts/06-cssom.md); redesign §5.10; D-SPEC-8 (id range); sealed C1–C9 as amended |
| **Invariants** | Dom/Cssom plane split; shared `generation`/`sequence`; one pipe. Cssom ids in `[0x80000001 .. 0xFFFFFFFF]`; `0x80000000` reserved; Dom ids never enter this range. Opcode disambiguates sheet vs rule. `cssomInstall` before any `establishChunk`. Live Cssom after Dom patch/documentState, before scrolls. Owned CSSOM on client (not URL reload authority). Scope `main \| pierceHost`. |
| **Ban list** | Sharing Cssom across sessions (K2). Redesigning plane beyond encoding/chronology/order/coalesce. Allocating Cssom ids from Dom counter. Using Dom range for sheets/rules. Full stylesheet refetch as authority. |

---

## Id allocation (D-SPEC-8)

```ts
const CSSOM_ID_RESERVED = 0x80000000;
const CSSOM_ID_MIN = 0x80000001;
const CSSOM_ID_MAX = 0xffffffff;

interface CssomIdSpace {
  allocSheet(): number;
  allocRule(): number;
  resetOnGenerationBump(): void; // continues counter; never reuse; clear maps
}
```

Algorithm:

1. `nextCssomId` starts at `CSSOM_ID_MIN` for the session.
2. `alloc*`: return `nextCssomId++` (same counter for sheets and rules — opcode disambiguates).
3. If `nextCssomId` would exceed `CSSOM_ID_MAX` → fail closed (`cssom_id_space_exhausted`).
4. On Dom `bumpGeneration`: clear sheet/rule WeakMaps; **do not** reset `nextCssomId` (same never-reuse strength as Dom).
5. MUST NOT call Dom `identity.allocate` for Cssom objects.

Forward maps: `WeakMap<CSSStyleSheet, id>`, `WeakMap<CSSRule, id>` (or sheet+index keying if rule object identity unstable — prefer WeakMap on rule objects; on replace, new id).

---

## Types / signatures

```ts
type CssomScope = 'main' | 'pierceHost';

interface CssomSheetRecord {
  id: number;
  scope: CssomScope;
  ownerNodeId: NodeId | 0; // pierce host or 0 for document-level
  rules: CssomRuleRecord[]; // install only; full tree
}

interface CssomRuleRecord {
  id: number;
  type: number;          // CSSRule.type
  cssText: string;       // authoritative text for owned CSSOM
  style?: Record<string, string>; // optional structured for style rules if needed
  children?: CssomRuleRecord[];   // grouping rules
}

interface CssomProducer {
  /** Full install snapshot for establish/resync. */
  snapshotInstall(): CssomSheetRecord[];
  /** Sensors mark dirty; flush returns ops. */
  flushOps(): WireOp[];
  noteSheetListChanged(): void;
  noteRuleListChanged(sheet: CSSStyleSheet): void;
  noteRulePatched(rule: CSSRule): void;
}
```

---

## Sensors

In-page:

1. Observe `document.styleSheets` length/order changes (poll at frame boundary is acceptable if no native event — prefer wrapping `adoptedStyleSheets` setters + MO on `style`/`link` elements).
2. For each tracked sheet, observe rule list mutations (insertRule/deleteRule hooks or boundary diff).
3. For style rules, detect `style` property / `cssText` changes via boundary diff of tracked rule cssText.
4. Sensor handlers **only** mark dirty sets: `sheetsDirty`, `ruleListDirty: Set<sheetId>`, `rulePatchDirty: Set<ruleId>`, `addedSheets`, `removedSheets`.

Pierce-scoped sheets: associate with pierce host node id; `scope = 'pierceHost'`.

---

## Coalescing within a frame

1. Multiple patches to same rule → one `cssomPatch` with final cssText.
2. Sheet added and removed in same frame → omit both.
3. Rule added and removed in same frame under same sheet → omit.
4. Install path is full snapshot; no coalesce with live.

---

## Step-by-step — `snapshotInstall`

1. Enumerate document style sheets + pierce-scoped sheets in stable order (document order of owners; adoptedStyleSheets after).
2. For each sheet: allocate id if new; recursively snapshot rules allocating rule ids; capture `cssText` / children.
3. Return `CssomSheetRecord[]` for op 8.

Empty install allowed **only** if Virtual truly has zero sheets; if Virtual is styled and install empty → product bug (fail later debug; do not invent fake sheets).

---

## Step-by-step — `flushOps` (live)

1. Build `removed` / `added` sheet list ops (op 9).
2. For each dirty sheet rule list → op 10.
3. For each dirty rule → op 11.
4. Clear dirty sets.
5. Return ops (caller places them after documentState).

---

## Binary sheet/rule shape (encoder)

**Sheet:** `id u32`, `scope u8` (0=main, 1=pierceHost), `ownerNodeId u32`, `ruleCount u32`, Rule*.

**Rule:** `id u32`, `type u16`, `cssText strIdx u32`, `childCount u32`, Rule*children.

URL tokens inside `cssText` are rewritten on Node hop ([node-rewrite.md](node-rewrite.md)).

---

## Ordering

| Phase | Order |
|-------|-------|
| Establish/resync | op8 before any establishChunk |
| Live | after Dom patch + documentState; before scrolls |

---

## PP-* tests

| ID | Assert |
|----|--------|
| `PP-EST-6` | install before first chunk; no FOUC |
| `PP-REC-2` | Resync includes cssomInstall from mirror path |
| Plane integrity | Cssom ids only in Cssom range; Dom resolve miss ≠ Cssom miss codes |
| `PP-ISO-2` | Cssom never shared across sessions |
| Coalesce | add+remove same frame never sent |
