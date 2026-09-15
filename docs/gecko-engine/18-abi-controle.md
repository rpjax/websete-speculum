# 18 — ABI de controle e envelope

**Status:** ESTABELECIDO. Contrato binário entre o processo base do browser e o
supervisor. Vocabulário em `12-ponte-controle-vocabulario.md`; forma do runtime em
`17-runtime-de-projecao.md`.

Tudo little-endian. Strings em UTF-8, prefixadas por tamanho, **sem** terminador
nulo.

---

## 1. Envelope

Toda mensagem na ponte é um envelope. Cabeçalho de 9 bytes:

```
u8   Kind
u32  ContextId     roteamento; 0 quando não se aplica
u32  Length        bytes de payload
...  Payload
```

| Kind | Nome | Sentido | Payload |
|------|------|---------|---------|
| 0x01 | Frame | browser → supervisor | bytes do frame, opacos |
| 0x02 | Event | browser → supervisor | mensagem de controle (§2) |
| 0x03 | Hello | browser → supervisor | vazio |
| 0x04 | Command | supervisor → browser | mensagem de controle (§2) |
| 0x05 | Telemetry | browser → supervisor | `u16 catalogId` + `bytes` opacos. Supervisor encaminha; não parseia. |
| 0x06 | Asset | **mão dupla** | `u32 streamId`, `u8` fase (`0 request` / `1 chunk` / `2 denied` / `3 complete`), `u64 offset`, `bytes`. Recusa HTML/JS/CSS/XHR é fase `denied` no falso/Gecko, não MIME no supervisor. |

O `ContextId` viaja **no envelope**. É isso que permite ao supervisor rotear sem
nunca interpretar o conteúdo — a regra de `11-supervisor-linguagem.md` §9: o
supervisor é cego ao frame; o frame é carga opaca.

No WS do consumidor o comando de controle viaja **cru** (mensagem de §2, sem
envelope). Ativo do consumidor viaja **envelope Kind 0x06 completo**: o campo
Length tem de bater com o resto da mensagem, e o payload tem de ter pelo menos
`streamId + fase + offset`. Olhar só o primeiro byte não serve — `HistoryGo`
é `0x0106`, little-endian começa com `0x06`.

Teto de sanidade por payload: 64 MiB. Payload maior é violação de protocolo, não
condição a tratar.

---

## 2. Mensagem de controle

Payload dos envelopes `Event` e `Command`:

```
u16  OpCode
u32  CorrelationId
...  Campos, na ordem definida por OpCode
```

Assíncrono: `CorrelationId` identifica a resposta de um comando, e nada bloqueia a
linha esperando por ela. Resposta sem comando correspondente é descartada com log,
não é erro fatal.

### Codificação de campos

| Tipo | Forma |
|------|-------|
| `u8` `u16` `u32` `u64` | inteiro sem sinal, little-endian |
| `i32` | inteiro com sinal, complemento de dois |
| `bool` | `u8`, 0 ou 1 |
| `str` | `u32` byteLen + bytes UTF-8 |
| `bytes` | `u32` len + bytes |

---

## 3. OpCodes

Faixas separadas por sentido, para que um erro de direção seja detectável em vez
de silencioso.

### 0x01xx — supervisor → browser (Command)

| OpCode | Nome | Campos |
|--------|------|--------|
| 0x0101 | ContextCreate | `u32` contextId, `i32` width, `i32` height |
| 0x0102 | ContextDestroy | `u32` contextId |
| 0x0103 | Navigate | `u32` contextId, `str` url |
| 0x0104 | Reload | `u32` contextId |
| 0x0105 | Stop | `u32` contextId |
| 0x0106 | HistoryGo | `u32` contextId, `i32` delta |
| 0x0107 | ViewportSet | `u32` contextId, `i32` width, `i32` height |
| 0x0108 | Input | `u32` contextId, `u8` tipo, campos do tipo (abaixo). Sem JSON. Sem MessagePack. |
| 0x0109 | Resync | `u32` contextId, `u8` força (0 = mapa/`emitResyncFrame`, 1 = walk/`resyncVirtual`) |
| 0x010a | DialogRespond | `u32` contextId, `u32` requestId, `bytes` resposta |
| 0x010b | PermissionRespond | `u32` contextId, `u32` requestId, `bool` concedido |
| 0x010c | DownloadRespond | `u32` contextId, `u32` requestId, `bool` aceito |
| 0x010d | HaltClocks | — (aba inteira: todos os `C`) |
| 0x010e | ResumeClocks | — |
| 0x010f | FlushFrame | `u32` contextId |
| 0x0110 | Snapshot | `u32` contextId |
| 0x01ff | Shutdown | — |

`HaltClocks` para o timer da aba. A fila **continua**; `FlushFrame` chama `emitFrame`. Não é `discardPending` — isso só no resync, enquanto reconstrói. Halt zerar o builder perde mutação e o dump de S mente.

