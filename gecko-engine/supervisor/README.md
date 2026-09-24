# Supervisor e Lab (Gecko)

**Debug / parity só de fora:** [docs/gecko-engine/lab-debug-surface.md](../../docs/gecko-engine/lab-debug-surface.md).
A API de observação Virtual é o WS do consumidor do supervisor; o lab é o primeiro caller.
`capture.sh` / `doctor.sh` são fork/build — não bar de accept.

Contrato do fio: [docs/gecko-engine/redesign/08-fio.md](../../docs/gecko-engine/redesign/08-fio.md)
e [schema/speculum.wire.toml](../../docs/gecko-engine/redesign/schema/speculum.wire.toml).
As três pontas usam codecs **gerados** (`SpeculumWire.gen` / `speculum_wire.gen.ts`).
Não há Kind 9B / ControlAbi em paralelo.

```
Supervisor (.NET)  --spawn-->  Gecko (fork)
       ^                            |
       |    unix socket   <-- processo pai <-- IPC <-- processos de conteúdo
       |    envelope 16B + opcodes do schema
       |
   interface do supervisor (WebSocket)
       |
   Lab (.NET) — primeiro caller do vocabulário ViewportOpen…Shutdown
       |
   HTTP 4077: client.html + client.js
   WS /lab/session: JSON controle + binário frames
       |
   seu navegador (ProjectionClient + codec gerado)
```

## O supervisor é dono do browser

Uma sessão é um par supervisor+browser. O par **nasce junto e morre junto**:
o supervisor sobe o Gecko como processo filho, recebe a conexão dele no socket, e
quando o browser termina o supervisor termina.

Política (força de resync, retry de navegação, vazão de offers) mora **só** no Supervisor
(`SessionPolicy`). O motor aplica o `force` que chega no `Resync` do wire.

## Protocolo do envelope (processo pai ↔ supervisor)

Unix domain socket. Cabeçalho de **16 bytes**, little-endian (08-fio / schema):

```
u16  OpCode
u16  Reserved       // zero
u32  TargetId       // host ou viewport; 0 = sessão
u32  Length
u32  Correlation    // 0 = espontânea
...  Payload        // codec gerado (Patch.deltas carrega ISA opaco para o supervisor)
```

O `TargetId` viaja **no envelope**. O supervisor roteia sem interpretar o conteúdo do Patch —
a carga de projeção continua opaca no plano de consumo.

Hash do schema (`SchemaMeta.Sha256` / `SCHEMA_SHA256` / `schema.sha256`) é checado na
abertura: divergência = erro de implantação (`schema_hash_mismatch`), não warning.
Env opcional: `SPECULUM_SCHEMA_SHA256` deve bater com o tip embutido.

## Configuração

| Variável | Padrão | Onde |
|---|---|---|
| `SPECULUM_BROWSER_BIN` | **obrigatória** | lab (repassa ao supervisor) |
| `SPECULUM_SUPERVISOR_BIN` | binário publicado do supervisor | lab |
| `SPECULUM_BROWSER_URL` | `about:blank` | supervisor (vem do lab por sessão) |
| `SPECULUM_BROWSER_PROFILE` | perfil temporário por execução | supervisor |
| *(prefs de produto)* | em todo launch o supervisor escreve no `user.js` do perfil o bloco *single session tab* | `ProductProfilePrefs` |
| `SPECULUM_BROWSER_HEADLESS` | lab: default `0` (janela); `1` = headless | lab → supervisor |
| `SPECULUM_BROWSER_SOCKET` | `/tmp/speculum-browser.sock` | supervisor |
| `SPECULUM_CAP_EVENTS` | off | supervisor → Firefox (telemetria schema) |
| `SPECULUM_CAP_METRICS` | off | supervisor → Firefox |
| `SPECULUM_SCHEMA_SHA256` | tip embutido | se setado, deve coincidir |
| `SPECULUM_SUPERVISOR_PORT` | `4100` | supervisor |
| `SPECULUM_LAB_HOST` | `127.0.0.1` | lab |
| `SPECULUM_LAB_PORT` | `4077` | lab |
| `SPECULUM_SUPERVISOR_WS` | `ws://127.0.0.1:4100/session` | lab |
| `SPECULUM_LAB_STATIC` | `sidecar/.../lab/static` | lab |
| `SPECULUM_LAB_FIXTURES` | `sidecar/.../lab/fixtures` | lab |

## Rodar

```bash
cd gecko-engine/supervisor
dotnet build

OBJ=$(cd ~/speculum-gecko/checkout && ./mach environment --format=json \
      | python3 -c 'import sys,json;print(json.load(sys.stdin)["topobjdir"])')

SPECULUM_BROWSER_BIN="$OBJ/dist/bin/firefox" \
  dotnet run --project src/Speculum.Lab
```

Abra <http://127.0.0.1:4077/>, **Connect**, escreva a URL, **Start Virtual**.

Gate da Fase 10: `npm run ci:all` (inclui `scripts/ci/run-phase10.sh`).
