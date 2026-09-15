#!/usr/bin/env bash
# Speculum — a escada de testes (doc 19).
#
# Sem argumento: L0, L1 (C++ e C#), L2, L3, L5 — segundos, SEM Gecko. É o que se
# roda antes de todo commit.
#   --stack: acrescenta o L4, que exige o Gecko já construído.
#
# Cada degrau imprime o próprio veredito e sai 0/1. O primeiro que falhar aborta
# a escada (set -e): a investigação começa sempre no degrau mais baixo que falhou.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GECKO="$(cd "$HERE/.." && pwd)"
OUT="${SPECULUM_OUT:-/tmp/speculum-tests}"
CONFIG="${SPECULUM_CONFIG:-Release}"
mkdir -p "$OUT"

WIRE="$GECKO/speculum-wire"
SUPERVISOR_PROJ="$GECKO/supervisor/src/Speculum.Supervisor"
TESTS_PROJ="$HERE/Speculum.Tests"
ABI_SRC="$GECKO/patches/dom/ipc"
GOLDEN="$HERE/control-abi.golden"

SUPERVISOR_DLL="$SUPERVISOR_PROJ/bin/$CONFIG/net9.0/speculum-supervisor.dll"
TESTS_DLL="$TESTS_PROJ/bin/$CONFIG/net9.0/speculum-tests.dll"

banner() { printf '\n\033[1m==== %s ====\033[0m\n' "$1"; }

# dotnet costuma existir mas fora do PATH de um shell não-interativo. Procura no
# PATH, depois num shell de login (que carrega .bashrc/.profile), depois nos
# lugares comuns. SPECULUM_DOTNET força um caminho.
find_dotnet() {
  # Instalações Linux conhecidas primeiro — sabemos que existem e evitam pegar o
  # dotnet.exe do Windows exposto pelo interop do WSL (que não tem libhostfxr.so).
  local c
  for c in "$HOME/.dotnet/dotnet" /root/.dotnet/dotnet /usr/share/dotnet/dotnet \
           /usr/lib/dotnet/dotnet /usr/local/bin/dotnet /snap/bin/dotnet; do
    if [ -x "$c" ]; then echo "$c"; return; fi
  done
  # PATH e shell de login por último, rejeitando .exe e qualquer coisa em /mnt/.
  local p
  for p in "$(command -v dotnet 2>/dev/null || true)" "$(bash -lc 'command -v dotnet' 2>/dev/null || true)"; do
    case "$p" in
      ""|*/mnt/*|*.exe) ;;
      *) if [ -x "$p" ]; then echo "$p"; return; fi ;;
    esac
  done
}
DOTNET="${SPECULUM_DOTNET:-$(find_dotnet)}"
if [ -z "$DOTNET" ]; then
  echo "dotnet não encontrado. Defina SPECULUM_DOTNET com o caminho do executável"
  echo "(ex.: export SPECULUM_DOTNET=\$HOME/.dotnet/dotnet) e rode de novo."
  exit 127
fi

# O dotnet pode estar num diretório privado (ex.: /root/.dotnet), sem instalação
# de sistema. Rodamos tudo pelo muxer (dotnet X.dll), que resolve o runtime a
# partir do próprio lugar; DOTNET_ROOT vai junto por garantia, para qualquer
# processo filho que ainda toque num apphost.
export DOTNET_ROOT="$(dirname "$DOTNET")"
export DOTNET_ROOT_X64="$DOTNET_ROOT"
export PATH="$DOTNET_ROOT:$PATH"
echo "dotnet: $DOTNET"
echo "DOTNET_ROOT: $DOTNET_ROOT"

# Firefox construído do fork (só usado no --stack). SPECULUM_STACK_BROWSER_BIN
# força; senão procura por <objdir>/dist/bin/firefox sob os lugares prováveis,
# evitando /mnt/ (Windows, lento).
find_firefox() {
  if [ -n "${SPECULUM_STACK_BROWSER_BIN:-}" ] && [ -x "$SPECULUM_STACK_BROWSER_BIN" ]; then
    echo "$SPECULUM_STACK_BROWSER_BIN"; return
  fi
  local d f
  # Candidatos prováveis primeiro (raso e rápido): checkouts comuns de Gecko.
  for d in "$HOME"/mozilla-unified "$HOME"/mozilla-central "$HOME"/firefox \
           "$HOME"/gecko "$HOME"/gecko-dev "$HOME"/src/mozilla-unified \
           "$HOME"/src/firefox "$HOME"/dev/mozilla-unified; do
    [ -d "$d" ] || continue
    f="$(find "$d" -maxdepth 4 -type f -name firefox -path '*/dist/bin/firefox' 2>/dev/null | head -1)"
    if [ -n "$f" ] && [ -x "$f" ]; then echo "$f"; return; fi
  done
  # Varredura de último recurso, LIMITADA POR TEMPO — nunca trava o script.
  f="$(timeout 20 find "$HOME" -maxdepth 6 -type f -name firefox -path '*/dist/bin/firefox' 2>/dev/null | head -1)"
  if [ -n "$f" ] && [ -x "$f" ]; then echo "$f"; return; fi
}

