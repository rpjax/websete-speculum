#!/usr/bin/env bash
set -euo pipefail
ROOT="${SPECULUM_GECKO_ROOT:-$HOME/speculum-gecko}"
ENGINE="${SPECULUM_GECKO_ENGINE:-/mnt/c/RPJ/Coding/Projects/Seven/Websete/Websete Speculum/gecko-engine}"
cp -r "$ENGINE/baseline-profile" "$ROOT/baseline-profile"
export SPECULUM_GECKO_ROOT="$ROOT"
export SPECULUM_GECKO_ENGINE="$ENGINE"
export BASELINE_PROFILE="$ROOT/baseline-profile"
SESSION=speculum-gecko-baseline
tmux kill-session -t "$SESSION" 2>/dev/null || true
tmux new-session -d -s "$SESSION" "bash $ENGINE/scripts/run-baseline-suites.sh"
echo "tmux session: $SESSION"
tmux ls
