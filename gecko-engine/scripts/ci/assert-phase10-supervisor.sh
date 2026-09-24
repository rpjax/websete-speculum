#!/usr/bin/env bash
# Phase 10 — product path must not carry Kind/ControlAbi dual-stack.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

SUP="supervisor/src"
fail=0

scan() {
  local pat="$1"
  local label="$2"
  local hits
  hits="$(grep -RInE --include='*.cs' "$pat" \
    "$SUP/Speculum.Supervisor" "$SUP/Speculum.Gecko.Abi" "$SUP/Speculum.Lab" "$SUP/Speculum.Orchestrator" 2>/dev/null \
    | grep -vE 'SchemaCommands\.cs|no ControlAbi|No Kind/ControlAbi|Generated codec only' \
    || true)"
  if [[ -n "$hits" ]]; then
    echo "FAIL $label:"
    echo "$hits"
    fail=1
  else
    echo "PASS $label"
  fi
}

scan '\bEnvelopeKind\b' 'no EnvelopeKind'
scan '\bControlAbi\b' 'no ControlAbi'
scan '\bControlCommand\b' 'no ControlCommand'
scan '\bControlOpCode\b' 'no ControlOpCode'
scan '\bControlReader\b' 'no ControlReader'
scan '\bControlWriter\b' 'no ControlWriter'
scan 'HeaderBytes\s*==\s*9' 'no HeaderBytes==9'
scan '\bclass Envelope\b' 'no Kind Envelope class'

# Kind Envelope helpers — must not match SchemaEnvelope.*
for pat in 'TryReadComplete' 'WriteHeader'; do
  hits="$(grep -RInE --include='*.cs' "\bEnvelope\.${pat}\b" \
    "$SUP/Speculum.Supervisor" "$SUP/Speculum.Gecko.Abi" "$SUP/Speculum.Lab" "$SUP/Speculum.Orchestrator" 2>/dev/null \
    | grep -v SchemaEnvelope \
    || true)"
  if [[ -n "$hits" ]]; then
    echo "FAIL no Envelope.$pat:"
    echo "$hits"
    fail=1
  else
    echo "PASS no Envelope.$pat"
  fi
done


# A2 — policy decisions live only in Supervisor SessionPolicy, not domain/engines.
if grep -RInE --include='*.hpp' --include='*.cpp' --include='*.h' \
    'ChooseResyncForce|NavigateRetryLimit|MaxOutstandingOffers|TryBeginNavigate|TryAcquireOfferSlot' \
    domain engines 2>/dev/null | grep -q .; then
  echo "FAIL A2: policy symbols leaked into domain/engines"
  grep -RInE --include='*.hpp' --include='*.cpp' --include='*.h' \
    'ChooseResyncForce|NavigateRetryLimit|MaxOutstandingOffers|TryBeginNavigate|TryAcquireOfferSlot' \
    domain engines || true
  fail=1
else
  echo "PASS A2: no policy symbols in domain/engines"
fi

for eng in engines/sim/EngineCommands.hpp engines/gecko/GeckoEngineCommands.hpp; do
  if ! grep -q 'm\.force' "$eng" || ! grep -q 'doResync' "$eng"; then
    echo "FAIL A2: $eng must apply m.force via doResync"
    fail=1
  else
    echo "PASS A2: $eng applies wire force"
  fi
done

if ! grep -q 'class SessionPolicy' "$SUP/Speculum.Gecko.Abi/Control/SessionPolicy.cs"; then
  echo "FAIL SessionPolicy missing"
  fail=1
else
  echo "PASS SessionPolicy present"
fi

if ! grep -qE 'ChooseResyncForce|TryBeginNavigate|TryAcquireOfferSlot' \
    "$SUP/Speculum.Gecko.Abi/Control/SessionPolicy.cs"; then
  echo "FAIL SessionPolicy missing three decisions"
  fail=1
else
  echo "PASS SessionPolicy three decisions"
fi

# SchemaControlChannel must gate navigate + offers through policy.
if ! grep -q 'TryBeginNavigate' "$SUP/Speculum.Supervisor/Control/SchemaControlChannel.cs"; then
  echo "FAIL SchemaControlChannel missing navigate policy"
  fail=1
else
  echo "PASS SchemaControlChannel navigate policy"
fi
if ! grep -q 'TryAcquireOfferSlot' "$SUP/Speculum.Supervisor/Control/SchemaControlChannel.cs"; then
  echo "FAIL SchemaControlChannel missing offer policy"
  fail=1
else
  echo "PASS SchemaControlChannel offer policy"
fi

exit "$fail"
