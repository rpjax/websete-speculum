# Phase 3 gate — engine sim (no libxul). A1–A7.
$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $Root

Write-Host "==== layer gates ===="
& "$PSScriptRoot\..\phase1\layer_gates.ps1"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "==== grep_no_is_root ===="
$fail = 0
$paths = @("domain\documents", "engines\sim")
$hits = @()
foreach ($p in $paths) {
  if (-not (Test-Path $p)) { continue }
  $files = Get-ChildItem -Recurse -File $p | Where-Object {
    $_.Extension -match '\.(hpp|h|cpp)$'
  }
  # Ban isRoot / is_root as category. Allow parent.valid() comparisons.
  $hits += @($files | Select-String -Pattern 'isRoot|is_root|is-root' -CaseSensitive -ErrorAction SilentlyContinue)
}
if ($hits.Count -gt 0) {
  Write-Host "FAIL: grep_no_is_root"
  $hits | ForEach-Object { Write-Host "  $($_.Path):$($_.LineNumber): $($_.Line.Trim())" }
  $fail = 1
} else {
  Write-Host "PASS: grep_no_is_root"
}

Write-Host "==== build C++ ===="
cmd /c "$PSScriptRoot\build_cpp.bat"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$exe = Join-Path $Root "build\phase3\phase3_tests.exe"
if (-not (Test-Path $exe)) { Write-Error "phase3 exe missing"; exit 1 }

Write-Host "==== C++ tests (A1-A7) ===="
& $exe
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if ($fail -ne 0) { exit $fail }

Write-Host "==== PASS phase3 ===="
exit 0
