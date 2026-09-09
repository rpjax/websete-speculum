# webkit-engine

Fork do WebKit (port WPE) que hospeda o produtor nativo do Speculum.

O codigo do WebKit **nao** vive neste repo. Este diretorio guarda apenas:

- `UPSTREAM` — o pin (tag + commit). Unica fonte de verdade da base do fork.
- `scripts/fork-init.sh` — materializa `checkout/` na tag pinada e cria o branch do fork.
- `scripts/build.sh` — build do port WPE.
- `patches/` — patches do Speculum, quando existirem (ainda nao existe).

Docs: `docs/webkit-engine/`.

## Uso

    ./scripts/fork-init.sh     # clona o upstream na tag pinada
    ./scripts/build.sh         # build (exige maquina de build, ver docs/webkit-engine/02-build.md)

Por default, `checkout/`, `build/` e `.ccache/` ficam em `webkit-engine/` (gitignored).
Para mover para ext4 nativa da WSL (recomendado — ver `docs/webkit-engine/02-build.md`):

    export SPECULUM_WEBKIT_ROOT=~/speculum-webkit
    bash scripts/fork-init.sh
    BUILD_TYPE=Release JOBS=6 bash scripts/build.sh

`SPECULUM_WEBKIT_ROOT` e override de ambiente; o default mantem o comportamento atual.

`checkout/`, `build/` e `.ccache/` sao gitignored (no default, dentro de `webkit-engine/`).
