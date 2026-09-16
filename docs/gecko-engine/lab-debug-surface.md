# Lab debug surface — observação do par Gecko só de fora

**Status:** normativo para debug/parity do par supervisor+Gecko.  
**Não é:** Diagnostics HTTP da API Speculum (`docs/diagnostics.md`).  
**Não é:** `MOZ_LOG`, `devpath/capture.sh`, `devpath/doctor.sh` (fork/build only).

A API de observação da sessão **Virtual** é o WebSocket do **consumidor do supervisor** (doc 11). O lab (`http://127.0.0.1:4077`) é o primeiro caller fora da caixa. Live usará o **mesmo** WS.

```text
Gecko --unix--> Supervisor --WS consumidor--> Lab (dev) | Live (produto)
```

## Dois planos (não colapsar)

| Plano | Origem | Saída |
|-------|--------|-------|
| **Virtual** | Gecko / ponte / supervisor | Só WS consumidor (Frame, Kind `0x05`, Event ABI, Kind `0x06`) |
| **Projected** | Browser que aplica o frame | Uplink do client (`client.telemetry`, `client.snapshotResult`; produto: hub Live) |

Desync / apply fail **não** nascem no unix socket. Caps Gecko **não** ligam telemetria Projected.

## Caps no create

| Param (`browse.start.telemetry`) | Env | Efeito |
|----------------------------------|------|--------|
| `enabled` | `SPECULUM_CAP_EVENTS` | Emite Kind `0x05` |
| `clock` ∧ events | `SPECULUM_CAP_METRICS` | Preenche `buildMs` |

Fluxo: lab `browse.start` → env do processo supervisor → supervisor copia para o Firefox (`SpeculumCaps`). Sem toggle em runtime. Default lab (omitido) = on; default produto (env ausente) = **off**.

## Superfícies

| Permitido (parity / site debug) | Proibido |
|---------------------------------|----------|
| `GET /lab/health` | `docker exec` / shell na caixa |
| `WS /lab/session` (protocol v1 + binário PP) | Unix socket do browser |
| Estáticos projected servidos pelo lab | `capture.sh` / `doctor.sh` como fonte de verdade |
| WS consumidor do supervisor (mesmo contrato) | Assert de iso por telemetria de evento (I10) |

## Matriz de erros

### Virtual → WS consumidor

| Classe | Sinal | Cap |
|--------|-------|-----|
| Par não sobe / crash | sem Ready; processo morto | — |
| Ponte caiu | close no consumidor (doc 15) | — |
| Fault `0x02ff` | Event (`errorCode`+`phase`) | — |
| Cold sem frame | zero Frame na janela de boot | — |
| Resync * | `0x05` ids 2–4 | EVENTS |
| Input rejected | `0x05` id 7 | EVENTS |
| Snapshot / oversized | SnapshotServed ou Fault | — |
| Asset denied | `0x06` denied | — |
| Dialog/permission/download | Event pedido | — |
| Drop de fila | contador no hub | — |
| Caps off | zero `0x05` | EVENTS=0 |
| `buildMs` | FrameEmitted | EVENTS+METRICS |

### Projected → uplink

| Classe | Sinal |
|--------|-------|
| Desync / apply fail / gate | `client.telemetry` |
| Armed / blank / iso | `client.snapshotResult` + Snapshot Virtual |

Estado em S = probe (Snapshot ABI + `requestSnapshot`). Eventos = investigação, nunca accept.

## Lab = caller

O lab sobe o par, consome o WS do supervisor, demuxa, traduz para protocol v1. Decode Virtual mora em `Speculum.Supervisor` (Wire/Control); o lab não é fonte paralela de verdade do plano Virtual.

## Referências

- Envelope / caps: [18-abi-controle.md](18-abi-controle.md)
- Supervisor = interface: [11-supervisor-linguagem.md](11-supervisor-linguagem.md)
- Instrumentação Gecko: [20-projecao-completa.md](20-projecao-completa.md) §8
- Evento ≠ probe ≠ accept: [../page-projection/spec/observability.md](../page-projection/spec/observability.md)
- README operacional: [../../gecko-engine/supervisor/README.md](../../gecko-engine/supervisor/README.md)
