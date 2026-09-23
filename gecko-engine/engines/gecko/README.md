# engines/gecko — GeckoEngine (Phase 8)

Implements the same ports as `engines/sim/`. Real libxul lives under `xul/` and
`GeckoXulGlue` — **only** place for `nsI*` / `mozilla/` includes.

## Build

| Mode | How |
|---|---|
| Host (phases 1–7) | no `SPECULUM_HAS_LIBXUL` — `NativeNode*` stand-in for domain tests |
| libxul (Phase 8 close) | WSL + `w7s` → `dom/speculum` via `modifications/`; `mach gtest SpeculumPhase7.*` + `SpeculumPhase8.*` |

```bash
# WSL
cd /home/webkit/speculum/gecko-engine
npx w7s gecko make gecko-source
npx w7s gecko make gecko-binary
npx w7s gecko shell -- ./mach gtest SpeculumPhase7.*
npx w7s gecko shell -- ./mach gtest SpeculumPhase8.*
# textual gates (host)
bash scripts/ci/assert-observer-no-script.sh
```

## Bans

- No `RefPtr` / `nsCOMPtr` of nodes — raw pointer, forget on `NodeWillBeDestroyed`.
- CSSOM `RefPtr` of sheet/rule only on the **process** (`XulCssomBinder` / `CssomTable`).
- No policy in the bridge.
- No `nsI*` outside `engines/gecko/`.
- Do not evolve `patches/` for the redesign — use `modifications/`.

## Contract note

C++ `ports/*.hpp` wins over visitor-style markdown.
