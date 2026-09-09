#!/usr/bin/env bash
# Configure-only wrapper — mesmas flags de build.sh.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="${SPECULUM_WEBKIT_ROOT:-$HERE}"
CHECKOUT="$ROOT/checkout"
[ -d "$CHECKOUT/.git" ] || { echo "ABORT: checkout/ nao existe." >&2; exit 1; }

export CCACHE_DIR="${CCACHE_DIR:-$ROOT/.ccache}"
mkdir -p "$CCACHE_DIR"

cd "$CHECKOUT"

CMAKE_ARGS=(
  -DENABLE_WPE_PLATFORM=ON
  -DENABLE_WPE_PLATFORM_HEADLESS=ON
  -DENABLE_WPE_PLATFORM_WAYLAND=ON
  -DENABLE_WPE_LEGACY_API=OFF
  -DENABLE_WEBDRIVER=OFF
  -DENABLE_WEBDRIVER_BIDI=OFF
  -DENABLE_TOUCH_EVENTS=ON
  -DENABLE_ENCRYPTED_MEDIA=OFF
  -DUSE_LIBBACKTRACE=OFF
  -DCMAKE_CXX_FLAGS=-g0
  -DCMAKE_C_FLAGS=-g0
  -DCMAKE_EXE_LINKER_FLAGS=-fuse-ld=lld
  -DCMAKE_SHARED_LINKER_FLAGS=-fuse-ld=lld
)

BUILD_TYPE="${BUILD_TYPE:-Release}"
rm -rf WebKitBuild

perl Tools/Scripts/build-webkit --wpe "--$(printf '%s' "$BUILD_TYPE" | tr '[:upper:]' '[:lower:]')" \
  --generate-project-only \
  --cmakeargs="${CMAKE_ARGS[*]}"