`FlushFrame` e `Snapshot` são de um `C`. Nested: `sequence` não alinha entre pai e filho.

`Input` usa os **mesmos tipos de campo** desta ABI. O supervisor relaya o comando
e não interpreta o gesto. O payload **não** é saco opaco nem JSON do lab Chromium.

`tipo`: `1` down, `2` up, `3` keyDown, `4` keyUp, `5` scrollSet. Outro valor: não
aplica (não derruba a ponte). `move` não existe neste fio. Histórico é
`HistoryGo`, não `Input`. `setFiles` é **1.1**, não deste V1.

| tipo | Campos depois do `u8` |
|------|------------------------|
| 1, 2 | `u32` nodeId, `u16` localX, `u16` localY, `u8` botão (0 esquerda, 1 meio, 2 direita) |
| 3, 4 | `str` key, `str` code, `u8` mods (bit0 ctrl, bit1 shift, bit2 alt, bit3 meta) |
| 5 | `u32` nodeId (`0` = viewport), `u16` fracX, `u16` fracY |

`local*` e `frac*` são 0…65535 = [0, 1], origem no canto superior esquerdo da
caixa do nó. `nodeId` 0 em down/up: não aplica. Sem `local*` neste fio — centro
é `32768, 32768`. Apply: id da tabela → nó vivo → `HeadlessWidget`. Sem CDP.

`Resync`: a força vem na mensagem. O C++ não decide qual resync aplicar
(`12-ponte-controle-vocabulario.md`).

### 0x02xx — browser → supervisor (Event)

| OpCode | Nome | Campos |
|--------|------|--------|
| 0x0201 | Ready | — |
| 0x0202 | Heartbeat | `u64` monotonicMs |
| 0x0203 | ContextCreated | `u32` contextId, `u64` browsingContextId, `u32` parentContextId (sempre `0`) |
| 0x0204 | ContextDestroyed | `u32` contextId |
| 0x0205 | Navigated | `u32` contextId, `str` url |
| 0x0206 | LoadStateChanged | `u32` contextId, `u8` estado |
| 0x0207 | DialogRequested | `u32` contextId, `u32` requestId, `bytes` descrição |
| 0x0208 | PermissionRequested | `u32` contextId, `u32` requestId, `bytes` descrição |
| 0x0209 | DownloadRequested | `u32` contextId, `u32` requestId, `bytes` descrição |
| 0x020a | SnapshotServed | `u32` sequence, `u32` generation, `u32` contextId, `u64` tableHash, `bytes` dump. Mesmo `CorrelationId` do `Snapshot`. Estoura teto → `Fault` com causa `response_too_large`, nunca dump ilimitado. |
| 0x02ff | Fault | `u32` contextId (0 = sessão), `str` causa |

`Fault` não derruba nada por si: quem decide o que fazer com a falha é o
supervisor.

`LoadStateChanged.estado`: `1` = start, `2` = stop (document top-level).
`Navigated` é o commit da carga **pedida** — START e depois STOP dessa carga,
não o STOP de um about:blank ou da página anterior. A janela do `ContextCreate`
não enfileira URI de conteúdo; quem navega é o `Navigate`. `ContextCreated` só sai
quando a aba está quieta; se ainda está carregando, espera o STOP.
`parentContextId` é resto do ABI: nested não emite `ContextCreated`. O `C` do
iframe viaja no frame e no `NODE_NEW` do host.

---

## 4. Regras

**Ordem.** Um canal, uma ordem. Mensagens chegam na ordem em que foram escritas, e
nenhum plano tem prioridade sobre outro no transporte.

**Escrita atômica.** Um envelope nunca sai entrelaçado com outro. Escrita curta é
completada em laço, dos dois lados.

**Desconhecido não é fatal.** OpCode desconhecido é registrado e ignorado — nunca
derruba a ponte. Isso permite que os dois lados avancem de versão sem lockstep.

**Versão.** Não há negociação de versão na v1. O par supervisor+browser é
construído e implantado junto (`10-orquestrador.md`); versões divergentes são erro
de implantação, não condição de runtime.

**Falha de transporte é fatal.** Romper a ponte encerra a sessão dos dois lados
(`15-vida-da-sessao.md`). Não há reconexão.

---

## 5. Descartados

**5.1 JSON UTF-8 no payload de controle.** Foi a primeira implementação. Sai
porque frames, resync e input (scroll/tecla em rajada) vão no mesmo canal:
parse de texto com alocação por mensagem é o custo errado no caminho quente.
**Não** é justificativa de stream de `pointermove`. Texto era conveniente para
depurar; a conveniência não paga o preço.

**5.2 Canal separado por plano.** `17-runtime-de-projecao.md` §4.

**5.3 Negociação de versão.** §4 — o par é implantado junto.
