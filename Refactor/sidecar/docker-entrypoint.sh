#!/bin/sh
# Ensure a usable /dev/uinput when the host kernel provides the driver.
# Do NOT mknod a dead node when the module is missing — that fools access(2)
# checks while open(2) returns ENODEV (common on Docker Desktop WSL2).
# Also install Chrome managed policies (LNA allowlist) system-wide for every
# Chrome in this image — not per session profile.
set -eu

ensure_uinput() {
  if [ -e /dev/uinput ]; then
    return 0
  fi
  if command -v modprobe >/dev/null 2>&1; then
    if modprobe uinput 2>/dev/null; then
      if [ ! -e /dev/uinput ]; then
        mknod /dev/uinput c 10 223 2>/dev/null || true
        chmod 666 /dev/uinput 2>/dev/null || true
      fi
    fi
  fi
  if [ ! -e /dev/uinput ]; then
    echo "[sidecar] warning: /dev/uinput unavailable (kernel has no uinput) — OS input will fail closed" >&2
  fi
}

ensure_chrome_lna_policies() {
  # Google Chrome (Linux) reads /etc/opt/chrome/policies/managed/*.json for all profiles.
  src="/app/chrome-policies/managed"
  dst="/etc/opt/chrome/policies/managed"
  if [ ! -d "$src" ]; then
    return 0
  fi
  mkdir -p "$dst"
  # shellcheck disable=SC2045
  for f in "$src"/*.json; do
    [ -f "$f" ] || continue
    base=$(basename "$f")
    cp -f "$f" "$dst/$base"
  done
}

ensure_uinput
ensure_chrome_lna_policies
exec "$@"
