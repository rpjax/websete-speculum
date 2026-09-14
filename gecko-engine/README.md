# gecko-engine

Fork do Firefox/Gecko (ESR) — lado **B** da avaliacao Speculum.

O codigo do Gecko **nao** vive neste repo. Este diretorio guarda apenas:

- `UPSTREAM` — o pin (tag + commit ESR). Unica fonte de verdade da base do fork.
- `mozconfig` — flags de build Speculum (sem artifact builds).
- `scripts/fork-init.sh` — materializa `checkout/` na tag pinada e cria o branch do fork.
- `scripts/build.sh` — wrapper `./mach build` / `./mach build binaries`.
- `patches/` — patches Speculum no fork (observer, runtime, ABI). O produtor
  é C++ nativo; não se porta `packages/page-projection/virtual`.

Docs: `docs/gecko-engine/`. Constituicao da projecao completa (leis + planos +
o que falta): [`docs/gecko-engine/20-projecao-completa.md`](../docs/gecko-engine/20-projecao-completa.md).

Gate sem Gecko: `gecko-engine/tests/run.sh` (sem `--stack`). L0–L3-PP + L5.
Isto **nao** e o V1 prod-ready — falta Firefox real, widget, proxy e aceite visual.

## Uso

    ./scripts/fork-init.sh     # clona o upstream na tag pinada
    ./scripts/bootstrap.sh     # mach bootstrap (Firefox for Desktop, sem artifact)
    ./scripts/build.sh         # build a frio

Por default, `checkout/`, `build/` e `.ccache/` ficam em `gecko-engine/` (gitignored).
Para ext4 nativa da WSL (**obrigatorio** — nunca `/mnt/c`):

    export SPECULUM_GECKO_ROOT=~/speculum-gecko
    bash scripts/fork-init.sh
    bash scripts/bootstrap.sh
    JOBS=6 bash scripts/build.sh

`SPECULUM_GECKO_ROOT` e override de ambiente; o default mantem o comportamento atual.
