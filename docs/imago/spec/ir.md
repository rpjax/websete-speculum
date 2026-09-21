# The IR — what a closed session leaves on disk

Written at "close sandbox", read by generation and nothing else (IR-6). This seam is what lets a
session be generated from N times under N configurations without ever re-browsing.

## 1. Layout

```
sessions/<sessionId>/
  session.json           # the entity: status, config, versions, stats (flow.md §1)
  timeline.jsonl         # append-only event log (atoms.md §2)
  overlay.json           # curation: atom names, volatile set, conflict resolutions, dropped items
  atoms/<atomId>.json
  transitions/<id>.json
  snapshots/<snapId>.json# tree hash + styles + assets + oracle refs + trigger
  trees/<hash>.json
  fragments/<hash>.json
  styles/<hash>.css
  assets/<hash>.<ext>
  network/<reqId>.json
  oracles/<snapId>/      # reference screenshots, matching-rule sets, geometry (atoms.md §7)
  slots.json
  contract.json
  coverage.md
  errors.json
```

Everything hashed is **content-addressed** (SHA-256, first 16 hex). Dedup, cross-atom sharing and
byte-idempotence all fall out of that; none is a separate feature.

## 2. Invariants (IR-1 … IR-8)

- **IR-1 Content addressing.** Same bytes → same path. No hashed file is ever mutated.
- **IR-2 No data in structure.** A tree or fragment node may not carry text that came from an API
  response; it carries a **slot marker**. **I1** made mechanical.
- **IR-3 Closed world.** Every asset referenced by a tree or stylesheet resolves inside `assets/`.
  A dangling reference is a failure, not a warning.
- **IR-4 Stylesheets authored, not merged.** Per source sheet, source order, including rules that
  matched nothing. No merging, minifying or pruning at capture (**I3**).
- **IR-5 Atoms reference, never inline.** An atom is a manifest of hashes.
- **IR-6 Generator isolation.** Generation reads the IR and nothing else — no network, no live browser,
  no origin.
- **IR-7 Immutability + overlay.** A closed session is frozen (S-1). All human curation lives in
  `overlay.json`, which references it. Generation reads session + overlay.
- **IR-8 Errors are first class.** `errors.json` ships with the artifact; a session with errors may be
  usable, but nothing downstream may call it complete.

## 3. Tree encoding

```jsonc
{ "root": {
    "t": "element", "n": "div",
    "a": { "class": "grid" },
    "c": [ … ],
    "shadow": { "mode": "open"|"closed", "root": {…} },
    "doc":    { "src": "…", "root": {…} },
    "canvas": { "w": 640, "h": 480, "substitute": "<assetHash>|null" },
    "slot":   "slot-a91f"
} }
```

Canonicalization, required for hashing to mean anything:

1. attributes sorted; whitespace-only text between block elements dropped; comments dropped
2. attributes in the session's volatile set replaced by a stable placeholder **before** hashing
   (hydration ids, generated `id`/ARIA pairs, nonces)
3. inline `style` attributes preserved verbatim — authored bytes, not computed style
4. form state captured explicitly (`value`, `checked`, `selected`, `scrollTop`), never as attributes the
   origin did not serve

## 4. Fragments

A subtree whose canonical hash appears in ≥2 atoms.

- **F-1** subtree hashes computed bottom-up across all trees
- **F-2** qualifies at count ≥2 across distinct atoms **and** node count ≥ floor (default 8)
- **F-3** maximal wins: a qualifying parent suppresses its children
- **F-4** no name, no semantics, no props — a hash and a reference

That is the entire deduplication layer (**I4**): shell, header and nav sharing with no taxonomy to argue
about and nothing to keep in sync.

A subtree repeating **within one atom** with the same shape and differing slot values is recorded as
`repetition: { shape, count, varyingSlots }` — the only honest evidence that a reusable block exists,
since one instance can never separate structure from content. Recorded, not acted on.

## 5. Slots

```jsonc
{ "slot-a91f": {
    "atom": "catalog/list",
    "location": { "treePath": [0,3,1,2], "kind": "text|attr|srcset|style-var", "attr": "href" },
    "source":   { "reqId": "req-014", "jsonPath": "$.items[3].name" },
    "confidence": "exact|formatted|heuristic" } }
```

`exact` = verbatim. `formatted` = through a recognized transform (currency, date, number grouping,
truncation), which is named. `heuristic` = correlated by position/timing only; **never gates accept,
never drives a generator** — review material.

Slots are the seam between the two artifacts: the bundle carries the marker, the contract carries the
meaning.

## 6. Deliberately absent

Component boundaries (I4) · any judgement about what an endpoint means · server behaviour, validation
or state machines · anything the human did not browse.
