# Configurations — skeleton (Sprint 2 depth)

## Jobs
1. Hub: see all engine sections + operational/missing status.  
2. Section edit flow: load → edit (revealing) → validate → apply → feedback.  
3. Never edit all sections on one page.

## Routes
| Route | Job |
|-------|-----|
| `/admin/configurations` | Hub list |
| `/admin/configurations/:section` | Section editor flow |
| `/admin/configurations/:section/review` | Optional review if large diff (Sprint 2) |

`:section` ∈ `Hosting` | `Navigation` | `Sessions` | `ResourceManagement` | `Scripting` | `Journal` | `Telemetry` (`ConfigSectionKeys`).

**Note:** Scripting injections UX lives under **Scripts** module; Configurations hub still lists Scripting for full-section / advanced JSON reveal.

## APIs (existing)

| método | path | use |
|--------|------|-----|
| GET | `/api/configurations/status` | Hub operational/missing |
| GET | `/api/configurations/{section}` | Load |
| PUT | `/api/configurations/{section}` | Apply one |
| PUT | `/api/configurations` | Multi-section (rare; prefer per-section) |
| GET | `/api/journal/catalog` | Journal section facilitator |

## DNA pages
- [Hub](hub.md)
- [Section editor flow](section-edit-flow/section-editor.md) — primary inventories: Navigation (`defaultTargetHost`, allowlisted main-frame URLs), Sessions (detached timeout, JavaScript bridge, viewport), ResourceManagement (session concurrency, storage budget); Hosting, Journal, and Telemetry have advanced inventories.
- Scripting primarily deep-links to [`/admin/scripts?tab=injections`](../../../../web/src/App.tsx); advanced JSON stays secondary.

## Nav placement
Admin nav item **Configurations**.

## Deep-links
- Scripting section row → `/admin/scripts?tab=injections` (primary) with secondary “Advanced JSON” stay-in-config (Sprint 2).
- Host capacity related → `/admin/host-resources`.

## Explicitly deferred to Sprint 2
Full control inventories, ASCII layouts, copy, UX intelligence sections per section editor.
