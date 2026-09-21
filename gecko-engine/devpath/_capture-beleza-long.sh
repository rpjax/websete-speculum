#!/bin/bash
set -euo pipefail
export SPECULUM_SUPERVISOR_PORT=4199
export SPECULUM_SUPERVISOR_WS="ws://127.0.0.1:4199/session"
export TIMEOUT=180
exec "$(dirname "$0")/capture.sh" "https://www.belezanaweb.com.br/" "beleza-long"
