# WebKit Engine — Fundação do port

Branch: `feat/webkit-engine` (base: HEAD de `diag/scroll-axis-temp`, 22 commits à frente de `origin/main`).

Status: **fundação**. Nada de código de engine ainda. Este doc define o recorte, a ABI que o
port tem que honrar, e o que está decidido vs aberto. Ler antes de escrever qualquer linha.

---

## 1. Decisão

Trocar o engine do Virtual de Chromium/CDP para WebKit, e mover o **produtor de frames**
de JavaScript-na-página para código nativo dentro do renderer.

Motivos, em ordem de peso:

1. **Injeção de input nativa.** Em WPE o embedder relaia eventos de input via `libwpe`
   direto para os input-methods internos do WebKit. Não há protocolo, não há IPC por evento.
   O `projectedInputCapture` deixa de interpretar intenção e vira transporte.
2. **O produtor sai do mundo JS da página.** Hoje `virtual.js` roda no mundo MAIN e patcheia
   `attachShadow`, `setAttribute`, `appendChild`. Isso é a superfície mais detectável do motor
   inteiro. Nativo, a detecção morre *e* a necessidade do patch morre.
3. **WPE foi desenhado pra ser embedado.** Viewport, DPR e ciclo de vida da view são API
   principal, não workaround.

O que isso **não** resolve: divergência de layout entre Virtual e cliente. O cliente renderiza
HTML no engine dele. Trocar o Virtual pra WebKit não casa com cliente Chrome — só muda de
quem diverge. Isso não é objetivo deste port.

---

## 2. Onde o motor já é agnóstico

O repo já está bem cortado. O port é menor do que parece.

| Camada | Caminho | LOC | Destino |
|---|---|---|---|
| **Contrato de sessão** | `sidecar/browser/contracts/index.ts` | 319 | **sobrevive intacto** |
| **ABI de frame / tabela replicada** | `packages/page-projection/src/core/` | ~5.075 | **sobrevive intacto** |
| **Consumidor (cliente projetado)** | `packages/page-projection/src/projected/` | ~5.248 | **sobrevive intacto** |
| **Produtor (Virtual)** | `packages/page-projection/src/virtual/` | ~8.298 | **reescrito nativo** |
| **Runtime Chromium** | `sidecar/browser/patchright/` | — | substituído por runtime WebKit |
| **Extensão MV3** | `sidecar/extensions/speculum-pp/` | — | **morre** |

`IBrowserSessionFactory` em `contracts/index.ts` é a costura. Hoje tem uma implementação
(`createPatchrightFactory.ts`). O port adiciona uma segunda. Os dois modos convivem no mesmo
binário durante toda a transição — não existe big-bang.

### O que da extensão morre e por quê

- `main/virtual.js` → produtor nativo
- `main/csp-neutralize.js` → resource load delegate do WebKitWebContext
- `main/single-tab.js` → o embedder simplesmente não cria view nova
- `main/webgl.js` → hook no web process extension
- `main/runtime-bridge.js` / `main/plane-shim.js` → canal nativo embedder↔sidecar
- `background.js` / `content-isolated.js` → não existem no modelo

Com isso vão junto: `Extensions.loadUnpacked`, `--enable-unsafe-extension-debugging`,
`ignoreDefaultArgs: ['--disable-extensions']` e toda a saga do EP-13.

---

## 3. A ABI — já está selada, não reabrir

O produtor nativo não inventa protocolo. Ele emite **exatamente** o que o cliente já decodifica.

Fonte de verdade: `docs/page-projection/spec/frame-protocol.md`.

- `packages/page-projection/src/core/opcodes.ts` — ISA selada em 2026-08-20.
  Valores são wire-stable: **nunca renumerar, só apender em faixa reservada.**
  `Check=0x01`, `NodeNew=0x20`, `NodeDrop=0x21`, `Insert=0x40`, `Remove=0x41`,
  `AttrSet=0x60`, `AttrDel=0x61`, `TextSet=0x62`, `PropSet=0x63`,
  `SheetNew=0xa0` … `RuleSet=0xa5`.
- `packages/page-projection/src/core/frame.ts` — `FRAME_WIRE_VERSION = 2`,
  `FRAME_PREFIX_BYTES = 28` (magic u16, version u8, flags u8, contextId u32, generation u32,
  sequence u32, partIndex u16, partCount u16, preTableHash u64).
- `DOCUMENT_ID = 1`, `CONTEXT_ID_ROOT = 1`, `INSERT_AT_END = 0`.
- `NodeKind`: Element=1, Text=2, Comment=3, Sheet=4, Rule=5, Doctype=6, ShadowRoot=7.

**Critério de aceite do port, em uma frase:** o produtor nativo emite um stream de frames
byte-compatível com o que `virtual/frame/binaryFrameEncoder.ts` emite hoje, e o
`projected/` aplica sem uma linha de mudança.

