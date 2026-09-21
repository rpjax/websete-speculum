# 09 — Observabilidade: gravar, reexecutar, e nunca morrer calado

**Status:** EM DESENHO. Resultado da iteração 9.

Testabilidade e **diagnosticabilidade** não são a mesma coisa. Os docs anteriores perseguiam a
primeira. Este persegue a segunda, e ela tem um alvo:

> **Um bug de produção vira teste unitário no laptop, em minutos, sem reproduzir a página.**

---

## 1. Gravar e reexecutar

Todo contato com o mundo passa por porta. Então **decorar toda porta com um gravador** produz o
roteiro completo do que aconteceu, e o `sim` reexecuta esse roteiro.

```
produção     engines/gecko + Recorder   →  roteiro.spec
reprodução   engines/sim   + roteiro.spec →  os mesmos bytes, em milissegundos
```

Isto é o retorno composto de tudo que veio antes: só funciona porque nenhuma decisão mora fora
de um componente e nenhuma entrada chega fora de uma porta.

**Um formato, três papéis:** formato de teste, formato de replay, e roteiro do oráculo
`sim × gecko`. Três formatos divergiriam.

**Custo declarado:** o gravador escreve tudo que atravessa porta, inclusive conteúdo de página.
É ferramenta de laboratório, ligada por parâmetro de lançamento, nunca padrão.

## 2. Span de causa

`CorrelationId` liga pergunta e resposta. Não liga **causa e efeito**.

Todo envelope que entra abre um `SpanId`. Tudo que ele causa — comando, mutação marcada, patch
publicado, falha, fato de telemetria — carrega o span. "Por que este patch saiu agora" passa a
ter resposta mecânica em vez de arqueologia.

Um campo. É a diferença entre um log que se lê e um log que se **consulta**.

## 3. Dump de estado na morte

Falha cuja ação é `KillSession` emite, **antes** de morrer, um retrato estruturado e limitado
de todo registro vivo:

| registro | o que sai |
|---|---|
| `Hosts` | árvore, viewport, documento instalado, fase de navegação |
| `Documents` | documento → frame, processo |
| `Streams` | streams vivos, fase, offset |
| `Correlations` | pendências, por tipo |
| escritor | ocupado ou ocioso, bytes do envelope pendente |
| sessão | fase, e a falha que a matou |

Um lugar, um formato, sempre. Morrer sem dizer em que estado se estava é a diferença entre um
ticket resolvido e um ticket eterno.

## 4. Invariante como código

Todo registro expõe `checkInvariants()`. Em build de depuração roda nas fronteiras de patch e
de comando.

Os docs estão cheios de invariante numérica — `pending() == 0`, `live() == 0`, árvore sem
ciclo, todo documento com frame e processo vivos, offset não-decrescente. Enquanto isso for
prosa, é aspiração. Executando, **a deriva é pega no instante em que acontece**, não três
segundos depois, quando o sintoma aparece em outro lugar.

Custo zero em release.

## 5. Nada passa despercebido

| regra | efeito |
|---|---|
| todo gesto termina em admitido **ou** rejeitado catalogado | nada some em silêncio |
| código de falha não catalogado é erro de **build** | sem string livre |
| `faultsOf(code)` conta ocorrências | o teste afirma **qual** falha, não "não quebrou" |
| opcode desconhecido é registrado antes de ignorado | avanço sem lockstep, mas com rastro |
| telemetria ligada e desligada produzem bytes idênticos | observar não perturba |

### O buraco que faltava

Leitura de árvore devolve neutro para handle morto — caso normal, não é erro. Mas neutro era
também o que se recebia para handle que **nunca foi válido**, que é bug. Indistinguíveis.

**Correção:** handle morto devolve neutro em silêncio; handle **nunca visto** incrementa
contador de diagnóstico e é assert em build de depuração. Em release nada muda; em teste, a
única classe de bug que conseguia se esconder atrás de um caso legítimo para de se esconder.
