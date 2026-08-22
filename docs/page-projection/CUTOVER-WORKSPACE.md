# Cutover workspace (TEMP)

**Status:** oficialmente em andamento — 2026-08-20.  
**Não é spec.** Scratchpad enquanto o lab `V4ProjectionBrowserSession` vira `PageProjectionBrowserSession` completo e o Live corta pro V4.  
**Normativo:** [spec/browser-session.md](spec/browser-session.md) (**SEALED 2026-08-21**), [spec/roadmap.md](spec/roadmap.md) (gate 10 + lei CUTOVER-SESSION), [spec/acceptance.md](spec/acceptance.md).  
**Comparar com:** `Refactor/sidecar/browser/patchright/PatchrightBrowserSession.ts`  
**Alvo:** `Refactor/sidecar/browser/mirror/projection/session/V4ProjectionBrowserSession.ts` → `PageProjectionBrowserSession`

Quando o cutover fechar: apagar ou arquivar este arquivo. Não virar fonte de verdade eterna.

---

## Lei (lembrete)

- Aceite = 1:1 Projected ≈ site original. Protocol green ≠ cutover.
- Sem ad-hoc. Sem dual path no dia do switch: V4 only + delete `LivePageProjection`.
- Streaming de **vídeo / screencast / WebRTC / camera frame plane** = **fora desta lista** (deixamos de lado de propósito). Cam/mic **ingress** + permission host estão no contrato selado — implementar quando o Live exigir.
- Canvas **content** (bitmap no package) = gate 7, ainda produto antes da Integration plena — track abaixo, não misturar com stubs de sessão.
- Contrato de sessão = [spec/browser-session.md](spec/browser-session.md) — não reinventar APIs.

---

## Já fechado (não reabrir)

| Item | Nota |
|------|------|
| Algoritmo V4 lab (DOM/CSSOM/shadow/OPEN-6 SO/resync) | Package + lab |
| Input V2 lab M1 | click / forms / scroll / iframe |
| Gate 6.5 `@speculum/page-projection` | `core` / `virtual` / `projected` |
| Fold `iframe-open` pós-dropHost | lab fold, não algoritmo |
| **BrowserSession mirror contracts** | **SEALED** [spec/browser-session.md](spec/browser-session.md) |

---

## Checklist — gaps V4 vs Live

Marque `[x]` quando estiver no V4 **de verdade** (não stub). Evidência = método/teste/lab. Nomes = contrato selado.

### A. Contrato `IBrowserSession` / `IPageProjectionBrowserSession` (stub / ausente)

- [ ] **Cookies + restore/export de estado** (cookies, localStorage, IndexedDB, history)
- [ ] **Probe operacional** (`tabs` / `cookies` / `dom` / `evaluate` / `screenshot` / `process`)
- [ ] **`pushInput`** (PP = `DomInputIngress`; video = `BrowserInput` — mode-specific)
- [ ] **História** — core `goBack` / `goForward`
- [ ] **`getAsset`** (ex-`getDomAsset`) — serve de asset virtual
- [ ] **`putUpload`** (ex-`putDomUpload`) + `setFiles` (upload store; hoje `takeUpload` → `undefined`)
- [x] ~~`reportClientState`~~ — **drop** (pre-V4 rate-ladder)
- [x] ~~`getResync` / `sendControl`~~ — **drop**; one path `requestResync` → frame on stream
- [ ] **`requestResync({ contextId?, reason? })`**
- [ ] **`getTelemetrySnapshot(contextId?)`** (PP DTO async)
- [ ] **Permissões** — `IBrowserPermissionHost.requestPermission(kind)` (ambos os modes)
- [ ] **Lab probes** — `haltClocks` / `resumeClocks` / `emitFrame` / `getStateSnapshot` (raw dump; oracles no lab)
- [ ] **CPU profile** — core `startCpuProfile` / `stopCpuProfile` + launch `cpuProfiling`
- [ ] **Sinks** — `IPageProjectionSessionSink` (`onFrame` + `onProjectionTelemetry` + observation)
- [ ] **Rename** `V4ProjectionBrowserSession` → `PageProjectionBrowserSession`

### B. Launch / emulação / antibot

- [ ] **Locale / language / timeZone / colorScheme**
- [ ] **Geolocation override**
- [ ] **Device profile** (mobile, DPR, touch, orientation, UA)
- [ ] **Device-kit / stealth** (navigator, WebGL, workers)
- [ ] **Extensão webgl-spoof**
- [ ] **Injeção de script** (`BrowserLaunchOptions.scripts` + Fetch fulfill) — depois do CSP
- [ ] **Allowlist main-frame** + `onMainFrameNavigationBlocked`
- [x] **CSP cirúrgico** — spec [csp.md](spec/csp.md); strip nonce/hash/`strict-dynamic` + compensação delta; hook Response-stage
- [ ] **Viewport policy** (min/max validate Launch/Resize)
- [ ] **Browser pool** pré-warm (`browserPoolSize` / refill)
- [ ] **`userDataDir` / profile persistente**
- [ ] **Display / Xvfb lifecycle** — **video mode only** (PP thin; fora do foco desta lista)

