# WIP — PP touch no iOS: triagem para o Cursor

> **Temporário.** Nota de trabalho, não é spec. Apagar junto com o TEMP-DIAG quando
> `PP-SCROLL-AXIS` fechar para WebKit. Spec de verdade: `docs/page-projection/spec/open.md`
> e `docs/page-projection/PENDING.md` (P5).

## 1. O que foi relatado

Cliente **iPhone**, `mirrorMode: 'pageProjection'` (default — `web/src/features/sessions/live/sessionPreStart.ts:48`).
Dois sintomas, no mesmo gesto:

1. Scroll horizontal sequestra o vertical: swipe vertical iniciado sobre um carrossel
   horizontal não rola a página; o carrossel come o gesto.
2. Gesto de scroll acaba virando **click** no remoto.

Superfície envolvida:
- `packages/page-projection/src/projected/input/projectedInputCapture.ts`
- `packages/page-projection/src/projected/input/projectedNativeGuard.ts`

## 2. Estado do P5 — leia antes de qualquer coisa

`PP-SCROLL-AXIS` está marcado **RESOLVIDO** em `PENDING.md` P5 e em `spec/open.md`. **Esse
fechamento vale só para Chromium.** A prova é o probe CDP do lab
(`sidecar/lab-runs/2026-09-02T23-11-38-017Z-input-touch-scroll-axis/probes/touch-scroll-axis.json`),
que roda em Chrome. O caminho WebKit/iOS nunca foi medido.

O fix do P5 foi mover o cancelamento de ativação de link de `touchstart` para `touchend`
(commit `bf7c6db`). Isso resolve o recognizer do Blink. O WebKit tem outro. **Não trate o P5
como fechado em discussão de iPhone.**

## 3. Fato que já pode ser descartado

Scroll no Projected é **local-first e mão única**:
- `ScrollEchoGate.expect()` não é chamado em lugar nenhum do código.
- `projected/applyDom.ts` não escreve `scrollTop`/`scrollLeft`.

Ou seja: **não existe eco de scroll vindo do Virtual brigando com o gesto do dedo.** Não gaste
tempo nessa hipótese.

## 4. Hipóteses

### H2 — tap fantasma (maior confiança; ataque esta primeiro)

O discriminador tap × scroll é `TOUCH_TAP_SLOP_PX = 8` sobre o `deferredTouch`. Ele só é
descartado por três caminhos, e os três falham no iOS:

1. **`onPointerMove`** — é o único que descarta por movimento, e lê `pointermove`. O iOS **para
   de entregar `pointermove`** assim que o pan nativo assume o gesto (o scroll roda fora da main
   thread; o WebKit manda `pointercancel`, ou nada). Sem `pointermove`, o teste de slop degrada
   para **só ponto final**: compara `pointerup` contra `pointerdown` e ignora o caminho
   percorrido. Um gesto que vai e volta passa como tap.
2. **`onScroll`** — descarta, mas **depois** de dois `return` antecipados:
   `if (rangeY === 0 && rangeX === 0) return;` e `if (opts.consumeScrollEcho?.(...)) { ...; return; }`.
   Scroll que cai em qualquer um deles nunca cancela o tap pendente. Isso é bug puro,
   independente de plataforma.
3. **`onPointerCancel`** — não dispara no caso mais comum.

E o caso mais comum não está modelado em lugar nenhum: **no iOS o primeiro toque depois de um
flick só freia a inércia e não ativa nada.** Aqui esse toque tem deslocamento ~0, cai no
`emitDeferredTouchTap()` e vira `down`+`up` no remoto. É o click no gesto de scroll.

Detalhe de apoio: `TOUCH_TAP_SLOP_PX = 8` é mais apertado que o slop do próprio iOS (~10pt) e
não há limite de tempo para o tap.

### H1 — sequestro de eixo (duas causas possíveis, mutuamente exclusivas)

**H1a — a réplica perdeu a superfície de gesto do original.** `installProjectedTouchSurface`
(`projectedNativeGuard.ts`) escreve `touch-action: manipulation` em `<html>` e `<body>` do
documento projetado. Se o original restringia um eixo ali (`pan-y`, `pan-x`, `none`), essa
escrita **mascara** a restrição. Vale também para os scrollers internos: se o `touch-action`
que o site definia por CSS não chegou na réplica, quem escolhe o latch é a engine, não o site.

**H1b — estrutural, e sem conserto no cliente.** K5/CSP mata **todo JS de página** no Projected
(`PROJECTED_K5_CSP = "script-src 'none'"`). Carrossel cujo axis-lock vem de script (Swiper,
Splide, `touchstart` com `preventDefault`, direction lock em JS) vira um `overflow-x: auto`
pelado na réplica. O WebKit, diferente do Blink, **não faz scroll chaining para fora** depois
que o scroller aninhado latcha o gesto. Se for isso, nenhum ajuste em `projectedInputCapture`
resolve — a saída é sintetizar `touch-action: pan-y` nos scrollers horizontais da réplica, ou
replicar o `touch-action` computado do original.

