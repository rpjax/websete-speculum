# Host resource status

## Job

Read host capacity and enter the reviewed provisioning flow.

## Route / params / auth gate

- Route: `/admin/host-resources`

- Params: none

- Auth: Bearer access

## Entrada (pré-condições, deep-link)

Admin navigation or ResourceManagement context opens this route.

## Layout (ASCII regiões)

```

[Title]

[status pills: Host · shm · CPU · apply state]

[StatCards: Host memory | Available | Shared memory | CPU + ulimits]

[ResourceGauges: host use · sidecar shm vs host]

[lastApply card if present]

[NBA if shm below planned floor]

[NBA: Live resource monitoring → Diagnostics Resources]

[StepWizard] [Parameters | Review | Applied]

```



## Inventory de controlos

| id | tipo | label | helper | default | required | validation |

| status | metrics | Current status | Host memory/CPU, sidecar shm/limits | API | yes | response |

| gauges | resource-gauge | RAM / shm | Derived from status bytes | API | no | |

| lastApply | card | Last apply | From status.lastApply (budget/reserve/shm/warnings) | API | no | |

| nba.shm | next-best-action | Shared memory looks low | When shm below planned shmMin | — | — | |
| nba.resources | next-best-action | Watch live resources | Continuous CPU/mem series (not capacity) | — | — | `/admin/diagnostics/resources` |

| preview | button | Review plan | Opens after parameters | visible | yes | valid parameters |



## Copy (strings)

“Host resources”; “Host status is unavailable”; “Last apply”; “Shared memory looks low”; “Plan applied previously”; “No apply yet”; “Watch live machine series”; “Open resources”.



## Inteligência UX nesta view

Status is a hero, not a sparse metric grid. Capacity changes always begin with GiB parameters and a preview; ulimits stay revealed. No fabricated host numbers. Continuous CPU/memory observability lives under Diagnostics → Resources — link there, do not embed series charts on this page.



## Path feliz (passos numerados)

1. Load status. 2. Enter parameters. 3. Review preview. 4. Apply.



## Reveals

The provisioning flow reveals review only after a successful preview.



## Estados (loading/empty/error/success/blocked)

Loading EmptyState, unavailable hostError callout, reported metrics, and applied confirmation are all visible.



## Dados / API

| ação UI | método | path | request | response usada |

| load | GET | `/api/admin/host-resources` | none | host, sidecar, lastApply, hostError |



## Components usados

`PageHeader`, `StatCard`, `ResourceGauge`, `StatusPill`, `EmptyState`, `SaveFeedback`, `HelperCallout`, `NextBestAction`, `StepWizard`.



## Navegação (vem de / sai para)

From Admin nav; stays in the provisioning flow; NBA exits to Diagnostics Resources for live watch.



## Aceite de build

- Current status renders without fabricated data; unavailable status is actionable.

- shm-below-floor surfaces an NBA without inventing API fields.



## Explicitamente fora

Automatic apply and unreviewed host mutation. TelemetryMonitor / resource series charts (Diagnostics Resources).


