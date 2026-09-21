# 06 — Taxonomia: contrato, componente, e a forma de ambos

**Status:** EM DESENHO. Este doc governa o formato de tudo em `contratos/`.

---

## 1. Duas categorias, e a diferença importa

Nem toda unidade pequena e testável precisa de interface. Interface sobre lógica pura é
custo sem prêmio: ninguém nunca vai fakear uma função de hash.

| | **Contrato** (porta) | **Componente** |
|---|---|---|
| tem | interface, dispatch virtual | tipo concreto |
| existe porque | há mais de uma implementação real | há uma responsabilidade coesa |
| fica em | `ports/` | `domain/**` |
| é testado | pelos dois lados: fake e real | direto, sem fake de si mesmo |

### Teste de justificação de interface

Uma unidade vira **contrato** se, e só se, satisfaz pelo menos um:

1. **Fronteira de engine** — a implementação real precisa de libxul ou de outro motor.
2. **Injeção de falha** — o teste precisa forçar um erro que o real não produz sob demanda
   (escrita curta, socket rompido, leitura parcial, timer atrasado).
3. **Duas implementações reais** — ambas existem em produção, não hipoteticamente.

Não satisfaz nenhum? É **componente**. O digest de tabela é determinístico, puro e testado
diretamente; dar interface a ele adiciona indireção e zero capacidade nova.

## 2. Forma de nome

- **Contrato:** prefixo `I`, substantivo de papel, sem nome de motor.
  `IDocumentView`, não `IGeckoDom`, não `IDomService`.
- **Componente:** substantivo do que ele é dono. `NavigationState`, `LinkWriter`, `DirtyLedger`.
- **Nenhum nome contém** `Manager`, `Helper`, `Util`, `Handler` genérico. Nome que não diz
  de que o objeto é dono é sintoma de que ele não é dono de nada específico.

## 3. Template obrigatório

**Contrato** tem doc próprio com estas seções. **Componente** vive num doc de módulo, com um
bloco compacto — documentação é uma segunda base de código a manter em sincronia, e oito
seções para vinte linhas de função pura é dívida, não rigor.

Seções, nesta ordem:

```
# <Nome>
**Tipo / Escopo de vida / Thread / Camada**   (cabeçalho de quatro campos)
## Responsabilidade      uma frase: de que ele é dono
## Não é responsável por  lista explícita — é onde mora a incapacidade
## Contrato               a assinatura
## Semântica              por operação: pré, pós, o que é erro
## Falhas                 tabela FECHADA: código | quando | quem decide
## Invariantes            numerados, verificáveis
## Testabilidade          que fake precisa, que cenário prova
## Colabora com           links
```

A seção **"Não é responsável por"** não é decorativa. É o registro escrito da capacidade
negada — o mecanismo de `04-resiliencia.md` §1. Um doc sem ela não está pronto.

A seção **Falhas** é fechada por definição: o conjunto listado é o conjunto total. Falha
fora da tabela é bug de contrato, não caso novo.

## 4. Campos do cabeçalho

| campo | valores |
|---|---|
| **Tipo** | `contrato/dirigida` · `contrato/notificação` · `componente` |
| **Escopo de vida** | `sessão` · `processo` (de conteúdo) · `documento` · `chamada` |
| **Thread** | `main` · `any` · `egress` |
| **Camada** | `ports` · `domain/<sub>` |

Escopo e thread são declarados no doc **antes** de existir código, porque são as duas
perguntas que o C++ cobra e que o .NET esconde.

## 5. Regras de assinatura

1. Nenhum tipo de engine aparece — nem `nsIContent*`, nem `nsAtom*`, nem `AttrModType`.
2. Handles são opacos e tipados: `Ref<Node>`, `Ref<Sheet>`, `Ref<Rule>`, `Ref<Atom>`.
3. Erro por valor, e o valor é sempre `Fault` — um tipo, nunca um enum por porta.
   `-fno-exceptions` é flag do projeto.
4. Nenhuma operação sem chamador real. Operação especulativa não entra.
5. Coleção devolvida por valor só em caminho frio (walk de resync). Caminho quente devolve
   por callback ou `span`.