### C. Navegação / sessão Live

- [ ] **Single-tab** (window.open → same tab; fechar popups)
- [ ] **Location sync contínuo** (`framenavigated` → `onLocationChanged`)
- [ ] **Crash / context close** (`onCrash`)
- [ ] **Editable focus → IME** (`onEditableFocusChanged`)
- [x] ~~Eventos PP legado soft-nav/parity/diff bags~~ — **não reintroduzir** no sink V4 (contrato)
- [ ] **Frame queue + backpressure** (`frameQueueCapacity`; pause/resume se produto exigir)
- [ ] **Navigate serializado + reassert viewport** pós-nav (mobile)
- [ ] **Evaluate seguro** (wrapper async + console levels — hoje `page.evaluate` direto)

### D. Input (lab V2 ok; ainda falta pro contrato)

- [ ] **Upload end-to-end**
- [ ] **IME / composition** (produto deferred / EditableFocus)
- [ ] **OS DnD / caret pixel** (deferred na redesign — só se cutover exigir)
- [ ] **`pushInput` no modo PageProjection** (DomInput — já lab; fiar Live)

### E. Produção (não lab loopback)

- [ ] **URL rewrite → `/w7s/virtual-assets|blob|data`**
- [ ] **Data plane produção** (CDP / hub — sem page WebSocket)
- [ ] **Resync bounded + erros catalogados** no path Live
- [ ] **Path Live único** — V4 no lugar de `LivePageProjection`; factory dual some no mesmo dia

### F. Engine / NIT (produto, não só API de sessão)

- [ ] **`<canvas>` content projection** (gate 7 — último feature de produto antes da Integration)
- [ ] **Nested XO / srcdoc / sandbox / fenced** (NIT; fail `unsupported.*`)
- [ ] **Shadow closed / UA / manual** (NIT)
- [ ] **MSE / DRM** (attrs stub aceitos hoje)
- [ ] **CSS paint iso automatizado** (O1 / SEAL-CSSOM-P2-ISO)
- [ ] **Wire prod CSSOM/shadow/OPEN-6** no Live path (lab done; prod ainda 0% nos gates)

---

## Fora de escopo (desta área)

- Screencast / video plane / WebRTC display stream (modo video — contrato existe; não é o foco do scratchpad PP)
- Downloads / print-PDF / clipboard remoting / proxy genérico / extensões genéricas — se não existirem no port atual, não inventar no cutover

---

## Ordem de trabalho (fechada)

1. **CSP cirúrgico** — normativo: [spec/csp.md](spec/csp.md) — **done**
2. **Contrato selado** — [spec/browser-session.md](spec/browser-session.md) — **done (papel)**
3. **Injeção de scripts** — `BrowserLaunchOptions.scripts` + Fetch (depois do CSP)
4. **Pipeline de input** — `pushInput(DomInputIngress)` no V4; alinhar Live

Depois (fila):

5. Allowlist main-frame + `onMainFrameNavigationBlocked`
6. Estado — cookies / restore / export
7. Location sync + single-tab + crash
8. Device / locale / geo / stealth / webgl-spoof
9. Assets + upload (`getAsset` / `putUpload`)
10. APIs PP (`requestResync`, `getTelemetrySnapshot`, raw `getStateSnapshot`, clocks)
11. Probe operacional + CPU profile core
12. Data plane produção + asset rewrite
13. Canvas (gate 7) → Integration / MotorAssert Live (gate 10) → delete legado

---

## CSP

**Normativo:** [spec/csp.md](spec/csp.md) — não duplicar rulings aqui.

---

## Notas de sessão

| Data | Nota |
|------|------|
| 2026-08-20 | Cutover declarado aberto. Lista de gaps levantada vs `PatchrightBrowserSession`. Lab UI: `npm run lab:projection` → http://127.0.0.1:4077/ (`SPECULUM_LAB_HEADED=1`). |
| 2026-08-20 | Ordem fechada: **CSP → injeção de scripts → pipeline de input**. |
| 2026-08-20 | CSP: só `connect-src` amplo + inline script (incl. nonce sites); preservar resto; **Response-stage CDP only**. |
| 2026-08-20 | Spec normativa [spec/csp.md](spec/csp.md). |
| 2026-08-21 | Draft → polish → **SEAL** mirror contracts — [spec/browser-session.md](spec/browser-session.md). Proposal path = pointer only. |
| 2026-08-21 | Spec pack atualizado: README/observability/open/roadmap/decision-log apontam pro contrato selado; snapshot = dump bruto. |

---

## Paths úteis

| O quê | Onde |
|-------|------|
| Contrato selado | `docs/page-projection/spec/browser-session.md` |
| V4 session (lab) | `Refactor/sidecar/browser/mirror/projection/session/V4ProjectionBrowserSession.ts` |
| Fat port legado | `Refactor/sidecar/browser/BrowserSession.ts` |
| Patchright Live | `Refactor/sidecar/browser/patchright/PatchrightBrowserSession.ts` |
