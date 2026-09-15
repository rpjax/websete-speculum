#!/usr/bin/env bash
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
GECKO="${GECKO:-$HOME/speculum-gecko/checkout}"
echo "REPO=$REPO"
echo "GECKO=$GECKO"
# third_party/speculum-wire is the same tree as gecko-engine/speculum-wire
if [ ! "$REPO/gecko-engine/speculum-wire/include/speculum/Producer.h" -ef \
     "$GECKO/third_party/speculum-wire/include/speculum/Producer.h" ]; then
  cp -f "$REPO/gecko-engine/speculum-wire/include/speculum/"*.h \
    "$GECKO/third_party/speculum-wire/include/speculum/"
fi
for f in \
  dom/base/SpeculumNodeSource.h \
  dom/base/SpeculumNodeSource.cpp \
  dom/base/SpeculumMutationObserver.h \
  dom/base/SpeculumMutationObserver.cpp \
  dom/base/SpeculumInput.h \
  dom/base/SpeculumInput.cpp \
  dom/base/moz.build \
  dom/ipc/PContent.ipdl \
  dom/ipc/ContentChild.h \
  dom/ipc/ContentChild.cpp \
  dom/ipc/ContentParent.h \
  dom/ipc/ContentParent.cpp \
  dom/ipc/SpeculumProjectionRuntime.h \
  dom/ipc/SpeculumProjectionRuntime.cpp \
  dom/ipc/SpeculumControlAbi.h \
  dom/ipc/SpeculumControlAbi.cpp \
  dom/ipc/SpeculumMarionette.h \
  dom/ipc/SpeculumMarionette.cpp \
  dom/ipc/SpeculumAssetClassifier.h \
  dom/ipc/SpeculumAssetClassifier.cpp \
  dom/ipc/SpeculumAssetRegistry.h \
  dom/ipc/SpeculumAssetRegistry.cpp \
  dom/ipc/moz.build
do
  mkdir -p "$GECKO/$(dirname "$f")"
  cp -f "$REPO/gecko-engine/patches/$f" "$GECKO/$f"
  echo "copied $f"
done
GECKO="$GECKO" python3 "$REPO/gecko-engine/scripts/apply-speculum-v1-hooks.py" || true
echo DONE
