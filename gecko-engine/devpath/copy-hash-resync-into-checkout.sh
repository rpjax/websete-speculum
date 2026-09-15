#!/usr/bin/env bash
set -euo pipefail
REPO="${REPO:-$(cd "$(dirname "$0")/../.." && pwd)}"
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
  dom/base/SpeculumCssom.h \
  dom/base/SpeculumCssom.cpp \
  dom/base/SpeculumLog.h \
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
  dom/ipc/SpeculumMint.h \
  dom/ipc/SpeculumMint.cpp \
  dom/ipc/SpeculumAssetClassifier.h \
  dom/ipc/SpeculumAssetClassifier.cpp \
  dom/ipc/SpeculumAssetRegistry.h \
  dom/ipc/SpeculumAssetRegistry.cpp \
  dom/ipc/SpeculumCaps.h \
  dom/ipc/SpeculumCaps.cpp \
  dom/ipc/SpeculumTelemetry.h \
  dom/ipc/SpeculumTelemetry.cpp \
  dom/ipc/moz.build
do
  mkdir -p "$GECKO/$(dirname "$f")"
  cp -f "$REPO/gecko-engine/patches/$f" "$GECKO/$f"
  echo "copied $f"
done
HUNK="$REPO/gecko-engine/patches/dom/base/nsGlobalWindowInner.cpp.patch"
TARGET="$GECKO/dom/base/nsGlobalWindowInner.cpp"
[ -f "$HUNK" ] || { echo "FALHOU: hunk ausente $HUNK" >&2; exit 1; }
[ -f "$TARGET" ] || { echo "FALHOU: $TARGET ausente" >&2; exit 1; }
if grep -q 'SpeculumTryAskDialog' "$TARGET"; then
  echo "window dialog hunk already applied"
elif grep -q 'SpeculumAskAndWait' "$TARGET"; then
  python3 "$(dirname "$0")/upgrade-window-dialog-hunk.py" "$TARGET"
else
  patch -d "$GECKO" -p1 --fuzz=0 < <(sed 's/\r$//' "$HUNK")
fi
HUNK="$REPO/gecko-engine/patches/dom/base/ShadowRoot.cpp.patch"
TARGET="$GECKO/dom/base/ShadowRoot.cpp"
[ -f "$HUNK" ] || { echo "FALHOU: hunk ausente $HUNK" >&2; exit 1; }
[ -f "$TARGET" ] || { echo "FALHOU: $TARGET ausente" >&2; exit 1; }
if grep -q 'SpeculumNotifyRuleAdded' "$TARGET"; then
  echo "shadow css hunk already applied"
else
  patch -d "$GECKO" -p1 --fuzz=0 < <(sed 's/\r$//' "$HUNK")
fi
echo DONE
