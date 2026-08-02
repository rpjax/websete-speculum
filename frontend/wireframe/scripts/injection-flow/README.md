# Injection flow — module

Multi-step create/edit of one `Scripting.Injections[]` entry. Apply only on review (or via [`../remove-injection.md`](../remove-injection.md)).

## Routes

| Mode | Route | Query |
|------|-------|-------|
| New | `/admin/scripts/injections/new` | `?step=source\|placement\|targets\|review` |
| Edit | `/admin/scripts/injections/:index/edit` | same `?step=` |

Default step when missing: `source`. Invalid step → `source`.

## Draft state (client)

Hold one draft object until review PUT:

```ts
{
  source: { sourceType, storedScriptId?, remoteUrl? },
  position: ScriptInjectionPosition,
  executionType: ScriptExecutionType,
  targetRules: UrlMatchRule[]
}
```

- **New:** start with defaults — Stored (empty id), `headEnd`, `classic`, one Match-all rule.
- **Edit:** GET Scripting → clone `injections[index]` into draft; bad index → toast + injections tab.
- Back/Continue navigate `?step=` and **preserve draft** (memory / sessionStorage keyed by `new` or index).
- Refresh mid-flow: restore draft from sessionStorage if present; else restart source.

## Abandon

`step-wizard` Cancel (all steps):

1. If draft unchanged from entry snapshot → navigate `/admin/scripts?tab=injections` (no confirm).
2. If dirty → `confirm-destructive` title `Discard injection changes?` body `Your edits will be lost.` confirm `Discard` → clear draft → injections tab.

## Steps

1. [`01-source.md`](01-source.md)
2. [`02-placement.md`](02-placement.md)
3. [`03-targets.md`](03-targets.md)
4. [`04-review-apply.md`](04-review-apply.md)

## Explicitamente fora
Applying from steps 1–3; editing other Scripting fields; Lab.
