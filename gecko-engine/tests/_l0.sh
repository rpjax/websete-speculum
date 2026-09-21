#!/usr/bin/env bash
set -euo pipefail
ROOT="/mnt/c/RPJ/Coding/Projects/Seven/Websete/Websete Speculum"
cd "$ROOT/gecko-engine/speculum-wire"
g++ -std=c++17 -O2 -Wall -Wextra -Werror -fno-exceptions -fno-rtti -Iinclude \
  test/producer_lifecycle.cpp -o /tmp/producer_lifecycle
/tmp/producer_lifecycle
g++ -std=c++17 -O2 -Wall -Wextra -Werror -fno-exceptions -fno-rtti -Iinclude \
  test/producer_shadow.cpp -o /tmp/producer_shadow
/tmp/producer_shadow
g++ -std=c++17 -O2 -Wall -Wextra -Werror -fno-exceptions -fno-rtti -Iinclude \
  test/producer_cssom.cpp -o /tmp/producer_cssom
/tmp/producer_cssom
g++ -std=c++17 -O2 -Wall -Wextra -Werror -fno-exceptions -fno-rtti -Iinclude \
  test/producer_cli.cpp -o /tmp/producer_cli
printf 'boot\nmk div d1\nappend body d1\nflush\nhalt\nmk span s1\nappend body s1\nsnapshot\nflush\n' | /tmp/producer_cli | head
echo "L0 producer ok"
