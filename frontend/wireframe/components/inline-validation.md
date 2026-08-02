# inline-validation

## Papel
Field-level error / hint associated with a control.

## Quando usar / não usar
Use: forms before/after submit.  
Don’t: page-level API failures (save-feedback).

## Variantes / props
- `message`, `tone`: error | hint
- wired via `aria-describedby` to input id

## Estados
hidden / visible.

## Copy default
Page/API supplied.

## A11y
Associate with input; `aria-invalid` when error.

## Usado por
auth/*; setup wizard; scripts upload & injection steps.

## Aceite de build
- [ ] Screen reader announces with field