# ---- L0 + L5: núcleo e regressão viva (C++ ↔ TypeScript, capturas congeladas) ----
banner "L0 + L5 — núcleo e regressão viva (speculum-wire)"
WIRE_OUT="/tmp/speculum-wire"
SPECULUM_OUT="$WIRE_OUT" "$WIRE/run-tests.sh"

if [ -f "$HERE/projected-sw/assetSw.test.ts" ]; then
  banner "K5 — SW projected (unit)"
  npx --yes tsx "$HERE/projected-sw/assetSw.test.ts"
fi

# ---- L1 (C++): o codec REAL compilado fora do Gecko contra os vetores de ouro ----
banner "L1 (C++) — ABI de controle standalone"
"${CXX:-g++}" -std=c++17 -O2 -Wall -Wextra -Werror -fno-exceptions -fno-rtti \
  -I"$HERE/abi/shim" -I"$ABI_SRC" \
  "$HERE/abi/l1_abi_verify.cpp" "$ABI_SRC/SpeculumControlAbi.cpp" \
  -o "$OUT/l1_abi_verify"
"$OUT/l1_abi_verify" "$GOLDEN"

banner "L1 (TS) — encoder Input deste fio"
npx --yes tsx "$HERE/abi/encode-input.test.ts"

# ---- Build do lado C# (uma vez; puxa o supervisor junto) ----
banner "Build C# ($CONFIG)"
"$DOTNET" build "$TESTS_PROJ" -c "$CONFIG" --nologo -v quiet

# ---- L1 (C#) + L2 + L3: contrato, transporte e amarração ----
# Tudo pelo muxer (dotnet X.dll): ele resolve o runtime a partir do próprio
# lugar, sem depender de apphost nem de instalação em local de sistema.
export SPECULUM_PP_FRAMES_DIR="$OUT/l3-pp"
rm -rf "$SPECULUM_PP_FRAMES_DIR"
mkdir -p "$SPECULUM_PP_FRAMES_DIR"
export SPECULUM_PRODUCER_CLI="${SPECULUM_PRODUCER_CLI:-$WIRE_OUT/producer_cli}"

banner "L1 (C#) + L2 + L3 — contrato, transporte, amarração"
SPECULUM_DOTNET="$DOTNET" \
SPECULUM_TESTS_DLL="$TESTS_DLL" \
SPECULUM_SUPERVISOR_DLL="$SUPERVISOR_DLL" \
SPECULUM_PRODUCER_CLI="$SPECULUM_PRODUCER_CLI" \
SPECULUM_PP_FRAMES_DIR="$SPECULUM_PP_FRAMES_DIR" \
  "$DOTNET" "$TESTS_DLL" all

if [ ! -f "$SPECULUM_PP_FRAMES_DIR/frames.txt" ]; then
  echo "L3-PP: frames.txt ausente — ExtraLayerTests não gravou frames do Producer"
  exit 1
fi
banner "L3-PP — apply core (tsx, mesmo helper do L0)"
(cd "$WIRE/test" && SPECULUM_OUT="$SPECULUM_PP_FRAMES_DIR" npx --yes tsx producer_loop.ts)

# ---- L4: pilha real, só sob demanda ----
if [[ "${1:-}" == "--stack" ]]; then
  banner "L4 — pilha real (Gecko construído)"
  FIREFOX="$(find_firefox)"
  if [ -z "$FIREFOX" ]; then
    echo "firefox do build não encontrado. Rode:"
    echo "  SPECULUM_STACK_BROWSER_BIN=<objdir>/dist/bin/firefox bash gecko-engine/tests/run.sh --stack"
    exit 2
  fi
  echo "firefox: $FIREFOX"
  SPECULUM_DOTNET="$DOTNET" \
  SPECULUM_TESTS_DLL="$TESTS_DLL" \
  SPECULUM_SUPERVISOR_DLL="$SUPERVISOR_DLL" \
  SPECULUM_STACK_BROWSER_BIN="$FIREFOX" \
    "$DOTNET" "$TESTS_DLL" l4
fi

banner "ESCADA COMPLETA"
echo "todos os degraus rodados passaram."
