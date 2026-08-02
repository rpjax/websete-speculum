# empty-state

## Papel
Explain absence of data and route the operator to the right action (or reassure).

## Quando usar / não usar
Use: empty lists.  
Don’t: API errors (use callout + retry).

## Variantes / props
- `title`, `body`, `cta?: { label, href | onClick }`
- `tone`: neutral | reassure (sessions empty)

## Estados
static.

## Copy default
Page-supplied (see Sessions / Profiles / Scripts library).

## A11y
Heading + text; CTA focusable.

## Usado por
sessions/live-list; profiles/list; scripts/library; scripts/injections.

## Aceite de build
- [ ] CTA goes to documented target
- [ ] No alarm styling for “normal empty” (sessions)
