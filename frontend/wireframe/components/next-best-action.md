# next-best-action

## Papel
Card/CTA telling the operator the single most useful next action.

## Quando usar / não usar
Use: Home not-ready; Setup gate; empty states that have one clear fix.  
Don’t: multiple competing NBAs on one screen.

## Variantes / props
- `title`, `body`, `ctaLabel`, `href` | `onClick`
- `tone`: info | warning

## Estados
default / disabled.

## Copy default
Title/body supplied by page (see Home / Setup).

## A11y
Region labeled “Next step”; CTA is a link or button.

## Usado por
home/operator-home; setup/readiness-gate; optionally empty-states compose this.

## Aceite de build
- [ ] Only one NBA visible per viewport
- [ ] CTA navigates or acts as specified
