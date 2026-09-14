# Supervisor e Lab (Gecko)

Fase **F1** do plano do supervisor: o frame sai do processo pai do Gecko, atravessa
o supervisor e chega ao cliente projetado aberto no seu navegador.

```
Supervisor (.NET)  --spawn-->  Gecko (fork)
       ^                            |
       |    unix socket   <-- processo pai <-- IPC <-- processos de conteúdo
       |
   interface do supervisor (WebSocket)
       |
   Lab (.NET)
       |
   HTTP 4077: client.html + client.js
   WS /lab/session: JSON controle + binário frames
       |
   seu navegador
```

## O supervisor é dono do browser

Uma sessão é um par supervisor+browser (doc 10). O par **nasce junto e morre junto**:
o supervisor sobe o Gecko como processo filho, recebe a conexão dele no socket, e
quando o browser termina o supervisor termina (doc 15, "caiu = morre").

Não existe browser avulso se conectando a um supervisor que estava esperando, e não
existe opção que mude esse comportamento. **Bandeira de modo faria o lab exercitar um
supervisor diferente do de produção — e um lab que testa outro binário é falso
positivo.** Toda variável de ambiente aqui é parâmetro de lançamento, nunca chave de
comportamento.

O `devpath/capture.sh` continua existindo para o harness de regressão, com o sink de
diretório. Ele não participa do fluxo do lab.

## O cliente projetado não foi portado

`Speculum.Lab` serve o `client.html` / `client.js` do lab TypeScript existente, no
lugar onde eles já estão (`sidecar/browser/mirror/projection/lab/static`). Sem cópia,
sem fork. Uma correção no applier vale nos dois hosts no mesmo instante.

Para isso o lab .NET fala o **lab protocol v1**, que é o contrato que esse cliente já
espera. Referência: `sidecar/browser/mirror/projection/lab/host/protocol.ts`.

## Protocolo do envelope (processo pai ↔ supervisor)

Unix domain socket. Cabeçalho de 9 bytes, little-endian, seguido do payload:

```
u8   Kind        0x01 Frame · 0x02 BrowserEvent(JSON) · 0x03 Hello · 0x04 Control(JSON)
u32  ContextId   roteamento; 0 quando não se aplica
u32  Length      bytes de payload
...  Payload     opaco para o supervisor
```

O `ContextId` viaja **no envelope**, não é lido de dentro do frame. É isso que permite
ao supervisor rotear sem nunca interpretar o conteúdo — a regra do doc 11 §9: o
supervisor é cego ao frame; o frame é carga opaca.

## Configuração

| Variável | Padrão | Onde |
|---|---|---|
| `SPECULUM_BROWSER_BIN` | **obrigatória** | lab (repassa ao supervisor) |
| `SPECULUM_SUPERVISOR_BIN` | binário publicado do supervisor | lab |
| `SPECULUM_BROWSER_URL` | `about:blank` | supervisor (vem do lab por sessão) |
| `SPECULUM_BROWSER_PROFILE` | perfil temporário por execução | supervisor |
| `SPECULUM_BROWSER_HEADLESS` | `1` (`0` para janela visível) | supervisor |
| `SPECULUM_BROWSER_SOCKET` | `/tmp/speculum-browser.sock` | supervisor |
| `SPECULUM_SUPERVISOR_PORT` | `4100` | supervisor |
| `SPECULUM_LAB_HOST` | `127.0.0.1` | lab |
| `SPECULUM_LAB_PORT` | `4077` | lab |
| `SPECULUM_SUPERVISOR_WS` | `ws://127.0.0.1:4100/session` | lab |
| `SPECULUM_LAB_STATIC` | `sidecar/.../lab/static` | lab |
| `SPECULUM_LAB_FIXTURES` | `sidecar/.../lab/fixtures` | lab |

## Rodar

O lab é o **caller**: ele sobe a sessão. Não há script intermediário — pedir sessão
e ter sessão são o mesmo ato.

```bash
cd gecko-engine/supervisor
dotnet build

OBJ=$(cd ~/speculum-gecko/checkout && ./mach environment --format=json \
      | python3 -c 'import sys,json;print(json.load(sys.stdin)["topobjdir"])')

SPECULUM_BROWSER_BIN="$OBJ/dist/bin/firefox" \
  dotnet run --project src/Speculum.Lab
```

Abra <http://127.0.0.1:4077/>, **Connect**, escreva a URL, **Start Virtual**.

O lab lança o supervisor; o supervisor lança o Gecko e pede o contexto; o Gecko
abre a aba e navega; os frames sobem até a sua tela. **Stop Virtual** derruba o
par. Um clique, uma sessão.

## Publicar o supervisor (NativeAOT)

```bash
dotnet publish src/Speculum.Supervisor -c Release -r linux-x64
```

`Speculum.Lab` é ferramenta de desenvolvimento: não entra no produto e por isso não
carrega a restrição de AOT.

## Estado

Implementado: F1 — o supervisor conduz a sessão e o frame chega ao cliente projetado.

Ainda não: `requestSnapshot`, input, runner de blueprints. O `LabSessionConnection`
aceita em silêncio as mensagens do protocolo v1 dessas fases em vez de responder
erro — para não ensinar o cliente a desconfiar de mensagem correta.

## Limitação conhecida

O supervisor não guarda frame. Um consumidor que conecta depois do bootstrap não
recebe o que já passou. A cura é `Resync(mapa)` no bind do consumidor e
`client.requestResync` — não adiar o lançamento da sessão.
