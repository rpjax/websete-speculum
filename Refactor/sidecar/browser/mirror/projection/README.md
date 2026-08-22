# PageProjection — sidecar adapters

The **algorithm** lives in `@speculum/page-projection`
(`Refactor/packages/page-projection` — `core` / `virtual` / `projected`).

This tree holds **callers only**:

| Folder | Role |
|--------|------|
| **`session/`** | `PageProjectionBrowserSession` + data-plane host (probes via DI) |
| **`inject/`** | Config pre-script + load `virtual.js` |
| **`input/`** | CDP dispatch / resolve (Patchright) — not in the package |
| **`lab/`** | Lab harness (chassis, blueprints, probes, `LabProjectedHarness`) |

Build: `npm run build` in `Refactor/sidecar` compiles the package, then esbuild
`virtual.js` / lab `client.js` / snapshot, then sidecar `tsc`.

See `docs/page-projection/spec/decision-log.md` §J and
`Refactor/packages/page-projection/README.md`.
