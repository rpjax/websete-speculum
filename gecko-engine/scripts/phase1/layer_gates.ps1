# Layer gates for redesign domain/ + ports/ (PowerShell).
$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $Root
$fail = 0

function Test-Grep {
  param([string]$Pattern, [string[]]$Paths)
  $hits = @()
  foreach ($p in $Paths) {
    if (-not (Test-Path $p)) { continue }
    $files = Get-ChildItem -Recurse -File $p |
      Where-Object {
        $_.Extension -match '\.(hpp|h|cpp|c|md|txt|toml|json|ts|cs)$' -and
        $_.FullName -notmatch '\\testdata\\'
      }
    $hits += @($files | Select-String -Pattern $Pattern -CaseSensitive -ErrorAction SilentlyContinue)
  }
  return @($hits)
}

$ns = Test-Grep -Pattern '"ns[A-Z]|mozilla/|nsI[A-Z]' -Paths @("domain","ports")
if ($ns.Count -gt 0) {
  Write-Host "FAIL: gecko symbols in domain/ or ports/"
  $ns | ForEach-Object { Write-Host "  $($_.Path):$($_.LineNumber): $($_.Line)" }
  $fail = 1
}
else { Write-Host "PASS: layer_gate_ns" }

$nr = Test-Grep -Pattern '\[\[noreturn\]\]' -Paths @("domain")
if ($nr.Count -gt 0) {
  Write-Host "FAIL: [[noreturn]] in domain/"
  $nr | ForEach-Object { Write-Host "  $($_.Path):$($_.LineNumber)" }
  $fail = 1
}
else { Write-Host "PASS: layer_gate_noreturn" }

$probe = "domain\.gate_probe_ns.tmp.cpp"
Set-Content -Path $probe -Value '#include "nsIFoo.h"'
$ns2 = Test-Grep -Pattern '"ns[A-Z]|mozilla/|nsI[A-Z]' -Paths @("domain","ports")
if ($ns2.Count -eq 0) { Write-Host "FAIL: layer_gate_ns did not detect planted nsI"; $fail = 1 }
else { Write-Host "PASS: layer_gate_ns closes" }
Remove-Item $probe -Force

$probe2 = "domain\.gate_probe_nr.tmp.cpp"
Set-Content -Path $probe2 -Value '[[noreturn]] void die();'
$nr2 = Test-Grep -Pattern '\[\[noreturn\]\]' -Paths @("domain")
if ($nr2.Count -eq 0) { Write-Host "FAIL: layer_gate_noreturn did not detect planted attribute"; $fail = 1 }
else { Write-Host "PASS: layer_gate_noreturn closes" }
Remove-Item $probe2 -Force

exit $fail
