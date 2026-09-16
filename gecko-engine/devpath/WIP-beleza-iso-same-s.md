# WIP — Beleza / same-S / isonomia (NÃO APAGAR até fechar)

**Status:** rascunho operacional. Não é spec normativa.  
**Branch:** `feat/gecko-eval` · produto base: `603275e` + fatias P1–P4 desta sessão  
**Data:** 2026-09-16  

---

## Lei (martelo do Rodrigo — carved in stone)

- **Sem ad-hoc / workaround.** Nunca segundo caminho pra “ficar verde”.
- **Consertar na raiz** o algoritmo desenhado (stream, tabela, CSSOM C6, tee de ativo, resync).
- **Não** declarar PASS / “fixed” / “1:1” por HUD, `200`, `armed`, `ResyncServed`, contagem solta.
- Isonomia / accept = **estado no mesmo S** (Halt→Flush→Snapshot) + oráculo; telemetria não decide.
- PageProjection accept = Projected **1:1** com o site no Virtual / browser normal (DOM numérico; CSSOM live percebido).
- Done = último hop **vivo** no produto; arquivo no disco sem caller ≠ feito.

Se código e papel divergem: **primeira frase.**

---

## Pé final (após P1–P5)

**Isonomia de estado DOM same-S: PASS** (dump Virtual × fio × tree Projected filtrada).  
**CSSOM plano: PASS** (Rule count wire ≈ adopted; dump ok; sem double-author).  
**CSSOM texto hash: FAIL** (contagem 4656=4656; hash Gecko wire ≠ Chromium `cssText` — serialização).  
**Ativo / layout H5: FAIL** no cold (logo `nw=0`, header **344**, `brokenImgs≈68`).  
**Accept 1:1: NÃO.**

One-liner típico P3/P4 re-prova:
`ISO FAIL — cssom_rule_text_hash_wire_vs_adopted, asset_logo_complete, layout_header_height_sane, asset_broken_imgs_zero`  
Capture: `gecko-engine/devpath/captures/same-s-iso-latest/iso.json`

---

## O que já fechamos (produto + instrumentação)

| Item | Onde | Raiz? |
|------|------|-------|
| C6 style filter / MIME wait+NoteMime (base) | `603275e` | sim |
| **P1** `dumpCssomSheets(doc)` sem hijack `document` | `cssomSheetDump.ts` + `LabProjectedHarness` · lab client | instrumentação |
| **P2** iso: tree filtrada, Rule hash, attrs, logo/header asserts | `lab-same-s-iso.mjs` | instrumentação |
| Tree filtrada Element/Text = wire (infraSkipped=2) | prova P3+ | sim (infra, não bug DOM) |
| **P4** sniff mime genérico/não-image; retry tee `failed`; deny `empty-image`; SW `no-store` + 502 corpo ruim | `SpeculumAssetRegistry.cpp` + `asset-sw.js` + `geckoLabWire.ts` | raiz parcial — **cold ainda falha** |

Prova diag ativo (iframe): `fetch`+blob → 120×51; `?cachebust` no `<img>` → 120×51; **src original** fica `nw=0`. Primeiro response da URL gruda decode falho no Chromium.

---

## Instrumentação (updates por fatia)

### P1 — `dumpCssomSheets(doc)` — **PASS**
- `cssomSheetDump.ok === true`, `totalRules` ~4915 na prova.

### P2 — oráculo iso — **feito**
- Checks nomeados; FAIL nomeado.

### P3 — re-prova Beleza — **registrado**
- DOM/CSSOM-contagem PASS; H5 FAIL; rule text hash FAIL (serialização).

### P4 — ativo — **mitigado, não fechado**
- Cold ainda header 344 / logo nw=0. open.md: GECKO-ASSET-SVG-MIME **residual OPEN**.

### P5 — papel — **este arquivo + open.md**

---

## Anti-padrões — proibido neste fio

- Bootstrap DomMap / full dump frio pra tapar stream
- Soft-skip se faltar property no JSON
- PASS por `armed` / rowCount sozinho enquanto header 344 / imgs mortas
- Declarar 1:1 / Fixed em SVG-MIME sem cold estável
- Re-`src` / cache-bust no DOM só pra verde (diag ok; produto não)

---

## Referências

- Accept: `docs/page-projection/spec/acceptance.md`
- Open: `docs/page-projection/spec/open.md` (GECKO-ASSET-SVG-MIME residual)
- CLI: `_run-same-s-iso.sh` / `lab-same-s-iso.mjs`

**Não esquecer:** tabela verde ≠ página 1:1.
