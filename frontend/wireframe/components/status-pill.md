# status-pill

## Papel
Compact semantic status (Ready, Live, Not ready, Missing, …).

## Quando usar / não usar
Use: Home, Setup, session rows, banners.  
Don’t: long sentences (use callout).

## Variantes / props
- `label: string`
- `tone`: success | warning | danger | neutral | info

## Estados
static.

## Copy default
Page supplies label (`Ready`, `Not ready`, `Open`, `Closed`).

## A11y
Text content sufficient; don’t rely on color alone (include label).

## Usado por
home; setup; sessions list/detail; shell banner.

## Aceite de build
- [ ] Tone + label always paired
