#!/usr/bin/env bash
# Textual layer gate: xul glue must not mention script-entry APIs.
# Not a transitive include graph — greps the cola sources only (01-alvo §3.1 spirit).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
XUL="$ROOT/engines/gecko/xul"
PATTERN='AutoEntryScript|nsJSUtils|mozJSComponentLoader|js/Public|JSContext|JSObject|JS::|nsIXPConnect|xpc_qs'
fail=0

shopt -s nullglob
files=("$XUL"/*.hpp "$XUL"/*.cpp)
if [[ ${#files[@]} -eq 0 ]]; then
  echo "assert-observer-no-script: no xul sources under $XUL" >&2
  exit 1
fi

hits="$(grep -nE "$PATTERN" "${files[@]}" || true)"
if [[ -n "$hits" ]]; then
  echo "FAIL: script-entry symbols in engines/gecko/xul/ (textual gate):" >&2
  echo "$hits" >&2
  fail=1
fi

LAYER_PATTERN='engines/(sim|gecko)/|SimEngineTraits|GeckoEngineTraits|SimEngine\.hpp|GeckoEngine\.hpp'
layer_hits="$(grep -rlE "$LAYER_PATTERN" "$ROOT/domain/session" "$ROOT/domain/producer" 2>/dev/null || true)"
if [[ -n "$layer_hits" ]]; then
  echo "FAIL: engine/Traits leaked into domain/session or domain/producer:" >&2
  echo "$layer_hits" >&2
  fail=1
fi

GECKO="$ROOT/engines/gecko"
POLICY_PATTERN='domain/producer/Policy\.hpp|["<]producer/Policy\.hpp[">]'
policy_hits="$(grep -rnE "$POLICY_PATTERN" "$GECKO" --include='*.hpp' --include='*.cpp' --include='*.h' --include='*.cc' 2>/dev/null || true)"
if [[ -n "$policy_hits" ]]; then
  echo "FAIL: engines/gecko includes policy header (incapacity gate):" >&2
  echo "$policy_hits" >&2
  fail=1
fi

# Planted probe — gate must fire
probe="$XUL/.gate_probe_script.tmp.cpp"
printf '%s\n' 'void f(JSContext* cx);' >"$probe"
probe_hits="$(grep -nE "$PATTERN" "$probe" || true)"
rm -f "$probe"
if [[ -z "$probe_hits" ]]; then
  echo "FAIL: assert-observer-no-script did not detect planted JSContext" >&2
  fail=1
else
  echo "PASS: assert-observer-no-script closes"
fi

if [[ "$fail" -ne 0 ]]; then
  exit 1
fi
echo "OK assert-observer-no-script + layer session/producer + gecko no-Policy"
