# PageProjection — CSP (Virtual Document surgery)

**Status:** **SEALED 2026-08-20** — normative for V4 cutover session (`PageProjectionBrowserSession` → Live).  
**Redesign — not a port of legado.** Legacy `Page.setBypassCSP` + `PERMISSIVE_*` CSP replace are **anti-models**.  
**Index:** [README.md](README.md). Scratchpad: [../CUTOVER-WORKSPACE.md](../CUTOVER-WORKSPACE.md).  
**Code:** `sidecar/browser/mirror/projection/session/csp/`.

**Related:** runtime inject boot **SEALED** ([browser-session.md](browser-session.md)) · [virtual-assets.md](virtual-assets.md) · open.md E-03/E-08 (amended — see §8).

---

## 1. Goal

Afrouxar o CSP do **Document** o mínimo para o Virtual (producer + scripts injetados + connects do nosso runtime) operar, **sem**:

- o host / antibot detectar path de rede estranho (TLS/HTTP fingerprint);
- o Chrome tratar a página como “CSP demolido” (bypass total);
- o **site original quebrar** por causa das **nossas** edições na policy.

Aceite de paridade DOM/CSSOM continua em [acceptance.md](acceptance.md). CSP aqui é **sessão / Document**, não frame protocol.

---

## 2. Non-goals

- Fazer funcionar no site coisas que **já eram bloqueadas** no CSP original (ex.: inline nu sem nonce).
- Trusted Types / `require-trusted-types-for` (fora de escopo até bloquear inject de verdade — aí abre ruling).
- `Page.setBypassCSP` como caminho V4.
- Substituir a policy inteira por um `PERMISSIVE_*`.
- Usar mutação de CSP como desculpa para **demolir** a policy (bypass / PERMISSIVE replace) — ver §9.
- Streaming de vídeo / screencast (fora do cutover workspace).

---

## 3. Transport — fingerprint law (carved)

O Document **já foi pedido e respondido pelo Chromium**. A cirurgia roda só depois.

| Permitido | Proibido |
|-----------|----------|
| CDP `Fetch` estágio **`Response`**, `resourceType: Document` | Pausar Document no **Request** e `fulfill` com bytes do Node |
| `Fetch.getResponseBody` → mutate → `Fetch.fulfillRequest` com **esse** body/headers | Re-fetch / proxy do HTML pelo sidecar (TLS/HTTP2/JA3–JA4 ≠ Chrome) |
| `continueResponse` se nada mudou ou 3xx | Servir o Document “do zero” pelo Node |

**Escopo de frames:** todo browsing context que carrega HTML Document (main **e** iframes / nested), inclusive OOPIF cross-site. O hook na page CDP **não basta** para Script em target filho — o mesmo `Fetch.enable` / fulfill de stored scripts roda também em `context.newCDPSession(frame)` (API pública Patchright). Não usar browser-level `Target.setAutoAttach` com `flatten: false` (Chromium rejeita). Não pausar CSS/XHR/img à toa.

**Hook único:** um pipeline de mutators no Response (CSP primeiro; inject de tags depois, mesmo pause).

Redirects (3xx): sempre `continueResponse`.

Ao reescrever body: strip `Content-Encoding` / `Content-Length` nos headers devolvidos.

---

## 4. Chokepoints

A policy enforcing entra por:

1. Header(s) HTTP **`Content-Security-Policy`** (vários = AND — cirurgiar **todos**).
2. **`<meta http-equiv="Content-Security-Policy" content="…">`** no HTML.

Cirurgia **idêntica** nos dois. Só header ou só meta = policy de nonce / script pode sobrar.

**`Content-Security-Policy-Report-Only`:** não demolir por padrão (não bloqueia). Reports podem delatar inject — se virar problema, ruling à parte; não misturar com a cirurgia enforcing.

---

## 5. O que afrouxamos (nossa ponta)

Duas necessidades **nossas** — não “melhorar o site”:

| Diretiva | Mudança | Por quê |
|----------|---------|---------|
| **`connect-src`** | Garantir `* data: blob: ws: wss:` (merge). Se ausente, criar a partir de `default-src` + esses extras. | Runtime Virtual precisa conectar (lab data plane / fetches nossos). |
| **`script-src` / `script-src-elem` / `script-src-attr`** | Garantir script inline nosso + caminho pós-nonce ( §§6–7 ). | Inject / inline do producer path. |

Todo o **resto** da policy: **preservar** (`img-src`, `style-src`, `frame-src`, `default-src` texto, etc.).

**Merge, nunca replace** da diretiva inteira por um literal permissivo.

