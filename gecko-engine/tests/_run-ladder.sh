#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export SPECULUM_DOTNET="${SPECULUM_DOTNET:-/root/.dotnet/dotnet}"
cd "$HERE"
# strip CR if this file was saved on Windows
exec bash "$HERE/run.sh"
