# Review resource plan
## Job
Compare computed memory and limit targets before applying.
## Route / params / auth gate
- Route: `/admin/host-resources/preview`
- Params: step `review`
- Auth: Bearer access
## Entrada (pré-condições, deep-link)
Available only after a successful preview.
## Layout (ASCII regiões)
```
[Step 2 of 3]
[consequence HelperCallout]
[status pills: budget · reserve · shm · ulimits]
[StatCards: budget | reserve | shm target]
[Budget breakdown gauges]
[Back] [Apply resource plan]
```
## Inventory de controlos
| id | tipo | label | helper | default | required | validation |
| budgetBytes | gauge/stat | Memory budget | Computed plan | API | yes | preview |
| reserveBytes | gauge/stat | Host reserve | Computed plan | API | yes | preview |
| shmTargetBytes | gauge/stat | Shared memory target | Computed plan | API | yes | preview |
| ulimits | pill | Process limits | From plan | API | no | |
| apply | button | Apply resource plan | Mutates host capacity | disabled pending | yes | preview exists |
## Copy (strings)
“Review resource plan”; “Applying changes affects future sidecar capacity”; “Apply resource plan”; “Budget breakdown”.
## Inteligência UX nesta view
Visual breakdown of budget → reserve → shm; consequence warning before mutation; no parameter editing on this step.
## Path feliz (passos numerados)
1. Read plan. 2. Go back to revise or apply. 3. Receive applied proof.
## Estados (loading/empty/error/success/blocked)
No plan returns to Parameters; apply pending prevents duplicate mutation; errors remain visible.
## Dados / API
| ação UI | método | path | request | response usada |
| preview result | POST | `/api/admin/host-resources/preview` | params | budget, reserve, shm target |
## Components usados
`StatCard`, `ResourceGauge`, `StatusPill`, `HelperCallout`, `StepWizard`, Button.
## Aceite de build
- Apply cannot occur without a successful preview.
## Explicitamente fora
Editing parameters in the review step.
