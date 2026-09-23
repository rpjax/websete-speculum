# Declared Gecko tree edits for w7s (whole-file).

## runtime (`replacesGeckoSource: false`)
`modifications/runtime` → `dom/speculum/` (moz.build + gtest)
plus `engines/`, `domain/`, `ports/` → under `dom/speculum/`.

## install (`replacesGeckoSource: true`)
`modifications/install/` — captured whole files (`dom/moz.build`, gtest registration).
