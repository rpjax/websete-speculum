# Phase 5 gate — roteiro check/record (no libxul). A1–A9.
$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $Root

Write-Host "==== layer gates ===="
& "$PSScriptRoot\..\phase1\layer_gates.ps1"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "==== build C++ ===="
cmd /c "$PSScriptRoot\build_cpp.bat"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$exe = Join-Path $Root "build\phase5\phase5_tests.exe"
if (-not (Test-Path $exe)) { Write-Error "phase5 exe missing"; exit 1 }

Write-Host "==== C++ tests (A1-A9) ===="
& $exe
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "==== fixture present ===="
$fix = Join-Path $Root "tests\phase5\fixtures\minimal.spec"
if (-not (Test-Path $fix)) { Write-Error "minimal.spec missing"; exit 1 }
$schema = (Get-Content (Join-Path $Root "domain\wire\gen\schema.sha256") -Raw).Trim()
$content = Get-Content $fix -Raw
if ($content -notmatch [regex]::Escape($schema)) {
  Write-Host "FAIL: fixture schema != schema.sha256"
  exit 1
}
Write-Host "PASS: fixture schema"

Write-Host "==== PASS phase5 ===="
exit 0
