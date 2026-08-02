# Injection flow — 03 Targets

## Job
Define at least one URL match rule (domain + path) for when the injection applies — via a facilitated host/path editor, not raw JSON.

## Route
Step `targets`.

## Entrada
Placement complete.

## Layout

```
step-wizard step 3 of 4

[ Guided presets: Match all pages | Clear rules ]

Rules (1..n) — each row:
  Host input (example.com | *.example.com | empty=* )
  Path input (/ or /app)
  Exact path checkbox  → path.matchType exact|prefix
  [ Remove ]

[ Add rule ] draft host/path/exact

Helper: At least one rule. Match all = any host + any path.
[ Back ] [ Continue ]
```

Advanced (reveal, optional): show camelCase summary chips per rule (`describeUrlMatchRule`).

## Inventory de controlos

| id | tipo | label | helper | default | required | validation |
|----|------|-------|--------|---------|----------|------------|
| rules | repeater | Target rules | ≥1 rule | one Match all | yes | count ≥ 1 |
| addRule | button | Add rule | — | — | — | host or path draft |
| presetMatchAll | guided-preset | Match all pages | Any/Any | — | — | |
| presetClear | guided-preset | Clear rules | Leaves zero until add | — | — | then invalid until add |
| host | text | Host | `*` / `example.com` / `*.example.com` | — | if pattern | leading `*` only |
| path | text | Path | `/` = any path | `/` | — | |
| exact | checkbox | Exact path | Sets `path.matchType` | false → prefix | — | |
| remove | button | Remove | — | — | — | |

Keep pattern editors **facilitated** — not raw JSON / not scope dropdowns as primary.

## Copy

- Match all: `Match all pages`
- Clear: `Clear rules`
- Add rule: `Add`
- Helper: `At least one rule is required. Use Match all for every navigation.`
- Error: `Add at least one target rule.`
- Host placeholder: `example.com or *.example.com`
- Path helper: `Path / means any path on that host.`

## Inteligência UX nesta view

- Primary path: accept Match all or refine host/path → Continue.
- Helpers: `guided-preset`, `inline-validation`, `helper-callout`, `id-chip` summaries.
- Hidden: full pattern grammar; Advanced labels only if needed later.
- Recovery: inline validation.

## Path feliz
Ensure ≥1 rule → Continue → Review.

## Reveals
Optional rule summary chips; Advanced label/segment editors deferred.

## Estados
idle / invalid (zero rules).

## Dados / API
Draft `UrlMatchRule` models aligned with `Configurations.Models.Patterns` (JSON camelCase).

**Match all** (default one rule):

```json
{
  "domain": { "scope": "any", "labels": [] },
  "path": { "scope": "any", "matchType": "exact", "segments": [] }
}
```

**Host pattern** via facilitator → `domain.scope: pattern` + labels (`exact`/`any`).  
**Path** `/` → `path.scope: any`; otherwise `pattern` + segments.  
`path.matchType`: `exact` \| `prefix` when path has segments (Exact checkbox).

Reuse the same helpers as Navigation allowlist (`urlMatchRules` / camelCase).

## Components usados
`step-wizard`, `guided-preset`, `inline-validation`, `helper-callout`.

## Navegação
→ 04-review-apply.

## Teclado / a11y
Repeater add/remove labeled.

## Aceite de build
- [ ] Cannot continue with zero rules
- [ ] Match all preset works
- [ ] Exact path toggles matchType
- [ ] Back preserves rules

## Explicitamente fora
Testing match against live URL in V1; raw JSON target editor as primary.
