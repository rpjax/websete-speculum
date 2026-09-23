# Env helpers after `w7s gecko make gecko-source`.
# On Windows NTFS the tree lives in a Docker named volume (not the host folder).
# Usage: . .\scripts\w7s-env.ps1
$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$ver = (Get-Content (Join-Path $Root "w7s.json") -Raw | ConvertFrom-Json).gecko.version
$marker = Join-Path $Root ".w7s\gecko\$ver\.w7s-docker-volume"
$stamp = Join-Path $Root ".w7s\gecko\$ver\.w7s-stamp.json"
$hostTree = Join-Path $Root ".w7s\gecko\$ver"

if (-not (Test-Path $stamp)) {
  Write-Error "gecko-source missing — run: npx w7s gecko make gecko-source"
}

if (Test-Path $marker) {
  $vol = (Get-Content $marker -Raw).Trim()
  $env:SPECULUM_GECKO_DOCKER_VOLUME = $vol
  $env:SPECULUM_GECKO_ROOT = ""  # not a host bind mount on NTFS
  Write-Host "gecko-source: Docker volume '$vol' (Windows NTFS — not bind-mounted)"
  Write-Host "  headers: npx w7s gecko shell -- ls /gecko-source/dom/base/nsINode.h"
  Write-Host "  for host-side modifications: put the workspace on WSL (\\wsl`$\\...) so w7s bind-mounts"
} elseif (Test-Path (Join-Path $hostTree ".git")) {
  $env:SPECULUM_GECKO_ROOT = (Resolve-Path $hostTree).Path
  Write-Host "SPECULUM_GECKO_ROOT=$env:SPECULUM_GECKO_ROOT"
} else {
  Write-Error "gecko-source stamp present but neither docker volume nor host .git found"
}