Isso dá teste diferencial de graça: mesma página, produtor JS vs produtor nativo, comparar
frames. Se divergir, é bug do port, não ambiguidade de spec.

---

## 4. Fato duro que define a arquitetura do produtor

**A API pública de WebKitGTK/WPE não te dá DOM nativo.**

O GObject DOM API (`WebKitDOMDocument`) foi **removido sem substituto** na migração para
WebKitGTK 6.0. A orientação oficial é "use JavaScript". O que sobrou no web process
extension é obter um contexto de JavaScriptCore — ou seja, chamar bindings de JS a partir de C.

Consequência direta:

- **Produtor nativo de verdade = fork do WebKit**, linkando contra WebCore.
  WebCore não é API pública. Não tem atalho.
- O web process extension (`WebKitWebProcessExtension`, entry point
  `webkit_web_process_extension_initialize()`) continua sendo o veículo de injeção — mas o
  código dentro dele só alcança DOM nativo se a árvore for a nossa.

WebCore não tem um registro de observador de mutação equivalente ao `nsIMutationObserver` do
Gecko. O produtor vai costurar hooks internos (`ContainerNode::childrenChanged`,
`Element::attributeChanged`, caminhos de CSSOM). Em troca, a árvore do WebKit é
significativamente menor que a do Chromium e o rebase contra upstream é mais barato.

---

## 5. As três camadas do port

Independentes. Podem ser atacadas fora de ordem e por pessoas diferentes.

**C1 — Runtime WebKit (sem produtor).**
Implementar `IBrowserSessionFactory` sobre WPE: launch, navigate, resize, viewport/DPR,
cookies (`restoreState`/`exportState`), permissões, `evaluate`. Produtor ainda é o
`virtual.js` atual, injetado como user script. Objetivo: **paridade funcional com o
Chromium em `mirrorMode: 'pageProjection'`, com o produtor antigo.** Isso valida runtime
sem tocar em produtor.

**C2 — Input nativo.**
Substituir o caminho CDP por injeção via `libwpe`. Aqui mora o ganho de performance e o
fim da interpretação de gesto no cliente. Independente de C1 estar 100%.

**C3 — Produtor nativo.**
Fork do WebKit, produtor em C++ dentro do renderer, emitindo a ABI da §3. Só começa depois
de C1 dar sinal verde, porque antes disso não existe baseline pra comparar frames.

Ordem recomendada: **C1 → C2 → C3.** C1 é o que descobre se o resto é viável.

---

## 6. Decisões abertas

Nenhuma bloqueia C1. Todas bloqueiam produção.

1. **macOS ou Linux?** WebKit só existe comercialmente em macOS/iOS. WPE em Linux emite
   JavaScriptCore + Mesa/llvmpipe + fontconfig + stack de áudio do Linux. "Safari em Linux"
   não é uma população real de tráfego — é combinação única, e único é score no chão pro
   antibot. Rodar em Apple resolve e muda a economia da infra. **Decisão do Vinicius.**
2. **WPE ou WebKitGTK?** WPE é o caminho de embedding puro (headless via WPEBackend-FDO
   off-screen SHM). WebKitGTK arrasta GTK. Default: WPE.
3. **Fork a partir de qual tag?** Definir política de rebase antes da primeira linha de C3.
4. **Mídia.** O Virtual não decodifica — o sidecar proxia assets e quem dá play é o cliente
   projetado. Logo codec e Widevine no WPE são irrelevantes. Resíduo: site que consulta
   `canPlayType` / `MediaSource.isTypeSupported` pra escolher fonte ou pra bloquear.
   Mentira barata de contar no web process extension. Não é bloqueante.

---

## 7. Regras da casa

- **A ABI da §3 é lei.** Nenhum PR do port renumera opcode, muda `FRAME_WIRE_VERSION` ou
  toca `packages/page-projection/src/core/`. Se o port "precisa" mudar a ABI, o port está errado.
- **`projected/` não se mexe.** Se mexeu, o produtor não está honrando o contrato.
- **Nada de big-bang.** Chromium e WebKit convivem atrás de `IBrowserSessionFactory` até o
  WebKit passar os oracles.
- **Um teste por afirmação.** "WebKit também faz X" só entra no doc com run que mostra.
- **Sem loop.** Todo experimento tem cap de tempo e número de tentativas escrito antes de rodar.

---

## Anexo — o que está sujo na working tree

A branch nasceu com a working tree do trabalho de gesto iOS ainda não commitada. Em especial
`packages/page-projection/src/projected/input/projectedInputCapture.ts` contém a correção
click-driven que **funciona e está validada no device**, e ela não está em nenhum commit.
Commitar isso antes de mexer em qualquer coisa deste port.
