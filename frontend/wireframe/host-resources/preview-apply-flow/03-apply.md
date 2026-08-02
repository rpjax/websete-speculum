# Apply resource plan
## Job
Apply the reviewed host-resource plan and report its result.
## Route / params / auth gate
- Route: `/admin/host-resources/apply`
- Params: step `applied`
- Auth: Bearer access
## Entrada (pré-condições, deep-link)
Entered only from a reviewed plan (apply success).
## Layout (ASCII regiões)
```
[Step 3 of 3]
[Applied HelperCallout — timestamp + shm]
[result pills]
[warnings if any]
[NBA → Resource Management]
[NBA → admit sessions carefully / back to parameters]
```
## Inventory de controlos
| id | tipo | label | helper | default | required | validation |
| result | callout | Applied | Timestamp and shared memory proof | API | yes | response |
| warnings | list | Apply warnings | From apply result | API | no | |
| nba.rm | next-best-action | Tune admission next | Link to Resource Management | — | — | |
| nba.admit | next-best-action | Admit sessions carefully | Caution + back to status | — | — | |
## Copy (strings)
“Applying…”; “Resource plan applied”; “Review the status above before admitting additional sessions.”; “Tune admission next”; “Open Resource Management”.
## Inteligência UX nesta view
Explicit result avoids a success-only toast; status refreshes above; NBA points to admission config without inventing host fields.
## Path feliz (passos numerados)
1. POST apply. 2. Show timestamp and applied shared memory. 3. Refresh status. 4. Offer next actions.
## Dados / API
| ação UI | método | path | request | response usada |
| apply | POST | `/api/admin/host-resources/apply` | `HostResourceProvisionParams` | plan, shmAppliedBytes, warnings, appliedAtUtc |
## Components usados
`HelperCallout`, `NextBestAction`, `StatusPill`, `StepWizard`, `SaveFeedback`.
## Aceite de build
- Apply result is visible and status reloads.
- Success is not claimed from HTTP alone without returned result fields.
## Explicitamente fora
Claiming host truth from HTTP success alone without showing returned result.
