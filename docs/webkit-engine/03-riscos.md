# Riscos, por camada e por peso

Camadas definidas em `00-foundation.md` §5: **C1** runtime WPE, **C2** input via libwpe,
**C3** produtor nativo.

Peso e' *calibrado*, nao alarmista. A secao final registra o que foi inflado numa primeira
passada e recalibrado — ler antes de tratar qualquer linha como bloqueio.

---

## Peso alto

### Ciclo de build (transversal) — bloqueia tudo
Build completo do WebKit e' medido em horas. Sem ccache, container de build e artefato
pre-buildado no CI, o ciclo de feedback vira dezenas de minutos. **Isso e' o que mata projeto de
fork — nao o codigo, o loop.** `scripts/build.sh` recusa rodar sem ccache por esse motivo.
Detalhe em `02-build.md`.

### A API publica forca o fork (C3) — fato, nao risco
O GObject DOM API (`WebKitDOMDocument`) foi removido **sem substituto** na migracao para
WebKitGTK/WPE 6.0. A orientacao oficial e' "use JavaScript". O que sobra no web process
extension (`WebKitWebProcessExtension`, entry `webkit_web_process_extension_initialize()`) e'
obter um contexto de JavaScriptCore. Logo: **produtor nativo exige linkar contra WebCore, que
nao e' API publica.** Nao ha atalho, nao ha versao "sem fork" de C3.

### CSSOM (C3)
Hoje `cssomPoller.ts` (358 linhas) **pollea** — gambiarra que existe porque nao ha API de
observacao. Nativo da o feed real, mas entra em cache de resolucao de estilo, sheets
compartilhadas entre documentos, `@import`, adopted/constructable stylesheets, cada um com ciclo
proprio. E o poll de hoje pode estar **mascarando bugs de ordenacao** que o feed real expoe.

**Nao e' bloqueante:** da pra continuar pollando em C3 v1. Nada piora.

### Emulacao de device (C1)
Viewport e device scale factor o WPE da limpos. O que **morre** e' o pacote do Chromium:
`Emulation.setDeviceMetricsOverride` tambem falsifica `screen.*`, capacidade de touch, UA-CH e
media features. `device-kits.ts` e `device-emulation.ts` sao **reimplementacao, nao mapeamento**.

---

## Peso medio

### Fronteira de shadow DOM de UA (C3)
Nativo se ve os shadow trees internos de `<input>`, `<video>`, `<details>`. Em JS essa fronteira
era de graca — JS nao ve UA shadow. Nativo e' regra explicita: **replicar shadow de autor, nunca
de UA.** Errar enche o cliente de no fantasma. `contextIdMint` e `domNodeTable` assumem a visao
JS da arvore. E' meia tarde de decisao de design, nao uma expedicao — mas tem que ser decidido
antes da primeira linha de C3.

### IME e composicao (C2)
O input-method do WPE e' fino comparado ao do Chromium. Teclado mobile, eventos de composicao,
autocorrecao. Vai ser preciso forwardar estado de composicao do cliente pra dentro do WPE;
`EditableFocus.ts` hoje se apoia em CDP.

### Manutencao do fork (transversal)
Os hooks vivem em internals sem garantia de estabilidade. **Mas o imposto e' agendavel, nao
continuo** — da pra sentar numa tag pinada indefinidamente. Politica em `01-fork.md`.

### Dois engines em producao (transversal)
`IBrowserSessionFactory` viabiliza a convivencia, mas todo oracle, probe e campo de telemetria
passa a ter que funcionar pros dois, e bug chega como "o Virtual" sem dizer qual. Orcar a
ambiguidade.

### Backend de view: dois caminhos coexistem (C1)
`HeadlessViewBackend` (API legada) e a plataforma headless do WPEPlatform sao **coisas
diferentes** e ambas existem na tag pinada. Escolher antes de escrever C1.

---

## Peso baixo / a verificar

### ITP e o `cf_clearance` (C1) — **verificar, nao assumir**
O Intelligent Tracking Prevention do WebKit particiona e purga storage de formas que o Chromium
nao. **Pode** afetar o round-trip `restoreState`/`exportState` e a persistencia do
`cf_clearance`. Foi afirmado sem evidencia numa primeira passada. Tratar como item de
verificacao em C1, com prefs de relaxamento como plano B — lembrando que relaxar ITP e', em si,
sinal de fingerprint.

### Compat de site (transversal)
Decisao tomada: nao perseguir edge case. O residuo que **nao** e' edge case: site que gateia por
User-Agent, e `canPlayType` / `MediaSource.isTypeSupported` usados pra escolher fonte ou pra
bloquear. Os dois sao mentira barata de contar no web process extension.

### Ferramenta de debug (C1)
Nao e' perda, e' troca: WebKit tem Web Inspector e o WPE expoe inspector remoto. Ainda assim,
investir em observabilidade em C1 **antes** de encostar em C3 e' o certo, porque C3 sem
diferencial verde e' indebugavel.

---

## Ganhos que valem registrar

- **Zero superficie de automacao.** Somos o embedder: nao existe Marionette, CDP nem
  `navigator.webdriver`. `ENABLE_WEBDRIVER=OFF` no build. Estritamente melhor que
  Chromium + patchright.
- **A extensao MV3 inteira morre**, e com ela `Extensions.loadUnpacked`,
  `--enable-unsafe-extension-debugging` e toda a saga do EP-13.
- **O fork pode mentir coerentemente.** Strings de renderer WebGL, enumeracao de fontes, stack
  de audio — em C++ na fonte, o que JS nao consegue. Isso torna Linux mais viavel do que a
  analise inicial dizia. Em troca, voce passa a *fabricar* um perfil de plataforma que precisa
  casar com uma populacao real de trafego.

---

## Recalibragem — o que foi inflado

Registrado porque a primeira passada superestimou C3 e isso distorce prioridade.

1. **"WebCore nao tem chokepoint de mutacao, vai ter que costurar hooks crus e vai furar."**
   Inflado. O WebKit **ja tem** a maquina de MutationObserver implementada em WebCore. O caminho
   e' **consumir essa maquina de C++**, nao reinventar observacao abaixo dela. Isso da
   exatamente as mesmas semanticas que o `virtual.js` tem hoje — mesma coalescencia, mesma
   entrega em checkpoint seguro, mesma ordem — e torna o teste diferencial quase trivial de
   passar, porque os dois produtores olham a mesma coisa.

2. **Caminho rapido do parser / ordenacao canonica na ABI.** Dissolve com (1): consumindo
   pos-coalescencia, a ordem e' a mesma de hoje.

3. **Re-entrancia e disciplina de thread.** Dissolve com (1): a entrega de MutationObserver ja
   acontece em ponto seguro. Continua valendo a regra de nao encodar inline (append em buffer +
   handoff), mas nao e' o campo minado descrito.

4. **"Perde DevTools".** Exagero, ver acima.

5. **ITP.** Rebaixado de "vai morder" para "verificar".

6. **"Mesmo engine do iPhone".** Meia-verdade. Layout e JS sim; **fisica de scroll e
   reconhecimento de gesto nao** — isso vive na camada UI iOS-especifica do WebKit, nao no core
   cross-platform que o WPE usa. Era o argumento mais forte a favor do WebKit e e' mais fraco do
   que foi vendido. C2 segue valendo pelo input que **nao** e' scroll (tap, drag, foco, IME) e
   por parar de interpretar intencao; scroll continua local-first por latencia, igual hoje.
