# Iteração 9 — depuração como requisito de desenho

**Passo:** perguntar o que precisa existir para que um bug de produção vire teste em minutos.
Até aqui o desenho perseguia testabilidade; testabilidade e **diagnosticabilidade** não são a
mesma coisa.

---

## D1 — Gravar e reexecutar: produção vira teste unitário

Todo contato com o mundo é porta. Então **decorar toda porta com um gravador** produz o
roteiro completo do que aconteceu — e o `sim` reexecuta esse roteiro.

```
produção   engines/gecko + Recorder  →  roteiro.spec
reprodução engines/sim   + roteiro.spec  →  mesmos bytes, no laptop, em milissegundos
```

Isto é o retorno composto de tudo que veio antes: só funciona porque nenhuma decisão mora
fora de um componente e nenhuma entrada chega fora de uma porta. Um bug que hoje exige
reproduzir uma página hostil vira um arquivo anexado ao ticket.

**O mesmo artefato serve três papéis** — formato de teste, formato de replay, e o roteiro do
oráculo `sim × gecko`. Um formato, não três.

**Custo declarado:** o gravador escreve tudo o que atravessa porta, inclusive conteúdo de
página. É ferramenta de laboratório, ligada por parâmetro de lançamento, nunca padrão.

## D2 — Span de causa: por que este patch existe

`CorrelationId` liga pergunta e resposta. Não liga **causa e efeito**.

Todo envelope que entra abre um `SpanId`. Tudo que ele causa — comando, mutação marcada,
patch emitido, falha, fato de telemetria — carrega o span. A pergunta "por que este patch
saiu agora" passa a ter resposta mecânica em vez de arqueologia.

Um campo, propagado por contexto de chamada. É a diferença entre um log que se lê e um log
que se **consulta**.

## D3 — Dump de estado na morte

Falha cuja ação é `KillSession` emite, antes de morrer, um retrato estruturado e limitado de
todo registro vivo: frames e sua árvore, documentos e seus processos, streams, correlações
pendentes, profundidade do escritor, fase da sessão.

Um lugar, um formato, sempre. Morrer sem dizer em que estado se estava é a diferença entre
um ticket resolvido e um ticket eterno.

## D4 — Invariante como código, não como doc

Todo registro expõe `checkInvariants()`. Em build de depuração roda nas fronteiras de patch e
de comando.

Os docs estão cheios de invariante numérica — `pending() == 0`, `live() == 0`, árvore de
frames sem ciclo, todo documento com processo vivo, offset não-decrescente. Enquanto isso for
prosa, é aspiração. Executando, **a deriva é pega no instante em que acontece**, não três
segundos depois quando o sintoma aparece em outro lugar.

Custo zero em release; em depuração, ordem de grandeza de um punhado de comparações.

## D5 — Erro impossível de passar despercebido

Consolidando as regras que já existiam e fechando o buraco que faltava:

| regra | onde |
|---|---|
| todo gesto termina em admitido **ou** rejeitado catalogado | nada some em silêncio |
| toda falha tem código catalogado — código não catalogado é erro de build | sem string livre |
| `faultsOf(code)` conta, para o teste afirmar **qual** falha houve | não "não quebrou" |
| opcode desconhecido é registrado antes de ignorado | avanço sem lockstep, mas com rastro |
| **buraco novo:** caminho que devolve valor neutro | ver abaixo |

Leitura de árvore devolve neutro para handle morto — é o caso normal e não é erro. Mas neutro
é também o que se recebe quando o handle **nunca foi válido**, que é bug. Eram
indistinguíveis.

**Correção:** handle morto devolve neutro em silêncio; handle **nunca visto** incrementa um
contador de diagnóstico e, em build de depuração, é assert. Em release não muda nada; em
teste, essa classe de bug para de se esconder atrás de um caso legítimo.
