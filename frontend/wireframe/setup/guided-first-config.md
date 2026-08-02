# Guided first configuration (wizard)

## Job
Walk the operator through each **missing** mandatory section one at a time, validate, apply, then advance — until `operational === true`.

## Route / params / auth gate
- Route: `/setup/configure`
- Query: `step` = section name (optional)
- Auth: bearer required to apply (if missing, interrupt with login returnUrl)

## Entrada
From readiness gate. Mandatory sections today: `Navigation`, `Sessions`, `ResourceManagement` (Hosting optional). Wizard only queues **missing** from API; if operator opens configure when nothing missing → redirect Home.

## Layout

```
step-wizard: Step i of n · {SectionName}
[ Back ]  progress  [ Skip disabled ]

Section form (revealing: advanced collapsed)
[ Apply and continue ]

On last success: celebratory empty → Go to Home
```

## Inventory de controlos

| id | tipo | label | helper | default | required | validation |
|----|------|-------|--------|---------|----------|------------|
| wizard | step-wizard | — | Section titles | — | — | |
| form.* | fields | Per section DNA (Sprint 2 full; V1: structured fields for mandatory keys only — see below) | — | from GET section | yes | server validate |
| apply | button | Apply and continue | Writes section then reloads status | — | — | |
| advanced | reveal-panel | Advanced | Rare options | collapsed | — | |

### Minimum fields per mandatory section (Sprint 1 DNA)

Completeness source: `ConfigurationCompleteness.MissingRequired` — mandatory = `Navigation`, `Sessions`, `ResourceManagement`.

**Navigation** (complete when `defaultTargetHost` is a bare host, no scheme/path)

| id | tipo | label | helper | default | required | validation |
|----|------|-------|--------|---------|----------|------------|
| defaultTargetHost | text | Default target host | Host only, e.g. `example.com` | from GET | yes | bare host |
| allowedMainFrameUrls | facilitator | Main-frame allowlist | `UrlMatchRule[]` — optional for *completeness*; recommended for real browsing | `[]` | no for gate | same pattern UX as Scripts targets |
| recommendedHostRule | guided-preset | Allow default host | Adds one rule: domain Exact(`defaultTargetHost`) + path Any | — | no | |

Do **not** treat allowlist as a free-text URL list — wire is `allowedMainFrameUrls: UrlMatchRule[]` (camelCase).

**Sessions** (complete when timeout > 0 **and** validator passes)

Primary viewport:

| id | tipo | label | helper | default | required | validation |
|----|------|-------|--------|---------|----------|------------|
| detachedSessionTimeout | duration | Detached session timeout | TimeSpan JSON e.g. `00:30:00` | from GET or preset | yes | > 0 |
| applyRecommended | guided-preset | Apply recommended session defaults | Fills nested policies so PUT validates | — | **yes before first apply if empty** | — |

Putting **only** `detachedSessionTimeout` on an empty section **fails** apply (`ViewportPolicy` / `ClientEnvironmentPolicy` / `DeviceEmulationPolicy` required). Contract: either GET an already-valid section and patch timeout, or apply the recommended baseline then edit primary fields.

Recommended baseline (Admin DNA — valid shape; tweak timeout in UI):

```json
{
  "detachedSessionTimeout": "00:30:00",
  "isJsBridgeEnabled": true,
  "viewportPolicy": {
    "minimum": { "width": 100, "height": 100 },
    "default": { "width": 1280, "height": 720 },
    "maximum": { "width": 4096, "height": 2160 }
  },
  "clientEnvironmentPolicy": {
    "defaultLocale": "en-US",
    "defaultLanguage": "en-US",
    "defaultTimeZoneId": "UTC",
    "defaultColorScheme": "light"
  },
  "deviceEmulationPolicy": {
    "default": {
      "mobile": false,
      "touch": false,
      "deviceScaleFactor": 1,
      "maxTouchPoints": 0,
      "userAgentProfile": "desktop",
      "screenOrientation": "landscapePrimary"
    },
    "minDeviceScaleFactor": 1,
    "maxDeviceScaleFactor": 2,
    "maxTouchPoints": 10,
    "defaultTouchPointsWhenTouch": 5,
    "desktopUserAgentProfile": "desktop",
    "mobileUserAgentProfile": "mobile"
  },
  "inputMultiplexingPolicy": {
    "access": "shared",
    "ownership": "firstAttached",
    "scheduling": "arrivalOrder"
  },
  "outputMultiplexingPolicy": {
    "delivery": "broadcast",
    "ownership": "firstAttached"
  }
}
```

Nested policies live in `reveal-panel` **Advanced** (Sprint 2 full editors). Link: `Open full editor` → `/admin/configurations/Sessions` (skeleton until Sprint 2 depth; still a valid route).

**ResourceManagement** (complete when `sessions.maxConcurrentSessions > 0`)

| id | tipo | label | helper | default | required | validation |
|----|------|-------|--------|---------|----------|------------|
| sessions.maxConcurrentSessions | number | Max concurrent sessions | Path: `sessions.maxConcurrentSessions` | from GET or `10` | yes | ≥ 1 |

PUT may send a partial object; other nests (`profiles`, `storage`, `diagnostics`) deserialize to server defaults when omitted. Prefer GET → patch `sessions.maxConcurrentSessions` → PUT full merged object so retention/budget defaults are preserved.

(Full section field inventories deepen in Sprint 2 Configurations DNA.)

## Copy

- Apply: `Apply and continue`
- Success toast: `{Section} applied`
- Validation: show `save-feedback` with server message / field paths when available
- Complete title: `Setup complete`
- Complete CTA: `Go to Home`

## Inteligência UX nesta view

- Primary path: apply each missing section in order.
- Helpers: `step-wizard`, `reveal-panel`, `save-feedback`, `inline-validation`.
- Hidden: non-missing sections; Hosting unless later required.
- NBA: after complete → Home.
- Recovery: apply error keeps step; fix fields; retry. Back revisits previous **wizard** step without undoing server state unless user edits again.

## Path feliz

1. Compute queue = `missing` array order.
2. GET `/api/configurations/{section}` for current.
3. Edit → PUT section.
4. GET status; if section still missing, show errors; else advance.
5. When operational → complete screen → `/admin`.

## Reveals
Advanced panel per section; full editor link.

## Estados
loading section / editing / applying / error / complete.

## Dados / API

| ação UI | método | path | request | response usada |
|---------|--------|------|---------|----------------|
| Load section | GET | `/api/configurations/{section}` | — | section JSON |
| Apply | PUT | `/api/configurations/{section}` | section JSON body | 200 or error string |
| Status | GET | `/api/configurations/status` | — | `operational`, `missing` |

## Components usados
`step-wizard`, `page-header`, `reveal-panel`, `save-feedback`, `inline-validation`, `helper-callout`, `guided-preset`.

## Navegação
Vem de: `/setup`. Sai para: `/admin` on complete; login if unauthorized.

## Teclado / a11y
Wizard announces step changes; apply is primary button.

## Aceite de build
- [ ] Only missing mandatory sections appear
- [ ] Sessions step cannot apply empty nested policies (preset or full blob)
- [ ] ResourceManagement writes `sessions.maxConcurrentSessions`
- [ ] Successful apply advances
- [ ] Failed apply stays with message
- [ ] Completion when operational

## Explicitamente fora
Editing Scripting/Journal/Telemetry in this wizard (Configurations hub later); Hosting mirroring (1.1).
