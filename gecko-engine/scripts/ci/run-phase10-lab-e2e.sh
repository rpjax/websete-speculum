#!/usr/bin/env bash
# Phase 10 A5 — build supervisor + LabE2E, run with explicit env paths.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

DOTNET="${SPECULUM_DOTNET:-$(command -v dotnet)}"
if [[ -z "$DOTNET" || ! -x "$DOTNET" ]]; then
  echo "FAIL A5: SPECULUM_DOTNET / dotnet not found" >&2
  exit 1
fi

# Unix domain sockets — require Linux/macOS for this gate.
if [[ "$(uname -s)" != "Linux" && "$(uname -s)" != "Darwin" ]]; then
  echo "FAIL A5: lab E2E requires Unix domain sockets (Linux/macOS / w7s shell)" >&2
  exit 1
fi

# WSL+/mnt/c NTFS denies utime on obj caches. Stage sources onto a native FS for build.
STAGE="${SPECULUM_PHASE10_DOTNET_STAGE:-${HOME}/.cache/speculum-phase10-stage}"
rm -rf "$STAGE"
mkdir -p "$STAGE/supervisor/src" "$STAGE/tests/phase10" "$STAGE/wire-clients/cs"
cp -a "$ROOT/supervisor/Directory.Build.props" "$STAGE/supervisor/Directory.Build.props"
rsync -a --delete \
  --exclude bin --exclude obj \
  "$ROOT/supervisor/src/Speculum.Gecko.Abi/" "$STAGE/supervisor/src/Speculum.Gecko.Abi/"
rsync -a --delete \
  --exclude bin --exclude obj \
  "$ROOT/supervisor/src/Speculum.Supervisor/" "$STAGE/supervisor/src/Speculum.Supervisor/"
rsync -a --delete \
  --exclude bin --exclude obj \
  "$ROOT/tests/phase10/Phase10.LabE2E/" "$STAGE/tests/phase10/Phase10.LabE2E/"
cp -a "$ROOT/wire-clients/cs/SpeculumWire.gen.cs" "$STAGE/wire-clients/cs/SpeculumWire.gen.cs"

echo "Building supervisor + Phase10.LabE2E (stage=$STAGE)..."
# Supervisor: default UseAppHost (product). LabE2E: UseAppHost=false declared in its csproj only.
dotnet build -c Release \
  "$STAGE/supervisor/src/Speculum.Supervisor/Speculum.Supervisor.csproj" -v q
dotnet build -c Release \
  "$STAGE/tests/phase10/Phase10.LabE2E/Phase10.LabE2E.csproj" -v q

BIN="$STAGE/supervisor/src/Speculum.Supervisor/bin/Release/net9.0"
SUP_DLL="$BIN/speculum-supervisor.dll"
SUP_EXE="$BIN/speculum-supervisor"
FAKE_DLL="$STAGE/tests/phase10/Phase10.LabE2E/bin/Release/net9.0/phase10-lab-e2e.dll"

if [[ ! -f "$SUP_DLL" ]]; then
  echo "FAIL A5: supervisor dll missing at $SUP_DLL" >&2
  exit 1
fi
if [[ ! -x "$SUP_EXE" && ! -f "${SUP_EXE}.exe" ]]; then
  echo "FAIL A5: supervisor apphost missing at $SUP_EXE — UseAppHost must stay on for Speculum.Supervisor" >&2
  exit 1
fi
if [[ ! -f "$FAKE_DLL" ]]; then
  echo "FAIL A5: lab-e2e dll missing at $FAKE_DLL" >&2
  exit 1
fi

export SPECULUM_DOTNET="$DOTNET"
# ProcessStartInfo launches `dotnet <dll>` (same as product host entry); apphost presence is the leak check above.
export SPECULUM_SUPERVISOR_DLL="$SUP_DLL"
export SPECULUM_PHASE10_FAKE_DLL="$FAKE_DLL"

dotnet "$FAKE_DLL"
