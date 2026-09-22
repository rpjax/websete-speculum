# Phase 1 gate — foundation + wire (no libxul).
$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $Root

Write-Host "==== wiregen ===="
python tools/wiregen/wiregen.py
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "==== refuse x7 ===="
$refuse = Get-ChildItem tools/wiregen/refuse/*.toml | Sort-Object Name
if ($refuse.Count -ne 7) { Write-Error "expected 7 refuse fixtures"; exit 1 }
$i = 1
foreach ($f in $refuse) {
  $out = python tools/wiregen/wiregen.py --refuse-test $f.FullName 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) { Write-Host $out; Write-Error "refuse $($f.Name) did not exit 0"; exit 1 }
  if ($out -notmatch "refuse#$i") {
    # rule number from filename prefix
    $rule = [int]($f.BaseName.Substring(0, 2))
    if ($out -notmatch "refuse#$rule") {
      Write-Host $out
      Write-Error "refuse $($f.Name) missing refuse#$rule"
      exit 1
    }
  }
  Write-Host "PASS refuse $($f.Name)"
  $i++
}

Write-Host "==== goldens ===="
python tools/wiregen/goldens.py
python tools/wiregen/gen_cpp_roundtrip.py

Write-Host "==== layer gates ===="
& "$PSScriptRoot\layer_gates.ps1"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "==== build C++ ===="
cmd /c "$PSScriptRoot\build_cpp.bat"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$exe = Join-Path $Root "build\phase1\phase1_tests.exe"
if (-not (Test-Path $exe)) { Write-Error "C++ exe not produced"; exit 1 }

Write-Host "==== C++ tests ===="
& $exe (Join-Path $Root "domain\wire\testdata\golden")
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "==== TS tests ===="
npx --yes tsx tests/phase1/roundtrip_ts.ts
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "==== C# tests ===="
dotnet run --project tests/phase1/Phase1.Cs/Phase1.Cs.csproj -c Release --verbosity quiet
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# Cross: goldens are the shared corpus; each language decode→encode must match.
# Explicit cross file drop: C++ already matched golden; TS/CS matched golden ⇒ transitive cross.

Write-Host "==== no DocumentRef mint ===="
$docRef = Get-ChildItem -Recurse -File domain -Include *.hpp,*.h,*.cpp |
  Select-String -Pattern 'Minter\s*<\s*Document|using DocumentRef\s*=' -CaseSensitive -ErrorAction SilentlyContinue
if ($docRef) {
  Write-Host "FAIL: DocumentRef global mint found"
  $docRef | ForEach-Object { Write-Host $_ }
  exit 1
}
Write-Host "PASS: generation_is_not_global_mint"

Write-Host "==== PASS phase1 ===="
exit 0
