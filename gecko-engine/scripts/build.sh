#!/usr/bin/env bash
# Build Firefox/Gecko a partir do checkout materializado por fork-init.sh.
# Ver docs/gecko-engine/03-build.md.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="${SPECULUM_GECKO_ROOT:-$HERE}"
# shellcheck disable=SC1091
source "$HERE/UPSTREAM"

CHECKOUT="$ROOT/checkout"
[ -d "$CHECKOUT/.git" ] || { echo "ABORT: checkout/ nao existe. Rodar scripts/fork-init.sh." >&2; exit 1; }

export MOZCONFIG="${MOZCONFIG:-$HERE/mozconfig}"
[ -f "$MOZCONFIG" ] || { echo "ABORT: mozconfig ausente em $MOZCONFIG" >&2; exit 1; }

export SCCACHE_DIR="${SCCACHE_DIR:-$ROOT/.ccache}"
mkdir -p "$SCCACHE_DIR"
command -v sccache >/dev/null || { echo "ABORT: sccache ausente. Instalar antes do build." >&2; exit 1; }

cd "$CHECKOUT"

MODE="${1:-build}"
case "$MODE" in
  build)
    echo ">> mach build, MOZCONFIG=$MOZCONFIG, SCCACHE_DIR=$SCCACHE_DIR"
    sccache -s 2>/dev/null | head -8 || true
    ./mach build
    echo ">> sccache depois:"
    sccache -s 2>/dev/null | head -12 || true
    ;;
  binaries)
    echo ">> mach build binaries, MOZCONFIG=$MOZCONFIG"
    ./mach build binaries
    ;;
  *)
    echo "Uso: $0 [build|binaries]" >&2
    exit 1
    ;;
esac
