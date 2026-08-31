# Changelog

## [0.3.0] — unreleased

### PageProjection (motor)

- **Apply gate** — queue assembled frames during async recreate/cold resync; `flightDepth` + `draining`; cap 64; overflow anti-loop (streak 3). Fixes self-inflicted `sequence_gap` on Eneba-class cold resync (PP-APPLY-GATE-OVERRUN).
- **Loopback `document.install`** — same-socket hello generation supersede; session `waitEstablished({ afterGeneration })` after install (PP-LOOPBACK-DOC-INSTALL).
- **Cold resync on armed surface** — `everArmed && resync && sequence === 1` → full surface recreate, not standby-only async.
- **PP-NESTED-GEN-PACK** — nested generation packing removed; parent mints monotonic per-`contextId` in the same `initContext` answer.
- **K5 / iOS (code)** — no `iframe.sandbox` on Projected; CSP `script-src 'none'; object-src 'none'` in `PROJECTED_STANDARDS_SRCDOC` + `ensureProjectedK5Csp`. Chromium probe fail-closed. **Safari iPhone `emitted > 0` evidence still required before tag.**
- **Lab proof** — Eneba `/br/` browse dossier `2026-08-30T06-10-17-942Z-www.eneba.com`: 0 desync, input 44/44, ~1% CPU our-code. Partial `/` soak `2026-08-31T01-07-05-005Z-soak` (Virtual only; see limitations).

### Known gaps (0.3.0 — documented limitations)

- Accept 1:1 sealed — not this tag.
- Antibot / stealth V3 — not this tag.
- Multi-session density / datacenter IP — not this tag.
- Canvas (M1 gate 7) — placeholder only.
- MotorAssert Live deep — open.
- **Lab `verdicts.json`** — often empty / skip-heavy; metrics without automatic verdict.
- **Turnstile nested sob desafio Cloudflare:** não verificável nesta versão — o contexto nested vive menos que a latência da sonda do lab. Instrumento, não produto. Piloto entra direto em /br/ e não atravessa esse caminho. Reabrir quando os verdicts nested passarem a ser derivados do journal/wire.
- **iPhone touch** — code/CSP done for 0.3.0; Safari `emitted > 0` **deferred to next version**.

### 0.3.0 release gates (status)

- [x] PP-NESTED-GEN-PACK revert
- [x] B3 SessionCollector race (PASS)
- [x] Windows sidecar `npm test` (+ Chrome for K5)
- [~] Eneba `/`→`/br/` — limitation (partial)
- [x] iOS/CSP code+unit (device Safari → next version)
- [x] Known limitations honesty (this file + motor-0.3.0)

See [docs/page-projection/spec/motor-0.3.0.md](docs/page-projection/spec/motor-0.3.0.md).

## [0.2.0](https://github.com/rpjax/websete-speculum/compare/v0.1.0...v0.2.0) (2026-08-04)


### Features

* ship screencast sharpness, immersive live, and sessions polish ([#5](https://github.com/rpjax/websete-speculum/issues/5)) ([269a9e7](https://github.com/rpjax/websete-speculum/commit/269a9e7b294677848678e8c566730039744ec80c))
