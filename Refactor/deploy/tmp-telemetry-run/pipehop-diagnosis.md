# pipehop — stall Broadcast×Diff **FIXED**

Session: `7a768641-10d2-44be-bd68-6bce8aac1063`  
Site: `www.belezanaweb.com.br` (Projected Live)  
Stack: dockup `dev` + nouinput (2026-08-10 pós mux sparse)

| Check | Result |
|-------|--------|
| Surface | htmlLen ~2.1M; screenshot usable (hero + nav + cookies) |
| `OutputStreamOpened` | notification, **pageProjectionDiff@256**, console, notification — Diff Wait **só** no Diff |
| FE / seq | **×1** (`hist {1: 7721}`), kind=`pageProjectionDiff` only, `targetCount=1` |
| FR=FE=SD=WD | 7721 cada; QD=0 |
| QD notification-por-Diff | **ausente** |

`stallFixed=true` — ver `pipehop-diagnosis.json`.
