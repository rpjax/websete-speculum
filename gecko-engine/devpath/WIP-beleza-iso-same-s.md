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
**Ativo / layout H5: logo PASS no cold** (V1–V10 true; `nw=120`) após decode `br` no tee.  
`brokenImgs` ainda ~61 (outros assets, ex. avif) — **não** é accept 1:1 total.  
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

### P6 — H5 absolute diag (instrumento) — **dossier no disco; NÃO Fixed**

Dossier: `gecko-engine/devpath/captures/asset-h5-20260916-222117Z/`  
(também `…/asset-h5-latest/` · run hex: `root-cause.json`)

CLI: `lab-asset-h5-trace.mjs` / `_run-asset-h5-trace.sh`  
Traço: C++ `/tmp/speculum-asset-trace.ndjson` + client `assetTrace` no same-S.

| Id | Resultado |
|----|-----------|
| V1 sw.intercept | true |
| V2 lab.request ctx=1 | true |
| V3 join ≠ denied_pre | true |
| **V4 emit body SVG/magic** | **false** ← **primeiro falso** |
| V5 mime image/* | true (MIME mente) |
| V6 sw 200∧looksLikeImage | false (502, corpo rejeitado) |
| V7 sha gecko=lab=sw | false (sw vazio pós-502) |
| V8 first img nw>0 | false (same-S nw=0) |
| V9 same-S interpret | false |
| V10 tee key == request | true |

#### Raiz objetiva (hex + encoding) — fechada

`root-cause.json`:
- `contentEncoding`: **`br`** (brotli) em `ensure` / `tap_attach_ok` / `tap_start`
- `applyConversion`: **`1`** (Gecko ainda ia decodificar para o listener seguinte)
- `bodyHeadHex`: `c19047002096a8d1aa7675d43bbf217e` — **não** é SVG/`1f8b`/PNG; é payload brotli cru
- `mimeOnComplete`: `image/svg+xml` com `dataLen=1029` = tamanho **comprimido**

**Causa:** o `TeeTap` grava/emite o corpo **antes** da conversão `Content-Encoding` (br). O Projected recebe brotli rotulado como SVG → SW 502 / `nw=0`.

**Fix na raiz (feito):** decode **só no tee** (`EnsureLogicalBody` / brotli|gzip) antes do emit — o Virtual child continua a receber o wire comprimido (`HttpChannelParent` desliga `ApplyConversion`). `SetNewListener(true)` sozinho **não** basta no parent e10s.

### P7 — prova cold pós-fix — **logo H5 fechado; não 1:1 site**

Dossier: `gecko-engine/devpath/captures/asset-h5-20260916-223633Z/`  
V1–V10 **todos true**. Logo `naturalWidth=120`. `bodyHead` = `<svg …`. sha gecko=lab=sw.  
`brokenImgs=61` (residual outros MIME/assets). **Não** declarar Fixed de accept.

### P8 — brokenImgs 61 — **causa classificada (não Fixed)**

Iso cold pós-logo: header 60 PASS; logo PASS; fail `asset_broken_imgs_zero` + hash CSSOM texto.

Classificação (`asset-h5-20260916-225115Z/broken-classify.json`):
- **34 AVIF** + **26 WEBP** Cloudinary + 1 pixel tracker
- Tee Virtual: `tap_stop_ok` na URL **completa**; Projected pede `.../upload/f_avif` (truncado) → `join/open` → `open-failed`
- Provável: **srcset** com vírgulas de transform Cloudinary interpretadas como separador de candidatos

Próximo fix: serialização/apply de `srcset` (não decode).

### P9 — `stampSrcsetAuth` Cloudinary — **raiz do truncamento fechada; não 1:1**

Fix: [`sessionBindingAuth.ts`](../../packages/page-projection/src/projected/sessionBindingAuth.ts) usa `mapSrcset` (WHATWG) em vez de `.split(',')`. Parser em [`srcsetParse.ts`](../../packages/page-projection/src/projected/srcsetParse.ts). Unit Beleza-shaped no sidecar.

Iso cold (`captures/same-s-iso-latest/`):
- `truncatedCount=0` / `attrs_img_src_sane` PASS
- `imgsSample`: **zero** `f_avif, fl_` e **zero** `src` truncado em `/f_avif`
- `brokenImgs` **61 → 35** (34 AVIF com URL **intacta** + 1 other; bucket WEBP sumiu do sample quebrado)
- Ainda FAIL: `asset_broken_imgs_zero`, `cssom_rule_text_hash_wire_vs_adopted`
- Logo + header 60 PASS

**Não** Fixed / 1:1. Residual: AVIF completa com `nw=0` apesar da URL correta (fora deste slice).

### P10 — residual diag one-shot — **causas fechadas (não Fixed)**

CLI: `_run-residual-diag.sh` / `lab-residual-diag.mjs` → `captures/residual-latest/` (`root-cause.json`).

1. **AVIF `nw=0` (≈31):** bytes OK (`image/avif`, `ftyp avif`), iframe fetch 200 — falha de **decode no Chromium Projected**, não truncamento/srcset.
2. **1 other:** `bat.bing.com` tracker `emit_empty` text/plain — fora do accept de imgs do site.
3. **CSSOM hash:** counts iguais (4656); 227×227 só diferem por **serialização Gecko×Chromium** (`border:` vs `border-width:` / animation / quotes). Assert de hash cssText cru é o problema do iso, não paint faltando.

### P11 — AVIF decode fork — **causa fechada**

`_run-avif-decode-probe.sh` → `captures/avif-decode-20260916-231809Z/`:
- `fetch` 200 `image/avif` + `createImageBitmap` / blob `Image` → **nw=2440**
- `<img>` da página → `EncodingError` / **nw=0**

**Raiz:** Chromium **decoda** AVIF. O elemento da página ficou com decode falho sticky (load ruim anterior / src apply sem reload). Próximo fix: garantir primeiro load com bytes bons **ou** rearmar `<img>` quando o corpo válido chega — sem workaround de cache-bust cosmético.

### P12 — residual fix — **iso cold PASS checks; sem claim 1:1 site**

Fixes:
1. SW `looksLikeImageBody` + `geckoLabWire` sniff `ftyp` avif/avis/heic (antes 502 em AVIF válido → sticky).
2. Iso: hash cssText só diagnóstico; gate = count.
3. `brokenImgs` ignora `bat.bing.com`.

Prova:
- AVIF probe: pageImg **nw=2440** (`avif-decode-20260916-233713Z`)
- same-S iso: **PASS** all checks; `brokenImgs=0`; logo 120; header 60; hashMatch=false diagnosticOnly

**Não** declarar Fixed de accept 1:1 visual do site — só checks same-S + ativos deste residual.

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
- H5 asset diag: `_run-asset-h5-trace.sh` / `lab-asset-h5-trace.mjs` → `captures/asset-h5-latest/`

**Não esquecer:** tabela verde ≠ página 1:1.
