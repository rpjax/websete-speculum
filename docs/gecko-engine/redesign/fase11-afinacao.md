# Fase 11 — Medição local para achar gargalo

**Status:** entregue. Limiares estruturais declarados **antes** da corrida. Medição na
máquina local (w7s / gecko-binary).

**Para quê:** achar gargalo crítico durante o desenvolvimento (ex.: O(N) em
`onChildList` / `prevSibling`). Performance **não** é condição de aceite do projeto —
esta fase não certifica SLO nem hardware alvo.

**Regra:**
- **Portão** = invariantes estruturais (algoritmo; independem de máquina):
  `SiblingScanMeter`, ausência de varredura de irmãos, `R_flat`, `R_table` (e formatos de
  streams). Limiar fora = achado; não se mexe no limiar para ficar verde.
- **Sinal** = absolutos (ms, µs, MB) e os três knobs/STR_DEF via `baseline.json` +
  `assert-phase11-signal.sh` — **nunca reprovação** do `ci:all`.

---

## 1. Limiares estruturais (declarados)

| id | razão | limiar | o que prova |
|----|-------|--------|-------------|
| `R_flat` | `us_per_op(K1600) / us_per_op(K100)` | **≤ 2.0** | custo/op plano com o lote |
| `R_table` | `cost(same_M, T_large) / cost(same_M, T_small)` | **≤ 1.5** | custo acompanha mutação |
| `R_scratch` | `scratch_peak / scratch_median` sob rajada | **≤ 8.0** | alocação sem explosão |
| `R_vocab` | `(bytes_no_intern - bytes_with_proxy) / bytes_no_intern` no fixture markup | **≥ 0.15** → ship; abaixo → defer | decisão STR_DEF |

Espelho: [`thresholds.json`](../../../gecko-engine/tests/phase11/thresholds.json).

---

## 2. Relatório + baseline de sinal

- Relatório: `tests/phase11/reports/<stamp>-phase11.json` + `latest.json`
- Baseline de sinal: [`baseline.json`](../../../gecko-engine/tests/phase11/baseline.json)
  (cadência, scratch, streams, `interning.decision`) — drift = **sinal registrado**, não
  falha o portão
- Absolutos impressos como `SIGNAL … (not a gate)`

`bash scripts/ci/run-phase11.sh` (razões estruturais + probes + signal).

---

## 3. Defaults (com justificativa)

| knob | valor | método |
|------|-------|--------|
| `kPatchClockIntervalMs` | **16** | menor intervalo com `R_flat` + coalescência |
| `kScratchCapacityBytes` | **262144** | ≥ pico same-run + margem; assert se estourar |
| `kMaxConcurrentAssetStreams` | **32** | 5×2 docs + kill + reject limpo |

---

## 4. Interning (`STR_DEF`)

Fixture realista: [`fixtures/markup-vocab.json`](../../../gecko-engine/tests/phase11/fixtures/markup-vocab.json)
(tags/attrs/classes de shell loja/notícias, across frames — não contadores).

Decisão na mesma corrida vs limiar `R_vocab_ship_min` (declarado antes):
**`ship_str_def`** se ≥ limiar; senão **`defer`** com o limiar intacto. Fio **não** ligado
(`wireShipped: false`).
