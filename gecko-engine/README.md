# gecko-engine

Fork Speculum do Firefox/Gecko (ESR). Código do Gecko **não** vive no git —
o **w7s** materializa, aplica `modifications/` e compila.

## Build (caminho novo)

```bash
cd gecko-engine
npm install
npx w7s gecko validate
npx w7s gecko status
npx w7s gecko make gecko-source    # árvore + mods
npx w7s gecko make gecko-binary    # mach build (longo)
npx w7s gecko make sidecar-package
```

| artefato | host |
|---|---|
| árvore | `.w7s/gecko/<version>/` |
| objdir | `.w7s/build/<version>/` |
| pacote | `out/<version>/linux-x64/` |

Para o redesign (`engines/gecko/`) no container:

```powershell
npx w7s gecko shell -- ls /gecko-source/dom/base/nsINode.h
. .\scripts\w7s-env.ps1   # imprime volume / SPECULUM_GECKO_ROOT
```

**Windows NTFS:** a árvore fica num *Docker named volume* (não no folder
`.w7s/gecko/…` do host). Edits de `modifications/` que precisam bind-mount
pedem o workspace em disco WSL. Ver design 0.2.0 § Windows NTFS.

Contrato da ferramenta: [`@rodrigopjax/w7s`](https://www.npmjs.com/package/@rodrigopjax/w7s) · design 0.2.0.
Pin do commit também em `UPSTREAM` (mesma SHA que `w7s.json`).

`out/` e `.w7s/` são gerados e estão no `.gitignore`.

## Legado (ainda no repo)

`patches/`, `scripts/fork-init.sh`, `mozconfig`, `gecko-dist/` — caminho antigo.
Não use `gecko-dist/` como SDK. Migração de patches → `modifications/` é trabalho
posterior; o manifesto hoje declara `modifications: []`.

Docs de sistema: `docs/gecko-engine/`. Redesign: `docs/gecko-engine/redesign/`.
**Nota:** `docs/gecko-engine/22-w7s.md` ainda descreve o modelo 0.1.0 (imagem
publicada); a ferramenta publicada é 0.2.0 (clone + verify no manifesto).
