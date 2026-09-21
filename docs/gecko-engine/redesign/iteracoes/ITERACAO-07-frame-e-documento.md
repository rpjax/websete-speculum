# Iteração 7 — a identidade estava mentindo

**Passo:** conferir se `DocumentId` significa o que o nome diz.

---

## O problema

O desenho dizia: navegação interna **mantém** o `DocumentId` e avança a `generation`.

Mas se o id sobrevive à destruição do documento, então ele **não identifica um documento**.
Ele identifica o **slot** onde documentos se sucedem. O tipo estava mentindo, e `generation`
existia para consertar a mentira por fora.

O motor não tem essa confusão. Ele separa:

| Gecko | o que é | sobrevive a navegar? |
|---|---|---|
| `BrowsingContext` | o slot na árvore de frames | **sim** |
| `Document` | o que está carregado nele agora | não |

A plataforma web também não tem: fala em **árvore de frames**, e em **documento** como o que
está dentro de um frame agora.

## A correção

```
Viewport ──> árvore de Frames ──> cada Frame tem um Documento
```

- **`FrameId`** — o slot. Estável, nasce com o frame, morre com ele. É por ele que a árvore é
  chaveada, dos dois lados do fio.
- **`DocumentId`** — o documento carregado. **Novo a cada navegação.**
- Navegar **troca o documento do frame**, não o frame.

## `generation` morreu

Era um eixo inventado para dizer "o conteúdo do slot foi trocado" quando não havia identidade
de documento. Agora há: o `DocumentId` mudou. Um conceito a menos, sem perder nada —
sequência de patch reinicia naturalmente porque o documento é outro, snapshot carrega o
documento, e "época" é só o documento anterior ter morrido.

## O contrato se parte pela linha certa

Duas vidas diferentes, e a regra do projeto diz que vida diferente proíbe fusão:

```cpp
IEngineFrame      // o slot — vive mais
  navigate reload stop historyGo resize
  id parent viewport children
  document()  → IEngineDocument*      // o de agora; troca ao navegar
  attach(IFrameObserver*)             // progresso de carga, diálogos

IEngineDocument   // o conteúdo — vive menos
  id frame process
  view()  → const IDocumentView&
  attach(IDocumentObserver*)
  dispatch(gesto) boxOf(nó)
```

Três coisas caem de graça:

**Teardown por destruição de objeto.** Navegar destrói o documento e cria outro. A projeção,
a tabela de identidade e o ledger são do documento — morrem junto. Não há `applyEpochReset`
limpando sete estruturas na mão, e não há a oitava que alguém esqueceu.

**Navegação mora onde acontece.** `navigate` é do frame, que é quem sobrevive à navegação.
Antes estava num objeto que a própria operação destrói.

**A troca de processo do isolamento por site encaixa.** O frame vive do lado do processo pai
(é o slot canônico); o documento vive no processo de conteúdo que o possui. Navegar pode
trocar o processo — o frame fica, o documento muda de lado. Os dois eixos do modelo agora têm
lastro no motor em vez de serem só uma boa ideia.

## Os observadores passam a se pendurar no que observam

`IFrameObserver` no frame (progresso de carga, diálogos — coisas do slot).
`IDocumentObserver` no documento (mutação — coisas do conteúdo).

Cada um morre com o seu dono. Some o `detach` a lembrar, e some o caso "chegou notificação de
documento que já morreu": ela é inalcançável.
