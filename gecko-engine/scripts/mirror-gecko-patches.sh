#!/usr/bin/env bash
set -euo pipefail
BASE=feec67e62a
CHECKOUT=/root/speculum-gecko/checkout
REPO="/mnt/c/RPJ/Coding/Projects/Seven/Websete/Websete Speculum"
PATCHES="$REPO/gecko-engine/patches"
cd "$CHECKOUT"

mapfile -t tracked < <(git diff --name-only "${BASE}")
mapfile -t untracked < <(git ls-files -o --exclude-standard | grep -v '^speculum/' | grep -v '^third_party/speculum-wire' || true)

declare -A seen
all=()
for f in "${tracked[@]}" "${untracked[@]}"; do
  [[ -z "$f" ]] && continue
  [[ -n "${seen[$f]+x}" ]] && continue
  seen[$f]=1
  all+=("$f")
done

rm -f "$PATCHES"/SpeculumMutationObserver.cpp "$PATCHES"/SpeculumMutationObserver.h \
      "$PATCHES"/SpeculumNodeSource.cpp "$PATCHES"/SpeculumNodeSource.h

for f in "${all[@]}"; do
  src="$CHECKOUT/$f"
  dst="$PATCHES/$f"
  mkdir -p "$(dirname "$dst")"
  cp "$src" "$dst"
  echo "$f"
done

git diff "${BASE}" > "$PATCHES/ALL.diff"

echo "FILES:${#all[@]}"
