# Implementation — Node URL rewrite (D-SPEC-7)

| Field | Value |
|-------|-------|
| **Future path** | `Refactor/sidecar/browser/patchright/mirror/page/node/rewrite.ts` |
| **LOC ceiling** | 300 |
| **Contracts implemented** | [02-f-map.md](../../contracts/02-f-map.md) URL fields; [11-assets.md](../../contracts/11-assets.md); [04-wire.md](../../contracts/04-wire.md); D-SPEC-7 |
| **Invariants** | After receiving an encoded part from the page, Node **decodes ops + string table**, rewrites URL-bearing strings into `/w7s/virtual-*` forms, **re-encodes the part once** for outbound relay. Work is per-frame ops + string table only. Not API re-parse. Session-scoped rewrite (K2) — no shared rewrite memo across sessions. |
| **Ban list** | Intermediate JS object trees of the full document. JSON tree ferry. Skipping rewrite. Rewriting in the API. Shared cross-session URL memo. Inventing `virtualData1x1` placeholders for real assets. Bare-root `/w7s/virtual-assets/{host}/` without path. |

---

## Types / signatures

```ts
interface RewriteContext {
  sessionId: string;
  pageUrl: string;          // Document base for resolution
  reservedQueryParams: Set<string>; // Speculum-reserved per virtual-assets §1.1
}

interface NodeRewrite {
  /** Decode → rewrite strings → encode; returns bytes for mirror+relay. */
  rewritePart(input: Uint8Array, ctx: RewriteContext): Uint8Array;
}
```

---

## URL output forms (contract 11)

| Kind | Form |
|------|------|
| http(s) subresource | `/w7s/virtual-assets/{host}{path}?query` |
| blob: | `/w7s/virtual-blob/{id}` |
| data: | `/w7s/virtual-data/{id}` (stable per-session id for identical data URLs) |

`host` includes host[:port] as required for the asset serve key. Path MUST be absolute path beginning with `/`. Query preserves upstream params except Speculum-reserved handling per assets doc.

---

## Which strings to rewrite

Walk decoded ops; for each string table entry **that is referenced** by a URL-bearing field, rewrite in place (new table).

### Dom attributes (by name, case-insensitive)

`src`, `href`, `xlink:href`, `data-src`, `poster`, `srcset`, `imagesrcset`.

### Inline style / Cssom cssText

Rewrite `url(…)`, `@import`, `image-set(…)` bare URL tokens inside the string.

### srcset

Parse candidates; rewrite each URL token; reserialize.

### Non-URL strings

Leave unchanged (class names, plain text, non-URL attrs).

### javascript: / deny

Already stripped in F; if present, replace with empty or remove attr at rewrite (defense in depth).

---

## Step-by-step — `rewritePart` (D-SPEC-7)

1. **Decode** header + string table + ops into a lightweight structure: `strings: string[]`, `ops: DecodedOp[]` with indices into strings / nested nodes. **Do not** build a document tree.
2. Collect rewrite targets:
   - For each `patch` / fresh `Node` element attr whose name is URL-bearing → mark value strIdx.
   - For `srcset`/`imagesrcset` → mark.
   - For style attr and Cssom `cssText` strIdx → mark as CSS-URL-bearing.
3. For each marked string index (unique):
   a. Let `s = strings[i]`.
   b. `strings[i] = rewriteString(s, kind, ctx)`.
4. **Re-encode** one part with same `generation`, `sequence`, `partIndex`, `partCount`, `flags`, ops structure, updated string table.
5. Return bytes. Mirror applies **rewritten** bytes/ops. Relay sends rewritten bytes. Page’s original bytes are discarded after rewrite (page already pushed once — Node does not push back to page).

### `rewriteString` for plain URL

1. Trim; if empty return empty.
2. Resolve against `ctx.pageUrl` if relative.
3. Switch scheme:
   - `http:`/`https:` → virtual-assets form; strip only Speculum-reserved query params from the **serve key** side per assets contract when forming path; keep required upstream query for correctness (signed CDN tokens key differently — PP-ASSET-7).
   - `blob:` → map to session blob id table → `/w7s/virtual-blob/{id}`.
   - `data:` → map to session data id → `/w7s/virtual-data/{id}` (never collapse unrelated assets to a 1×1 placeholder — PP-ASSET-3).
   - `about:`/`javascript:` → empty or safe deny.
4. Never emit `/w7s/virtual-assets/{host}` without a path (no bare-root 400 class).

### CSS text

Tokenize coarsely for `url(`, `@import`, `image-set(`; rewrite URL substrings; preserve remainder byte-for-byte where possible.

---

## Session maps (K2)

```ts
// per session only
blobIdByUrl: Map<string, string>
dataIdByUrl: Map<string, string>
```

Destroyed with session. MUST NOT be host-global.

---

## Interaction with encode budgets

Rewrite MAY change string lengths; part size may grow slightly. If rewritten part exceeds `maxFrameBytes`, Node MAY re-split parts **keeping the same sequence** (partCount/index updated). Prefer rare; in-page already splits.

---

## Prefetch hint (optional note)

Rewrite MAY emit side-channel hints (not in frame body) for asset priority (CSS + in-viewport) to the asset plane — out of band; does not alter op algorithms. Priority rules in contract 11.

---

## PP-* tests

| ID | Assert |
|----|--------|
| `PP-WIRE-1` | API still opaque; rewrite is sidecar-only |
| `PP-WIRE-3` | No JSON document tree |
| `PP-ASSET-3` | No virtualData1x1 abuse; no bare-root 400 |
| `PP-ASSET-7` | Signed CDN queries key differently |
| `PP-ISO-2` | Rewrite maps per session |
| D-SPEC-7 | Single re-encode hop; string table only |
