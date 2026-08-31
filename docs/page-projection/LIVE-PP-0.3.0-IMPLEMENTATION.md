# Live PP → 0.3.0 / prod — ordem de implementação

**Status:** scratchpad operacional (2026-08-30).  
**Não substitui** [spec/motor-0.3.0.md](spec/motor-0.3.0.md) (gates do tag) nem [spec/acceptance.md](spec/acceptance.md) (aceite 1:1).  
**Normativo:** [spec/README.md](spec/README.md) **Now** · [spec/open.md](spec/open.md) · [spec/browser-session.md](spec/browser-session.md).

---

## Framing (não misturar)

| Camada | Promessa | Onde |
|--------|----------|------|
| **A — Tag `v0.3.0` motor** | Motor lab-proven; early adopter; limitações honestas | Este doc §A · [motor-0.3.0.md](spec/motor-0.3.0.md) |
| **B — Live preview honesto** | `MirrorMode.PageProjection` no dockup/CI com efeito | Este doc §B |
| **C — Prod RBI (M1)** | Aceite 1:1, canvas, antibot | Este doc §C · [roadmap.md](spec/roadmap.md) |

**Fato:** o fio Api ↔ gRPC ↔ sidecar PP ↔ web **já está plugado** (Launch / Frames / PushDom / Resync / Assets). O trabalho abaixo é **maturidade + limpeza + CI + produto**, não inventar o carrier.

**Já landed (sessão Live, não reabrir como gap):**

- [x] Domain guard main-frame PP (Fetch Request + allowlist) + NavigationBlocked → Redirect
- [x] IDB/localStorage restore/export via `PageState` no PP (+ multi-origin seed)
- [x] PermissionGate origin → EventBridge → `grantPermissions`
- [x] `cpu_profiling` no Launch proto/mappers + probes no factory Live

---

## Inventário gRPC / .NET (contrato)

### Já wired E2E

| Hop | Onde |
|-----|------|
| Launch PP/VS | `GrpcSessionConnection.LaunchBrowserAsync` · `LaunchPageProjection` / `LaunchVideoStreaming` |
| Frames | `WatchPageProjectionFrames` → `SessionDataStreamsHost` → web `ProjectionClient` |
| Input | `PushDomInput` → `PageProjectionBrowserSession.pushInput` |
| Resync | HTTP `/page-projection/resync` → `RequestResync` |
| Assets | `GetDomAsset` + `/w7s/virtual-assets/...` |
| State | `RestoreState` / `ExportState` |
| Nav / Resize / Probe | unary shared |
| Control | cam/mic `PermissionRequest` / `PermissionReply` |
| Blocked | `WatchNavigationBlocked` → `Redirect` |

### Gaps de contrato (completar ou documentar)

| Item | Sidecar | .NET | TODO |
|------|---------|------|------|
| `PutDomUpload` | handler ok; PP `putUpload` **no-op** | `PutDomUploadAsync` | §C — implementar store ou tirar do path Live |
| `PushCamera` / `PushMicrophone` | handler; PP **no-op** | **não abre** streams | §C — MediaIngress + Conn pump |
| `GoBack` / `GoForward` unary | sim | Conn **não chama** (intent) | §B — documentar “só intent” **ou** expor no Conn |
| Lab RPCs (`HaltClocks`, `EmitFrame`, `GetStateSnapshot`) | sim | **sem cliente** | OK — não plugar em prod |
| `startCpuProfile` / `stopCpuProfile` | in-process + flag Launch | só propaga flag | OK 0.3.0; RPC só se diag Live exigir |
| Launch knobs pré-V4 (`establish_chunk_bytes`, `client_state_ms`, …) | mapeados | `PageProjectionOptions` | §B — limpar ou marcar obsolete |
| Telemetry catalog `Establish.DomMap*` / ResyncServed “OOB” | — | catálogo/web | §B — alinhar V4 (resync = frame stream) |

**Arquivos âncora:** `proto/browser_session.proto` · `sidecar/grpc/BrowserSessionService.ts` · `Speculum.Api/BrowserClients/Grpc/GrpcSessionConnection.cs` · `GrpcSessionMappers.cs` · `sidecar/browser/contracts/index.ts`.

---

## A — Tag `v0.3.0` (motor) — ordem canônica

Gates oficiais: [motor-0.3.0.md](spec/motor-0.3.0.md). Só estes bloqueiam o tag.

### A1 — PP-NESTED-GEN-PACK revert (GATE — wire)

- [ ] Remover packing interim `(rootGen << 16) | installIndex` do wire
- [ ] Voltar mint SW monotônico; nested recebe gen via bus (não nested→SW)
- [ ] Atualizar encode/decode + units + [open.md](spec/open.md) / [frame-protocol.md](spec/frame-protocol.md) se preciso
- [ ] **Antes do tag** — encoding sujo vira superfície de compat

