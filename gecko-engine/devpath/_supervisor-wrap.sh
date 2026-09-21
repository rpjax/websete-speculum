#!/bin/bash
export PATH=/root/.dotnet:/usr/bin:/bin
export DOTNET_ROOT=/root/.dotnet
export DOTNET_ROOT_X64=/root/.dotnet
exec /root/.dotnet/dotnet "/mnt/c/RPJ/Coding/Projects/Seven/Websete/Websete Speculum/gecko-engine/supervisor/src/Speculum.Supervisor/bin/Release/net9.0/speculum-supervisor.dll" "$@"
