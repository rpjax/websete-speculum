# Build do port WPE

Tudo aqui foi lido da arvore real em `wpewebkit-2.52.6`, nao de memoria.

## Maquina de build

Medido em 2026-09-08 na WSL Ubuntu 24.04 do desktop (primeiro build a frio, tentativa instrumentada).

| ambiente | disco livre | RAM | swap | cores | cmake/ninja/ccache/lld | veredito |
|---|---|---|---|---|---|---|
| Host Windows (C:) | 282 GB | 32 GB fisica | — | — | — | disco OK |
| WSL antes (.wslconfig 8 GB) | 282 GB (/mnt/c) | 7 GB | 2 GB | 6 | git/cmake/ninja/ccache; lld ausente | RAM insuficiente |
| WSL depois (.wslconfig 22 GB + swap 32 GB) | 282 GB (/mnt/c) | 21 GB | 32 GB | 6 | cmake 3.28.3, ninja 1.11.1, ccache 4.9.1, lld 18.1.3, g++ 13.3.0 | **build verde em ext4** (`~/speculum-webkit`) |
| VM local (registro antigo) | ~9 GB | — | — | — | ausentes | nao serve |
| container de nuvem da sessao (registro antigo) | ~30 GB | 7 GB | — | 2 | presentes | nao serve (RAM/cores) |

`.wslconfig` do host (antes → depois):

    memory=8GB  →  memory=22GB   (70% de 32 GB)
    swap=(default 2GB)  →  swap=32GB
    processors=6 (inalterado)

