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
  dom/ipc/PContent.ipdl \
  dom/ipc/ContentChild.h \
  dom/ipc/ContentChild.cpp \
  dom/ipc/SpeculumProjectionRuntime.cpp
do
  cp -f "$REPO/gecko-engine/patches/$f" "$GECKO/$f"
  echo "copied $f"
done
echo DONE
