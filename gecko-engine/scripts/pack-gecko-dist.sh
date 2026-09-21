#!/usr/bin/env bash
# Empacota o dist/bin do Firefox já compilado em gecko-engine/gecko-dist/firefox-dist.tar.gz.
# A imagem Docker só COPY o tar — não roda mach. Tar (não árvore) porque o Docker
# no Windows recusa nomes/symlink do dist/bin (ex. BadCertAndPinningServer).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$HERE/gecko-dist"
mkdir -p "$DEST"

pick_src() {
  if [ -n "${SPECULUM_BROWSER_BIN:-}" ] && [ -x "$SPECULUM_BROWSER_BIN" ]; then
    cd "$(dirname "$SPECULUM_BROWSER_BIN")" && pwd
    return
  fi

  local root="${SPECULUM_GECKO_ROOT:-$HOME/speculum-gecko}"
  local cand
  for cand in \
    "$root/checkout/obj-x86_64-pc-linux-gnu/dist/bin" \
    /root/speculum-gecko/checkout/obj-x86_64-pc-linux-gnu/dist/bin
  do
    if [ -x "$cand/firefox" ]; then
      echo "$cand"
      return
    fi
  done

  shopt -s nullglob
  for cand in "$root"/checkout/obj-*/dist/bin; do
    if [ -x "$cand/firefox" ]; then
      echo "$cand"
      return
    fi
  done
}

SRC="$(pick_src || true)"
if [ -z "${SRC:-}" ] || [ ! -x "$SRC/firefox" ]; then
  echo "ABORT: dist do Firefox não encontrado. Defina SPECULUM_BROWSER_BIN ou SPECULUM_GECKO_ROOT." >&2
  exit 1
fi

TAR="$DEST/firefox-dist.tar.gz"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

echo ">> pack $SRC → $TAR"
# dist/bin do mach é cheio de symlink relativo pro objdir. Sem -L o tar
# chega na imagem com application.ini quebrado e o Firefox cai: XPCOM.
rsync -a --copy-links \
  --exclude 'Test*' \
  --exclude '*Server' \
  --exclude '*.so-gdb.py' \
  --exclude '.lldbinit' \
  --exclude '.mkdir.done' \
  --exclude '.parentlock' \
  --exclude 'lock' \
  "$SRC"/ "$STAGE"/ || {
  rc=$?
  # 23: dangling symlink no objdir (não é abort se application.ini veio real)
  if [ "$rc" -ne 23 ]; then
    exit "$rc"
  fi
}
if [ ! -f "$STAGE/application.ini" ] || [ -L "$STAGE/application.ini" ]; then
  echo "ABORT: application.ini não veio como arquivo real (ainda é symlink?)." >&2
  exit 1
fi
tar -C "$STAGE" -czf "$TAR" .
test -s "$TAR"
echo ">> ok $(du -sh "$TAR" | awk '{print $1}') application.ini=$(wc -c < "$STAGE/application.ini")B"
echo ">> dockup COPY gecko-engine/gecko-dist/firefox-dist.tar.gz — sem mach"
