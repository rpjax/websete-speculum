# PageProjection — CSP (Virtual Document surgery)

**Status:** **SEALED 2026-08-20** — normative for V4 cutover session (`PageProjectionBrowserSession` / lab `V4ProjectionBrowserSession` → Live).  
**Redesign — not a port of legado.** Legacy `Page.setBypassCSP` + `PERMISSIVE_*` CSP replace are **anti-models**.  
**Index:** [README.md](README.md). Scratchpad: [../CUTOVER-WORKSPACE.md](../CUTOVER-WORKSPACE.md).  
**Code:** `Refactor/sidecar/browser/mirror/projection/session/csp/`.

**Related:** script injection (next cutover step — **same** Document Response hook; does not reopen §§3–7) · [virtual-assets.md](virtual-assets.md) · open.md E-03/E-08 (amended — see §8).

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
- Usar mutação de CSP como desculpa para data plane de **produção** via `WebSocket` de página → loopback (ver §8).
- Streaming de vídeo / screencast (fora do cutover workspace).

---

## 3. Transport — fingerprint law (carved)

O Document **já foi pedido e respondido pelo Chromium**. A cirurgia roda só depois.

| Permitido | Proibido |
|-----------|----------|
| CDP `Fetch` estágio **`Response`**, `resourceType: Document` | Pausar Document no **Request** e `fulfill` com bytes do Node |
| `Fetch.getResponseBody` → mutate → `Fetch.fulfillRequest` com **esse** body/headers | Re-fetch / proxy do HTML pelo sidecar (TLS/HTTP2/JA3–JA4 ≠ Chrome) |
| `continueResponse` se nada mudou ou 3xx | Servir o Document “do zero” pelo Node |

**Escopo de frames:** todo browsing context que carrega HTML Document (main **e** iframes / nested). Não pausar CSS/XHR/img à toa.

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

[open.md](open.md) E-03/E-08 (2026-08-14): rejeitou punch de CSP / `connect-src *` como forma de **habilitar data plane de produção** via `WebSocket` de página → loopback (antibot vê).

**Amend 2026-08-20 (este doc):**

- Cirurgia CSP **Response-stage** (§§3–7) é **permitida e normativa** para Virtual (script + `connect-src` + compensação de nonce).
- **Não** altera a lei de produção: bytes Virtual→sidecar em Live **não** devem depender de page `WebSocket(127.0.0.1)` “porque afrouxamos CSP”. Lab loopback continua fixtures/lab; produção = CDP binding / hub ([roadmap.md](roadmap.md) gate 8 / residuals).

---

## 9. Anti-modelos (legado)

Em `Refactor/sidecar/browser/patchright/Navigation.ts`:

- `Page.setBypassCSP` como path preferido;
- `PERMISSIVE_MAIN_FRAME_CSP` / `relaxMainFrameCspHeaders` / `injectPermissiveMainFrameCsp` (troca a policy inteira).

**Não portar para V4.** Referência histórica só.

---

## 10. Implementação (mapa)

| Peça | Onde |
|------|------|
| Parse / merge / compensação | `session/csp/relaxCsp.ts` |
| Hook Fetch Document Response | `session/csp/documentResponseHook.ts` |
| Wire | `V4ProjectionBrowserSession.freshPage` → `installDocumentResponseHook` antes do `goto` |
| Units | `relaxCsp.unit.ts` + e2e nonce/meta no `v4ProjectionSession.unit.ts` |

**Status (2026-08-20):** **SEALED** — Response-stage hook + `connect-src` + strip nonce/hash/`strict-dynamic` + compensação `'unsafe-inline'` / `*` / `blob:` / `data:` (delta). Do **not** reopen §§3–7 without a decision-log row. Inject de script tags = próximo passo cutover (mutator no mesmo hook).

---

## 11. Checklist de aceite (CSP)

- [x] Document HTML (main + iframe): policy enforcing cirurgiada em **header e meta**.
- [x] Request Document nunca fulfilled a partir de bytes Node não obtidos via `getResponseBody` pós-Response.
- [x] Sem `setBypassCSP` no path V4.
- [x] `img-src` / `style-src` / demais diretivas intactas quando presentes.
- [x] Site noncado: após strip + compensação §7, scripts que dependiam de nonce/strict-dynamic de rede continuam; nosso inline/inject passa.
- [x] Report-Only intacto (salvo ruling futuro).
- [x] Não declarar “CSP done” só porque o producer conectou — cirurgia §§3–7 lacrada com units/e2e; inject de tags é passo cutover **seguinte**, não buraco desta spec.

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
| 2026-08-20 | E-03/E-08 amended: cirurgia CSP ok; data plane prod ainda não é page WS loopback. |
| 2026-08-20 | **SEALED** — §§3–7 + impl `session/csp/*` + units/e2e. Não reabrir sem decision-log. |
