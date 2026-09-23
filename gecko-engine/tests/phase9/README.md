# Phase 9 — lab notes

## Verde = um comando

```bash
export SPECULUM_MONOREPO_ROOT=/path/to/Websete\ Speculum   # packages/page-projection
npm run ci:all
```

`ci:all` = exige `SPECULUM_MONOREPO_ROOT` → registro gtest estático → layer → observer →
digest → lab-schema-ingest → `w7s gecko shell -- ./mach gtest` Phase 7/8/9 com
conjunto de casos == expect → digest de novo com dump da suíte.

## Aceite mecânico

| Gate | Onde |
|------|------|
| sim × gecko (+ oráculo nos dois) | `SpeculumPhase9.SimGeckoWireParity` |
| Digest C++×TS | `assert-digest-parity.sh` (`SPECULUM_MONOREPO_ROOT`) |
| Codec gen no produto | `lab-schema-ingest.mjs` (`SPECULUM_MONOREPO_ROOT` ou `--monorepo-root=`) |
| `d(PTR)==d(PN)` | `ProjectionClient.create({ assertDescriptors: true })` |
| Lista gtest única | `assert-gtest-registration.sh` (antes do build) |

## Monorepo root

Não há `../` implícito. Workspace WSL que só tem `gecko-engine/` **não** contém
`packages/` — declare a raiz do checkout completo (ex. mount `/mnt/c/.../Websete Speculum`).
Copiar `gen.ts` entre árvores para passar o gate é proibido.

## Exclusões

`exclusions.txt`: `path.spec` + TAB + motivo. Malformado = fail contabilizado.
`excluded > 0` exige `SPECULUM_PHASE9_ALLOW_EXCLUSIONS=1`. `compared == 0` = fail.

## Página real 1:1

1. Sessão Speculum com PageProjection.
2. `ProjectionClient.create({ …, assertDescriptors: true })`.
3. Navegar URL real; após armado, `verifyDescriptors()` deve passar.
4. Fixture verde **não** substitui este lab.
