# 08 — O fio, redesenhado

**Status:** EM DESENHO. Substitui `18-abi-controle.md` inteiro. O cliente TypeScript muda
junto — não há compatibilidade a preservar.

---

## 1. Uma declaração, três lados gerados

A causa raiz de divergência em protocolo binário não é o formato: é existirem **várias
implementações do mesmo formato escritas à mão**. Hoje são três só no C++
(`SpeculumControlAbi`, `Wire.h`, e cópias de `ReadU32/U16/Str` dentro do código de entrada),
mais a do TypeScript, mais a do .NET.

No redesign existe **um** arquivo de declaração de mensagens. C++, TypeScript e .NET geram o
codec a partir dele. A classe de bug "os dois lados discordam do formato" deixa de ser algo a
evitar e passa a ser inalcançável.

Continua binário, little-endian, sem alocação no caminho quente — a razão que matou JSON
segue de pé.

## 2. Envelope

```
u16  OpCode
u16  Reserved       // zero; alinha target
u32  TargetId       // host ou viewport; 0 = sessão
u32  Length
u32  Correlation    // 0 = espontânea
```

Dezesseis bytes, alinhados, **sem flags e sem ramo** no decoder. Autoridade do layout:
[`schema/speculum.wire.toml`](schema/speculum.wire.toml). (Trechos mais velhos deste doc que
falavam em 12 bytes + flags opcionais estão superados pelo schema ESTABELECIDO.)

Mudanças em relação ao fio antigo, e o motivo de cada uma:

| mudou | antes | por quê |
|---|---|---|
| alinhamento | `u8+u32+u32` = 9 bytes | toda leitura desalinhada, de graça |
| uma taxonomia | `Kind` **e** faixas de opcode | dois eixos respondiam "que mensagem é essa" |
| `Hello` morreu | Kind próprio, payload vazio | `Ready` já era a mesma mensagem |
| ativo deixou de ser sub-protocolo | Kind `0x06` com byte de fase | protocolo dentro do protocolo; agora são opcodes |
| correlação sempre presente | flags + campo opcional | ramo no decoder é onde mora bug; 4 bytes fixos saem mais baratos |
| id uma vez | no envelope **e** no prefixo do patch | duas cópias da mesma verdade |
| `Frame` virou `Patch` | a palavra significava três coisas | o slot é `Host`; o lote de deltas é `Patch` |

Direção é o bit alto do opcode (`0x8xxx` = motor→supervisor). O gerador recusa declaração
cujo `direction` discorde do bit.

## 3. Vocabulário — em linguagem de domínio

O supervisor fala **viewport** e **documento**. Processo de conteúdo não aparece: é como o
motor arruma as coisas por dentro, e expor isso misturaria responsabilidade.

### Supervisor → motor
| grupo | alvo | mensagens |
|---|---|---|
| viewport | viewport | `ViewportOpen(extent)`, `ViewportClose`, `ViewportResize(extent)` |
| navegação | **frame** | `Navigate(url)`, `Reload`, `Stop`, `HistoryGo(delta)`, `FrameResize(extent)` |
| projeção | **frame** + alcance | `Resync(força, alcance)`, `ClocksHalt(alcance)`, `ClocksResume(alcance)` |
| projeção | **documento** | `Flush`, `Snapshot` |
| entrada | documento | `Input(gesto)` |
| resposta | frame | `PromptRespond(requestId, resposta)` |
| ativo | documento | `AssetRequest(streamId, url)`, `AssetCancel(streamId)` |
| vida | sessão | `Shutdown` |

### Motor → supervisor
| grupo | alvo | mensagens |
|---|---|---|
| vida | sessão | `Ready`, `Heartbeat(monotonicMs)` |
| viewport | viewport | `ViewportOpened(id, rootFrame)`, `ViewportClosed(id)` |
| árvore | **frame** | `FrameAttached(id, parent, viewport)`, `FrameDetached(id)` |
| conteúdo | **frame** | `DocumentInstalled(documentRef)`, `DocumentDiscarded(documentRef)`, `Navigated(url)`, `LoadState(estado)` |
| projeção | **documento** | `Patch(bytes)`, `Snapshotted(cabeçalho, dump)` |
| pedido | frame | `PromptRequested(requestId, tipo, descrição)` |
| ativo | documento | `AssetChunk(streamId, offset, bytes)`, `AssetEnd(streamId, total)`, `AssetDenied(streamId)` |
| diagnóstico | qualquer | `Fault(…)`, `Telemetry(catalogId, bytes)` |

**Todo host anuncia.** `FrameAttached` carrega o pai de verdade. Não há mensagem que só valha
para a raiz, e não há campo que exista só para ficar zerado.

**Frame e documento são alvos diferentes, e o opcode diz qual.** Navegar é do host, que
sobrevive à carga; ler e mutar é do documento, que não. `DocumentInstalled` / `DocumentDiscarded`
tornam a troca um evento **nomeado**, em vez de algo a inferir do progresso de carga — e por isso
`generation` viaja no quadro: é ela que diz qual documento do host aquele patch descreve.

**O cliente chaveia a árvore por `HostId`**, que é estável, e troca o conteúdo quando o
`DocumentRef` muda. É o que torna a árvore do cliente imune a navegação.

## 4. `Fault` é a estrutura, não uma tradução dela

A falha que o domínio produz é a que sai no fio, sem segunda serialização:

```
u16   code            catálogo único, estável
u32   flags           Transient | Retryable | ProtocolViolation | ClientVisible
str   origin          componente que produziu
str   message         literal estático, sem interpolação
u8    count
[ u16 key, u8 tag, value ] × count
```

Sem campo de domínio privilegiado dentro do `Fault`. O alvo a que a falha se refere é o do **envelope**; qualquer outro identificador — stream, nó, offset, esperado, obtido — entra
como par chave/valor com chave **tipada e catalogada**, para o supervisor casar
programaticamente em vez de ler string.

## 5. Regras

**Ordem.** Um canal, uma ordem, nenhuma prioridade entre planos.

**Um envelope em voo.** O motor não enfileira: a sujeira coalesce no ledger em vez de se
acumular no fio, e o produtor obtém isso sem saber que existe socket — ele só consulta
`IPatchUplink::isDrained()`. Se o anterior não drenou, o próximo host simplesmente sai maior depois.
Contrapressão é do socket, e supervisor lento é problema do supervisor.

**Escrita atômica.** Envelope nunca sai entrelaçado; escrita curta é completada em laço.

**Opcode desconhecido não é fatal** — registra e ignora, para as pontas avançarem sem lockstep.

**Enquadramento perdido é fatal** — sem confiar no tamanho não há como achar o próximo
envelope.

**Sem negociação de versão.** O par é construído e implantado junto.

## 6. Descartados

**6.1 Compatibilidade com o fio antigo.** Nenhuma. O cliente muda junto; agora é a hora.

**6.2 Codec escrito à mão.** §1.

**6.3 Processo de conteúdo no vocabulário.** É detalhe do motor; expor mistura responsabilidade.

**6.5 Mint global de `documentRef`.** Identidade de documento é `(hostId, generation)` — um
contador por host custa menos ao consumidor que um id global (doc 11).

**6.6 A palavra `Frame` para lote de deltas.** Era empréstimo de streaming de vídeo e colidia
com o slot. Agora é `Patch`.

**6.4 Política de saturação no motor.** Vazão é do supervisor; §5.
