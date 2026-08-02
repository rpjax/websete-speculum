# Configurations hub
## Job
Choose one engine section and see whether it is ready.
## Route / params / auth gate
- Route: `/admin/configurations`
- Params: none
- Auth: Bearer access
## Entrada (pré-condições, deep-link)
Admin navigation opens the hub; a section editor returns here.
## Layout (ASCII regiões)
`[Title] [operational callout]` above `[section cards: status | purpose | action]`.
## Inventory de controlos
| id | tipo | label | helper | default | required | validation |
| section | card link | Open section | Edit one concern | all seven | yes | known key |
| scripting | link | Open injections | Safer primary flow | visible | yes | route exists |
## Copy (strings)
“Configurations”; “Manage focused engine sections”; “Open section”; “Open injections”; “Configuration needs attention”.
## Inteligência UX nesta view
Status is summarized first; Scripting sends operators to injection management instead of a JSON wall.
## Path feliz (passos numerados)
1. Load status. 2. Find the section. 3. Open its focused editor.
## Reveals
No reveal; each card drills into one route.
## Estados (loading/empty/error/success/blocked)
Loading says “Checking”; error explains unavailable status; missing sections receive warning badges; ready sections receive Ready badges.
## Dados / API
| ação UI | método | path | request | response usada |
| load | GET | `/api/configurations/status` | none | `operational`, `missing` |
## Components usados
`PageHeader`, `HelperCallout`, `StatusPill`, Card, Button.
## Navegação (vem de / sai para)
From Admin nav; to `/admin/configurations/:section` or `/admin/scripts?tab=injections`.
## Teclado / a11y notas
Cards use named links; status has visible text, not color alone.
## Aceite de build
- Seven named sections render; status and Scripting deep-link work.
## Explicitamente fora
Bulk multi-section editing and raw JSON as the landing experience.
