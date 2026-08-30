# Changelog

## [0.3.0] — unreleased

### PageProjection (motor)

- **Apply gate** — queue assembled frames during async recreate/cold resync; `flightDepth` + `draining`; cap 64; overflow anti-loop (streak 3). Fixes self-inflicted `sequence_gap` on Eneba-class cold resync (PP-APPLY-GATE-OVERRUN).
- **Loopback `document.install`** — same-socket hello generation supersede; session `waitEstablished({ afterGeneration })` after install (PP-LOOPBACK-DOC-INSTALL).
- **Cold resync on armed surface** — `everArmed && resync && sequence === 1` → full surface recreate, not standby-only async.
- **Lab proof** — Eneba `/br/` browse dossier `2026-08-30T06-10-17-942Z-www.eneba.com`: 0 desync, input 44/44, ~1% CPU our-code.

### Known gaps (0.3.0 — documented limitations, not tag gates)

- Accept 1:1 / antibot stealth / multi-session density / datacenter IP — see [docs/page-projection/spec/motor-0.3.0.md](docs/page-projection/spec/motor-0.3.0.md).
- Canvas (M1 gate 7) — not in 0.3.0.

### 0.3.0 release gates (before tag)

- PP-NESTED-GEN-PACK revert (wire)
- Eneba `/` → `/br/` dossier
- B3 dotnet test if failing on `main`
- Full Windows CI gates

See [docs/page-projection/spec/motor-0.3.0.md](docs/page-projection/spec/motor-0.3.0.md).

## [0.2.0](https://github.com/rpjax/websete-speculum/compare/v0.1.0...v0.2.0) (2026-08-04)


### Features

* ship screencast sharpness, immersive live, and sessions polish ([#5](https://github.com/rpjax/websete-speculum/issues/5)) ([269a9e7](https://github.com/rpjax/websete-speculum/commit/269a9e7b294677848678e8c566730039744ec80c))
