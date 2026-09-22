# Phase 7 gate — fixtures / SpecDriver / oracle lab (no libxul). A1–A9.
$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $Root

Write-Host "==== layer gates ===="
& "$PSScriptRoot\..\phase1\layer_gates.ps1"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "==== build C++ ===="
cmd /c "$PSScriptRoot\build_cpp.bat"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$exe = Join-Path $Root "build\phase7\phase7_tests.exe"
if (-not (Test-Path $exe)) { Write-Error "phase7 exe missing"; exit 1 }

Write-Host "==== C++ fixtures (A1-A9) ===="
& $exe --oracle.preset=lab
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "==== fixture classes present ===="
$classes = @("correcao","estrutural","cssom","aninhamento","ciclo","estresse","adversaria")
foreach ($c in $classes) {
  $dir = Join-Path $Root "tests\phase7\fixtures\$c"
  if (-not (Test-Path $dir)) { Write-Error "missing class $c"; exit 1 }
  $specs = @(Get-ChildItem $dir -Filter *.spec)
  if ($specs.Count -lt 1) { Write-Error "no specs in $c"; exit 1 }
}
Write-Host "PASS: seven classes"

Write-Host "==== PASS phase7 ===="
exit 0
