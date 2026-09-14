#!/bin/bash
set -euo pipefail
export PATH=/root/.dotnet:/usr/bin:/bin
export DOTNET_ROOT=/root/.dotnet
export DOTNET_ROOT_X64=/root/.dotnet
export SPECULUM_DOTNET=/root/.dotnet/dotnet
export SPECULUM_TESTS_DLL="/mnt/c/RPJ/Coding/Projects/Seven/Websete/Websete Speculum/gecko-engine/tests/Speculum.Tests/bin/Release/net9.0/speculum-tests.dll"
export SPECULUM_SUPERVISOR_DLL="/mnt/c/RPJ/Coding/Projects/Seven/Websete/Websete Speculum/gecko-engine/supervisor/src/Speculum.Supervisor/bin/Release/net9.0/speculum-supervisor.dll"
export SPECULUM_STACK_BROWSER_BIN=/root/speculum-gecko/checkout/obj-x86_64-pc-linux-gnu/dist/bin/firefox
exec /root/.dotnet/dotnet "$SPECULUM_TESTS_DLL" l4
