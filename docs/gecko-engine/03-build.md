# Build Gecko ESR 153 — medido

Pin: `FIREFOX_153_2_0esr_RELEASE` (`feec67e62a5148b41fd017ccbbc463e8a6f9e83d`).
Checkout/build: `~/speculum-gecko` (ext4). **Nunca** `/mnt/c`.

Maquina: WSL Ubuntu 24.04, 21 GB RAM, 6 cores, maquina na tomada.

---

## Mozconfig Speculum (`gecko-engine/mozconfig`)

```
ac_add_options --enable-optimize
ac_add_options --disable-debug
ac_add_options --enable-debug-symbols
ac_add_options --with-ccache=sccache
```

| flag | por que |
|---|---|
| `--enable-optimize` | build de produto, nao debug lento |
| `--disable-debug` | sem `-O0`; combina com optimize |
| `--enable-debug-symbols` | stack/symbolos uteis sem debug completo |
| `--with-ccache=sccache` | cache de compilacao (dir em `~/speculum-gecko/.ccache`) |

### Armadilha: artifact build

**NÃO usar `--enable-artifact-builds`.** E' o conselho padrao de "build rapido" do Gecko,
mas baixa C++ pre-compilado e so recompila frontend. Para o Speculum e **inutil** — vamos
mexer em C++. Habilitar artifact invalida qualquer medicao de iteracao incremental.

Nada observavel pela pagina foi desligado nesta rodada.

---

## Bootstrap (`./mach bootstrap`, Firefox for Desktop)

| metrica | valor |
|---|---|
| tempo | **169,77 s** |
| rc | 0 |
| `~/.mozbuild` | **2,7 GB** (clang 1,3 GB, toolchains 637 MB, …) |
| apt extra | `unzip`, `watchman`, `sccache` |

### Rust pin pos-bootstrap

Bootstrap instalou **rust 1.98.1** via rustup. Configure falhou:

```
ERROR: Don't know how to translate x86_64-pc-linux-gnu for rustc
```

**Correcao:** `rustup default 1.90.0`. `bootstrap.sh` agora aplica esse pin automaticamente.

---

## Build a frio (`./mach build`, JOBS=6)

| metrica | Gecko | WebKit (ref. lado A) |
|---|---|---|
| tempo wall | **6119,51 s** (~1h42m) | 8098 s (~2h15m) |
| pico RSS (`time`) | **19 637 384 KB** (~19,6 GB) | ~7,5 GB |
| diretorio build | **16 GB** (`obj-x86_64-pc-linux-gnu/`) | 1,5 GB (`WebKitBuild/`) |
| rc | 0 | 0 |

`sccache` pos-build: **2,6 GB** em `~/speculum-gecko/.ccache` (stats inline no log
mostraram 0 hits no primeiro build — esperado).

---

## Iteracao incremental (`dom/base/nsContentUtils.cpp`, `./mach build binaries`)

| run | Gecko | WebKit (ref.) |
|---|---|---|
| 1 | **14,15 s** | 93,01 s |
| 2 | **10,40 s** | 1,18 s |

Metodologia: comentario temporario, revert com `git checkout`, mesmo padrao do lado A.

---

## Sinal de vida (`./mach run --headless https://example.com/`)

| | |
|---|---|
| subiu | **sim** — `*** You are running in headless mode.` |
| navegou | URL passada ao binario; processo rodou ate timeout 60 s |
| erros | `RenderCompositorSWGL failed mapping default framebuffer, no dt`; ruido de console (SearchSERPTelemetry, BackupService, Nimbus) |
| rc script | 124 (timeout) |

Headless sobe; render SWGL na WSL sem GPU continua ruidosa (analogo ao GBM/DRM do WPE).

---

## Entrada

```bash
export SPECULUM_GECKO_ROOT=~/speculum-gecko
export SPECULUM_GECKO_ENGINE=/mnt/c/.../gecko-engine   # repo Speculum
bash gecko-engine/scripts/fork-init.sh
bash gecko-engine/scripts/bootstrap.sh
JOBS=6 bash gecko-engine/scripts/build.sh
```

Build longo em tmux: `gecko-engine/scripts/run-build-tmux.sh`.
