# Diagnostics timeline
## Job
Read scoped diagnostic evidence as a narrative timeline.
## Route / params / auth gate
- Route: `/admin/diagnostics/timeline`
- Params: future scope and period
- Auth: Bearer access
## Entrada (pré-condições, deep-link)
Opened from Investigate; future deep-links carry scope and period.
## Layout (ASCII regiões)
`[Timeline title] [availability callout] [honest empty state]`.
## Inventory de controlos
| id | tipo | label | helper | default | required | validation |
| scope | future selector | Scope | Evidence boundary | none | future | known scope |
| period | future range | Period | Narrative time window | none | future | valid range |
## Copy (strings)
“Diagnostics timeline”; “No timeline to read”; “Timeline data is not available yet.”
## Inteligência UX nesta view
Timeline is a reader, not a telemetry dump; it waits for catalogued evidence contracts.
## Path feliz (passos numerados)
1. Select scope and period when available. 2. Load events. 3. Read chapters and drill into evidence.
## Reveals
Technical payloads appear only after narrative event selection.
## Estados (loading/empty/error/success/blocked)
Current empty state explains API expansion; future errors preserve selected scope.
## Dados / API
| ação UI | método | path | request | response usada |
| future query | GET | diagnostics timeline endpoint | scope, period | catalogued events |
## Components usados
`PageHeader`, `HelperCallout`, `EmptyState`.
## Navegação (vem de / sai para)
From Diagnostics hub; future link to Investigate uses selected period.
## Teclado / a11y notas
Future timeline keyboard navigation follows chronological order.
## Aceite de build
- No legacy telemetry feed substitutes for the timeline.
## Explicitamente fora
Charts as the primary timeline experience.
