# Speculum — contexto temporário: programa de testes assertivos (3 fases)

> Ficheiro temporário dehando. Apagar após Fases 1–3 concluidas ou fundir em docs permanentes.
> V1.0.0 em desenvolvimento: sem semver/retrocompat até lançamento anunciado.

## Objectivo

Pipeline agressiva de testes com cobertura assertiva do motor — se passou em testes/GitHub Actions, o motor funciona de verdade (efeito interno verificado, não só “não crashou”).

## As 3 fases

### Fase 1 — Frontend refactor (coesão)
- Alinhar `web/` ao refactor API/sidecar: vocabulario Motor / naming.md, estrutura por domínio.
- Extrair responsabilidades de `motor-engine` (hub vs screencast vs URL sync), tipagem Admin API PascalCase exacta.
- Introduzir Vitest básico (host-mapper, session-id, decode) — base para Fase 3.
- Fora de scope: instrumentação, Playwright E2E massivo, admin hub.

### Fase 2 — Instrumentação e telemetria (produto + harness de teste)
**Propósitos:** (1) telemetria (2) debug (3) asserts de testes/CI — fonte da verdade observável do motor.

**Modelo Dev vs Prod (mesmo schema):**
- Completude absurda nos dois ambientes (mesma taxonomia de probes/eventos).
- Dev: revelação total (cookies, tokens, DOM, evaluate, stacks, PIDs…).
- Prod: mesma granularidade com redaction/hash/truncagem/sampling — práticas de mercado.
- Não é “ligar/desligar instrumentação por ambiente”; é redactor/policy variante.

**Probes assertáveis (exemplos):**
- Sessão/registry/FSM, slots, WS sidecar, Xvfb/Chrome PID, recursos libertados.
- Browser query: cookies, storage, DOM, evaluate JS — via sidecar/CDP.
- Event timeline `since=` para Act → Assert.
- Host/container: CPU, mem, fds, disk (ops).

**Control plane (obrigatório — alto padrão):**
- Toggles granulares por domínio + verbosity (Off → Metrics → Events → StateSnapshots → BrowserQuery).
- Destinos: ring buffer / SQLite / futuro OTLP.
- Budget: maxBytes, maxEventsPerSession, TTL, overflow (DropOldest etc.).
- Sampling, cleanup hosted service, circuit breaker → DiagnosticsDegraded.
- Elevate temporário (ex. BrowserQuery 15–30 min) com audit em Prod.
- Config runtime (secção tipo Diagnostics no SQLite/Admin), hot apply sem redeploy.
- CI pode forçar perfil Assertive/Full.

**Hub admin SignalR realtime:** opcional (Fase 2b) — só se REST + event stream não bastarem. Preferir REST/events para asserts estáveis.

**Auth:** admin Bearer sempre; revelação ≠ endpoint público.

### Fase 3 — Pipeline agressiva de testes
- Consumir probes da Fase 2: Act (API/SignalR) → Assert (diagnostics internos).
- Camadas: unit/contract (PR) + integration + job `motor-assertive` (Docker/Chrome) separado do CI rápido.
- Matriz de features: lifecycle sessão, drain config, navigation allowlist, persistence, injection, mirroring/NSO, resource release, etc.
- Testes também da governance (TTL, overflow, redaction Dev vs Prod).

## Ordem de trabalho recomendada

1. Plano + implementação Fase 1  
2. Plano + implementação Fase 2 (incl. control plane; hub = 2b)  
3. Plano + implementação Fase 3 (ancorado nos endpoints reais)

Cursor: um plano detalhado por fase (não três no mesmo turn).

## Referências no repo

- `docs/naming.md`, `docs/architecture.md`, `docs/diagnostics.md` (Assert Cookbook Fase 2→3), `readme.md`
- API: `Motor/`, `Edge/`, `BrowserPersistence/`, `Config/Application/`, `Diagnostics/`
- Web: `web/src/features/motor/`, `web/src/features/admin/DiagnosticsPage.tsx`, `web/src/lib/diagnosticsApi.ts`
- Admin REST: `/api/admin/diagnostics/v1/*` + secção config `Diagnostics`
- Já existe telemetria leve: `SessionStatus` no canal SignalR (não substitui diagnostics/admin probes)

## Estado

- **Fase 1:** concluída (Motor live refactor + Vitest).
- **Fase 2:** concluída a 100% (Diagnostics control plane, sidecar diagProbe, Admin UI, cookbook, testes).
- **Fase 3:** concluída (dual gate + fixture + MotorAssert matrix A–O no job `motor-assertive`; Chrome só GitHub Actions; K4 ACME nightly). Correções finais: clientToken hex, canais SignalR input/frame/status/console, rotas fixture C/N/B6/B9/B10.
- **Fase 2b:** hub admin SignalR — fora de scope.