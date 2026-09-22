# Phase 2 gate — Session foundation (no libxul).
$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $Root

Write-Host "==== layer gates ===="
& "$PSScriptRoot\..\phase1\layer_gates.ps1"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "==== build C++ ===="
cmd /c "$PSScriptRoot\build_cpp.bat"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$exe = Join-Path $Root "build\phase2\phase2_tests.exe"
if (-not (Test-Path $exe)) { Write-Error "phase2 exe missing"; exit 1 }

Write-Host "==== C++ tests ===="
& $exe
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "==== PASS phase2 ===="
exit 0
