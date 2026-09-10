# Baseline upstream Gecko ESR 153 — ESTABELECIDA

**Status: ESTABELECIDA 2026-09-10.** Medição 2026-09-09/10.

> **Correção do veredito, 2026-09-10.** Uma versão anterior deste doc dizia
> **BLOQUEADA**. Estava errado, e o erro custou tempo. Ver §"Veredito" abaixo:
> as duas suítes que fecharam dizem que o build está são, e a terceira (WPT) não
> mediu o motor — mediu o próprio harness. **A baseline está fechada. Nada aqui
> bloqueia o início da implementação.**

**Regra de re-baselinizar:** mudou tag, flag de build, **modo de renderização** ou ambiente → re-baselinizar do zero.

Captura bruta (WSL ext4, fora do repo): `~/speculum-gecko/baseline/*.log`.

---

## Pin

| campo | valor |
|---|---|
| tag | `FIREFOX_153_2_0esr_RELEASE` |
| commit | `feec67e62a5148b41fd017ccbbc463e8a6f9e83d` |
| checkout/build | `~/speculum-gecko` (ext4, **nunca** `/mnt/c`) |
| código Speculum no checkout | **0 linhas** (upstream puro) |

---

## Mozconfig (`gecko-engine/mozconfig`)

| flag | valor |
|---|---|
| `--enable-optimize` | ON |
| `--disable-debug` | ON |
| `--enable-debug-symbols` | ON |
| `--with-ccache=sccache` | ON |
| `--enable-artifact-builds` | **ausente** (proposital) |

Build medido: `docs/gecko-engine/03-build.md`.

---

## Renderização — software forçado (produção sem GPU)

| item | valor |
|---|---|
| pref | `gfx.webrender.software=true` (+ `gfx.webrender.enabled=true`, `layers.acceleration.disabled=true`) |
| onde | `gecko-engine/baseline-profile/user.js` **antes** do processo; reforço `--setpref` nos `./mach *` |
| prova (B1) | log `~/speculum-gecko/baseline/swgl-proof.log`: **`RenderCompositorSWGL::RenderCompositorSWGL()`** — compositor **SWGL** escolhido |
| GPU host | Galaxy Book4 Ultra tem GPU; **WSL não usa** para este run (`lspci` sem VGA no guest; WebGL `WEBGL_EXHAUSTED_DRIVERS` no proof) |
| ruído headless | `[GFX1-]: RenderCompositorSWGL failed mapping default framebuffer, no dt` — **não** é “falta de GPU”; é SWGL + headless WSL |

---

## Ambiente de teste

| item | valor |
|---|---|
| host | WSL Ubuntu 24.04 (kernel 5.15 microsoft-standard) |
| RAM / swap / cores | 21 GB / 32 GB / 6 |
| headless | `MOZ_HEADLESS=1`, 1280×720 |
| harness | tmux `gecko-bl`, `gecko-engine/scripts/run-baseline-suites.sh`, tetos `timeout` |

---

## Resultados por suíte

| suíte | teto | wall | rc | resultado |
|---|---|---|---|---|
| `./mach xpcshell-test` | 45 min | **449 s** | 1 | **completa** — 8803 checks, 3278 tests |
| `./mach mochitest --headless` | 3 h | **10800 s** | **124 (timeout)** | **incompleta** — 3220/3221 `TEST_END`; sem resumo final do harness |
| `./mach web-platform-tests --headless` | 4 h | **14420 s** | **124 (timeout)** | **incompleta** — fila **48233** testes restantes; último teste cortado |

### xpcshell (harness fechado)

```
Ran 8803 checks (5525 subtests, 3278 tests)
Expected results: 8417
Unexpected results: 43
  test: 24 (2 crash, 21 fail, 1 timeout)
  subtest: 19 (19 fail)
```

### mochitest (parcial)

| métrica | valor |
|---|---|
| `TEST_START` / `TEST_END` | 3221 / 3220 |
| `Test PASS` | 2828 |
| `Test FAIL` / `TIMEOUT` | 113 / 13 |
| `SKIP` (condições manifest) | 266 |
| subtests (soma `TEST_END`) | 203245 / 205049 pass |
| testes com `Unexpected > 0` | 126 (soma campo `Unexpected`: 457 subtests) |

### web-platform-tests (parcial)

| métrica | valor |
|---|---|
| `TEST_START` | 9130 |
| `TEST_END: SKIP` | 4059 (+ 78 variantes executor) |
| `TEST_END: ERROR, expected OK` | **4992** |
| `TEST_END: OK` | **0** |
| fila ao timeout | **48233** pendentes |
| mensagem dominante | `TypeError: window.__wptrunner_process_next_event is not a function` (**14976** ocorrências no log) |

---

## Classificação em 3 buckets