**O probe de paridade separa H1a de H1b.** Divergência → H1a. `PARITY` → H1b (ou engine).

### O que WebKit desktop NÃO resolve

Não perca tempo tentando reproduzir em WebKit de desktop. O build do Playwright é WebCore +
porte GTK/WinCairo: dá semântica de engine, mas momentum, tap-para-frear e a supressão de
`pointermove` durante o pan são **UIKit/UIScrollView**, não WebCore. Além disso o Playwright só
injeta `touchscreen.tap()` (não existe API de swipe) e evento sintético via `dispatchEvent`
nunca dispara scroll nativo. O binário WebKit também não baixa no bridge (allowlist de egress).

## 5. Instrumentos já prontos (não precisa criar nada)

### 5.1 TEMP-DIAG — mede a parte iOS-only

Em `projectedInputCapture.ts`, bloco marcado `TEMP-DIAG`. Emite **um registro por gesto**
(`phase: 'gesture'`), tanto em `touchend` quanto em `touchcancel`:

| campo | para que serve |
|---|---|
| `pointerMoves` × `touchMoves` | `pointerMoves ≈ 0` com `touchMoves` alto **prova** H2 |
| `maxDist` × `endDist` | caminho percorrido vs deslocamento final; `endDist` é o que o slop compara hoje |
| `tapEmitted` | se aquele gesto virou `down`+`up`. É o click fantasma, medido |
| `pointerCancelled` | se o `pointercancel` chegou a salvar |
| `msSincePrevScroll` | ms do último scroll até o `touchstart`. Valor baixo + `tapEmitted` = tap-de-freio |
| `scrolled` | `{ "DIV.carousel": {dLeft, dTop} }` — qual elemento comeu o gesto e em que eixo. É a medida de H1 |
| `capture` | `A(on)` ou `B(off)` — qual build rodou |

Leitura: HUD do lab → "Copiar diagnóstico" (`diagDump()`, em
`sidecar/browser/mirror/projection/lab/client/scrollDiagHost.ts`).

### 5.2 `probe.touchFlingTap` — reproduz H2 sem aparelho

`sidecar/browser/mirror/projection/lab/probes/touchFlingTap.ts`
Blueprint `input-touch-fling-tap` · `npm run lab:touch-fling-tap`

Usa `Input.synthesizeScrollGesture` com `preventFling: false` — fling real pelo pipeline de
input do Blink. Detecta a inércia amostrando o scroll **depois** que o gesto retornou (viagem
residual = fling, não dedo), dá o tap enquanto ela corre, e mede o delta de `down`/`up` em
`chassis.journal.intents`. Quatro células: P (Projected) e C (control) × `G-IDLE-TAP` e
`G-FLING-TAP`.

`G-IDLE-TAP` roda primeiro **de propósito**: é a guarda contra instrumento morto. Se um tap
comum não emitir intent, a célula de fling limpa não prova nada — o veredito sai `VOID` com
`idle_tap_no_intent`, não `pass`. Mesma coisa para `no_fling_observed_projected`.

### 5.3 `probe.touchSurfaceParity` — separa H1a de H1b, sem gesto nenhum

`sidecar/browser/mirror/projection/lab/probes/touchSurfaceParity.ts`
Blueprint `input-touch-surface-parity` · `npm run lab:touch-surface-parity`

Lê `touch-action`, `overflow-x/y`, `overscroll-behavior-x/y` computados e as faixas de scroll
(`scrollWidth − clientWidth`) nos mesmos seletores dos dois lados, com o control forçado ao
mesmo box do `#surfaceHost` (faixa de scroll medida em viewport diferente não significa nada).

Sobre o veredito `ROOT_WRITE_MASKS`: a escrita do `installProjectedTouchSurface` no root é
deliberada, então divergência ali seria ruído permanente — mas **isentar o root seria
enfraquecer o assert**, o que a constituição proíbe. O probe asserta o que importa: a escrita
só é inócua se o root do original já era `auto` ou `manipulation` (ambos liberam pan nos dois
eixos). Se restringia um eixo, é fail.

Ambos reusam `fixtures/touch-scroll-axis.html` — o carrossel dele já é a assinatura NAV.zyqj8m.

## 6. Execução

### 6.1 Probes no lab (Windows — sem iPhone)

```
cd sidecar
npm run lab:touch-surface-parity
npm run lab:touch-fling-tap
```

