#!/bin/bash
# Sobe o lab Gecko na 4077. Só Linux/WSL — o Firefox e o socket unix moram lá.
set -euo pipefail
export PATH=/root/.dotnet:/usr/bin:/bin:/usr/sbin
export DOTNET_ROOT=/root/.dotnet
export DOTNET_ROOT_X64=/root/.dotnet

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
FIREFOX="${SPECULUM_BROWSER_BIN:-$HOME/speculum-gecko/checkout/obj-x86_64-pc-linux-gnu/dist/bin/firefox}"
SUPERVISOR_DLL="$REPO/gecko-engine/supervisor/src/Speculum.Supervisor/bin/Release/net9.0/speculum-supervisor.dll"

[ -x "$FIREFOX" ] || { echo "firefox não encontrado: $FIREFOX" >&2; exit 1; }

cd "$REPO/gecko-engine/supervisor"
/root/.dotnet/dotnet build src/Speculum.Lab/Speculum.Lab.csproj -c Release --nologo -v quiet
/root/.dotnet/dotnet build src/Speculum.Supervisor/Speculum.Supervisor.csproj -c Release --nologo -v quiet

WRAP=/tmp/speculum-supervisor-wrap.sh
cat > "$WRAP" <<WRAP
#!/bin/bash
export PATH=/root/.dotnet:/usr/bin:/bin
export DOTNET_ROOT=/root/.dotnet
export DOTNET_ROOT_X64=/root/.dotnet
exec /root/.dotnet/dotnet "$SUPERVISOR_DLL" "\$@"
WRAP
chmod +x "$WRAP"

export SPECULUM_BROWSER_BIN="$FIREFOX"
export SPECULUM_SUPERVISOR_BIN="$WRAP"
export SPECULUM_LAB_HOST=127.0.0.1
export SPECULUM_LAB_PORT=4077
# Lab: Virtual com janela. Headless só se o caller exportar 1.
export SPECULUM_BROWSER_HEADLESS="${SPECULUM_BROWSER_HEADLESS:-0}"

echo "lab: http://127.0.0.1:4077/  firefox=$FIREFOX  headless=$SPECULUM_BROWSER_HEADLESS"
exec /root/.dotnet/dotnet run --project src/Speculum.Lab --no-build -c Release