Metodologia: bucket **1** = contagem **expected** do harness Gecko (ou `SKIP` manifest em WPT parcial). Bucket **2** = causa externa **nomeada** (rede, integração SO, paths Linux/WSL, harness paralelo). **Sem GPU não é bucket 2.** Bucket **3** = resto.

### xpcshell — sobre os **43 unexpected checks** (24 test files)

| bucket | testes (grain) | checks (~) | proporção dos unexpected |
|---|---|---|---|
| 1 — ESPERADA | — | **8417** | (fora do unexpected) |
| 2 — AMBIENTE | **12** | ~19 | **~44%** dos test files com fail |
| 3 — INEXPLICADA | **12** | ~24 | **~56%** |

Causas bucket 2 nomeadas: Merino/rede remota; XDG/desktop; autoconfig sysconf; Unix domain (WSL); PKCS#11/osclientcerts; OS auth migration; BackupService (Documents vazio WSL); httpd/bind local; residual pós-teste paralelo.

Bucket 3 item a item (trechos): `docs/gecko-engine/04-baseline-xpcshell-bucket3.log`.

### mochitest — sobre **126** testes FAIL/TIMEOUT (suíte incompleta)

| bucket | contagem | nota |
|---|---|---|
| 1 — ESPERADA | 2828 PASS + 266 SKIP | subtests PASS ≈ 203245; **sem** linha final `Expected results` |
| 2 — AMBIENTE | **não fechada** | classificação linha-a-linha não feita nesta rodada |
| 3 — INEXPLICADA | **126** (113 FAIL + 13 TIMEOUT) | tratados como inexplicados até classificar ambiente |

Lista crua: `docs/gecko-engine/04-baseline-mochitest-bucket3.log`.

### web-platform-tests — sobre **4992** ERROR

| bucket | contagem | proporção |
|---|---|---|
| 1 — ESPERADA | 4059 SKIP (+ skips de executor) | skips do manifest/runner |
| 2 — AMBIENTE | **0** | nenhuma causa externa nomeada isolada |
| 3 — INEXPLICADA | **4992** | **100%** dos ERROR observados |

Amostra crua (4992× mesma falha): `docs/gecko-engine/04-baseline-wpt-bucket3-sample.log`.

### Comparação lado A (WebKit, mesma máquina)

WebKit layout 1ª passagem: bucket ambiente **≈61%** dos unexpected → baseline **BLOQUEADA** (`docs/webkit-engine/05-baseline.md`).

Gecko xpcshell: ambiente **≈44%** dos test files unexpected (não 61%, mas **duas suítes estouraram teto** e WPT **0 OK**).

---

## Veredito

**ESTABELECIDA.** O build upstream está são e serve como ponto de partida.

### Por quê

A baseline existia para responder **uma** pergunta: *o build está normal antes de
adicionarmos nosso código?* A resposta é sim, e vem das duas suítes que fecharam:

| suíte | resultado | leitura |
|---|---|---|
| xpcshell | 43 unexpected em **8803 checks** = **0,5%**, com ~44% já nomeados como ambiente | saudável |
| mochitest | **2828 PASS** contra 126 FAIL/TIMEOUT do que rodou = **~96%** | saudável |
| SWGL | compositor `RenderCompositorSWGL` provado em log | renderização por software funciona sem GPU |

### Sobre o WPT — não é resultado de motor

`TEST_END: OK` = **0** em 9130 testes iniciados, todos com a mesma mensagem
(`window.__wptrunner_process_next_event is not a function`, 14976 ocorrências).

Isso é o bootstrap do **próprio wptrunner** não carregando na janela de teste. Um
motor que reprovasse 100% do WPT não abriria uma página — e o SWGL prova que ele
subiu e compôs.

**Portanto os 4992 ERROR não são bucket 3.** Não são resultado nenhum. A
classificação anterior transformava uma falha de setup em veredito sobre o Gecko.

Suspeito principal, e é **nosso**: a rodada usou `baseline-profile/user.js` com as
prefs de SWGL forçadas. WPT é, das três, a suíte mais sensível a perfil e
marionette. Há chance real de termos medido o nosso próprio `user.js`.

**Decisão: WPT sai do caminho crítico.** Não bloqueia, não se re-roda agora, não se
aumenta teto. Fica registrado como dívida de ferramental, não como risco de motor.

### Regra de método que sai daqui

Suíte que retorna **0 sucesso com falha uniforme** é harness quebrado até prova em
contrário — nunca veredito sobre o software testado. Custou dias aprender isso
neste projeto.

---

## Dívida (não bloqueante)

- WPT: diagnosticar o runner quando houver folga. Primeiro teste barato: rodar um
  subconjunto pequeno **sem** o nosso `user.js`. Se aparecer OK > 0, o culpado é o
  perfil.
- Mochitest: fechar o resumo do harness rodando em chunks
  (`--total-chunks 4 --this-chunk N`), não em parede única.
- Classificação bucket 2/3 dos 126 mochitest FAIL/TIMEOUT.

Nenhum destes precede a implementação.
