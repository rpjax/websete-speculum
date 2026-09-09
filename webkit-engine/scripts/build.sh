#!/usr/bin/env bash
# Build do port WPE a partir do checkout materializado por fork-init.sh.
# Exige maquina de build de verdade. Ver docs/webkit-engine/02-build.md.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="${SPECULUM_WEBKIT_ROOT:-$HERE}"
# shellcheck disable=SC1091
source "$HERE/UPSTREAM"

CHECKOUT="$ROOT/checkout"
BUILD_ROOT="$ROOT/build"
[ -d "$CHECKOUT/.git" ] || { echo "ABORT: checkout/ nao existe. Rodar scripts/fork-init.sh." >&2; exit 1; }

BUILD_TYPE="${BUILD_TYPE:-Release}"
JOBS="${JOBS:-$(nproc)}"

export CCACHE_DIR="${CCACHE_DIR:-$ROOT/.ccache}"
export CCACHE_MAXSIZE="${CCACHE_MAXSIZE:-50G}"
mkdir -p "$BUILD_ROOT" "$CCACHE_DIR"
command -v ccache >/dev/null || { echo "ABORT: ccache ausente. Sem ccache o ciclo de build inviabiliza o projeto." >&2; exit 1; }

cd "$CHECKOUT"

# Flags do Speculum. Justificativa de cada uma em docs/webkit-engine/02-build.md.
CMAKE_ARGS=(
  # WPEPlatform e' a API de embedding moderna. Default do upstream e' ENABLE_DEVELOPER_MODE,
  # entao em build de release tem que ser ligada explicitamente.
  -DENABLE_WPE_PLATFORM=ON
  -DENABLE_WPE_PLATFORM_HEADLESS=ON
  -DENABLE_WPE_PLATFORM_WAYLAND=ON

  # API legada (libwpe). OptionsWPE.cmake:114 default ON; :304-305 find_package(WPE) so
  # com ENABLE_WPE_LEGACY_API. Speculum usa WPEPlatform — desligamos a legada.
  -DENABLE_WPE_LEGACY_API=OFF

  # Superficie de automacao: o upstream liga WebDriver por default no WPE. Nos somos o
  # embedder, nao precisamos dele, e ele e' exatamente o tipo de sinal que queremos ausente.
  -DENABLE_WEBDRIVER=OFF
  -DENABLE_WEBDRIVER_BIDI=OFF

  # Touch e' o caminho de input do produto.
  -DENABLE_TOUCH_EVENTS=ON

  # O Virtual nao decodifica midia: o sidecar proxia assets e quem da play e' o cliente.
  -DENABLE_ENCRYPTED_MEDIA=OFF

  # Dev/diag — pagina nao observa backtraces nativos (categoria B).
  -DUSE_LIBBACKTRACE=OFF

  # PROVISORIO — ajuste de maquina de build (feat/webkit-engine, build a frio WSL).
  # Reduz debug info e usa lld para aliviar pico de memoria no link.
  -DCMAKE_CXX_FLAGS=-g0
  -DCMAKE_C_FLAGS=-g0
  -DCMAKE_EXE_LINKER_FLAGS=-fuse-ld=lld
  -DCMAKE_SHARED_LINKER_FLAGS=-fuse-ld=lld
)

echo ">> build $BUILD_TYPE, $JOBS jobs, ccache em $CCACHE_DIR"
ccache -s | head -5 || true

BUILD_DIR="$CHECKOUT/WebKitBuild/WPE/$(printf '%s' "$BUILD_TYPE" | sed 's/./\U&/')"
PORT_ARGS=(--wpe "--$(printf '%s' "$BUILD_TYPE" | tr '[:upper:]' '[:lower:]')")

if [ ! -f "$BUILD_DIR/build.ninja" ]; then
  perl Tools/Scripts/build-webkit "${PORT_ARGS[@]}" \
    --generate-project-only \
    --cmakeargs="${CMAKE_ARGS[*]}"
fi

# build-webkit repassa caminho com espacos sem quote — quebra cmake --build no WSL.
ninja -C "$BUILD_DIR" -j"$JOBS"

echo
echo ">> ccache depois:"
ccache -s | head -5 || true
