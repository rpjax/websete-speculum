# Iteração 6 — o Gecko real, não o Gecko imaginado

**Passo:** conferir cada suposição do desenho contra como o motor de fato funciona. Suposição
errada sobre o motor não aparece em revisão de doc — aparece em vazamento e em crash.

---

## A1 — O adaptador não pode segurar referência forte a nó

`nsINode`, `StyleSheet` e `css::Rule` participam de **coleta de ciclos**. Uma referência forte
segurada por um objeto que a coleta **não enxerga** não é proteção: é aresta invisível, e o
ciclo `nó → documento → adaptador → nó` nunca é quebrado. Vaza a árvore inteira, calado.

O código atual faz exatamente isso: três mapas de `RefPtr` no adaptador de leitura
(`mHeldNodes`, `mHeldSheets`, `mHeldRules`), existindo só porque não há GC.

**Correção, para nó:** a tabela de handles guarda **ponteiro cru** e o limpa em
`NodeWillBeDestroyed`, que o motor já notifica e que o desenho já tem como
`onNodeDestroyed`. Sem contagem, sem ciclo, sem vazamento — e `resolve` de id esquecido
devolve nulo, que já era o contrato.

**Correção, para folha e regra:** não há notificação de destruição para esses. Referência
fraca ali seria ponteiro pendurado. Então a tabela de CSSOM guarda referência forte **e é
possuída fora do `Document`** — vive no adaptador de processo, indexada por documento, e é
destruída quando o documento morre. Assim a cadeia é `processo → adaptador → folha →
documento`, sem aresta de volta: não há ciclo para a coleta quebrar.

**Regra que sai disto:** *nenhum objeto do motor é possuído por algo que o motor possua.*
Os adaptadores vivem pendurados no processo, nunca no documento que observam.

## A2 — Não se roda script dentro de notificação

O motor notifica mutação dentro de regiões que **proíbem rodar script**. Chamar algo que roda
script ali é crash ou reentrância arbitrária, não é bug sutil.

O desenho já está do lado certo por acidente de forma: quem recebe notificação não tem o
handle que despacha entrada, e despachar entrada é a única coisa que roda script. Mas agora
isso é **invariante nomeada**, não sorte:

> Nenhuma operação alcançável a partir de uma notificação roda script.

E ela é verificável: o grafo de injeção prova que o observador não tem como chegar lá.

## A3 — Shadow root precisa de observação própria

`ShadowRoot` mantém lista de observadores **separada** da do documento. Anexar ao documento e
esperar ver mutação dentro do shadow é suposição errada, e a falha é silenciosa: a projeção
simplesmente não vê metade da página.

**Obrigação do adaptador**, escrita no contrato: ao receber `onShadowAttached`, anexar
também à shadow root, recursivamente para shadow aninhado. É do adaptador, não do domínio —
o domínio nem sabe que existe lista de observador.

## A4 — Regra nascida de parse não notifica

Já estava no desenho e agora tem a razão escrita: `RuleAdded` só sai de mutação por API
CSSOM. Folha carregada por `<link>` chega com todas as regras e **nenhuma notificação**. O
único momento em que a lista viva existe é a folha ficar aplicável.

Por isso `onSheetApplicable` não é redundante, e por isso o teste que importa é justamente o
`<link>` — o caminho sem notificação nenhuma.

## A5 — Isolamento por site move o documento de processo

Navegar pode trocar o processo de conteúdo. Isso **não** quebra "processo possui documentos":
documento não migra, ele morre e outro nasce do outro lado. Mas expõe que a coisa estável
atravessando essa troca não é o documento — é o slot onde ele mora.

Que é o achado da iteração 7.
