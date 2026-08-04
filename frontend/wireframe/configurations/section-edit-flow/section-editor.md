# Configuration section editor

## Job
Load, edit, validate, and apply one engine section with facilitated primary controls. Technical JSON is secondary.

## Route / params / auth gate
- Route: `/admin/configurations/:section`
- Params: `section` ∈ Hosting | Navigation | Sessions | ResourceManagement | Scripting | Journal | Telemetry
- Auth: Bearer access

## Entrada
From hub; Scripting primary UX is `/admin/scripts?tab=injections` (hub deep-link). Advanced stay-in-config JSON remains available on this route.

## Layout

```
PageHeader [Back All sections] · section title · DNA description
MetaRow: dirty/ready hints

┌ Primary controls (Card) ───────────────────────────────┐
│ Section-specific facilitator fields (see inventory)    │
└────────────────────────────────────────────────────────┘

▸ Technical details (collapsed Reveal)
  JSON textarea + Apply technical details

Sticky footer (contained in editor width, compact dock — not a full-bleed empty tray):
  [Save {section}] · inline status on the same strip (pending / success / error via SaveFeedbackStrip)
```

## Inventory de controlos (primary)

### Navigation
| id | tipo | label | helper |
|----|------|-------|--------|
| defaultTargetHost | text | Default target host | Bare host, no scheme/path |
| allowedMainFrameUrls | allowlist editor | Main-frame allowlist | Match-all switch; host modes any/exact/subdomains; path modes any/prefix/exact; presets + helper callout |

### Sessions
| id | tipo | label |
|----|------|-------|
| status + StatCards | posture strip | Timeout · JS bridge · viewport · multiplexing |
| guided-presets | Lab / Shared / Locked-down + fill gaps | Merge-safe posture; fill only missing nests |
| detachedSessionTimeout | duration facilitator (5m/15m/30m/1h/custom) | Detached session timeout |
| isJsBridgeEnabled | switch + consequence copy | Enable JavaScript bridge |
| viewportPolicy.default | size chips + width/height | Default viewport |
| Reveal: viewport min/max | numbers | How small/large clients may resize |
| ControlStep: stream sharpness | Sharp / Lean chips | Screencast encode density (MaxEncodeScale 2/1) |
| Reveal: clientEnvironmentPolicy | locale/language/timezone/colorScheme + env chips | What locale sessions pretend |
| Reveal: deviceEmulationPolicy | desktop/mobile presets + defaults + bounds/UA | Phone vs desktop |
| Reveal: input/output multiplexing | enums + plain-language helpers | Who can type / who gets frames |

### ResourceManagement
| id | tipo | label |
|----|------|-------|
| sessions.maxConcurrentSessions | number + slot chips + Lab/Dev/Small-prod presets | Maximum concurrent sessions |
| sessions.maxConcurrentSessionsPerProfile | unlimited switch + number | Max sessions per profile |
| storage.budgetBytes | GiB presets + custom | Storage budget |
| Reveal (open): maxSessionDuration (duration facilitator), maxPipesPerSession (unlimited switch) | | |
| Reveal: profiles retention (day presets), history entry chips, storage retention facilitators | | |
| Reveal: diagnostics probe limits (concurrent, response KiB, elevation duration) | | |
| Callout → Host resources | | shm / capacity planning |

### Hosting
| id | tipo | label |
|----|------|-------|
| defaultCertificateEmail | email | Default certificate email |
| domains[] | repeater | Domain, optional email, subdomain mirroring, DNS challenge reveal (Cloudflare) |

### Journal
| id | tipo | label |
|----|------|-------|
| events | catalog toggles | Opt-in facts from `GET /api/journal/catalog` |
| — | StatusPill / StatCard | Enabled opt-ins, catalog size, categories (owner or type prefix) |
| — | SearchFilter | Filter catalog by name / type / category |
| — | GuidedPreset | Investigation (high-signal Journal-owned); Clear opt-ins — never disables canonical; never writes Telemetry-owned keys |
| — | dense grouped list | Enable/disable filtered Journal-owned facts; Telemetry-owned rows browse-only → Telemetry section |
| — | RevealPanel | Canonical always-on list; custom fact key fallback (not primary) |
| — | HelperCallout | Canonical always recorded; opt-ins cost retention/noise; link Diagnostics timeline |

### Telemetry
| id | tipo | label |
|----|------|-------|
| isEnabled | master switch + Sampler off/Lean/Operable/Deep presets | Enable telemetry sampler |
| intervalSeconds | interval chips + custom (clamped 1–3600) + samples/hour | Sample interval |
| host/apiProcess/sessions/sidecar/profiles/journal/docker | section cards + enable all/none; nested includes when on | Sample sections |
| Reveal: events map | opt-in Telemetry event facts (not SampleCollected) | |
| Callout → Telemetry monitor | | |

### Scripting
Callout → Open injections + library; show injection count. No JSON editor.

## Copy
“{section} controls”; “Facilitated fields only — no JSON wall.”; “Save {section}”; “{section} saved.”; “Why this matters”.

## Inteligência UX
Routine fields visible; nested policies in Reveal; **no JSON wall** on the operator path. Errors preserve input; Save sticky.

## Path feliz
1. GET section. 2. Edit facilitated fields. 3. PUT. 4. Inline confirmation.

## Estados
Loading “Retrieving”; invalid route; inline validation; save disabled while pending; success explicit.

## Dados / API
| ação | método | path |
|------|--------|------|
| load | GET | `/api/configurations/:section` |
| save | PUT | `/api/configurations/:section` |
| journal catalog | GET | `/api/journal/catalog` |

## Components
`PageHeader`, `HelperCallout`, `SaveFeedback` / save strip, `RevealPanel`, `GuidedPreset`, `InlineValidation`, allowlist editor, Card, Switch, Input, Select.

## Aceite
- [ ] Every section has a non-JSON primary path
- [ ] Navigation allowlist facilitated
- [ ] Sessions Lab/Shared/Locked-down presets + timeout facilitator + nested reveals including multiplexing
- [ ] Journal uses catalog when available (search, group, presets, dense list; Telemetry-owned not toggled here)
- [ ] Journal never claims to disable canonical; custom key add is Reveal fallback only
- [ ] No Technical JSON disclosure on section pages

## Explicitamente fora
Multi-section edit page; fake defaults; automatic migration; inventing fields not on the server model; raw Technical JSON as operator UI.

