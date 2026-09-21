#!/usr/bin/env bash
set -euo pipefail
I="/mnt/c/RPJ/Coding/Projects/Seven/Websete/Websete Speculum/gecko-engine/speculum-wire/include"
T="/mnt/c/RPJ/Coding/Projects/Seven/Websete/Websete Speculum/gecko-engine/speculum-wire/test"
for name in producer_cssom producer_resync producer_lifecycle producer_shadow producer_nested producer_loop producer_cli; do
  echo "== ${name}"
  g++ -std=c++17 -O2 -Wall -Wextra -Werror -fno-exceptions -fno-rtti -I"${I}" "${T}/${name}.cpp" -o "/tmp/${name}"
  "/tmp/${name}"
done
echo ALL_OK
