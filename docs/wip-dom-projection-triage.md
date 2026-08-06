# WIP — Dom Projection triage (temporário)

**Status:** rascunho de trabalho · **não** é contrato V1  
**Escopo:** separar débitos pós-debug local e priorizar o que fecha o **fluxo/pipeline** antes de polir a **Projected DOM**.  
**Atualizado:** 2026-08-05  
**Apagar/arquivar** quando o pipeline estiver redondo e a lista tiver sido absorvida em issues/PRs ou docs oficiais.

---

## Decisão de prioridade

**Concordo:** Dom Projection está **boa o suficiente** para testes iniciais de sessão.  
Próximo foco = **pipeline e fluxo 100% redondo** (Start → live → navigate → assets → input → stop/resync), depois voltar a polir projeção.

| Fase | Objetivo |
|------|----------|
| **1 — Pipeline / fluxo** | Sessão previsível de ponta a ponta; sem gambiarra de rota/auth/transport |
| **2 — Dom Projection polish** | Isomorfismo CSS/DOM, input fino, pierce, overflow, rewrite robusto |

**Não feito neste WIP:** hardcode por site (Eneba/Google). Fixes de projeção já aplicados foram genéricos (flatten `html`/`body`, unidades CSS, anchors).

---

## A — Problemas de pipeline e fluxo

*Tudo que é “a sessão existe, conecta, navega, autentica assets, sincroniza URL/viewport, entrega diffs/input” — independente de quão fiel a pintura está.*

### A1. Sessão / ciclo de vida

| ID | Sintoma / risco | Notas |
|----|-----------------|-------|
| P-START | Catch-all `*` (`SessionLivePage`) auto-`StartSession` com path/query do browser | Precisa ser determinístico: operational gate, fail-closed em `/w7s/*`, re-start vs refresh |
| P-STOP | Stop / detach / timeout / recover | Baseline MotorAssert: Degraded + recover antes de probes |
| P-GEN | `generation` bump + resync após navegação / miss de sequência | Cliente pede `resync`; gaps não podem deixar árvore zumbi sem caminho de recuperação |
| P-MODE | `MirrorMode.DomProjection` vs video | Config Sessions → client-config → surface correta |

### A2. URL / NSO / Navigate

| ID | Sintoma / risco | Notas |
|----|-----------------|-------|
| P-NSO | `_w7s_nso` na barra vs SyncUrl do servidor | Lab vs Live; não corromper state no Navigate |
| P-NAV | Navigate allowlist / blocked vs rejected | Contratos Diagnostics já existem; fluxo UI deve refletir |
| P-BAR | Display URL (`localhost/` vs path virtualizado) | Lab mostrou `BROWSER \| localhost/` em cases; clareza operador |

### A3. Transport / wire

| ID | Sintoma / risco | Notas |
|----|-----------------|-------|
| P-DS | DataStream WT vs WS (`Sessions.DataStreamTransport`) | Connect, mux, fallback; refresh após Save config |
| P-HUB | Hub Start / DomDiff / DomInput ordering | MessagePack DTOs; token de sessão |
| ~~P-TOKEN~~ | ~~Cookie `speculum_session_token` + `?token=` em virtual assets~~ | **Fechado.** Cookie morto; auth só no param reservado `speculum-session-token`; `token=` do site preservado na URL **e** na chave de cache (era 401 *e* `asset_missing` 404). `@import`/`image-set` string-form, `xlink:href`, `data-src` também tokenizados. Contrato em `dom-projection-virtual-assets.md` §1.1 |

### A4. Edge / assets (serve plane)

| ID | Sintoma / risco | Notas |
|----|-----------------|-------|
| P-PROXY | Traefik + nginx + Vite devem encaminhar `/w7s/virtual-assets\|blob\|data` à API | **Já mitigado** no deploy local; regressão = tela sem CSS de novo |
| P-RANGE | Pass-through / Range / HLS-DASH rewrite | Contrato em `dom-projection-virtual-assets.md` |
| P-WARM | Emit sem esperar cache warm | Produtor livre; serve plane aguarda — timeouts/erros com `errorCode`+`phase` |