Os dois `npm run lab:*` já encadeiam o build inteiro. **`build:lab-client` só roda no Windows**
— o `node_modules` do sidecar tem esbuild win32.

### 6.2 A/B no iPhone

```
cd sidecar
npm run build:lab-client
set SPECULUM_LAB_HOST=0.0.0.0 && npm run lab:projection
```

O lab liga em `127.0.0.1` por padrão (`sidecar/scripts/lab-ports.js`) — daí o `0.0.0.0` para o
aparelho alcançar pela LAN.

No iPhone, **quatro gestos rotulados** (setar `__SCROLL_DIAG_LABEL`), em cada build:

| build | como |
|---|---|
| A | URL normal |
| B | `?touchCapture=off` |

| rótulo | gesto |
|---|---|
| `g-vert-on-carousel` | swipe **vertical** começando em cima do carrossel |
| `g-horiz-carousel` | swipe **horizontal** no carrossel |
| `g-flick` | flick vertical curto e rápido |
| `g-arrest` | flick e, durante a inércia, **um tap para frear** |

Depois: "Copiar diagnóstico".

## 7. Tabela de decisão

| Evidência | Conclusão | Ação |
|---|---|---|
| `probe.touchFlingTap` = `ARREST_TAP_EMITS` | H2 confirmada, sem aparelho | Consertar (§8) com teste de regressão já pronto |
| `probe.touchFlingTap` = `ARREST_TAP_CLEAN` | Blink não reproduz | H2 volta a depender do iPhone: olhar `tapEmitted` no gesto `g-arrest` |
| `probe.touchFlingTap` = `VOID` | Instrumento ou fling falhou | Ler `voidReasons` antes de qualquer conclusão. **Não é pass.** |
| iPhone: `pointerMoves ≈ 0` e `touchMoves` alto | H2 confirmada na causa raiz | O slop precisa sair do `pointermove` |
| iPhone: `tapEmitted: true` com `msSincePrevScroll < ~400` | Tap-de-freio virando click | Guarda de momentum |
| `probe.touchSurfaceParity` ≠ `PARITY` | H1a — a réplica perdeu a superfície | Corrigir a replicação de `touch-action`/overflow |
| `probe.touchSurfaceParity` = `PARITY` | H1b ou engine | Réplica inocentada; ver §8 (item 4) |
| A/B muda o `scrolled` no iPhone | `preventDefault` no `pointerdown` quebra o pan no WebKit | Tirar o `preventDefault` do caminho de toque |
| A/B não muda o `scrolled` | Não é o capture | H1b |

## 8. Conserto adotado (H2 — click como gatilho de tap)

**Status:** implementado em `projectedInputCapture.ts`. WebKit/iPhone ainda precisa do gesto
`g-arrest` (§6.2) antes de fechar `open.md` / PENDING.

### Design

- **Tap touch (não-link):** o browser classifica o gesto e dispara `click` → `onClick` emite
  `down`+`up`. K5/CSP impede `el.click()` forjado na superfície Projected.
- **Mouse:** inalterado — `pointerdown`/`pointerup`.
- **Links (`<a href>`):** o `projectedNativeGuard` faz `preventDefault` no `touchend` para
  bloquear navegação local, o que **impede a síntese de `click`**. Fallback: `touchend` em
  captura **antes** do guard — emite `down`+`up` só quando o gesto não scrollou e passou no
  slop. `touchstart`/`touchmove` rastreiam o gesto (CDP/lab nem sempre disparam `pointerdown`).
- **Removido:** `deferredTouch`, `TOUCH_TAP_SLOP_PX` global, capture/`preventDefault` no
  `pointerdown` de touch, gate `?touchCapture=off`.

### Probes Chromium (2026-09-05, pós-fix)

| Probe | Antes | Depois |
|---|---|---|
| `lab:touch-scroll-axis` | não rodado | **FIXED** (G5 hash ok, G6 sem click) |
| `lab:touch-fling-tap` | VOID (`no_fling_observed_projected`) | **VOID** (mesmo — fling não observado no P; G-IDLE-TAP dn=1 ✓) |
| `lab:touch-surface-parity` | DIVERGENT_SCROLL_RANGE | **DIVERGENT_SCROLL_RANGE** (inalterado — H1a) |
| `smoke:projection-lab` | não rodado | **timeout** — host escuta 4077 fixo; smoke espera 4099 (pré-existente) |

### Plano B (só se iPhone provar que falta)

Itens 1–3 abaixo eram candidatos **antes** do fix por click. Ficam como fallback, não aplicados:

1. ~~Slop por caminho via `touchmove`~~ — substituído pelo recognizer nativo + fallback navigable.
2. ~~Mover `discardDeferredTouch()` no `onScroll`~~ — **removido** com `deferredTouch`.
3. ~~Guarda de momentum (~400 ms)~~ — não entrou no path de `click`; no fallback navigable
   a guarda bloqueava taps legítimos após `resetScrollers` do lab (~100 ms).