Se `script-src*` ausente e existe `default-src`: criar `script-src` clonando tokens de `default-src`, depois aplicar §6–7.  
Se `connect-src` ausente: idem a partir de `default-src`.

---

## 6. Nonce / hash / `strict-dynamic`

### 6.1 O que “habilita” nonce numa página

1. Na policy: `'nonce-…'` em `script-src` e/ou `script-src-elem` (etc.).
2. No elemento: `nonce="…"` igual.

CSP3: se há **nonce ou hash** na policy, **`'unsafe-inline'` é ignorado**. Por isso só “adicionar unsafe-inline” **não** libera inject em site noncado.

### 6.2 Decisão

**Remover** da policy (header + meta), **só** nas diretivas de script:

- `'nonce-…'`
- `'sha256-…'` / `'sha384-…'` / `'sha512-…'`
- `'strict-dynamic'`

Chokepoints §4 bastam para **desligar a política de nonce** daquele Document. O atributo `nonce` no HTML vira decoração.

Não é preciso (nesta decisão) carimbar nosso `<script>` com o nonce do site — strip + compensação §7.

---

## 7. Compensação (só o delta da nossa cirurgia)

**Lei:** o site deve continuar se comportando como **antes da nossa edição**, no que a edição quebraria.  
**Não** é missão fazer funcionar o que o CSP original já bloqueava.

### 7.1 Entra (compensação pela remoção de nonce / hash / `strict-dynamic`)

| Token | Compensa |
|-------|----------|
| **`'unsafe-inline'`** | Inlines que **rodavam com nonce** (ou hash que removemos). Também cobre a nossa ponta de inject inline. |
| **`*`** | Scripts com `src` de rede que rodavam por nonce, e filhos que entravam via `strict-dynamic`. |
| **`blob:`** | Scripts noncados com `src=blob:…`. |
| **`data:`** | Scripts noncados com `src=data:…`. |

Aplicar como **merge** nas diretivas de script afetadas (e na `script-src` criada a partir de `default-src` se preciso).

### 7.2 Não entra (não é regressão de tirar nonce)

| Token | Por quê |
|-------|---------|
| **`'unsafe-eval'`** / **`wasm-unsafe-eval`** | Nonce não libera eval. Se o original tinha, **preservar** no merge. Se não tinha, **não adicionar**. |
| Liberar inline nu / `onclick` que já eram bloqueados | Já falhavam no original — fora de escopo. |

### 7.3 Over-permission consciente

`'unsafe-inline'` + `*` podem deixar passar coisas que o original bloqueava (ex.: inline **sem** nonce). Isso é efeito colateral de operar / compensar — **não** é requisito de paridade “melhor que o original”. Não expandir além da tabela 7.1.

---

## 8. Relação com E-03 / E-08 (data plane)

[open.md](open.md) E-03/E-08:

- **2026-08-14:** rejeitou punch bruto de CSP / `connect-src *` / disable-PNA como enablement antibot-visível.
- **2026-08-20:** cirurgia CSP Response-stage §§3–7 é normativa para Virtual (script + `connect-src` + nonce).
- **2026-08-26:** o **carrier** Virtual↔sidecar é loopback WebSocket (`ws://127.0.0.1` no sidecar). Plano CDP `exposeBinding` foi removido.
- **2026-08-27:** on managed Chrome the loopback socket is opened by the **Speculum Plane extension** ([extension-plane.md](extension-plane.md)) — the page does **not** need `connect-src` for `127.0.0.1` for the data plane. CSP surgery for `connect-src` remains for other runtime fetches; extension carrier decouples plane from page CSP/LNA.

---

## 9. Anti-modelos (legado)

Em `sidecar/browser/patchright/Navigation.ts`:

- `Page.setBypassCSP` como path preferido;
- `PERMISSIVE_MAIN_FRAME_CSP` / `relaxMainFrameCspHeaders` / `injectPermissiveMainFrameCsp` (troca a policy inteira).

**Não portar para V4.** Referência histórica só.

---

## 10. Implementação (mapa)

| Peça | Onde |
|------|------|
| Parse / merge / compensação | `session/csp/relaxCsp.ts` |
| Hook Fetch Document Response | `session/csp/documentResponseHook.ts` |
| Runtime inject (CDP-only) | `inject/projectionRuntimeInstaller.ts` + `inject/buildProjectionInjectBundle.ts` |
| Wire | `PageProjectionBrowserSession.freshPage` → `ProjectionRuntimeInstaller.install` + `installDocumentResponseHook` (CSP only) before any `goto`; prelude includes meta neutralizer + single-tab |
| Units | `relaxCsp.unit.ts` + inject installer units + e2e nonce/meta + single-tab locale CSP plane in `pageProjectionSession.unit.ts` |

