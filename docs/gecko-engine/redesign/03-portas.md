# 03 — Regras de forma de porta

**Status:** EM DESENHO. O catálogo mora em [`contratos/`](contratos/README.md); este doc
governa a **forma** de qualquer porta.

---

## 1. Quando existe interface

Só quando satisfaz ao menos um:

1. **fronteira de motor** — a implementação real precisa de libxul ou de outro motor;
2. **injeção de falha** — o teste precisa forçar erro que o real não produz sob demanda;
3. **duas implementações reais**, existentes, não hipotéticas.

Não satisfaz nenhum? É componente. Interface sobre função pura é indireção sem capacidade nova.

## 2. Quando NÃO se fatia mais

Interface pequena não é o mesmo que muitas interfaces. A incapacidade vem do que um componente
**recebe injetado**, não de quão fino o contrato está partido.

Regras de corte, nesta ordem:

- **Mesmo objeto sempre implementa os dois?** Funde. Separar transforma ordem garantida em
  coordenação — o caso de estrutura e estilo, que chegam intercalados e precisam manter ordem.
- **Mesmo recurso, mesma vida, mesma morte?** Funde. Ler e escrever o mesmo socket eram dois
  contratos para um fd.
- **A separação entrega uma capacidade diferente?** Mantém, mesmo que a implementação seja a
  mesma. `IDocumentView` fica separado de `IEngineDocument` porque quem recebe a visão fica
  incapaz de agir — **separação de capacidade, não de implementação.**
- **Encaminhamento de dez linhas e nada mais?** Não é porta, é ruído.

## 3. Assinatura

1. Nenhum tipo de motor aparece — nem `nsIContent*`, nem `nsAtom*`, nem `AttrModType`.
2. Handles opacos e tipados: `Ref<Node>`, `Ref<Sheet>`, `Ref<Rule>`, `Ref<Atom>`.
3. **Nenhuma posse na porta.** Nada de `retain`/`release`: a tabela de handles é do motor.
4. Erro por valor, e o valor é sempre `Fault`. Um tipo, nunca um enum por porta.
5. Caminho quente não falha por valor: handle morto devolve **neutro**, não `Result`.
6. Coleção nunca é devolvida por valor — **visitor** ou `span`. Devolver `vector` e `string`
   custava quatro ou mais alocações por nó, por varredura.
7. Nenhuma operação sem chamador real. Operação especulativa é CDP disfarçado.

## 4. Direção

| família | quem chama | custo |
|---|---|---|
| dirigida | domínio → motor | o da chamada |
| notificação | motor → domínio | uma chamada indireta, argumentos primitivos, **zero alocação** |

A objeção clássica ("interface no caminho quente custa") se aplica a **materializar record**,
não a porta. Não existe `MutationRecord` neste desenho.

## 5. Notificação: a forma que garante a regra

Uma porta de notificação **não tem método capaz de produzir saída**. É assim que "o sink só
marca" deixa de ser regra escrita e vira propriedade do tipo: a implementação não pode emitir
porque não há o que chamar, e não recebe link nem relógio.