4. **Se `PARITY` + A/B limpo (H1b):** sintetizar `touch-action: pan-y` nos scrollers horizontais
   da réplica — decisão de design, não no capture.

Em `projectedNativeGuard.ts`:

5. **Só se o A/B apontar para lá:** o `preventDefault()` no `pointerdown` de link — o path de
   capture touch foi removido; `?touchCapture=off` perdeu efeito (build B = build A no TEMP-DIAG).

## 9. Regras da casa que valem aqui

- **Sem código ad-hoc / workaround.** Se o algoritmo falha, conserte o algoritmo.
  (`AGENTS.md`, `docs/engineering-standards.md`)
- **Effect assert, não smoke.** `VOID` com razão é resultado honesto; `pass` sem efeito medido
  não é. Nunca enfraquecer assert para ficar verde (`docs/assert-failure-policy.md`).
- Propriedade JSON ausente **falha** — nada de skip-if-absent.
- Ao fechar: atualizar `spec/open.md` (PP-SCROLL-AXIS) e `PENDING.md` (P5) dizendo
  explicitamente **em qual engine** fechou, e apagar TEMP-DIAG + esta nota.

## 10. Coleta no aparelho (Eneba real) — instrumento de 2026-09-05

Substitui o A/B da seção 6.2 como caminho principal. Alvo: **site real**, não fixture.
A fixture não tem JS, então ela nunca pôde responder nada sobre carrossel movido por JS —
`touch-surface-parity` rodou contra ela e por isso não conclui nada sobre a Eneba.

### O que é coletado, por gesto

O TEMP-DIAG emite um registro por gesto (`phase: 'gesture'`, em `touchend` e `touchcancel`):

| campo | decide |
|---|---|
| `chain` | do elemento sob o dedo até `<html>`: `touch-action`, `overflow-x/y`, `overscroll-x/y`, `rangeX`, `rangeY` por nível. **Diz quais caixas podiam latchar o pan e com que política.** |
| `scrolled` | qual elemento de fato rolou, e em que eixo (`dLeft`/`dTop`). **Diz qual latchou.** |
| `viewport` | `clientW/H`, `innerW/H`, `visualViewport`, `dpr`, e o `getViewportSize()` da sessão. Mede a divergência de viewport direto, sem inferir. |
| `pointerMoves` × `touchMoves` | se o iOS parou de entregar `pointermove` durante o pan (H2) |
| `maxDist` × `endDist` | caminho vs deslocamento final |
| `tapEmitted` | se o gesto virou `down`+`up` no remoto (click fantasma) |
| `msSincePrevScroll` | tap-para-frear inércia |
| `durationMs`, `pointerCancelled`, `capture`, `docUrl`, `label` | contexto |

### Como sai do aparelho

Não usa console nem clipboard. O cliente do lab dá `POST /lab/diag/gesture` a cada 2 s com o
que ainda não subiu, e o host anexa em `sidecar/lab-runs/gesture-diag/<sessionId>.ndjson`
(uma linha por gesto). O botão "Copiar diagnóstico" também força um flush.
`?diagLabel=<rótulo>` na URL do lab carimba os gestos seguintes — é como rotular sem teclado.

### Roteiro

1. Windows: `cd sidecar && npm run build:lab-client` (esbuild é win32; não roda no bridge).
2. `set SPECULUM_LAB_HOST=0.0.0.0` e `npm run lab:projection`.
3. iPhone: abrir `http://<ip-do-pc>:4077/?diagLabel=g-vert-carousel` → aba **Browse** →
   **Connect** → URL já vem `https://www.eneba.com` → **Start Virtual**.
4. Rolar até um carrossel horizontal e fazer o gesto do rótulo. Um rótulo por vez, trocando
   `?diagLabel=` e recarregando: `g-vert-carousel`, `g-horiz-carousel`, `g-flick`, `g-arrest`.
5. Ler `sidecar/lab-runs/gesture-diag/*.ndjson` no PC.

### Como ler

- `scrolled` mostra um scroller interno com `dLeft != 0` e o `scrollingElement` com `dTop == 0`
  num gesto vertical → sequestro reproduzido. O `chain` daquele elemento diz por quê.
- `viewport.clientH` diferente de `viewport.surfaceH` → divergência de viewport, que é o
  candidato para os 12–14 px do `pp-input-oracle`.
- `tapEmitted: true` com `scrolled` não vazio, ou com `msSincePrevScroll` baixo → click fantasma.

Para comparar com o original, abrir `https://www.eneba.com` direto no Safari do iPhone e repetir
o gesto. Sem esse par, "diverge do original" é suposição.
