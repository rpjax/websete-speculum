# Phase 4 gate — producer (no libxul). A1–A12.
$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $Root

Write-Host "==== layer gates ===="
& "$PSScriptRoot\..\phase1\layer_gates.ps1"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "==== grep_no_lifecycle_branch ===="
$fail = 0
$hits = @()
if (Test-Path "domain\producer") {
  $files = Get-ChildItem -Recurse -File "domain\producer" | Where-Object { $_.Extension -match '\.(hpp|cpp)$' }
  $hits += @($files | Select-String -Pattern 'isFirstFrame|is_first_frame|lifecycleBranch' -CaseSensitive -ErrorAction SilentlyContinue)
}
if ($hits.Count -gt 0) {
  Write-Host "FAIL: grep_no_lifecycle_branch"
  $hits | ForEach-Object { Write-Host "  $($_.Path):$($_.LineNumber)" }
  $fail = 1
} else { Write-Host "PASS: grep_no_lifecycle_branch" }

Write-Host "==== build C++ ===="
cmd /c "$PSScriptRoot\build_cpp.bat"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$exe = Join-Path $Root "build\phase4\phase4_tests.exe"
if (-not (Test-Path $exe)) { Write-Error "phase4 exe missing"; exit 1 }

Write-Host "==== C++ tests (A1-A12) ===="
$out = & $exe 2>&1 | Out-String
Write-Host $out
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "==== Digest parity C++/TS ===="
# Parse GOLDEN lines from test output
$mName = [regex]::Match($out, 'GOLDEN hashName\(div\)=(\d+)')
$rowM = [regex]::Match($out, 'GOLDEN computeRowHash\(1,1,0,0,hashName\(div\)\)=(\d+)')
if (-not $mName.Success -or -not $rowM.Success) {
  Write-Host "FAIL: missing GOLDEN lines"
  exit 1
}
$cppName = $mName.Groups[1].Value
$cppRow = $rowM.Groups[1].Value

$js = @'
const FNV_OFFSET = 14695981039346656037n;
const FNV_PRIME = 1099511628211n;
const MASK64 = 0xffffffffffffffffn;
function h64Bytes(bytes, seed = FNV_OFFSET) {
  let h = seed;
  for (let i = 0; i < bytes.length; i++) {
    h ^= BigInt(bytes[i]);
    h = (h * FNV_PRIME) & MASK64;
  }
  return h;
}
function h64Str(s, seed = FNV_OFFSET) {
  return h64Bytes(new TextEncoder().encode(s), seed);
}
function h64U32(value, seed = FNV_OFFSET) {
  let h = seed;
  h ^= BigInt(value & 0xff); h = (h * FNV_PRIME) & MASK64;
  h ^= BigInt((value >>> 8) & 0xff); h = (h * FNV_PRIME) & MASK64;
  h ^= BigInt((value >>> 16) & 0xff); h = (h * FNV_PRIME) & MASK64;
  h ^= BigInt((value >>> 24) & 0xff); h = (h * FNV_PRIME) & MASK64;
  return h;
}
function hashName(name) { return h64Str("\u0000N" + name); }
function computeRowHash(id, kind, parent, prev, contentHash) {
  let h = h64U32(id);
  h = h64U32(kind, h);
  h = h64U32(parent, h);
  h = h64U32(prev, h);
  h ^= contentHash;
  h = (h * FNV_PRIME) & MASK64;
  return h;
}
const n = hashName("div");
const r = computeRowHash(1, 1, 0, 0, n);
process.stdout.write(n.toString() + " " + r.toString());
'@
$tmpJs = Join-Path $Root "build\phase4\digest_parity.mjs"
Set-Content -Path $tmpJs -Value $js -Encoding UTF8
$tsOut = node $tmpJs
if ($LASTEXITCODE -ne 0) { Write-Host "FAIL: node digest"; exit 1 }
$parts = $tsOut.Trim().Split(" ")
$tsName = $parts[0]
$tsRow = $parts[1]
if ($tsName -ne $cppName -or $tsRow -ne $cppRow) {
  Write-Host "FAIL: Digest mismatch cpp=($cppName,$cppRow) ts=($tsName,$tsRow)"
  exit 1
}
Write-Host "PASS: Digest parity"

if ($fail -ne 0) { exit $fail }
Write-Host "==== PASS phase4 ===="
exit 0
