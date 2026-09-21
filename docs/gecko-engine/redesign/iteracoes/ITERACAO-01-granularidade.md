# Iteração 1 — granularidade: 48 interfaces viraram 15

**Passo:** primeira decomposição completa, depois revisão de justificação.

---

## O que a primeira passada produziu

48 unidades, e o instinto inicial foi dar interface a todas — é o que "quebrar tudo em
contratos pequenos" sugere literalmente.

## O que a revisão encontrou

Interface sobre lógica pura é custo sem capacidade nova. `TableDigest` é determinístico,
tem uma implementação para sempre, e ninguém jamais vai fakeá-lo: uma interface ali adiciona
dispatch indireto, um arquivo, um fake que ninguém usa, e zero cenário novo de teste.

O erro estava em confundir **unidade pequena** com **interface**. As duas coisas são
ortogonais: a unidade pequena é o que dá coesão e testabilidade; a interface é o que dá
substituição. Só a segunda tem custo, e só ela precisa de justificação.

## A mudança

Introduzido o **teste de justificação de interface** (`06-taxonomia.md` §1). Uma unidade só
vira contrato se satisfaz pelo menos um de três:

1. fronteira de engine (precisa de libxul ou de outro motor);
2. injeção de falha (o teste precisa forçar erro que o real não produz sob demanda);
3. duas implementações reais, existentes, não hipotéticas.

Resultado: **15 contratos, 33 componentes.**

| unidade | veredito | critério |
|---|---|---|
| `IEgressLink` | contrato | 1 e 2 — socket real, e `Partial`/`Broken` sob demanda |
| `IEngineClock` | contrato | 1 e 2 — `nsITimer` real, e tempo manual no teste |
| `TableDigest` | componente | nenhum |
| `KeyMap` | componente | nenhum — tabela pura |
| `HitGeometry` | componente | nenhum — e já é testado assim hoje |
| `NavigationStateMachine` | componente | nenhum — o que precisa de fake é `INavigationSink`, não ela |
| `EnvelopeAssembler` | componente | nenhum — alimentado por bytes, testável direto |

## Fusão descartada

Cogitado fundir `IViewportControl` em `INavigationControl`, pela regra dos dez
encaminhamentos. **Rejeitado:** os escopos de vida são diferentes — a chrome é da sessão, a
navegação é do contexto — e fundir criaria um contrato com dois tempos de vida, que é
precisamente o defeito que o redesign existe para eliminar.

**Regra derivada:** escopo de vida diferente proíbe fusão, mesmo quando a superfície é
pequena.

## Fusão aceita

`IFrameIngress` foi absorvido por `IPeerSink`. Frame chegando e peer morrendo são o mesmo
domínio de fato — a vida do processo de conteúdo — e separá-los produziria dois contratos que
sempre seriam implementados pelo mesmo objeto, com o mesmo tempo de vida, e cuja ordem
relativa importa. Contrato separado teria transformado uma ordem garantida em uma coordenação.

---

> **Nota de arquivo.** Esta iteração é anterior às iterações 4 e 5. Os nomes de
> componente citados aqui foram consolidados desde então; os links apontam para onde a
> responsabilidade vive hoje. Os **achados** continuam válidos — foi por eles que o
> desenho chegou onde chegou.