### A5. Viewport lockstep

| ID | Sintoma / risco | Notas |
|----|-----------------|-------|
| ~~P-VP~~ | ~~Surface CSS size ↔ remote viewport (`CanvasViewportSync`)~~ | **Fechado.** `mirrorMode` + `viewportPolicy` vêm de `client-config` **antes** do Start; a surface definitiva é a medida; `DomProjector` não corrige mais drift no mount. Regra em pedra: tela estável ⇒ qualquer Resize é bug (MATRIX **D6**) |
| P-POLICY | `ViewportPolicy` min/max | Resize recusado vs aplicado |

### A6. Input path (entrega, não fidelidade DOM)

| ID | Sintoma / risco | Notas |
|----|-----------------|-------|
| P-IN-ARM | Input só após snapshot/`armed` | Cliques antes do arm = no-op |
| P-IN-WIRE | DomProjectionInput chega no sidecar (generation stale drop) | Separar de “site não reage” (projeção) |
| P-IN-COORD | Coords surface → virtual viewport (§6.3) | Erro de escala = pipeline de geometria |

### Checklist fase 1 (definição de “redondo”)

- [ ] Start em Live (`/`) e Lab (`/w7s/lab`) com `mirrorMode: domProjection` → `live` estável  
- [ ] Navigate (barra Lab + SyncUrl) atualiza remote + barra sem corromper `_w7s_nso`  
- [ ] Virtual assets 200 com `Content-Type` correto (não HTML do SPA) sob o param reservado (sem cookie)  
- [ ] DomDiff snapshot + patches fluem; gap → resync recuperável  
- [ ] DomInput (focus/type/scroll) ecoa no remote (efeito, não só `ok`)  
- [ ] Stop limpa surface; novo Start não herda generation/árvore antiga  
- [ ] Zero Resize numa sessão de tela estável (regra em pedra / D6)  
- [ ] Nenhum soft-skip de property; falhas catalogadas com `errorCode`+`phase` onde couber  

---

## B — Problemas de Dom Projection

*Pintura / isomorfismo / applier / CSS rewrite / pierce — adiar polish fino até A estar verde.*

### Já mitigado (genérico — não site-specific)

| ID | O quê |
|----|--------|
| D-FLAT | Flatten `html`/`body` → stand-ins; remount; sem append duplicado |
| D-ANCHOR | Remint em colisão de clone (`speculum-anchor` copiado) |
| D-CSS-SEL | Rewrite seletores `html`/`body` → stand-ins; `<link>` → CSS inline reescrito |
| D-REM | `rem` → `px` (root inferido) |
| D-VW | `vw`/`vh` → `cqw`/`cqh` + `container-type: size` |
| D-OX | Surface `overflow-x: hidden` (aproxima `body { overflow-x: hidden }`) |

### Débitos / frágil (fase 2)

| ID | Sintoma / risco | Notas |
|----|-----------------|-------|
| D-REGEX | Rewrite CSS por regex (seletores/comentários/strings) | Substituir por parser ou doc/iframe próprio |
| D-REM-STATIC | `rem` assado no ingest; `%` assume 16px UA | Não acompanha root dinâmico |
| D-OX-FIXED | `overflow-x: hidden` sempre na surface | Deveria espelhar overflow do `body` remoto |
| D-FLASH | Flash sem estilo enquanto fetch do CSS | Ordenação / skeleton |
| D-CLICK | Sem `click` no wire (só motion/pressed) | Modais/botões; ver `dom-projection-input.md` |
| D-SHADOW | Closed shadow / iframe cross-origin pierce | Gap conhecido F |
| D-CSSOM | Reload CSSOM via placeholders | Cobertura incompleta |
| D-A11Y | Nome acessível estranho (ex.: CSS em combobox) | Secundário |
| D-DIAG | Falhas Dom Projection sem eventos nomeados + `errorCode`/`phase` | Alinhar a `diagnostics.md` |

---

## Explicitamente fora / anti-padrões

- Soft-skip de JSON/property ausente para “ficar verde”  
- Provar sessão só com `200` / `ok: true`  
- Shims de config / aliases V1  
- CSS ou heurística por hostname do site alvo  

