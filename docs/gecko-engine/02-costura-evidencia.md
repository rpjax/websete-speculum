# Gecko — evidencia da costura contra a spec

Leitura direta da arvore em `FIREFOX_153_2_0esr_RELEASE`
(commit `feec67e62a5148b41fd017ccbbc463e8a6f9e83d`), feita para testar a spec ja
fechada contra o motor real. **Nenhum build envolvido.**

Regra que vale aqui e em todo o projeto: **evidencia, nao memoria.** Cada linha
abaixo tem caminho de arquivo.

**Resultado geral: a spec encaixa. Tres pontos ficaram mais faceis do que no WebKit.**

---

## 1. Registros de DOM — tem tudo que os ops precisam

`dom/base/nsIMutationObserver.h`, registro via `nsINode::AddMutationObserver()`
(`dom/base/nsINode.h`).

| callback | serve para |
|---|---|
| `CharacterDataWillChange` / `CharacterDataChanged` | `TextSet` |
| `AttributeWillChange` / `AttributeChanged` | `AttrSet` / `AttrDel` — o *WillChange* da acesso ao valor antigo |
| `ContentAppended` / `ContentInserted` / `ContentWillBeRemoved` | `Insert` / `Remove` |
| `NodeWillBeDestroyed` | ver §3 — resolve referencia pendurada |
| `ParentChainChanged` | reparentacao |

Diferenca do WebKit que importa: aqui existe **ponto de registro explicito**
(`AddMutationObserver`). No WebKit a maquina de MutationRecord e' interna, sem
registro para consumidor nativo.

**Caveat honesto:** `ContentInsertInfo` (= `ContentAppendInfo`) carrega apenas
`mOldParent` e um flag de confianca de script — **nao carrega a posicao de
insercao**. A posicao se deriva lendo o proprio no no callback, que ainda esta na
arvore. `ContentWillBeRemoved` dispara **antes** da remocao, entao a posicao
tambem e' legivel la. Trabalho pequeno, mas e' trabalho.

Bonus: `ContentRemoveInfo::mBatchRemovalState` avisa quando o motor vai remover
**todos** os filhos de um container — dica de lote de graca.

## 2. Shadow fechado — de graca

`dom/base/Element.h`:

- `GetShadowRoot()` — **nao filtra por modo**
- `GetShadowRootForBindings()` — a versao que filtra, para JS
- `GetOpenOrClosedShadowRoot(nsIPrincipal&)`

`dom/base/ShadowRoot.h`: `Mode()` e `IsClosed()` dao o modo, que e' exatamente o
que a ABI precisa (`SHADOW_MODE_OPEN` / `SHADOW_MODE_CLOSED`).

**Consequencia:** o patch de `attachShadow` — a coisa mais detectavel do motor
atual, e um dos motivos originais do port — **nao e' necessario**. Le-se do C++.

## 3. Identidade e referencia pendurada — item G resolvido

Nao existe id estavel nativo em `nsINode` (nada apareceu nas buscas). Entao a
**tabela paralela continua** — igual ao WebKit.

**Mas existe `NodeWillBeDestroyed(nsINode*)`.** O motor avisa antes do no morrer.

Isso resolve o risco levantado em `docs/webkit-engine/08-costura.md` §"Risco:
referencia pendurada": o acumulador guarda identidade, e o motor diz quando
despejar. **Nao precisa de referencia forte segurando viva coisa que a pagina removeu.**

## 4. CSSOM — mais fino que no WebKit

`layout/style/StyleSheet.h`:

- `RuleAdded(css::Rule&)`
- `RuleRemoved(css::Rule&)`
- `RuleChanged(css::Rule*, const StyleRuleChange&)`
- `ApplicableStateChanged(bool)`

Isso e' notificacao **por regra**, com ponteiro da regra e o tipo da mudanca.

**Correcao registrada:** `docs/gecko-engine/00-viabilidade.md` pontuou este
criterio como vitoria do WebKit. Esta errado. O `didChangeStyleSheetContents()`
do WebKit diz apenas "mudou neste escopo"; o Gecko diz **qual regra e qual
mudanca**. Era o unico ganho claro do WebKit na tabela.

## 5. Fronteira de UA — item F vira predicado

`dom/base/nsINode.h`:

- `IsInNativeAnonymousSubtree()`
- `IsRootOfNativeAnonymousSubtree()`
- `ChromeOnlyAccess()` — implementado **como** `IsInNativeAnonymousSubtree()`

O Gecko **modela explicitamente** a fronteira autor/UA como flag de primeira
classe em todo no.

No WebKit isso era regra de design nossa, com risco de inundar o cliente de no
fantasma (`08-costura.md` §"Fronteira de shadow DOM de UA"). Aqui e' um predicado.

## 6. Checkpoint — item H

`layout/base/`: `nsRefreshDriver`, `nsRefreshObservers`, e em `PresShell.h`
`WillPaint()`, `DidDoReflow()`, `FlushPendingNotifications()`.

Existem pontos de checkpoint registraveis. Suficiente para o item H, que ja estava
de-riscado pelo acumulador de conjunto sujo.

## 7. Input — nativo, em processo, com touch

`widget/headless/HeadlessWidget.h`:

- `SynthesizeNativeMouseEvent`, `SynthesizeNativeMouseMove`
- `SynthesizeNativeMouseScrollEvent`
- **`SynthesizeNativeTouchPoint`**
- `SynthesizeNativeTouchPadPinch`, `SynthesizeNativeTouchpadPan`

Touch — que e' o caminho de input do nosso produto — esta la, no widget headless,
sem Marionette e sem WebDriver.

## 8. Fission — complicacao real, mas e' pref

`dom/ipc/`: `BrowserBridgeChild/Parent/Host`, `PBrowserBridge.ipdl`,
`WindowGlobalChild/Parent`, `PWindowGlobal.ipdl`. Iframe cross-origin vai para
processo separado.

`modules/libpref/init/StaticPrefList.yaml`:

    - name: fission.autostart
      type: bool
      value: true
      mirror: never

**Vem ligado, mas e' pref — da' para desligar.**

Mesma classe de decisao que a troca de processo no WebKit
(`docs/webkit-engine/06-runtime.md` contexto de `generation`). Recomendacao igual:
**desligar no v1**, uma variavel a menos enquanto o produtor e' novo.

Impacto no item **I** (contextos aninhados): com Fission ligado, cada iframe
cross-origin e' outro processo, logo outro produtor. Com Fission desligado, um
processo de conteudo por aba e todos os frames dentro dele — que e' o modelo que a
spec assume.

---

## O que continua nao sabido

- **Custo de build a frio** — nao medido
- **Custo de iteracao** (edicao de uma linha) — nao medido
- **Baseline** — nao rodada

Referencia do lado A na mesma maquina: build frio **8098 s**, iteracao
**93 s / 1,18 s**, baseline **BLOQUEADA** (bucket ambiente 61%).

**A decisao de motor repousa hoje nesses tres numeros e em mais nada.**
