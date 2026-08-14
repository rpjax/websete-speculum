# Contract 12 — Session lifecycle / browser pool

**Norm:** redesign §5.13. **Tests:** PP-SESS-1..2. **Impl:** pool behaviour under sidecar session host (spec in `implementation/sidecar/` notes + config).

## Pool

1. Pre-warmed Chromium instances remove boot from user critical path (E10 / PP-SESS-1).  
2. Handout: **clean** — fresh context + profile, **never navigated**.  
3. Release: instance **destroyed**, never recycled to another session (PP-SESS-2) — K2.  
4. `browserPoolSize` default 8; `browserPoolRefillPerSec` default 2; refill throttled.  
5. `bootMs` reported separately from site load; never mixed into site-load verdict.

## Interface sketch

```ts
interface BrowserPool {
  acquire(): Promise<CleanBrowserInstance>;
  releaseDestroy(instance: CleanBrowserInstance): Promise<void>;
}
```

## MUST NOT

- Recycle a navigated profile into another session.  
- Share cookies/storage/DOM/CSSOM/id space across sessions.