**Refs:** [open.md](spec/open.md) · [motor-0.3.0.md](spec/motor-0.3.0.md) gate 4

### A2 — Eneba `/` → `/br/` proof (GATE — proof)

- [ ] Lab browse `www.eneba.com/` (não só `/br/`)
- [ ] Dossier: redirect + Turnstile nested + gen bump
- [ ] Assert: apply gate sem `sequence_gap` storm; desync 0
- [ ] Anexar path do dossier em motor-0.3.0 / CHANGELOG

**Baseline já green:** `sidecar/lab-runs/2026-08-30T06-10-17-942Z-www.eneba.com` (`/br/` direto)

### A3 — B3 SessionCollector (GATE if red)

- [ ] Reproduzir `SessionCollectorTests.TimedOut_DoesNotFireAfterReattachClaimRace` em `main`
- [ ] Se red: fix (race pós-`AddRef` / `IsDetached`) ou atribuir dono
- [ ] Se green: marcar DONE em motor-0.3.0

**Refs:** `Speculum.Api/Sessions/Services/SessionCollector.cs` · Sessions.Tests

### A4 — Windows / full gates (GATE)

- [ ] `cd sidecar && npm test` + build (virtuais / package)
- [ ] Dotnet unit relevante (Api + Sessions.Tests)
- [ ] SessionsTest CI: honestidade — category PP **ainda fraca**; não fingir cobertura Video = PP
- [ ] Fixar falhas **pré-existentes** que bloqueiam gate (ex. bus units se ainda red: `portCarrier`, mocks `localName`)

### A5 — Known limitations (GATE — honesty)

- [ ] [motor-0.3.0.md](spec/motor-0.3.0.md) § “does not promise” completo
- [ ] `CHANGELOG.md` `[0.3.0]`: antibot, canvas, accept 1:1, multi-session, MotorAssert deep
- [ ] `version.txt` = `0.3.0`

### A6 — Tag

- [ ] Só após A1–A5
- [ ] **Não** prometer RBI / aceite sealed no anúncio do tag

**Polish pós-tag (não bloqueia A):** lab sink applyGate*; limpar métricas dossier 0; `verdicts.json` em blueprints.

---

## B — Live preview honesto (pós-tag / early adopter)

Objetivo: operador liga PP no stack completo e o CI prova **efeito**, não hop verde.

### B1 — Flip config / seed

- [ ] Documentar (e opcional seed compose) `Sessions.MirrorMode = PageProjection`
- [ ] `deploy/compose/docker-compose.sessions-test.yml` + `seed-sessions-test.sh`: valor MirrorMode PP
- [ ] Admin Configurations: path óbvio; SPA já lê `mirrorMode` do client-config **antes** do Start

**Refs:** `SessionsConfiguration.cs` · `PublicClientConfigProjector` · `web/.../sessionPreStart`

### B2 — SessionsTest category PP (mínima)

- [ ] Criar category/filter real `PageProjection` (não reusar asserts VideoStreamingInput como prova PP)
- [ ] Casos mínimos (Act → Assert por **estado/evento**, nunca só `200`):
  - [ ] Start + `WatchPageProjectionFrames`: body + `contextId` + sequence
  - [ ] Intent click → efeito no Virtual/Projected (oracle / snapshot)
  - [ ] Resync HTTP → frame resync + surface armada (sem DomMap dump)
  - [ ] NavigationBlocked → `Redirect` (allowlist)
  - [ ] Restore profile com LS/IDB → assert counts / probe (não soft-skip)
- [ ] Atualizar [MATRIX.md](../../Speculum.Api.SessionsTest.Tests/MATRIX.md) depth
- [ ] CI `.github/workflows/ci.yml`: job ou seed com MirrorMode PP

**Refs:** `Speculum.Api.SessionsTest.Tests` · `docs/assert-failure-policy.md` · `docs/page-projection/spec/observability.md`

### B3 — Limpeza contrato pré-V4 (gRPC + .NET + web)

- [ ] Proto / `PageProjectionOptions`: marcar ou remover `establish_chunk_bytes`, `client_state_ms` (ReportClientState purged)
- [ ] Mappers Api + sidecar: não mentir knobs mortos
- [ ] Catálogo journal/admin: remover ou renomear `Establish.DomMap*`
- [ ] Copy `ResyncServed`: “frame no stream”, não “OOB snapshot”
- [ ] Docs stale: roadmap “CSSOM live 0%”, “OS input”, header “temporary until Live flip” em `PageProjectionBrowserSession.ts`

**Decisão GoBack/GoForward:**