WebKit precisa de maquina dedicada: muitos cores, RAM alta (link de `libWebKit` e' o pico),
disco em dezenas de GB por configuracao de build, e **ccache obrigatorio**.

`scripts/build.sh` aborta se `ccache` nao existir. Isso e' de proposito: sem ccache o ciclo de
feedback vira dezenas de minutos e o projeto morre pelo loop, nao pelo codigo. Esse e' o modo
de falha mais comum de projeto de fork.

### Primeiro build a frio (medido)

Paralelismo: `build-webkit` nao tem flag propria de jobs — repassa via `--makeargs="-jN"`.

Flags provisorias no `build.sh` (commit separado, ajuste de maquina WSL): `-g0`, `-fuse-ld=lld`.

#### Sessao [6] — antes de `ENABLE_WPE_LEGACY_API=OFF`

Comando: `BUILD_TYPE=Release JOBS=4 bash webkit-engine/scripts/build.sh`

| tentativa | resultado | fase | tempo wall | pico RSS (time) | pico RAM (free -g, 2 min) | swap usado |
|---|---|---|---|---|---|---|
| 1 | **falhou** | CMake configure — `find_package(WPE)` (`ENABLE_WPE_LEGACY_API` default ON) | 133 s | 104 MB | 0 GB used / 21 GB total | 0 GB |
| 2 | **falhou** | idem (cache CMake reutilizado) | 27 s | 46 MB | 0 GB used / 21 GB total | 0 GB |

Causa: `OptionsWPE.cmake:114` liga `ENABLE_WPE_LEGACY_API` ON; `:304-305` chama `find_package(WPE)`.
Nao e' falta de jhbuild — e' API legada ligada com WPEPlatform.

#### Sessao [7] — com `ENABLE_WPE_LEGACY_API=OFF`, so configure

Comando: `build-webkit --wpe --release --generate-project-only` (WebKitBuild/ apagado antes).

| tentativa | resultado | fase | tempo wall |
|---|---|---|---|
| 1 | **falhou** | CMake configure — `find_package(LibBacktrace)` (`USE_LIBBACKTRACE` default ON, `:463-467`) | **172 s** |

`FindWPE` **nao falhou**. Proximo bloqueio: `LibBacktrace` (`LIBBACKTRACE_INCLUDE_DIR`, `LIBBACKTRACE_LIBRARY`).

#### Sessao [8] — configure verde + build a frio (incompleto)

Configure (`scripts/configure.sh`): **486 s**, verde.

Build (`BUILD_TYPE=Release JOBS=6`, `scripts/build.sh` com `ninja -C` — contorna bug do
`build-webkit` com espacos no path do repo).

| tentativa | resultado | fase | tempo wall | progresso | notas |
|---|---|---|---|---|---|
| 1 | **falhou** | pos-configure — `cmake --build` do `build-webkit` quebra path com espaco | 493 s | 0% compile | corrigido no `build.sh`: `ninja -C` |
| 2 | **falhou** | compile — alvo `WebCoreBindings` (`generate-bindings-all.pl` / `CodeGenerator.pm`) | **8333 s** (~2h19m) | **3960/9998** (~40%) | erros: mixin supplemental deps; sessao WSL perdeu logs em `/tmp` |

Pos-falha: `WebKitBuild/` = **726 MB**; `ccache -s`: **1797 misses**, 0 hits, **0,1 GiB**.
Monitor `free -g` (2 min) reportou 0 GB used o tempo todo — arredondamento de `free -g`, nao confiar como pico.
MiniBrowser headless **nao rodou** (binario nao linkado).

#### Sessao [9] — ext4 nativa (`SPECULUM_WEBKIT_ROOT=~/speculum-webkit`)

**Nunca buildar em `/mnt/c`.** NTFS via ponte WSL + path com espaco no repo (`Websete Speculum`)
degradam clone e I/O de compile. Checkout/build/ccache vivem em ext4 via `SPECULUM_WEBKIT_ROOT`.

| metrica | `/mnt/c` (NTFS) | ext4 (`~/speculum-webkit`) |
|---|---|---|
| clone (`fork-init.sh`) | **5666 s** (~94 min) | **113 s** (~1,9 min) |
| configure | 486 s | (incluso no build) |
| build a frio (`JOBS=6`) | incompleto ~40%, morte por bateria | **8098 s** (~2h15m), **verde** |
| `WebKitBuild/` pos-build | 726 MB (parcial) | **1,5 GB** |
| pico RSS (`time`) | — | **7634668 KB** (~7,5 GB) |
| ccache hits no inicio | 0 | 0 (path mudou; `CCACHE_NOHASHDIR=1` nao bastou) |
| `WebCoreBindings` | erro pos-queda (provavel artefato) | **passou** |

Build em tmux, maquina na tomada. `CCACHE_NOHASHDIR=1` ao migrar cache.

MiniBrowser WPE headless (`bin/MiniBrowser --headless`): processo **sobe e fica vivo** 15 s;
WSL emite `DRM_IOCTL_MODE_CREATE_DUMB failed` / `Failed to create GBM buffer` (sem GPU/DRI util).
Sinal de vida parcial — render headless na WSL ainda precisa validacao.

## Dependencias

`Tools/wpe/install-dependencies` no checkout. Suporta `apt-get` (Debian/Ubuntu), `dnf` (Fedora)
e `pacman` (Arch). Fora dessas tres o script recusa.

Alternativa do upstream para deps isoladas: jhbuild (`Tools/wpe/jhbuild.modules`,
`jhbuild-minimal.modules`, `jhbuild-minimal-plus-gstreamer.modules`).

### Dependencias e classificacao

Regra: se a pagina JS consegue perceber a diferenca → **A** (instalar, nunca desligar).
Dev/diag/desktop → **B** (apt se existir; senao `-D…=OFF`).

| dependencia | cat. | acao tomada | motivo |
|---|---|---|---|
| `LibBacktrace` (`USE_LIBBACKTRACE`) | B | `-DUSE_LIBBACKTRACE=OFF` | dev/diag backtrace; pagina nao observa. `libbacktrace-dev` **ausente** no apt Ubuntu 24.04 |
| `xdg-dbus-proxy` (`ENABLE_BUBBLEWRAP_SANDBOX`) | B | `apt install xdg-dbus-proxy` | infra sandbox bubblewrap; pagina nao observa |
| `ENABLE_WPE_LEGACY_API` / `find_package(WPE)` | — | `-DENABLE_WPE_LEGACY_API=OFF` | decisao de arquitetura WPEPlatform (sessao [7]) |

## Entrada de build

    export SPECULUM_WEBKIT_ROOT=~/speculum-webkit   # ext4 — obrigatorio na WSL
    bash scripts/fork-init.sh
    scripts/configure.sh          # so configure (mesmas flags de build.sh)
    BUILD_TYPE=Release JOBS=6 CCACHE_NOHASHDIR=1 bash scripts/build.sh

Sem `SPECULUM_WEBKIT_ROOT`, checkout/build/ccache ficam em `webkit-engine/` (default).

## Flags do Speculum e por que

Lidas de `Source/cmake/OptionsWPE.cmake` na tag pinada.

| flag | default upstream | nosso | motivo |
|---|---|---|---|
| `ENABLE_WPE_PLATFORM` | `${ENABLE_DEVELOPER_MODE}` | **ON** | WPEPlatform e' a API de embedding moderna. Em build de release o default deixa ela **desligada** — tem que ligar explicito. Upstream tambem exige que ao menos uma de `ENABLE_WPE_PLATFORM` ou `ENABLE_WPE_LEGACY_API` esteja ligada. |
| `ENABLE_WPE_PLATFORM_HEADLESS` | ON | ON | Plataforma headless e' opcao de primeira classe. E' o modo de producao. |
| `ENABLE_WPE_PLATFORM_WAYLAND` | ON | ON | Util pra debug com janela. |
| `ENABLE_WPE_LEGACY_API` | **ON (PUBLIC)** | **OFF** | `:114` default ON; `:304-305` `find_package(WPE)` so com legada. Speculum usa WPEPlatform — desliga libwpe e Cog (`ENABLE_COG` depende dela, `:136`). |
| `ENABLE_WEBDRIVER` | **ON (PUBLIC)** | **OFF** | O upstream liga WebDriver por default no WPE. Somos o embedder, nao precisamos, e e' superficie de automacao — exatamente o sinal que o port existe pra nao emitir. |
| `ENABLE_WEBDRIVER_BIDI` | experimental (off) | OFF | idem, explicito. |
| `ENABLE_TOUCH_EVENTS` | ON | ON | E' o caminho de input do produto. |
| `ENABLE_ENCRYPTED_MEDIA` | experimental (off) | OFF | O Virtual nao decodifica midia: o sidecar proxia assets e quem da play e' o cliente projetado. DRM e codec sao irrelevantes aqui. |
| `USE_LIBBACKTRACE` | ON | **OFF** | B — dev/diag; pagina nao observa. Pacote apt ausente (ver tabela acima). |

Notas de flags que **nao** mexemos mas importam saber:

- `ENABLE_GPU_PROCESS` ON, e depende de `USE_GBM`, que depende de `USE_LIBDRM`.
- `ENABLE_BUBBLEWRAP_SANDBOX` ON no Linux. Relevante quando isso for pra container.
- `ENABLE_WPE_PLATFORM` **conflita** com `ENABLE_WPE_1_1_API`.
- `ENABLE_WK_WEB_EXTENSIONS` fica atras de experimental — e' a API de WebExtensions do WebKit,
  nao tem relacao com o que chamamos de "extensao" hoje (a MV3 do Chromium morre no port).

## Backend de view

**Decidido: WPEPlatform headless.** `ENABLE_WPE_PLATFORM=ON`, `ENABLE_WPE_PLATFORM_HEADLESS=ON`,
`ENABLE_WPE_LEGACY_API=OFF`.

O caminho legado (`Tools/wpe/backends/HeadlessViewBackend`, API libwpe/fdo) fica fora do build.
C1 (runtime WebKit) embute via WPEPlatform — viewport, DPR e ciclo de vida pela API moderna.
Wayland (`ENABLE_WPE_PLATFORM_WAYLAND=ON`) fica disponivel so pra debug com janela.

## Ordem

1. Provisionar maquina de build (bloqueia tudo). **WSL: ext4 via `SPECULUM_WEBKIT_ROOT`, nunca `/mnt/c`.**
2. `scripts/fork-init.sh`
3. `Tools/wpe/install-dependencies`
4. `scripts/build.sh` — primeiro build a frio, medir. Esse numero define a cadencia do projeto.
5. Rodar o MiniBrowser do WPE headless e navegar uma pagina. Esse e' o primeiro sinal de vida.

Nada de C1 antes do passo 5 passar.
