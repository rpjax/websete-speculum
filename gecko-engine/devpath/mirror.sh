#!/usr/bin/env bash
# Speculum devpath — espelha no repo TODO arquivo do Gecko que a gente modificou.
#
# O checkout do Gecko e' descartavel e fica fora do repo. O conjunto de patches
# no repo e' a fonte da verdade do fork: sem ele ninguem reproduz o build, e
# ninguem consegue revisar o que mudou sem estar naquela maquina.
#
#   ./mirror.sh            # espelha e regenera ALL.diff
#
# Variaveis: GECKO=<checkout>  (default ~/speculum-gecko/checkout)
set -euo pipefail

GECKO="${GECKO:-$HOME/speculum-gecko/checkout}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && git rev-parse --show-toplevel)"
PATCHES="$REPO/gecko-engine/patches"
BASE_FILE="$PATCHES/BASE.txt"

[ -d "$GECKO" ] || { echo "checkout do Gecko nao encontrado em $GECKO" >&2; exit 1; }
[ -f "$BASE_FILE" ] || { echo "falta $BASE_FILE com o commit upstream de referencia" >&2; exit 1; }
BASE="$(tr -d '[:space:]' < "$BASE_FILE")"

cd "$GECKO"
mapfile -t FILES < <(git diff --name-only "$BASE" HEAD; git diff --name-only)
# dedup preservando ordem
mapfile -t FILES < <(printf '%s\n' "${FILES[@]}" | awk 'NF && !seen[$0]++')

if [ ${#FILES[@]} -eq 0 ]; then
  echo "nada modificado em relacao a $BASE"
  exit 0
fi

for f in "${FILES[@]}"; do
  [ -f "$GECKO/$f" ] || continue          # arquivo apagado: some do espelho tambem
  mkdir -p "$PATCHES/$(dirname "$f")"
  cp -f "$GECKO/$f" "$PATCHES/$f"
  echo "  espelhado: $f"
done

git diff "$BASE" -- "${FILES[@]}" > "$PATCHES/ALL.diff"
echo "$BASE" > "$BASE_FILE"
echo "${#FILES[@]} arquivo(s) espelhado(s); ALL.diff regenerado"
