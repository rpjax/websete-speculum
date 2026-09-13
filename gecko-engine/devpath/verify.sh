#!/usr/bin/env bash
# Speculum devpath — passa uma captura (frames via supervisor WS) pelo apply estrito.
#
#   ./verify.sh <diretorio-da-captura>
#   ./verify.sh            # usa a captura mais recente
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CAP="${1:-}"
if [ -z "$CAP" ]; then
  CAP="$(ls -d "$HERE"/captures/*/ 2>/dev/null | tail -1)"
  [ -n "$CAP" ] || { echo "nenhuma captura em $HERE/captures" >&2; exit 1; }
fi
exec npx --yes tsx "$HERE/verify.ts" "$CAP"