**Status (2026-08-20):** **SEALED** — Response-stage hook + `connect-src` + strip nonce/hash/`strict-dynamic` + compensação `'unsafe-inline'` / `*` / `blob:` / `data:` (delta). Do **not** reopen §§3–7 without a decision-log row.

**Inject (2026-08-27 / boot SEALED 2026-08-28):** **CLOSED** — HTML `<script>` tag inject removed. Runtime + launch scripts = single CDP bundle per target (`Page.addScriptToEvaluateOnNewDocument`); OOPIF via `frameCdpSession`. Document hook **does not** fulfill stored scripts. **Boot:** main-world Virtual; inject arm IIFE; lateBoot miss-detect only (fail-closed probe null; one attempt per `generation|url`). Normative: [browser-session.md](browser-session.md) Runtime inject.

---

## 11. Checklist de aceite (CSP)

- [x] Document HTML (main + iframe): policy enforcing cirurgiada em **header e meta**.
- [x] Request Document nunca fulfilled a partir de bytes Node não obtidos via `getResponseBody` pós-Response.
- [x] Sem `setBypassCSP` no path V4.
- [x] `img-src` / `style-src` / demais diretivas intactas quando presentes.
- [x] Site noncado: após strip + compensação §7, scripts que dependiam de nonce/strict-dynamic de rede continuam; nosso inline/inject passa.
- [x] Report-Only intacto (salvo ruling futuro).
- [x] Não declarar “CSP done” só porque o producer conectou — cirurgia §§3–7 lacrada com units/e2e; runtime inject CDP-only (2026-08-27) separado desta spec.

---

## 12. Decision log (este arquivo)

| Date | Decision |
|------|----------|
| 2026-08-20 | Cutover CSP = redesign cirúrgico; não bypass; não PERMISSIVE replace. |
| 2026-08-20 | Transport: Fetch **Response** Document only; fingerprint Chrome intacto. |
| 2026-08-20 | Chokepoints: CSP headers enforcing + meta http-equiv. |
| 2026-08-20 | Nossa ponta: `connect-src` amplo + script inline. |
| 2026-08-20 | Nonce: remover da policy (não carimbar tag); compensar com `'unsafe-inline'` + `*` + `blob:` + `data:`. |
| 2026-08-20 | Compensação = só delta da nossa edição; não “fazer tudo funcionar”. |
| 2026-08-20 | `'unsafe-eval'` não é compensação de nonce — só preservar se já existia. |
| 2026-08-20 | E-03/E-08 amended: cirurgia CSP ok (carrier plane ruled separately). |
| 2026-08-20 | **SEALED** — §§3–7 + impl `session/csp/*` + units/e2e. Não reabrir sem decision-log. |
| 2026-08-26 | E-03 revised: loopback WS = sole Virtual↔sidecar carrier; CDP binding plane purged. |
| 2026-08-27 | OOPIF: mesmo Fetch Document Response via `context.newCDPSession(frame)` (não `Target.setAutoAttach` flatten:false no browser CDP — Chromium rejeita). |
| 2026-08-27 | **PP inject CDP-only:** tag mutators + stored-script fulfill **removed**; `ProjectionRuntimeInstaller` + unified bundle; sentinel scrub in prelude + `bootstrap.ts`. |
| 2026-08-28 | **PP inject boot SEALED:** main-world only; arm IIFE; lateBoot miss-detect (fail-closed / token). | [browser-session.md](browser-session.md) · decision-log |
| 2026-08-27 | **Single-tab (PP, LOCKED):** one Chromium page per session — **never** two tabs. Site `window.open` / `_blank` → same-tab `location` redirect (init script); auxiliary pages closed immediately + URL adopted on primary. | `session/singleTab.ts` · [browser-session.md](browser-session.md) |
| 2026-08-27 | **Meta CSP neutralize init:** when Document body is unreadable (huge HTML / CDP limits) and enforcing CSP is meta-only, `CSP_META_NEUTRALIZE_INIT_SCRIPT` drops `<meta http-equiv=Content-Security-Policy>` before parse — same intent as `rewriteCspMetasInHtml`, not a bypass reopen. | `session/csp/cspMetaNeutralizeInitScript.ts` · PP-CSP-META-HUGE |
| 2026-08-27 | **LNA managed Chrome = enterprise policy only** — generic `["*"]` in `speculum-lna.json`; **reject** `LocalNetworkAccessChecks` launch disable and per-site policy URL lists. Residual plane desync → [loopback.md](loopback.md) PP-LOOPBACK-ESTABLISH. | [loopback.md](loopback.md) §11 |
