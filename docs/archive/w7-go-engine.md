# Websete Engine (W7) — archived

> **This document describes the legacy Go-based W7 MITM engine.** It is **not** the current Speculum (W7S) remote-browser stack.  
> For the active project, start at [../../readme.md](../../readme.md).

---

# Websete Engine (W7)

Websete Engine (W7) is a Go-based HTTPS interception and forwarding engine.  
It terminates downstream TLS, processes HTTP traffic through a middleware pipeline, and reconnects upstream using a uTLS client fingerprint derived from the downstream `ClientHello`.

This document is the authoritative technical reference for this repository and describes what is currently implemented in code.

---

## Table of Contents

- [What W7 Is](#what-w7-is)
- [Core Capabilities](#core-capabilities)
- [Architecture](#architecture)
- [Request Lifecycle](#request-lifecycle)
- [Protocol and TLS Model](#protocol-and-tls-model)
- [Middleware Pipeline (Exact Order)](#middleware-pipeline-exact-order)
- [Configuration](#configuration)
- [Configuration Reference](#configuration-reference)
- [Practical Usage Guide (How To Use)](#practical-usage-guide-how-to-use)
- [Configuration Recipes (Copy/Paste)](#configuration-recipes-copypaste)
- [Lure Deep Dive](#lure-deep-dive)
- [Cookie Namespace Model](#cookie-namespace-model)
- [Caching Model](#caching-model)
- [Firewall Model](#firewall-model)
- [Script Injection Model](#script-injection-model)
- [Static and Script File Serving](#static-and-script-file-serving)
- [Certificates](#certificates)
- [Project Structure](#project-structure)
- [Build and Run](#build-and-run)
- [Docker Deployment](#docker-deployment)
- [Testing](#testing)
- [Telemetry](#telemetry)
- [Troubleshooting](#troubleshooting)
- [Conscious Design Limitations](#conscious-design-limitations)
- [Known Limitations and Caveats](#known-limitations-and-caveats)
- [Roadmap (Ambitious Targets)](#roadmap-ambitious-targets)
- [Security and Legal Notice](#security-and-legal-notice)

---

## What W7 Is

W7 is a programmable MITM-style engine focused on traffic control and transformation:

- Accepts downstream TLS connections at a configured TCP address.
- Negotiates HTTP/1.1 or HTTP/2 via ALPN.
- Runs each request through middleware for firewalling, rewriting, patching, caching, static/script serving, and upstream forwarding.
- Reconnects upstream with uTLS and applies the downstream fingerprint (`ClientHelloSpec`) to reduce handshake mismatch.

W7 is **not** a generic reverse proxy with high-level abstraction only. It contains explicit transport, protocol, and rewriting behavior implemented directly in code.

---

## Core Capabilities

- Downstream TLS termination using configured certificate pair.
- Upstream dialing with optional HTTP CONNECT proxy support.
- HTTP/1.1 and HTTP/2 forwarding.
- Stream switching support (`101 Switching Protocols` and successful `CONNECT` tunnels).
- Bidirectional host rewriting (upstream <-> downstream mapping).
- Request/response body rewriting for textual payloads.
- HTML script injection at configurable insertion points.
- Firewall policies (allow/deny/mock) and lure-based redirect gate.
- In-memory HTTP cache with HIT/MISS headers and range-aware responses.
- Optional redirect patcher (`http://` -> `https://` on 3xx `Location`).

---

## Architecture

### Startup Layer

1. `Bootstrap()` ensures required folders exist.
2. `LoadConfig()` reads `config.json`.
3. `applyDefaults()` fills default values for script type and firewall behavior.
4. `ValidateConfig()` validates syntax/semantics and selected cross-field rules.
5. DI container is built with all runtime services.
6. Domain certificate is loaded from `Certificates`.

### Connection Layer

- Listener binds to `TcpAddress`.
- Each accepted TCP connection is handled in a goroutine.
- `ConnectionContext` peeks downstream `ClientHello`, performs downstream TLS handshake, and stores raw `ClientHello` bytes for fingerprinting.

### Forwarding Layer

- ALPN decides forwarder:
  - `http/1.1` -> `Http1Forwarder`
  - `h2` -> `Http2Forwarder`
- For each request/stream, a scoped service provider and `HttpContext` are created.
- The pipeline runs with deterministic middleware order.
- Endpoint middleware executes upstream round-trip via H1 or H2 transport.

---

## Request Lifecycle

1. Process starts at `main.go`.
2. Engine bootstraps folders and loads/validates config.
3. TCP listener starts on `TcpAddress`.
4. Downstream TLS handshake completes with configured certificate.
5. Protocol is negotiated (`h2` or `http/1.1`).
6. Request enters middleware pipeline.
7. If not short-circuited, request is sent upstream through selected transport.
8. Response flows back through post-processing middlewares.
9. Final response is written to downstream connection.

For stream-switch scenarios, WebSockets middleware takes over raw bidirectional copy and marks response as already sent.

---

## Protocol and TLS Model

### Downstream (Client -> W7)

- TLS server side is created with `utls.Server`.
- Advertised ALPN protocols: `h2`, `http/1.1`.

### Upstream (W7 -> Target)

- W7 extracts `ClientHelloSpec` from downstream bytes.
- Upstream connection uses `utls.UClient(..., HelloCustom)`.
- The extracted preset is applied with `ApplyPreset`.
- ALPN protocols: `h2`, `http/1.1`.

### Proxy

If proxy is enabled, upstream TCP is established through HTTP CONNECT with Basic auth.

### Important TLS Behavior

- Upstream TLS uses `InsecureSkipVerify: true` by design in current implementation.
- This is suitable only for controlled environments where trust boundaries are explicit.

---

## Middleware Pipeline (Exact Order)

W7 builds the HTTP pipeline in this exact order:

1. `ErrorMiddleware`
2. `TelemetryMiddleware`
3. `FirewallMiddleware`
4. `ScriptsMiddleware`
5. `StaticFilesMiddleware`
6. `CacheMiddleware`
7. `WebSocketsMiddleware`
8. `PatcherMiddleware`
9. `RewriterMiddleware`
10. `EndpointMiddleware`

### Practical Impact of Order

- Firewall can block/mock/redirect before upstream traffic.
- Script/static middlewares can serve local files and bypass upstream.
- Cache can return HIT without reaching endpoint.
- Patcher runs request patching before rewrite+endpoint and response patching after downstream flow returns.
- Rewriter executes around endpoint when `UseHostRewrite` is true.

---

## Configuration

W7 reads `config.json` in the current working directory at startup.  
There are no CLI flags and no environment-variable override path in current code.

---

## Configuration Reference

### Root Object

```json
{
  "Environment": "Dev",
  "TcpAddress": "0.0.0.0:443",
  "Domain": "websete.localhost",
  "MaxConnections": 20000,
  "ProxyConfig": {},
  "RoutingConfig": {},
  "FirewallConfig": {},
  "RewriteConfig": {},
  "ScriptConfig": {},
  "PatchingConfig": {}
}
```

### `Environment` (`"Dev" | "Staging" | "Prod"`)

- Type: string enum.
- Declared enum exists in code.
- Currently **not validated** in `ValidateConfig`.
- Runtime side effect used by scripts: `IS_DEBUG` is true only when `Environment == "Dev"`.

### `TcpAddress` (`string`, required)

- Must be `host:port`.
- Host cannot be empty.
- Port must be valid TCP port.

### `Domain` (`string`, required)

- Must be valid FQDN-style domain (not URL, no path/port/scheme).
- Must have matching certificate files in `Certificates`.

### `MaxConnections` (`int`, required)

- Validator range: `1..65535`.
- Note: validated, but currently not used as active runtime limit.

### `ProxyConfig`

```json
"ProxyConfig": {
  "Enable": false,
  "Address": "proxy.example.com:8080",
  "User": "username",
  "Password": "password",
  "SessionParam": ""
}
```

- `Enable` (`bool`): enables upstream HTTP CONNECT proxy.
- `Address` (`string`): required `host:port` when enabled.
- `User` and `Password` (`string`): if one is present, both must be present.
- Username cannot contain reserved chars `:` or `@`.
- `SessionParam` exists but is currently unused by runtime logic.

### `RoutingConfig`

```json
"RoutingConfig": {
  "Rules": [
    {
      "PathPrefix": "/api",
      "UpstreamAddress": "api.example.com",
      "UpstreamPath": "/",
      "UseTls": true,
      "UseProxy": false,
      "UseHostRewrites": true
    }
  ]
}
```

- Schema exists.
- `validateRoutingConfig` is currently empty.
- `CreateEndpoint` currently returns fixed behavior (`UseTls: true`, `UseHostRewrite: true`), so routing rules are effectively dormant.

### `FirewallConfig`

```json
"FirewallConfig": {
  "Enable": true,
  "UseDownstreamPolicies": false,
  "UseUpstreamPolicies": false,
  "UseLures": false,
  "DefaultDownstreamPolicy": "Allow",
  "DefaultUpstreamPolicy": "Allow",
  "RedirectURL": "https://example.org",
  "LureCookieMaxAge": 172800,
  "DownstreamPolicies": [],
  "UpstreamPolicies": [],
  "Lures": []
}
```

Allowed policy actions:

- `Allow`
- `Deny`
- `Mock`

Defaults applied when firewall is enabled:

- Missing default policies become `Allow`.
- Policy toggles are auto-enabled when corresponding list is non-empty.
- If policy lists are empty, corresponding toggles are forced false.
- If `UseLures` is true:
  - `LureCookieMaxAge` default: `172800` (2 days)
  - `RedirectURL` default: Rickroll URL

Validation highlights:

- Policy host must be valid domain.
- Policy path and method are required.
- Allowed methods: `GET`, `POST`, `PUT`, `DELETE`, `PATCH`, `HEAD`, `OPTIONS`, `*`.
- If `UseLures` is true:
  - `Lures` required
  - `RedirectURL` required
  - `LureCookieMaxAge` > 0 and <= 30 days

### `RewriteConfig`

```json
"RewriteConfig": {
  "HostRules": [
    { "Upstream": "target.example.com", "Downstream": "target.websete.localhost" }
  ]
}
```

- Both fields must be valid domains.
- For each rule, engine creates:
  - Upstream -> Downstream rewrite rule.
  - Downstream -> Upstream rewrite rule.

### `ScriptConfig`

```json
"ScriptConfig": {
  "InjectionRules": [
    {
      "Host": ".*\\.example\\.com",
      "File": "w7.js",
      "Position": "HeaderTop",
      "Type": "Classic"
    }
  ]
}
```

Field rules:

- `Host`: valid regex or valid domain.
- `File`: must end with `.js` and exist at `Scripts/<File>`.
- `Position`: one of `HeaderTop`, `HeaderBottom`, `BodyTop`, `BodyBottom`.
- `Type`: `Classic` or `Module`; defaults to `Classic` when omitted.

### `PatchingConfig`

```json
"PatchingConfig": {
  "PatchTurnstile": false,
  "ForceHttpsRedirect": true
}
```

- `PatchTurnstile`: currently wires a no-op patcher.
- `ForceHttpsRedirect`: rewrites redirect `Location` header from `http://` to `https://` for 3xx responses.

---

## Practical Usage Guide (How To Use)

This section is intentionally operational.  
If you are asking "how do I actually run and use this thing?", start here.

### 1) Minimal local startup

1. Create certificate files for your configured local domain.
2. Place them in `Certificates` using domain naming convention.
3. Create `config.json` with at least domain, address, rewrite rule, and max connections.
4. Start:

```powershell
go run .
```

5. Point your test client/browser to your local domain and port.

### 2) What a single request does in practice

For a request to `https://websete.localhost/some/path`:

1. Downstream TLS terminates in W7.
2. Firewall may allow/deny/mock/redirect.
3. Local script/static middlewares may short-circuit.
4. Cache may serve HIT.
5. Request is patched, rewritten, and sent upstream.
6. Response is rewritten, patched, possibly cached, then returned.

### 3) How to verify each subsystem quickly

- **Rewrite**: send HTML containing upstream host and check downstream body/headers after rewrite.
- **Scripts**: request HTML and inspect `<head>`/`<body>` for injected script tags.
- **Firewall**: add deny rule and verify immediate `403`.
- **Lure**: enable lures, request non-lure document path, verify `302`.
- **Cache**: request same static GET twice and inspect `X-W7-Cache` transition (`MISS` -> `HIT`).

---

## Configuration Recipes (Copy/Paste)

These examples are practical baselines and intentionally verbose.

### Recipe A - Minimal MITM (no proxy, no firewall)

```json
{
  "Environment": "Dev",
  "TcpAddress": "0.0.0.0:443",
  "Domain": "websete.localhost",
  "MaxConnections": 20000,
  "ProxyConfig": { "Enable": false },
  "RoutingConfig": { "Rules": [] },
  "FirewallConfig": { "Enable": false },
  "PatchingConfig": {
    "PatchTurnstile": false,
    "ForceHttpsRedirect": true
  },
  "RewriteConfig": {
    "HostRules": [
      {
        "Upstream": "target.example.com",
        "Downstream": "websete.localhost"
      }
    ]
  },
  "ScriptConfig": { "InjectionRules": [] }
}
```

Use when:

- You want the cleanest baseline with rewriting and forwarding only.

### Recipe B - Upstream proxy enabled

```json
{
  "Environment": "Dev",
  "TcpAddress": "0.0.0.0:443",
  "Domain": "websete.localhost",
  "MaxConnections": 20000,
  "ProxyConfig": {
    "Enable": true,
    "Address": "proxy.example.net:8080",
    "User": "proxy_user",
    "Password": "proxy_pass",
    "SessionParam": ""
  },
  "RoutingConfig": { "Rules": [] },
  "FirewallConfig": { "Enable": false },
  "PatchingConfig": {
    "PatchTurnstile": false,
    "ForceHttpsRedirect": true
  },
  "RewriteConfig": {
    "HostRules": [
      {
        "Upstream": "target.example.com",
        "Downstream": "websete.localhost"
      }
    ]
  },
  "ScriptConfig": { "InjectionRules": [] }
}
```

Use when:

- You need all upstream traffic tunneled through a provider proxy.

### Recipe C - Script injection on one host and all subdomains

```json
{
  "Environment": "Dev",
  "TcpAddress": "0.0.0.0:443",
  "Domain": "websete.localhost",
  "MaxConnections": 20000,
  "ProxyConfig": { "Enable": false },
  "RoutingConfig": { "Rules": [] },
  "FirewallConfig": { "Enable": false },
  "PatchingConfig": {
    "PatchTurnstile": false,
    "ForceHttpsRedirect": true
  },
  "RewriteConfig": {
    "HostRules": [
      {
        "Upstream": "example.com",
        "Downstream": "websete.localhost"
      }
    ]
  },
  "ScriptConfig": {
    "InjectionRules": [
      {
        "Host": "www\\.example\\.com",
        "File": "w7.js",
        "Position": "HeaderTop",
        "Type": "Classic"
      },
      {
        "Host": ".*\\.example\\.com",
        "File": "w7.js",
        "Position": "BodyBottom",
        "Type": "Module"
      }
    ]
  }
}
```

Use when:

- You need deterministic payload placement by host pattern.

### Recipe D - Lure gate with redirect and allow policies

```json
{
  "Environment": "Dev",
  "TcpAddress": "0.0.0.0:443",
  "Domain": "websete.localhost",
  "MaxConnections": 20000,
  "ProxyConfig": { "Enable": false },
  "RoutingConfig": { "Rules": [] },
  "FirewallConfig": {
    "Enable": true,
    "UseDownstreamPolicies": true,
    "UseUpstreamPolicies": false,
    "UseLures": true,
    "DefaultDownstreamPolicy": "Allow",
    "DefaultUpstreamPolicy": "Allow",
    "RedirectURL": "https://example.org/landing",
    "LureCookieMaxAge": 172800,
    "DownstreamPolicies": [
      {
        "Host": "websete.localhost",
        "Path": "*",
        "Method": "*",
        "Action": "Allow"
      }
    ],
    "UpstreamPolicies": [],
    "Lures": [
      {
        "Host": "websete.localhost",
        "Path": "/"
      },
      {
        "Host": "websete.localhost",
        "Path": "/entry/*"
      }
    ]
  },
  "PatchingConfig": {
    "PatchTurnstile": false,
    "ForceHttpsRedirect": true
  },
  "RewriteConfig": {
    "HostRules": [
      {
        "Upstream": "target.example.com",
        "Downstream": "websete.localhost"
      }
    ]
  },
  "ScriptConfig": { "InjectionRules": [] }
}
```

Use when:

- You want entry-point gating before normal flow continues.

---

## Lure Deep Dive

This section explains lure behavior as an execution flow, not just feature description.

### What problem lures solve

Lures enforce that "document navigation must begin at expected entry points" before regular browsing is accepted.

### Exact decision flow (current code behavior)

For each request when firewall is enabled:

1. If `UseLures` is false -> lure logic is skipped.
2. If method is `OPTIONS` -> lure gate is skipped.
3. Lure gate is evaluated only for requests where `Sec-Fetch-Dest == document`.
4. If lure cookie already exists -> request proceeds (no redirect).
5. If no lure cookie:
   - If request matches any lure policy (`Host` + `Path`) -> request proceeds.
   - If it does not match -> W7 returns `302` to `RedirectURL`.
6. After successful pipeline pass, if request matched lure and had no lure cookie, W7 sets `X-You-Got-Fished`.

### Lure cookie details

- Name: `X-You-Got-Fished`
- Domain: `.<config.Domain>`
- Path: `/`
- `SameSite=None`
- `Secure=true`
- `HttpOnly=false` (as implemented)
- `MaxAge`: from `LureCookieMaxAge`

### Debug checklist for lure issues

- Confirm `FirewallConfig.Enable=true` and `UseLures=true`.
- Confirm at least one valid lure exists.
- Confirm browser request carries `Sec-Fetch-Dest: document`.
- Confirm host/path exactly match lure pattern logic.
- Confirm cookie domain matches your downstream host space.

---

## Cookie Namespace Model

W7 rewrites upstream cookies to prevent cross-domain loss in browser context:

- Upstream `Set-Cookie` is parsed.
- Cookie name is namespaced as `name:original-domain`.
- Cookie domain is rewritten to proxy domain (`.<config.Domain>`).
- `SameSite=None` and `Secure=true` are enforced on downstream cookie serialization.

On downstream requests:

- Namespaced cookies are decoded back to plain `name=value`.
- Only cookies matching the current target host context are forwarded upstream.

---

## Caching Model

Cache is in-memory (`httpx.MemoryHttpCache`) and middleware-driven.

### Cache Key

Key format includes:

- request method
- request host + path
- `Origin` header
- `Accept-Encoding` header

Query string is not part of key in current implementation.

### Eligibility

Primary conditions:

- Method must be `GET`.
- Status must be `200` or `206`.
- Response must not be continuous stream.
- `Set-Cookie` must be absent.
- Vary must be limited to `accept-encoding` and/or `origin`.
- Respects cache-control restrictions (`no-store`, `no-cache`, `private`).
- Max body size threshold: 25 MB.

### TTL

- From `Cache-Control: max-age=<seconds>` when available.
- Fallback: 5 minutes for known static extensions.
- Otherwise TTL returns `0`, which fails cache storage (`minimum 1s` required).

### Response Headers

- `X-W7-Cache: HIT` for served-from-cache.
- `X-W7-Cache: MISS` for new cached response.
- `Accept-Ranges: bytes` added.

---

## Firewall Model

When enabled, firewall can return terminal responses before endpoint forwarding:

- `Deny` -> `403`
- `Mock` -> `200` with synthetic body
- Lure mismatch -> `302` to `RedirectURL`

Lure logic details:

- Lure cookie name: `X-You-Got-Fished`.
- For document fetches without lure cookie, unmatched lures trigger redirect.
- On successful lure match, cookie is set post-next with configured max age.

Policy matching:

- Host: exact match.
- Path: exact, wildcard `*`, or prefix wildcard ending in `/*`.
- Method: exact or `*`.

---

## Script Injection Model

W7 injects both internal engine scripts and user-defined scripts.

### Internal Scripts (always loaded)

- Engine config script (`LOCAL_DOMAIN`, `IS_DEBUG`, `DOMAIN_BINDINGS`).
- URL rewrite helper (`applyUrlRewrite`).
- `xhook` external loader: `https://unpkg.com/xhook@latest/dist/xhook.min.js`.
- HTTP API hijack script for fetch/XHR rewrites.
- DOM element hijack script for dynamic URL-bearing elements.

### User Scripts

- Configured by `ScriptConfig.InjectionRules`.
- `Host` is compiled as regex (`regexp.MustCompile`).
- Script tags are generated with optional `type="module"` and `src="/<file>"`.

### Injection Points

- `HeaderTop` (after `<head>` start tag)
- `HeaderBottom` (before `</head>`)
- `BodyTop` (after `<body>` start tag)
- `BodyBottom` (before `</body>`)

Injection is performed only for HTML content.

---

## Static and Script File Serving

Two short-circuit middlewares serve local files:

- `ScriptsMiddleware`: serves from `Scripts`.
- `StaticFilesMiddleware`: serves from `Static Files`.

Behavior:

- If requested path exists in provider map, response is generated locally with mime type and status `200`.
- Scripts middleware normalizes missing `.js` extension.
- File providers are indexed at startup, not continuously rescanned.

---

## Certificates

W7 validates and loads certificate files using domain-based naming:

- `Certificates/<domain>.fullchain.pem`
- `Certificates/<domain>.privatekey.pem`

`Domain` in config must have a corresponding pair or startup validation fails.

---

## Project Structure

- `main.go` - process entrypoint.
- `core/` - bootstrap, config load/validate, app builder, listener lifecycle.
- `config/` - configuration structs and enums.
- `forwarding/` - protocol forwarders, middleware, endpoint and utility helpers.
- `netx/` - TLS/clienthello fingerprinting and dialers (direct/proxy/TLS).
- `rewriting/` - host and HTML rewrite engine.
- `scripting/` - script generation and HTML injection.
- `patching/` - patcher interface and implementations.
- `staticfiles/` - local file providers.
- `httpx/` - pipeline abstractions, context, response builder, cache.
- `certs/` - certificate loading and validation helpers.
- `tests/` - test suites (`di`, `httpx`).

---

## Build and Run

### Prerequisites

- Go `1.25.6` (declared in `go.mod`).
- Valid `config.json`.
- Valid certificate pair for configured `Domain`.

### Run directly

```powershell
go run .
```

or

```powershell
go run main.go
```

### Release binaries (`publish_bin.ps1`)

Builds:

- `Bin/websete-linux-amd64`
- `Bin/websete-windows-amd64.exe`

Command:

```powershell
.\publish_bin.ps1
```

### Local shared library build (`local_build.ps1`)

Builds `websete-engine.dll` in `c-shared` mode using MinGW + GCC.

```powershell
.\local_build.ps1
```

---

## Docker Deployment

### Dockerfile

- Multi-stage build from `golang:1.25.6-alpine`.
- Produces static linux binary (`CGO_ENABLED=0`).
- Runtime image is Alpine.
- Exposes port `443`.

### Compose

`docker-compose.yml` defines service `websete-proxy` with:

- host network mode
- restart policy `always`
- port mapping `443:443`
- `ulimit` and `sysctls` tuning

Note: compose env vars (`PROXY_USER`, `PROXY_PASS`, `PROXY_ADDR`) are present, but current Go runtime does not consume env vars for config.

---

## Testing

Run:

```powershell
go test ./...
```

Current test coverage focuses on:

- DI container behavior (`tests/di`)
- HTTP abstractions and cache logic (`tests/httpx`)

Areas with no dedicated test suite in this repo include core forwarding/rewrite/firewall/certs/netx end-to-end paths.

---

## Telemetry

`TelemetryMiddleware` starts a background logger once and prints engine status every 10 seconds, including:

- active connections
- cache hits/misses/hit ratio/saved bandwidth
- firewall and lure counters

---

## Troubleshooting

### Startup fails with certificate error

Check that files exist and match naming convention:

- `Certificates/<domain>.fullchain.pem`
- `Certificates/<domain>.privatekey.pem`

### Config validation fails

W7 returns aggregated errors with JSON-like paths (for example `$.TcpAddress`, `$.ScriptConfig...`).

### Unexpected upstream TLS behavior

Remember upstream verification is disabled (`InsecureSkipVerify`) and uTLS preset is mandatory on this path.

### Script rule not triggering

- Ensure script file exists in `Scripts`.
- Confirm host regex matches the actual request host.
- Ensure response content type is HTML for HTML injection path.

---

## Conscious Design Limitations

These are current intentional choices or accepted trade-offs in implementation:

- `InsecureSkipVerify` on upstream TLS is intentionally enabled for controlled interception scenarios.
- File providers are startup-indexed for deterministic and fast lookup (no live FS watcher complexity).
- Cookie re-namespace strategy prioritizes compatibility in cross-site browser contexts over strict origin semantics.
- Middleware flow is explicit and linear to keep transformation order predictable.
- Routing schema is preserved even though endpoint resolution is currently fixed, allowing future extension without breaking config shape.

---

## Known Limitations and Caveats

- `MaxConnections` is validated but not enforced as runtime gate.
- `RoutingConfig` schema exists but active routing logic is not implemented.
- `TurnstilePatcher` is currently a no-op.
- `ProxyConfig.SessionParam` is currently unused.
- `Environment` enum includes `Staging`, but validator does not enforce environment value.
- Upstream TLS certificate verification is disabled.
- Cache key ignores query string.
- Cache recovery requests use `http.DefaultClient`, bypassing custom transport stack.
- File providers index files at startup only (no live refresh).
- Script host patterns are compiled as regex directly (`regexp.MustCompile`).
- Response rewriter intentionally strips selected security headers (`CSP`, `HSTS`, `X-Frame-Options`, etc).
- `Accept` error logging path in listener attempts `connection.RemoteAddr()` when `Accept` fails, which may panic on nil connection.

---

## Roadmap (Ambitious Targets)

This roadmap combines architectural improvements and offensive-capability goals discussed by maintainers/users.

### Transport and protocol architecture

- Add QUIC/UDP and HTTP/3 support (downstream and upstream strategy defined separately).
- Replace direct dependency on standard `http.RoundTripper` as upstream core abstraction.
- Build a custom upstream connection orchestration layer decoupled from Go standard HTTP transport.
- Support variable ALPN negotiation between DS and US (avoid hard coupling DS protocol -> US protocol).
- Introduce protocol-translation modes (for example DS H2 -> US H1.1 where strategically required).

### Connection lifecycle and pooling

- Introduce upstream connection pool scoped by downstream session and/or routing key.
- Add adaptive US connection reuse policy (host, ALPN, TLS fingerprint, auth context).
- Add smarter stream/session aware pooling for long-lived traffic.
- Add per-upstream health scoring and dynamic dial strategy fallback.

### Patching and challenge bypass

- Implement real `TurnstilePatcher` logic (request/response and script-level coordination).
- Add reCAPTCHA patching framework with challenge lifecycle hooks.
- Create generic anti-bot patch pipeline (extensible plugins for challenge families).

### Session and cookie operations

- Add session/cookie capture framework inspired by Evilginx-style operational workflows.
- Implement session export/import tooling for controlled replay/lab usage.
- Add explicit capture policies (host/path/method/cookie selectors) and secure storage backend.

### Rewriting and injection evolution

- Add AST-aware JavaScript rewriting mode for safer complex script transforms.
- Add richer DOM/network instrumentation scripts with per-target toggles.
- Add script execution telemetry and deterministic injection diagnostics.

### Firewall and policy engine

- Extend policy grammar (header predicates, query predicates, body signatures).
- Add policy priority and explicit conflict resolution strategy.
- Add runtime policy hot-reload with validation and rollback.

### Observability and operations

- Add metrics endpoint (Prometheus/OpenTelemetry).
- Add structured JSON logs and correlation IDs.
- Add trace mode for request rewrite diffing and patch actions.
- Add benchmark suite for high-concurrency mixed protocol load.

### Quality and maintainability

- Expand integration tests for forwarding/netx/rewriting/firewall end-to-end paths.
- Add fuzzing for parser-heavy areas (cookie parsing, range parsing, HTML rewriting).
- Isolate critical interfaces to reduce coupling between forwarding and middleware internals.

---

## Security and Legal Notice

W7 is a powerful interception engine.  
Use it only in environments where you have explicit authorization.

Operating MITM systems against unauthorized targets may violate law, contracts, policy, and ethics.  
You are fully responsible for how this software is configured and used.
