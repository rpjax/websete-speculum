# helper-callout

## Papel
Non-blocking explanation or warning beside the primary path.

## Quando usar / não usar
Use: seed password note; live profile delete block; remote URL SSRF hint.  
Don’t: replace field validation errors; don’t hard-block without CTA.

## Variantes / props
- `tone`: info | warning | danger
- `title?`, `children`, `action?: { label, href }`

## Estados
static.

## Copy default
Page-supplied.

## A11y
`role=note` or `status`; danger uses `role=alert` if blocking intent.

## Usado por
auth/login; auth/change-password; profiles/detail; scripts/injection-flow/01-source; setup/*.

## Aceite de build
- [ ] Does not steal focus
- [ ] Optional action link works
