#!/bin/sh
# Ensure a usable /dev/uinput when the host kernel provides the driver.
# Do NOT mknod a dead node when the module is missing — that fools access(2)
# checks while open(2) returns ENODEV (common on Docker Desktop WSL2).
set -eu

ensure_uinput() {
  if [ -e /dev/uinput ]; then
    # Node present — still may be unusable without the driver; leave as-is.
    return 0
  fi
  if command -v modprobe >/dev/null 2>&1; then
    if modprobe uinput 2>/dev/null; then
      # udev may create the node; if not, mknod only after module loaded.
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

ensure_uinput
exec "$@"
