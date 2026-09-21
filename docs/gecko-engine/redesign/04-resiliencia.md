# 04 — O que fica robusto por causa de interface pequena

**Status:** EM DESENHO. Este doc é o argumento de por que o redesign vale o custo.

---

## 1. Compartimentalização por incapacidade

O ganho principal não é "erro fica fácil de perceber". É **erro fica impossível de
digitar**.

Um componente não erra numa classe inteira de erros porque nunca recebeu a capacidade de
cometê-los:

| componente | não pode | porque |
|---|---|---|
| a projeção | navegar, redimensionar, despachar entrada | recebe `IDocumentView` e implementa `IDocumentObserver`; nunca vê `IEngineDocument` |
| qualquer um | reter documento de processo morto | o único caminho até o documento passa pelo processo, que o possui |
| qualquer um | esquecer de desanexar observador ou limpar documentos | são possuídos; morrem junto |
| o código inteiro | perguntar "isto é a raiz?" | não existe documento especial |
| sink de mutação | emitir frame durante notificação | não tem `ILink` nem `IClock` na mão |
| transporte | decidir encerrar a sessão | não conhece sessão; devolve `Broken` e acabou |
| produtor | navegar, redimensionar, abrir janela | não tem `IEngineDocument` nem `IChromeHost` |
| rastreador de navegação | tocar a tabela de projeção | não tem `IDocumentView` |
| classificador de ativo | fazer I/O | recebe bytes, devolve veredito |

Isto é diferente de escrever no doc "o produtor não decide o que projetar"
(`17-runtime-de-projecao.md` §8.4) e confiar que ninguém vai. Aqui a regra é o grafo de
dependência, e quebrá-la exige mudar a raiz de composição — um ato visível, num arquivo, em
revisão.

**Corolário prático:** quando surgir a tentação de "só passa o transporte pro sink, é mais
rápido", a resposta não é uma discussão de estilo; é que a porta não está lá.

## 2. Espaço de estado: o argumento mais forte

O rastreador de navegação atual carrega cinco booleanos:

```
mWaitingCreated  mWaitingNavigated  mSawLoadStart  mSawExpectedLocation  mNavigateRetried
```

Cinco booleanos = **32 estados representáveis**. A máquina real tem talvez cinco legítimos.
Os outros 27 existem, são alcançáveis por caminho que ninguém enumerou, e cada bug de
corrida de navegação vive num deles.

Com a mesma lógica atrás de `INavigationSink` e um estado explícito:

```
enum class NavPhase { Idle, Requested, Started, Committed, Failed };
```

Cinco estados, transições em tabela, transição ilegal vira assert em **um** lugar. O espaço
de estado cai de 32 para 5 sem perder nenhum comportamento — os 27 eram ruído, não feature.

Este é o padrão a procurar em todo lugar: **booleano solto é estado escondido**. Onde houver
três ou mais booleanos coordenados, há uma máquina de estado não escrita.

## 3. Superfície de erro enumerável

God-object tem superfície de erro igual a "qualquer coisa". Porta pequena tem superfície
fechada e declarada (`03-portas.md` §3.5).

Consequência: a matriz de teste deixa de ser exploratória e passa a ser **exaustiva por
construção**. `ILink` com quatro resultados gera quatro cenários, e o fake produz os
quatro sob demanda:

- `Short` → prova que "escrita curta é completada em laço" (`18-abi-controle.md` §4).
- `Broken` no meio de um host → prova que a sessão morre e **não emite mais nada**
  (`15-vida-da-sessao.md`).
- `WouldBlock` sob pressão → prova que não há bloqueio de cabeça de fila
  (`12-ponte-controle-vocabulario.md` §2.2).

Hoje nenhuma dessas três tem teste, e nenhuma delas é testável sem derrubar um socket real
no meio de uma sessão real.

## 4. A escada de falha — quem detecta, quem decide

Compartimentalizar separa **detecção** de **decisão**. Hoje as duas moram juntas, e é por
isso que política vaza para dentro do mecanismo.

| falha | detecta | decide | resultado |
|---|---|---|---|
| escrita curta | `ILink` | o próprio transporte (mecanismo) | completa em laço |
| socket rompido | `ILink` | serviço de ciclo de vida | sessão morre |
| processo de conteúdo morre | ingresso de frame | registro de contexto | contexto some, `Fault` ao supervisor |
| `CHECK(scope: Table)` falha | projeção | **supervisor** | `Fault`; força do resync vem de lá |
| timer não dispara | `IClock` instrumentado | telemetria | fato catalogado, não morte |
| payload > 64 MiB | `wire` | mecanismo | violação de protocolo: morte |
| opcode desconhecido | `wire` | mecanismo | log e ignora |

