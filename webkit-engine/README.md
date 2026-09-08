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

`checkout/`, `build/` e `.ccache/` sao gitignored.
