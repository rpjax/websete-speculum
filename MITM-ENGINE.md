# Websete Speculum — Motor MITM & Forwarding

Documento de referência interno. Cobre arquitetura, fluxo de dados, comportamentos
do motor MITM, decisões de design e guia de configuração.

---

## Índice

1. [Visão geral da arquitetura](#1-visão-geral-da-arquitetura)
2. [O motor MITM — como o forwarding funciona](#2-o-motor-mitm--como-o-forwarding-funciona)
   - 2.1 [Ponto de entrada: o cliente envia a própria URL](#21-ponto-de-entrada-o-cliente-envia-a-própria-url)
   - 2.2 [Seleção de perfil](#22-seleção-de-perfil)
   - 2.3 [Reescrita de URL](#23-reescrita-de-url)
   - 2.4 [O que acontece quando nenhum perfil corresponde](#24-o-que-acontece-quando-nenhum-perfil-corresponde)
   - 2.5 [Preservação de path, query string e fragmento](#25-preservação-de-path-query-string-e-fragmento)
3. [Certificados TLS e SNI](#3-certificados-tls-e-sni)
4. [Protocolo binário de frames](#4-protocolo-binário-de-frames)
5. [Protocolo de input (cliente → sidecar)](#5-protocolo-de-input-cliente--sidecar)
6. [Ciclo de vida de uma sessão](#6-ciclo-de-vida-de-uma-sessão)
7. [Referência de configuração](#7-referência-de-configuração)
8. [Decisões de design](#8-decisões-de-design)

---

## 1. Visão geral da arquitetura

```
┌───────────────────────────────────────────────────────────────────────────┐
│ Browser do usuário                                                         │
│                                                                            │
│   https://www.websete.localhost/cars?q=1                                   │
│        │                                                                   │
│        ├─ SignalR /hub/virtualization ──── controle (create, navigate…)   │
│        └─ WebSocket /ws/{sessionId} ────── frames binários ←              │
│                                        ─── input JSON →                   │
└───────────────────────────┬───────────────────────────────────────────────┘
                            │ HTTPS (Kestrel, SNI, cert por domínio)
                            ▼
┌───────────────────────────────────────────────────────────────────────────┐
│ Container: app (.NET 10)                                                   │
│                                                                            │
│  ① SpeculumConfig.Load()          — snapshot imutável da config           │
│  ② CertificateProvider.Create()   — pré-carrega certs por domínio         │
│  ③ Kestrel SNI selector           — cert certo por conexão TLS            │
│  ④ VirtualizationHub (SignalR)    — cria sessão, navega, fecha            │
│  ⑤ VirtualizationService          — orquestra sessões, aplica rewrite     │
│  ⑥ IUrlRewriter / UrlRewriter     — regex substitution por perfil         │
│  ⑦ ClientWebSocketHandler         — relay bidirecional (frames + input)   │
│  ⑧ SidecarClient                  — WS client → sidecar                   │
└───────────────────────────┬───────────────────────────────────────────────┘
                            │ ws://sidecar:3000  (protocolo binário)
                            ▼
┌───────────────────────────────────────────────────────────────────────────┐
│ Container: sidecar (Node.js 22 + TypeScript)                               │
│                                                                            │
│  DisplayManager  → Xvfb (:100+N, 4096×2160 max) + xrandr + matchbox-WM   │
│  BrowserManager  → Chrome não-headless via Patchright                     │
│  FFmpegCapture   → x11grab do framebuffer Xvfb → JPEG → frames binários  │
│  Session         → orquestra tudo; input via CDP (mouse/teclado)          │
└───────────────────────────────────────────────────────────────────────────┘
```

**Separação de responsabilidades em dois planos:**

| Plano | Transporte | Conteúdo |
|-------|-----------|---------|
| Controle | SignalR (text, JSON) | `CreateSessionAsync`, `NavigateAsync`, `RefreshAsync`, `ResizeAsync`, `CloseSessionAsync` |
| Dados | WebSocket binário `/ws/{id}` | Frames JPEG do sidecar → cliente; input JSON do cliente → sidecar |

O `.NET` nunca toca nos pixels. Frames chegam do sidecar como `byte[]` e são
enviados byte a byte para o browser do usuário. Não há decodificação,
re-encoding nem composição no lado .NET.

---

## 2. O motor MITM — como o forwarding funciona

### 2.1 Ponto de entrada: o cliente envia a própria URL

O browser do usuário abre `https://www.websete.localhost/cars?q=1`.
Quando a página carrega, o JavaScript faz:

```javascript
const resp = await hub.invoke('CreateSessionAsync', {
    width:      viewport.clientWidth,
    height:     viewport.clientHeight,
    initialUrl: window.location.href,   // ← a URL que o usuário está vendo
});
```

`window.location.href` é `https://www.websete.localhost/cars?q=1`.
Esse valor chega no servidor como `CreateSessionRequest.InitialUrl`.

**Não existe um comando "navegar para" por parte do cliente.** O cliente não
sabe qual é o site real (upstream). Ele simplesmente informa onde está, e o
motor MITM decide para onde o browser virtual deve ir.

### 2.2 Seleção de perfil

`VirtualizationService.RewriteUrl` extrai o host da URL (`uri.Host`, sem porta)
e passa para `IUrlRewriter.Rewrite(url, requestHost)`.

`UrlRewriter.FindProfile` percorre os perfis em ordem de declaração e aplica
duas regras de correspondência, nesta ordem de prioridade:

1. **Correspondência exata** — `host == profile.Domain` (case-insensitive)
2. **Correspondência de subdomínio** — `host.EndsWith("." + profile.Domain)`
   (case-insensitive), somente quando `AllowSubDomains: true`

```
Exemplos com Domain = "websete.localhost", AllowSubDomains = true:

  "websete.localhost"       → correspondência exata  ✓
  "www.websete.localhost"   → correspondência de subdomínio ✓
  "api.websete.localhost"   → correspondência de subdomínio ✓
  "outrosite.com"           → nenhuma correspondência ✗
  "mal.websete.localhost.evil.com" → NÃO corresponde (EndsWith requer "." + domain)
```

O sufixo `"." + Domain` é **pré-computado** no construtor de `UrlRewriter`
para evitar alocação de string a cada request.

Se múltiplos perfis fossem configurados (ex: `websete.localhost` e
`outro.localhost`), o primeiro perfil cujo domínio corresponder ao host
seria selecionado — daí a importância da **ordem de declaração** em
`ForwardingProfiles`.

### 2.3 Reescrita de URL

Uma vez selecionado o perfil, suas regras são aplicadas **em sequência** sobre
a URL completa como string. Cada regra é uma substituição de regex:

```
url_atual = regra[0].Pattern.Replace(url_atual, regra[0].Replacement)
url_atual = regra[1].Pattern.Replace(url_atual, regra[1].Replacement)
...
```

**Exemplo com a config padrão:**

```json
{
  "Domain": "websete.localhost",
  "Rules": [
    { "Downstream": "websete.localhost", "Upstream": "olx.com.br" }
  ]
}
```

| Campo | Significado |
|-------|------------|
| `Downstream` | Padrão a ser substituído (o domínio "falso", do lado do usuário) |
| `Upstream`   | Valor de substituição (o site real, do lado da internet) |

```
Input:  "https://www.websete.localhost/cars?q=1"
Regex:  Regex.Escape("websete.localhost")  →  padrão literal "websete\.localhost"
Output: "https://www.olx.com.br/cars?q=1"
```

`www.` sobrevive porque o padrão só corresponde a `"websete.localhost"`, não ao
prefixo `www.`. O resultado é `www.olx.com.br` — subdomínio preservado
automaticamente pelo mecanismo de substituição.

**Como o padrão é compilado:**

```csharp
var pattern = new Regex(
    Regex.Escape(rule.Downstream),                // escapa pontos e meta-chars
    RegexOptions.IgnoreCase | RegexOptions.Compiled,
    matchTimeout: TimeSpan.FromMilliseconds(250)); // proteção contra ReDoS
```

- `Regex.Escape` trata o valor de `Downstream` como literal, não como regex.
  Isso significa que `olx.com.br` e `websete.localhost` são seguros mesmo
  com o ponto (que em regex seria "qualquer caractere").
- `RegexOptions.Compiled` pré-compila o automato para execução mais rápida
  em cenários com muitas sessões.
- `matchTimeout: 250ms` garante que uma URL patológica não bloqueie a thread.
  Se o timeout for atingido, `RegexMatchTimeoutException` é capturada,
  a regra é pulada e um `LogWarning` é emitido.

**Regras em cadeia** (múltiplas regras por perfil):

```json
"Rules": [
  { "Downstream": "websete.localhost", "Upstream": "olx.com.br" },
  { "Downstream": "cdn.websete.localhost", "Upstream": "cdn.olx.com.br" }
]
```

Cada regra opera sobre o resultado da regra anterior. A ordem importa:
regras mais específicas devem vir antes de regras mais genéricas quando
os padrões se sobrepõem.

### 2.4 O que acontece quando nenhum perfil corresponde

`IUrlRewriter.Rewrite` retorna `null`.
`VirtualizationService.RewriteUrl` recebe `null` e emite:

```
WARN [sessionId] No forwarding profile matched host 'outrosite.com';
     opening session without navigation.
```

O sidecar recebe `resolvedUrl = null`, ou seja, o browser virtual abre
sem navegar para nenhuma URL (mostra a página em branco do Chrome).
A sessão é criada normalmente — apenas não há navegação inicial.

Isso é intencional: o sistema não recusa sessões cujo host não tem perfil.
Permite sessões de debug ou casos onde a navegação será feita manualmente
depois via `NavigateAsync`.

### 2.5 Preservação de path, query string e fragmento

O padrão regex é aplicado à **string completa da URL** (`https://www.websete.localhost/cars?q=1`).
O padrão `websete\.localhost` corresponde **apenas** à parte do domínio, nunca
a `cars`, `q=1` ou qualquer outro segmento — desde que esses segmentos não
contenham literalmente o texto do domínio.

Em termos práticos: path, query string e fragmento passam intactos porque
`Regex.Replace` substitui apenas as ocorrências do padrão, e domínios não
aparecem em paths reais.

---

## 3. Certificados TLS e SNI

### Layout no disco

```
{certBasePath}/
  {domain}/
    privkey.pem      ← chave privada RSA/EC
    fullchain.pem    ← certificado + intermediários (ordem PEM padrão Let's Encrypt)
```

O `certBasePath` padrão é `{ContentRootPath}/Certificates` em desenvolvimento e
pode ser sobrescrito via `appsettings.json` ou variável de ambiente:

```json
{ "CertificatesPath": "/Certificates" }
```

Em Docker, `/Certificates` é montado como volume com os certs reais.

### Carregamento (fail-fast)

`CertificateProvider.Create()` é chamado **antes de `builder.Build()`**,
no startup do `Program.cs`. Para cada perfil em `ForwardingProfiles`:

1. Verifica se `privkey.pem` existe — lança `InvalidOperationException` se não.
2. Verifica se `fullchain.pem` existe — lança `InvalidOperationException` se não.
3. Carrega com `X509Certificate2.CreateFromPemFile(fullchain, privkey)`.
4. Loga subject e data de expiração no console.

Se qualquer certificado estiver faltando, a aplicação **não sobe**. Isso é
deliberado: é melhor falhar no boot do que servir TLS com o cert errado ou
sem cert.

### Seleção por SNI

Kestrel expõe um delegate `ServerCertificateSelector` que é chamado por conexão
TLS, recebendo o `serverName` do ClientHello (SNI extension):

```csharp
https.ServerCertificateSelector = (_, serverName) =>
    string.IsNullOrEmpty(serverName)
        ? certLoader.GetDefaultCertificate()
        : certLoader.GetCertificate(serverName);
```

`ICertificateProvider.GetCertificate(serverName)` aplica a mesma lógica de
correspondência do `UrlRewriter`:

1. Correspondência exata: `serverName == entry.Domain`
2. Correspondência de subdomínio: `serverName.EndsWith("." + entry.Domain)`
   quando `AllowSubDomains = true`
3. Fallback: primeiro certificado carregado (`_entries[0]`)

Isso garante que `www.websete.localhost` recebe o mesmo cert que
`websete.localhost` — comportamento correto para wildcards informais sem
precisar de certs wildcard (`*.websete.localhost`).

### Liberação de recursos

`CertificateProvider` implementa `IDisposable`. O dispose é registrado em
`ApplicationStopped`:

```csharp
app.Lifetime.ApplicationStopped.Register(() => certLoader.Dispose());
```

Isso libera os handles do sistema operacional para as chaves privadas
(importante em Linux onde cada `X509Certificate2` abre um fd).

---

## 4. Protocolo binário de frames

O sidecar envia frames como mensagens binárias WebSocket. O `.NET` faz relay
byte a byte sem parsing. O cliente JavaScript decodifica.

### Tipos de mensagem (sidecar → cliente)

```
[0x01] Tile frame  — apenas tiles que mudaram desde o frame anterior
  [frameId:  uint32 LE]
  [numTiles: uint16 LE]
  por tile:
    [x:   uint16 LE]
    [y:   uint16 LE]
    [w:   uint16 LE]
    [h:   uint16 LE]
    [len: uint32 LE]
    [jpegData: len bytes]

[0x02] Full frame  — frame JPEG completo (frame inicial e após resize)
  [frameId: uint32 LE]
  [len:     uint32 LE]
  [jpegData: len bytes]

[0x03] Frame skip  — nenhuma mudança (1 byte total, sem payload)

[0x04] URL update  — sidecar notifica o cliente da URL atual após navegação
  [len: uint32 LE]
  [url: len bytes, UTF-8]
```

### Implementação atual

O sidecar usa FFmpeg x11grab para capturar o framebuffer do Xvfb e produz
apenas frames `0x02` (full). O suporte a tiles (`0x01`) existe no protocolo
e no cliente mas não é gerado atualmente — reservado para versões futuras com
diff de tiles via CDP screencast.

### Relay no .NET

`ClientWebSocketHandler.RelayFramesAsync` lê do `IVirtualizationSession.FrameChannel`
(um `Channel<byte[]>`) e envia cada item como mensagem binária WebSocket:

```csharp
await foreach (var frame in session.FrameChannel.ReadAllAsync(ct))
    await ws.SendAsync(frame, WebSocketMessageType.Binary, true, ct);
```

### Renderização no cliente

```javascript
ws.onmessage = e => handleFrame(e.data);  // e.data é ArrayBuffer

// Full frame (0x02):
const bmp = await createImageBitmap(new Blob([jpeg], { type: 'image/jpeg' }));
ctx.drawImage(bmp, 0, 0, sessionW, sessionH);
bmp.close();
```

O cliente usa `requestAnimationFrame` com um slot de frame único — frames mais
novos sobrescrevem frames pendentes, eliminando backlog e mantendo latência
mínima mesmo em redes lentas.

---

## 5. Protocolo de input (cliente → sidecar)

Input é enviado como mensagens **texto JSON** no mesmo WebSocket binário.
O `.NET` faz relay para o sidecar sem parsing (exceto validação de tamanho).

### Mensagens suportadas

```json
{ "type": "mousemove",  "x": 640, "y": 360 }
{ "type": "mousedown",  "x": 640, "y": 360, "button": 0 }
{ "type": "mouseup",    "x": 640, "y": 360, "button": 0 }
{ "type": "wheel",      "x": 640, "y": 360, "deltaX": 0, "deltaY": 120 }
{ "type": "keydown",    "key": "a" }
{ "type": "keyup",      "key": "a" }
{ "type": "type",       "text": "hello" }
{ "type": "goback" }
{ "type": "goforward" }
{ "type": "navigate",   "url": "https://..." }
{ "type": "refresh" }
{ "type": "resize",     "width": 1280, "height": 720 }
```

### Coordenadas

O cliente normaliza coordenadas de tela para coordenadas de página antes de enviar:

```javascript
function canvasToPage(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: Math.round((clientX - rect.left) * (sessionW / rect.width)),
        y: Math.round((clientY - rect.top)  * (sessionH / rect.height)),
    };
}
```

Isso garante que o input seja correto mesmo quando o canvas é exibido em
tamanho diferente da resolução virtual (ex: display de alta densidade DPI).

### Scroll (normalização de deltaMode)

O evento `wheel` do DOM pode usar unidades diferentes (`deltaMode`):

| deltaMode | Unidade | Conversão |
|-----------|---------|-----------|
| 0 | pixels | nenhuma (trackpad, maioria dos browsers) |
| 1 | linhas | × 40px (roda de mouse física, Windows) |
| 2 | páginas | × `canvas.clientWidth/Height` |

O cliente normaliza para pixels antes de enviar. `canvas.clientWidth/Height`
(não `window.innerWidth/Height`) é usado no deltaMode=2 porque o canvas não
ocupa a janela inteira — a toolbar subtrai espaço.

### Teclado — caracteres não-ASCII

O sidecar usa CDP `keyboard.down/up` que só aceita teclas ASCII e nomes DOM
(ex: `"Enter"`, `"Shift"`). Caracteres não-ASCII (`ç`, `é`, `ñ`, CJK…) são
tratados com `keyboard.type()` que aceita qualquer codepoint Unicode:

```typescript
case 'keydown':
    if (msg.key.length === 1 && msg.key.charCodeAt(0) > 127) {
        await this._page.keyboard.type(msg.key);  // ciclo completo press+release
    } else {
        await this._page.keyboard.down(msg.key);
    }
    break;
case 'keyup':
    if (msg.key.length === 1 && msg.key.charCodeAt(0) > 127) break; // já tratado
    await this._page.keyboard.up(msg.key);
    break;
```

### Limite de mensagem

`ClientWebSocketHandler.RelayInputAsync` aplica um limite de **1 MB** por
mensagem. Mensagens maiores causam o fechamento da conexão WebSocket com
log de aviso. Nenhuma mensagem de input legítima deveria aproximar-se desse
limite.

---

## 6. Ciclo de vida de uma sessão

```
Cliente                   .NET (Hub)              .NET (Service)            Sidecar
  │                          │                         │                       │
  │── CreateSessionAsync ───►│                         │                       │
  │   { width, height,       │── CreateSessionAsync ──►│                       │
  │     initialUrl }         │   (connectionId)        │── WS connect ────────►│
  │                          │                         │   { create, sessionId,│
  │                          │                         │     w, h, url }       │
  │                          │                         │◄── { ready } ─────────│
  │◄── { sessionId, w, h } ──│◄── response ────────────│                       │
  │                          │                         │                       │
  │── WS /ws/{sessionId} ───►│                         │                       │
  │                          │                         │◄══ frames binary ═════│
  │◄══ frames binary ════════│◄════════════════════════│                       │
  │                          │                         │                       │
  │── input JSON ───────────►│─────────────────────────│─── input JSON ───────►│
  │                          │                         │                       │
  │── WS close ─────────────►│                         │                       │
  │                          │                         │── WS close ──────────►│
  │◄── OnDisconnectedAsync ──│── CleanupConnection ───►│                       │
                             │                         │── DisposeSession ─────│
```

**Passo-a-passo:**

1. **SignalR `CreateSessionAsync`** — cliente invoca via hub.
2. **Rewrite URL** — `VirtualizationService.RewriteUrl` aplica as regras MITM.
3. **Cria sessão no sidecar** — `SidecarClient.ConnectAsync` abre WS com o
   sidecar e aguarda a mensagem `{ type: "ready" }` (timeout: 30s).
4. **Sidecar inicializa** — Xvfb → xrandr → matchbox → Chrome → FFmpegCapture.
   `FFmpegCapture.start()` só resolve quando o primeiro frame JPEG é produzido.
5. **Resposta ao cliente** — hub retorna `{ sessionId, width, height }`.
6. **Cliente abre WS binário** — `GET /ws/{sessionId}` upgradado para WebSocket.
7. **Dois loops paralelos** — `RelayFramesAsync` e `RelayInputAsync` correm até
   qualquer um terminar, então o CancellationTokenSource cancela o outro.
8. **Disconnect** — WS fecha → `OnDisconnectedAsync` → `CleanupConnectionAsync`
   → `CloseSessionAsync` → sidecar fecha Chrome + Xvfb.

**Limite de sessões:** `MaxSessions` (config) é verificado atomicamente antes
de qualquer alocação. Se atingido, `CreateSessionAsync` lança
`InvalidOperationException` e o hub retorna erro ao cliente.

---

## 7. Referência de configuração

### appsettings.json

```json
{
  "Environment": "Dev",
  "HttpAddress": "0.0.0.0:443",
  "MaxSessions": 10,
  "CertificatesPath": "/Certificates",
  "Sidecar": {
    "BaseUrl": "ws://sidecar:3000"
  },
  "ForwardingProfiles": [
    {
      "Domain": "websete.localhost",
      "AllowSubDomains": true,
      "Rules": [
        {
          "Downstream": "websete.localhost",
          "Upstream":   "olx.com.br"
        }
      ]
    }
  ]
}
```

### Campos

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `Environment` | string | Identificador de ambiente. Máx 64 chars, sem `/` ou `\`. |
| `HttpAddress` | string | Endereço Kestrel. Formato `host:porta`. Ex: `0.0.0.0:443`, `[::]:443`. |
| `MaxSessions` | int | Máximo de sessões simultâneas. Range: 1–65535. |
| `CertificatesPath` | string | Diretório raiz dos certificados. Default: `{ContentRoot}/Certificates`. |
| `Sidecar:BaseUrl` | string | URL WebSocket do container sidecar. Ex: `ws://sidecar:3000`. |

### ForwardingProfile

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `Domain` | string | FQDN do domínio downstream (ex: `websete.localhost`). Obrigatório. Único entre perfis. |
| `AllowSubDomains` | bool | Se `true`, subdomínios de `Domain` também correspondem. Default: `true`. |
| `Rules` | array | Lista de regras. Mínimo: 1. Aplicadas na ordem declarada. |

### ForwardingRule

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `Downstream` | string | Texto a ser substituído (FQDN do lado do usuário). Tratado como literal. |
| `Upstream`   | string | Texto de substituição (FQDN do site real). |

### Validação

`SpeculumConfig.Load()` valida toda a config antes de retornar e lança
`InvalidOperationException` com todos os erros encontrados se algo for inválido.
Não há "avisos tolerados" — qualquer erro aborta o startup.

Regras de validação:
- `Domain`, `Downstream` e `Upstream` devem ser FQDNs válidos (`a-z0-9` e `-`, separados por `.`, mínimo dois labels).
- Nenhum desses campos pode conter esquema, porta, espaço ou path (`://`, `:`, `/`, `\`, ` `).
- Domínios duplicados entre perfis são rejeitados.
- Cada perfil deve ter pelo menos uma regra.

### Variáveis de ambiente (Docker)

Qualquer campo de config pode ser sobrescrito via variável de ambiente usando
a convenção ASP.NET Core de `__` como separador de seção:

```
Sidecar__BaseUrl=ws://sidecar:3000
CertificatesPath=/Certificates
MaxSessions=5
```

---

## 8. Decisões de design

### Por que o cliente envia `window.location.href`?

O MITM precisa saber qual URL o usuário está acessando para abrir o site real
correspondente. Alternativas consideradas:

- **Extrair do header `Host` no servidor** — funciona para o domínio, mas perde
  o path e query string (o header `Referer` é opcional e pode ser bloqueado).
- **Configurar URL de destino por domínio sem preservar path** — simples, mas
  o usuário não chegaria na página certa (ex: `/cars?q=1` seria perdido).
- **Solução escolhida: cliente envia `window.location.href`** — transmite o
  estado completo (scheme, host, path, query, fragment) sem esforço adicional
  no servidor. O servidor precisa apenas reescrever o domínio.

### Por que `Regex.Escape` e não `string.Replace`?

`Regex.Escape` garante que o valor de `Downstream` seja tratado como literal,
não como padrão regex. Isso importa porque:

1. Domínios contêm `.` que em regex significa "qualquer caractere". Sem escape,
   `websete.localhost` corresponderia a `webseteXlocalhost` também.
2. Usando a API de Regex (mesmo com literal) conseguimos `RegexOptions.IgnoreCase`
   e `matchTimeout` de graça, sem implementar a lógica manualmente.
3. Abre a porta para regras mais sofisticadas no futuro (ex: grupos de captura
   para preservar subdomínios dinamicamente) sem mudar a interface.

### Por que o timeout de 250ms no Regex?

Proteção contra [ReDoS](https://owasp.org/www-community/attacks/Regular_expression_Denial_of_Service_-_ReDoS).
Um cliente malicioso poderia enviar uma URL construída para causar backtracking
exponencial em padrões regex. Com `matchTimeout`, o pior caso é 250ms de CPU
desperdiçado por regra por sessão — aceitável e previsível.

### Por que SNI e não um cert wildcard?

Certs wildcard (`*.websete.localhost`) cobrem apenas um nível de subdomínio e
não cobrem o apex (`websete.localhost` em si). SNI com `ServerCertificateSelector`
cobre ambos sem restrição de profundidade, e cada domínio pode ter seu próprio
cert emitido por sua própria CA ou Let's Encrypt — importante quando múltiplos
domínios reais são servidos pelo mesmo Speculum.

### Por que o cert é carregado antes de `builder.Build()`?

Kestrel precisa do delegate `ServerCertificateSelector` configurado antes de
começar a aceitar conexões. Se o cert fosse carregado lazy (na primeira conexão),
haveria uma janela onde TLS seria negociado sem cert configurado. Carregando
antes do `Build()`, qualquer erro de cert — arquivo ausente, cert inválido,
chave incorreta — aborta o startup imediatamente com mensagem clara, em vez de
falhar silenciosamente na primeira conexão HTTPS.

### Por que `AllowSubDomains` controla tanto cert quanto forwarding?

Um subdomínio de um perfil deve ter exatamente o mesmo comportamento que o
apex: mesmo cert TLS, mesmas regras de reescrita. Separar os flags criaria
configuração inconsistente (ex: cert válido para subdomínio mas reescrita não
funciona). O flag único em `ForwardingProfile` governa os dois sistemas
simetricamente.

### Por que a URL é reescrita apenas na criação da sessão?

O MITM opera no nível do browser virtual, não como proxy HTTP. Uma vez que o
browser virtual está no site real (`olx.com.br`), ele navega normalmente via
links, formulários e redirects — tudo usando os domínios reais. Não há
necessidade de interceptar cada request subsequente. A reescrita acontece uma
única vez, no `initialUrl`, para "injetar" o browser no ponto certo do site real.

Navegações posteriores (back, forward, clicks em links) acontecem naturalmente
dentro do Chrome real sem qualquer intervenção do Speculum.
