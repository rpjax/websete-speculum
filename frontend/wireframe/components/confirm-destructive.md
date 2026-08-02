# confirm-destructive

## Papel
Confirm irreversible actions with explicit consequence copy.

## Quando usar / não usar
Use: profile delete; script delete.  
Don’t: routine save/apply.

## Variantes / props
- `title`, `body`, `confirmLabel`, `cancelLabel`
- `onConfirm`, `onCancel`
- `defaultFocus: 'cancel'`

## Estados
idle / submitting.

## Copy default
- Cancel: `Cancel`
- Confirm: page supplies (`Delete permanently`)

## A11y
Focus Cancel first; `role=alertdialog`.

## Usado por
profiles/delete-confirm; scripts/library delete; scripts/remove-injection.

## Aceite de build
- [ ] Cancel is default focus
- [ ] Confirm disabled while submitting