A coluna "decide" é o que precisa ser único por linha. Duas colunas de decisão para a mesma
falha é como nasce sessão que morre por um caminho e sobrevive por outro.

### 4.1 `[[noreturn]]` no domínio é política embutida

`FailCatalogued` hoje é `[[noreturn]]` — aborta o processo. Mas `18-abi-controle.md` §3 diz
que **`Fault` não derruba nada por si; quem decide é o supervisor**. O mecanismo atual
contradiz o contrato atual.

No redesign, falha catalogada é **valor** que sobe: o domínio produz `Fault{documentRef,
causa}`, o serviço de ciclo de vida decide, e morrer é uma decisão tomada em um lugar
nomeado. Abortar de dentro de uma folha é o equivalente estrutural do "auto-responder
temporário" que `12-ponte-controle-vocabulario.md` §4 proíbe: mata o princípio da marionete
sem ninguém ter decidido isso.

## 5. Reentrância deixa de ser problema de todo mundo

Callback de mutação do Gecko é síncrono e reentrante — mutação acontece durante mutação. Em
código fundido, isso significa que qualquer função chamada de dentro de uma notificação pode
reentrar, e a pilha fica ilegível.

Regra do redesign: **o sink só marca.** Toda saída acontece no flush, dirigido por `IClock`.

O que torna isso cumprível não é a regra, é a **forma da porta**: `IDocumentObserver` não tem
nenhum método capaz de produzir saída. A incapacidade é o enforcement (§1).

Ganho colateral: com `IClock` falso, `halt + N mutações + resume → exatamente um host,
tableHash avançou uma vez` vira asserção determinística de unidade. Hoje essa mesma
propriedade é verificada por um script de texto passado a um binário externo, com `python`
comparando hash de saída.

## 5.1 Posse é a forma mais forte de incapacidade

Invariante que precisa de teste é invariante que pode ser quebrada. Posse não.

| era invariante testado | virou fato de posse |
|---|---|
| morte de processo destrói seus documentos exatamente uma vez | os documentos **eram dele** |
| todo observador anexado é desanexado | o observador **é do documento** |
| stream de documento morto é cancelado | o registro **é por documento** |

É a diferença entre escrever a regra e tornar a violação inexprimível.

## 6. Tempo de vida compartimentado

Hoje tudo morre junto com um `Impl`, o que esconde a pergunta em vez de respondê-la. Com
escopo declarado por componente (`02-camadas.md` §4), a pergunta "o que acontece se o
Document morre no meio disso" deixa de ser investigação e vira propriedade do escopo: um
componente de escopo documento não sobrevive ao documento, e a raiz é quem garante.

O fake ajuda aqui de um jeito que o real não ajuda: o `sim` pode destruir um documento
**exatamente** entre duas notificações, coisa que num Gecko real é corrida que reproduz uma
vez a cada mil.

## 7. Observabilidade cai da costura

Instrumentação hoje é código de telemetria espalhado pelos mesmos arquivos que fazem o
trabalho. Com porta, cada porta pode ser **decorada**: um `TimingTransport` que embrulha o
real e mede, um `RecordingMutationSink` que grava a sequência para replay, um `IClock` que
reporta atraso de disparo.

Nada disso toca o domínio, nada disso liga em produção por padrão, e tudo isso desliga por
não ser construído na raiz — não por `if`. Isso também dá endereço para o custo conhecido da
agulha de serialização (`17-runtime-de-projecao.md` §7): a medição vira um decorador, não
uma intervenção.

## 8. Onde compartimentalizar para de ajudar

Honestidade de custo, para não virar dogma:

**8.1 Dentro de um algoritmo, coesão ganha de granularidade.** A tabela, os conjuntos de
sujeira e a montagem de frame do produtor são **um** algoritmo. Quebrar em seis componentes
atrás de interfaces colocaria chamada indireta no laço interno e não compraria nada — já é
testável como unidade. A regra: **granularidade na fronteira, coesão no miolo.**

**8.2 A raiz de composição é o ponto cego.** Com doze portas e dez serviços, a raiz é umas
150 linhas de fiação explícita. Compila mesmo se você ligar o sink errado. Mitigação: a raiz
tem teste próprio — monta o grafo real com engines `sim` e afirma a forma (toda porta ligada,
nenhuma nula, escopos coerentes).

**8.3 Interface com uma implementação para sempre é custo sem prêmio.** Regra dos dez
encaminhamentos (`03-portas.md` §4).

**8.4 Fake mentiroso é pior que ausência de teste.** Um `sim` que aceita sequência de
notificação que o Gecko nunca produz valida comportamento impossível. Por isso o oráculo de
`01-alvo.md` §2 não é opcional: é o que mantém o `sim` honesto.
