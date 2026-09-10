#!/usr/bin/env bash
# Bootstrap de dependencias via mach (Firefox for Desktop, SEM artifact mode).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="${SPECULUM_GECKO_ROOT:-$HERE}"
CHECKOUT="$ROOT/checkout"
[ -x "$CHECKOUT/mach" ] || { echo "ABORT: checkout/ sem mach. Rodar fork-init.sh." >&2; exit 1; }

export DEBIAN_FRONTEND=noninteractive
cd "$CHECKOUT"
./mach --no-interactive bootstrap --application-choice browser

command -v sccache >/dev/null || {
  echo ">> instalando sccache (mozconfig usa --with-ccache=sccache)"
  apt-get update -qq && apt-get install -y sccache
}

# mach bootstrap instala rust stable (1.98+ em 2026-09); configure ESR 153 falha no
# triplet x86_64-pc-linux-gnu com 1.98. Pin 1.90 ate upstream absorver.
if command -v rustup >/dev/null; then
  rustup install 1.90.0
  rustup default 1.90.0
fi

echo "OK bootstrap."
