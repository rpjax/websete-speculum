#!/bin/bash
set -euo pipefail
export REPO="${REPO:-/mnt/c/RPJ/Coding/Projects/Seven/Websete/Websete Speculum}"
export GECKO="${GECKO:-/root/speculum-gecko/checkout}"
cd "$REPO/gecko-engine/devpath"
# scripts no /mnt/c têm CRLF
sed 's/\r$//' copy-hash-resync-into-checkout.sh > /tmp/copy-hash.sh
sed 's/\r$//' upgrade-window-dialog-hunk.py > /tmp/upgrade-window-dialog-hunk.py
sed -i 's|python3 "$(dirname "$0")/upgrade-window-dialog-hunk.py"|python3 /tmp/upgrade-window-dialog-hunk.py|' /tmp/copy-hash.sh
bash /tmp/copy-hash.sh
echo "---- window ----"
grep -n "SpeculumTryAskDialog\|SpeculumAskAndWait" "$GECKO/dom/base/nsGlobalWindowInner.cpp" | head
echo "---- ipdl ----"
grep -n "sync SpeculumDialogRequested\|async SpeculumDialogRequested\|SpeculumClaimGeneration\|SpeculumFrameCredit" "$GECKO/dom/ipc/PContent.ipdl"
echo "---- cssom applicable ----"
grep -n "SpeculumNotifySheetApplicable" "$GECKO/dom/base/Document.cpp" | head
echo "---- input ----"
grep -n "aDontRetarget\|EventDispatcher::Dispatch\|HandleEvent" "$GECKO/dom/base/SpeculumInput.cpp"
echo "---- marionette ----"
grep -n "SpeculumTryAskDialog\|SendAsk" "$GECKO/dom/ipc/SpeculumMarionette.cpp" | head