- [ ] Opção travada: **(1)** documentar histórico só via intent PP, **ou (2)** `ISessionConnection.GoBack/GoForward` → unary gRPC

### B4 — PP-HARDNAV-PLANE-ACK

- [ ] Fechar race hello-ack pós hard-nav / extension Port ([open.md](spec/open.md))
- [ ] Lab/dossier site real com hard nav; zero `data_plane_not_established` falso

### B5 — Validação sessão plena (regressão do que já landed)

- [ ] Live: allowlist main-frame + Redirect no client
- [ ] Live: restore/export LS+IDB round-trip perfil
- [ ] Live: PermissionGate → Control → SessionHooks (default deny; register allow em teste)
- [ ] Live: `Sessions.CpuProfiling=true` → probes registrados (sem RPC Start ainda)

---

## C — Prod RBI / M1 cutover

Não é gate do tag 0.3.0. Ordem após B.

### C1 — Canvas (gate 7)

- [ ] Conteúdo canvas no `@speculum/page-projection` (sair do placeholder)
- [ ] Wire Virtual → frame → Projected apply
- [ ] Lab + oracle visual mínimo

### C2 — MotorAssert / Live deep

- [ ] Compose seed `MirrorMode.PageProjection` para MotorAssert
- [ ] Intents profundos + parity probes (não smoke)

### C3 — Antibot / stealth V3

- [ ] Spike V3 em Turnstile/CF real
- [ ] Bisseção patchright vs extensão se necessário
- [ ] **Sem** isto: não chamar RBI de produção

### C4 — Aceite 1:1

- [ ] Oracles O1/O2/O5 em sites baseline ([oracles.md](spec/oracles.md), [acceptance.md](spec/acceptance.md))
- [ ] Nunca PASS por protocolo-only (`200`, WD>N, htmlLen)

### C5 — Assets / upload / media

- [ ] Asset store “real” (densidade / antibot-facing)
- [ ] `PutDomUpload` deixa de ser no-op **ou** some do path Live
- [ ] MediaIngress + Conn `PushCamera`/`PushMicrophone` se produto exigir GUM

### C6 — Nested XO / limites

- [ ] Estratégia sem punch XFO (`PP-ASSET-XFO`)
- [ ] about:blank / srcdoc / sandbox opaco conforme [open.md](spec/open.md) / seal-gaps

### C7 — Densidade multi-session

- [ ] Smoke 2 Chrome live (C2 isolation) se for claim de produção
- [ ] Backpressure fila frames sob carga (produto, não só knobs)

### C8 — Encerrar scratchpads

- [ ] Apagar ou arquivar [CUTOVER-WORKSPACE.md](CUTOVER-WORKSPACE.md) quando produto restante fechar
- [ ] Atualizar este arquivo: marcar C* done ou mover residual pra open.md

---

## Ordem de execução (checklist mestre)

```text
A1 gen-pack revert
A2 Eneba / → /br/
A3 B3 se red
A4 Windows gates
A5 limitations + CHANGELOG
A6 tag v0.3.0
───
B1 seed MirrorMode PP
B2 SessionsTest PP mínima
B3 limpeza proto/.NET/telemetry pré-V4
B4 HARDNAV plane ack
B5 regressão state/nav/perm/cpu Live
───
C1 canvas
C2 MotorAssert deep
C3 stealth V3
C4 accept oracles
C5 upload/media/assets
C6 nested XO
C7 multi-session density
C8 fechar cutover scratchpads
```

---

## Fora de escopo / ruído (não reabrir)

- [x] B1 per-session `c2-endpoint.json` — shipped 2026-08-29
- [x] B2 `managedTabId` — withdrawn (1 session = 1 tab)
- [ ] Não implementar de `docs/page-projection/archive/`
- [ ] Não plugar lab RPCs no Live prod
- [ ] Não declarar accept por hopdiag / ResyncServed / ownedRules sozinhos

---

## Referências rápidas

| Tema | Path |
|------|------|
| Gates tag | [spec/motor-0.3.0.md](spec/motor-0.3.0.md) |
| Open named | [spec/open.md](spec/open.md) |
| Session sealed | [spec/browser-session.md](spec/browser-session.md) |
| Aceite | [spec/acceptance.md](spec/acceptance.md) |
| Roadmap M1 | [spec/roadmap.md](spec/roadmap.md) |
| Cutover temp | [CUTOVER-WORKSPACE.md](CUTOVER-WORKSPACE.md) |
| Proto | `proto/browser_session.proto` |
| Sidecar PP | `sidecar/browser/mirror/projection/session/PageProjectionBrowserSession.ts` |
| Api Conn | `Speculum.Api/BrowserClients/Grpc/GrpcSessionConnection.cs` |
| Web surface | `web/src/features/sessions/live/SessionMirrorSurface.tsx` |
