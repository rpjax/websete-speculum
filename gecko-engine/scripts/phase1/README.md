# Fase 1 — Fundação e fio (docs/gecko-engine/redesign/IMPLEMENTACAO.md)

Árvore nova sob `gecko-engine/` (lado a lado com o antigo; tratado como inexistente):

- `domain/` `ports/` `engines/` `host/`
- `tools/wiregen/` — TOML → C++/TS/C#
- `wire-clients/` — codecs gerados TS/C#
- `scripts/phase1/run.ps1` — gate de aceite

```
powershell -File gecko-engine/scripts/phase1/run.ps1
```

Requer: Python 3.10+ (tomli), Node (npx tsx), .NET 9, MSVC 2022.
