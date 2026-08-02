# save-feedback

## Papel
Show apply/save outcome: success toast or field-path / message errors.

## Quando usar / não usar
Use: after PUT config, upload, delete.  
Don’t: replace inline validation while typing.

## Variantes / props
- `mode`: toast-success | inline-error | banner-error
- `message`, `fieldErrors?: { path, message }[]`

## Estados
success / error / hidden.

## Copy default
- Success: `Saved` (override per page)
- Error: API `error` string

## A11y
Success = status; error = alert.

## Usado por
setup wizard; scripts review apply; change-password; host-resources (later).

## Aceite de build
- [ ] Success uses toast host
- [ ] Field errors associate to controls when paths map
