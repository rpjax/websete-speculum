# Component — AdminPage

## Papel
Consistent page shell: max-width rhythm, vertical density, optional sticky footer (Save strip).

## Quando usar
All Admin/Setup domain pages. Prefer `width="overview"` (`max-w-5xl`) for Home/lists; `width="editor"` (`max-w-3xl`) for section editors.

## Variantes
`overview` | `editor` | `narrow` (`max-w-2xl`).

## Estados
Children own loading/empty; footer slot always mounts when provided.

## Aceite
Pages do not float unbounded content; Save actions can sit in sticky footer.

---

# Component — DataCard

## Papel
Bordered `bg-card` container for tables and dense lists (stops content floating on void).

## Quando usar
Sessions/Profiles/Scripts lists; config domain lists; live strips.

## Aceite
Table + pagination footer live inside one card with shared border.

---

# Component — IdChip

## Papel
Monospace identity chip: truncate on small viewports, full id in `title`, optional Link.

## Quando usar
sessionId, profileId, script id in lists and strips.

## Aceite
Never dump raw UUID as unstyled paragraph primary text.

---

# Component — MetaRow

## Papel
Horizontal row of StatusPills + counts + secondary actions under PageHeader.

## Aceite
Lists show count/context without a second header block.

---

# Component — StatCard

## Papel
Compact metric tile (label, value, optional icon/sub/progress). Home overview only with real API numbers.

## Explicitamente fora
Fake health scores; diagnostics gauges without APIs.

---

# Component — FieldGrid / SwitchField

## Papel
Dense labeled fields and switch rows for configuration facilitators.

## Aceite
Every control has Label + helper; switches use accessible ids.

---

# Component — SaveFeedbackStrip

## Papel
Primary Save button + pending state + success/error message (inline, not toast-only). Sticky footer friendly.

## Quando usar
Configuration section editors; Host apply confirmation footers.

## Aceite
Routine save has no confirm dialog; errors stay visible with field paths when provided.
