# Iteração 10 — auditoria de nomes, e o saldo das dez

**Passo:** ler o catálogo inteiro procurando palavra que signifique duas coisas. Nome
ambíguo não é questão de estilo: é onde duas pessoas concordam em voz alta e discordam no
código.

---

## N1 — `Frame` significava três coisas

| uso | o que era |
|---|---|
| `FrameId` | o slot na árvore (iteração 7) |
| `Frame` no fio | o lote de deltas de projeção |
| `nsIFrame` | caixa de layout do Gecko |

O terceiro nunca entra no nosso vocabulário, mas os dois primeiros conviviam no mesmo doc.

**Decisão:** o slot é **`Frame`** — é a palavra da plataforma web (árvore de frames, iframe),
e o cliente já pensa assim. O lote de deltas vira **`Patch`**, que é o que ele é; "frame" ali
era empréstimo de streaming de vídeo, de quando a projeção era prima do modo de vídeo.

`FrameClock` → `PatchClock` · `FrameBuilder` → `PatchBuilder` · `FrameSequencer` →
`PatchSequence` · opcode `Frame` → `Patch` · `onFrameProduced` → `publish`.

## N2 — Palavras que ficaram proibidas

| proibida | porque | usar |
|---|---|---|
| `context` | era a confusão que a iteração 7 desfez | `frame` ou `document`, conforme o eixo |
| `generation` | morreu: `DocumentId` a subsome | — |
| `peer` | vago; é um processo de conteúdo | `process` |
| `sink` sozinho | não diz o que observa | `observer`, com o alvo no nome |
| `frame` para lote de deltas | N1 | `patch` |
| `tab` | não existe aba, existe viewport | `viewport` |

## N3 — Uma frase que o sistema inteiro cabe

Teste de fluidez: se o modelo não cabe numa frase, ele não está simples.

> **A sessão tem viewports. Um viewport tem uma árvore de frames. Um frame tem um documento,
> e navegar troca o documento do frame. Um documento vive num processo, que o possui. A
> projeção lê o documento, é avisada dele, e publica patches para cima.**

Nenhum substantivo aí precisa de nota de rodapé. Era o que faltava quando existia "aba",
"contexto", "contexto aninhado", "geração" e "época" na mesma conversa.

---

## Saldo das dez iterações

| # | achado | efeito |
|---|---|---|
| 1 | interface ≠ unidade pequena | teste de justificação; escopo de vida proíbe fusão |
| 2 | seis trechos sem dono | enquadrador, morte de processo, abandono de pedido, falha como valor |
| 3 | quatro cenários, três furos | patch no mesmo turno, fase `Cancelled`, lacuna de id |
| 4 | onze decisões eram sintoma | um `Fault`, saturação inexistente, fio aberto, 48 docs → 16 |
| 5 | o caso especial da aba | multi-documento primeiro; processo como objeto que possui |
| 6 | o Gecko real | zero referência forte a nó; adaptador fora do documento; script em notificação |
| 7 | a identidade mentia | `Frame` (slot) × `Document` (conteúdo); **`generation` morreu** |
| 8 | eram dois programas | produtor × sessão, com `IPatchUplink` entre eles |
| 9 | testável ≠ diagnosticável | gravar e reexecutar; span de causa; dump na morte; invariante executável |
| 10 | `Frame` era três coisas | `Patch` para o delta; seis palavras proibidas |

### O que ficou mais simples, medido em conceitos

Morreram: `contextId`, contexto aninhado como categoria, `parentContextId`, `generation`,
época como mecanismo próprio, `PeerRef`, aba, fila de saída, thread de saída, política de
saturação, quinze enums de erro, `Kind` de envelope, `Hello`, o sub-protocolo de ativo, e a
pergunta "isto é a raiz?".

Nasceram: `Frame`, `Patch`, `IPatchUplink`, e o gravador.

### O que continua pendente

Nada de desenho. Os três números de afinação de `05-decisoes.md`, e a declaração de mensagens
do fio — que é trabalho de escrever, não de decidir.