---

## Próximo passo sugerido

1. **Instrumentar hotpath DomDiff + DomInput** (ver § abaixo) — sem isso, flicker/input sequestrado vira adivinhação.  
2. Percorrer checklist **fase 1** no Lab + Live com site simples *e* pesado, anotando falhas só em **A-\*** com evidência de timeline.  
3. Abrir issues/PRs por ID `P-*`; não misturar polish `D-*` no mesmo PR.  
4. Quando checklist A estiver fechado → promover débitos B úteis para issues e **arquivar este WIP** (`docs/archive/` ou delete).

---

## Instrumentação milimétrica (Journal — backend)

**Status:** fatos Telemetry Journal separados por plano; toggles em `Telemetry.Events` + Lab Events panel.

### Planos (não reutilizar facts)

| Plano | Prefix | Facts |
|-------|--------|-------|
| Video streaming input | `Telemetry.Sessions.VideoStreamingInput.*` | `DataPlaneReceived`, `ControlReceived`, `SidecarPushWritten`, `SidecarAdmitted`, `Applied`, `Rejected` |
| Dom Diff | `Telemetry.Sessions.DomProjection.Diff.*` | `FrameReceived` |
| Dom Input | `Telemetry.Sessions.DomProjection.Input.*` | `DataPlaneReceived`, `SidecarPushWritten`, `Applied`, `Rejected` |

Enable via Lab → Telemetry → Events (grupos “Video streaming…” / “Dom Projection…”) ou `PUT Telemetry` `events` map. Default **off**. Hot-path — só enquanto diagnosticar.

### Hotpath Diff (Virtual → Projected) — hops restantes no front

| Hop | Onde | Campos mínimos |
|-----|------|----------------|
| Emit | Sidecar F | `generation`, `sequence`, `kind`, `nodeCount` / `urls`, `tEmit` |
| Relay | API Journal | `DomProjection.Diff.FrameReceived` (opt-in) |
| Recv / Apply | Web | Lab ring (ainda a instrumentar) |

### Hotpath Input Dom (Projected → Virtual)

| Hop | Onde | Campos |
|-----|------|--------|
| Data plane | API Journal | `DomProjection.Input.DataPlaneReceived` (+ generation/anchor) |
| Push written | API Journal | `DomProjection.Input.SidecarPushWritten` |
| Applied / Rejected | API Journal | outcomes com generation/anchor |
| Capture / Apply front | Web | Lab ring (ainda a instrumentar) |

### Sintomas → o que a timeline deve mostrar

| Sintoma | Sinais |
|---------|--------|
| Flicker | `Diff.FrameReceived` com snapshot/html alto; generation bump |
| Scroll sequestrado | flood Dom Input DataPlane + apply overlap no front |
| Input morto | Rejected; generation mismatch; sem Applied após DataPlane |

### Escopo

- **Feito (back):** fatos Journal + emitters + toggles Lab/Apply; E2E `traceId` /
  `ClientTimestampMs` / Diff `Timestamp` (schema v2); full capture quando o fact está ON
  (sem skip HF); Applied/Rejected gated por `IsTypeEnabled`.
- **Feito (front):** chassi compartilhado `features/sessions/debug` + `Telemetry.ClientObservation`
  (Admin/Lab) projetado no client-config; Lab Activity + Live Observe; JSONL export; hops Dom
  Diff/Input + Video input; `traceId` em todo send; ring 2000; sem amostragem `%25`/`%40` quando
  o plane está ON.
- **Pendente:** correlator UI (merge Journal + front JSONL) se precisar além de export manual;
  Dom `SidecarAdmitted` (sem canal de admit hoje).
- **Não inclui:** polish CSS / pierce (fase 2).

---

## Log curto (contexto)

- Debug local em `localhost:8080` (Live catch-all) + Lab.  
- Sites de observação: Google (anchors/clones), Eneba (CSS root/`rem`/overflow).  
- Fixes de projeção foram genéricos; prioridade = pipeline **com** instrumentação do hotpath antes de mais fixes às cegas.
