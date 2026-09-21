#!/usr/bin/env bash
set -euo pipefail
ROOT="/mnt/c/RPJ/Coding/Projects/Seven/Websete/Websete Speculum"
fix() { python3 -c "import pathlib; p=pathlib.Path('$1'); p.write_bytes(p.read_bytes().replace(b'\r\n', b'\n').replace(b'\r', b'\n'))"; }
fix "$ROOT/gecko-engine/tests/run.sh"
fix "$ROOT/gecko-engine/speculum-wire/run-tests.sh"
export SPECULUM_DOTNET="${SPECULUM_DOTNET:-/root/.dotnet/dotnet}"
cd "$ROOT/gecko-engine/tests"
bash run.sh
