#!/bin/bash
set -euo pipefail
export SCCACHE_DIR=/root/speculum-gecko/.ccache
export MOZCONFIG=/tmp/spec-mozconfig
sed 's/\r$//' "/mnt/c/RPJ/Coding/Projects/Seven/Websete/Websete Speculum/gecko-engine/mozconfig" > /tmp/spec-mozconfig
# objdir já existente
echo 'mk_add_options MOZ_OBJDIR=/root/speculum-gecko/checkout/obj-x86_64-pc-linux-gnu' >> /tmp/spec-mozconfig
cd /root/speculum-gecko/checkout
# IPDL novo (ClaimGeneration / FrameCredit) precisa de export; binaries sozinho
# deixa stub velho e o rebuild único não leva a onda 2.
./mach build pre-export export
./mach build binaries
