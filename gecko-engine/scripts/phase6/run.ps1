# Phase 6 gate — oracle / freeze / capture (no libxul). A1–A10.
$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $Root

Write-Host "==== layer gates ===="
& "$PSScriptRoot\..\phase1\layer_gates.ps1"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "==== build C++ ===="
cmd /c "$PSScriptRoot\build_cpp.bat"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$recon = Join-Path $Root "build\phase6\reconstructor_unit.exe"
$exe = Join-Path $Root "build\phase6\phase6_tests.exe"
if (-not (Test-Path $recon)) { Write-Error "reconstructor_unit exe missing"; exit 1 }
if (-not (Test-Path $exe)) { Write-Error "phase6 exe missing"; exit 1 }

Write-Host "==== A5 reconstructor unit (no motor) ===="
& $recon
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "==== C++ tests (A1-A10) ===="
& $exe --oracle.preset=lab --oracle.forward
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "==== PASS phase6 ===="
exit 0
