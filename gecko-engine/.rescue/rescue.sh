#!/usr/bin/env bash
set -euo pipefail

BASE=feec67e62a5148b41fd017ccbbc463e8a6f9e83d
GECKO="${GECKO:-/root/speculum-gecko/checkout}"
REPO="/mnt/c/RPJ/Coding/Projects/Seven/Websete/Websete Speculum"
STAMP="$(date -u +%Y%m%d-%H%M%SZ)"
OUT="$REPO/gecko-engine/.rescue/$STAMP"

[ -d "$GECKO/.git" ] || { echo "ABORT: checkout nao encontrado em $GECKO" >&2; exit 1; }
mkdir -p "$OUT"

git -C "$GECKO" rev-parse HEAD              > "$OUT/head.txt"
git -C "$GECKO" log --oneline -20           > "$OUT/log.txt"
git -C "$GECKO" status --porcelain          > "$OUT/status.txt"
git -C "$GECKO" diff "$BASE"                > "$OUT/tracked.patch"
git -C "$GECKO" diff --stat "$BASE"         > "$OUT/tracked.stat"
git -C "$GECKO" diff --name-only "$BASE"    > "$OUT/tracked.txt"

git -C "$GECKO" ls-files -o --exclude-standard \
  | grep -v -E '^(obj-|\.ccache/|\.mozbuild/)' > "$OUT/untracked.txt" || true

if [ -s "$OUT/untracked.txt" ]; then
  tar -C "$GECKO" -czf "$OUT/untracked.tar.gz" -T "$OUT/untracked.txt"
fi

{
  echo "rescue     $STAMP"
  echo "checkout   $GECKO"
  echo "head       $(cat "$OUT/head.txt")"
  echo "base       $BASE"
  echo "tracked    $(wc -l < "$OUT/tracked.txt") arquivos modificados"
  echo "untracked  $(wc -l < "$OUT/untracked.txt") arquivos novos"
  echo "patch      $(wc -l < "$OUT/tracked.patch") linhas"
} > "$OUT/MANIFEST.txt"

echo "===== MANIFEST ====="
cat "$OUT/MANIFEST.txt"
echo "===== TRACKED (stat) ====="
cat "$OUT/tracked.stat"
echo "===== UNTRACKED ====="
cat "$OUT/untracked.txt"
echo "===== TAMANHO ====="
du -sh "$OUT"