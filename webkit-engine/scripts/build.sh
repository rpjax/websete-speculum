#!/usr/bin/env bash
# Build do port WPE a partir do checkout materializado por fork-init.sh.
# Exige maquina de build de verdade. Ver docs/webkit-engine/02-build.md.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$HERE/UPSTREAM"

CHECKOUT="$HERE/checkout"
[ -d "$CHECKOUT/.git" ] || { echo "ABORT: checkout/ nao existe. Rodar scripts/fork-init.sh." >&2; exit 1; }

BUILD_TYPE="${BUILD_TYPE:-Release}"
JOBS="${JOBS:-$(nproc)}"

export CCACHE_DIR="${CCACHE_DIR:-$HERE/.ccache}"
export CCACHE_MAXSIZE="${CCACHE_MAXSIZE:-50G}"
command -v ccache >/dev/null || { echo "ABORT: ccache ausente. Sem ccache o ciclo de build inviabiliza o projeto." >&2; exit 1; }

cd "$CHECKOUT"

# Flags do Speculum. Justificativa de cada uma em docs/webkit-engine/02-build.md.
CMAKE_ARGS=(
  # WPEPlatform e' a API de embedding moderna. Default do upstream e' ENABLE_DEVELOPER_MODE,
  # entao em build de release tem que ser ligada explicitamente.
  -DENABLE_WPE_PLATFORM=ON
  -DENABLE_WPE_PLATFORM_HEADLESS=ON
  -DENABLE_WPE_PLATFORM_WAYLAND=ON

  # Superficie de automacao: o upstream liga WebDriver por default no WPE. Nos somos o
  # embedder, nao precisamos dele, e ele e' exatamente o tipo de sinal que queremos ausente.
  -DENABLE_WEBDRIVER=OFF
  -DENABLE_WEBDRIVER_BIDI=OFF

  # Touch e' o caminho de input do produto.
  -DENABLE_TOUCH_EVENTS=ON

  # O Virtual nao decodifica midia: o sidecar proxia assets e quem da play e' o cliente.
  -DENABLE_ENCRYPTED_MEDIA=OFF
)

echo ">> build $BUILD_TYPE, $JOBS jobs, ccache em $CCACHE_DIR"
ccache -s | head -5 || true

Tools/Scripts/build-webkit --wpe "--$(printf '%s' "$BUILD_TYPE" | tr '[:upper:]' '[:lower:]')" \
  --makeargs="-j$JOBS" \
  --cmakeargs="${CMAKE_ARGS[*]}"

echo
echo ">> ccache depois:"
ccache -s | head -5 || true
