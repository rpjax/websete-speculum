# Virtual-side checklist (TEMPORARY)

Each domain folder holds **its port(s) + implementation(s)**. `bootstrap.ts` is the composition root only.

## Layers (depend downward only)

```text
bootstrap.ts                 composition root
resync.ts / snapshot.ts      algorithm use cases (system)
frame/                       pipe (clock → encode → transport; attach pending CSSOM)
dom/                         DOM plane (observer, identity, tick builder, O2, describe-resync)
cssom/                       CSSOM plane (poll, idle, CssomPlane port)
clock/ transport/ config/    support
```

| Folder / file | Question |
|---------------|----------|
| `resync.ts` | Full-system resync frame (DOM + CSSOM scan + CHECK). Always all planes. |
| `snapshot.ts` | Debug/lab snapshot; CSSOM inclusion tunable (`none` \| `committed` \| `scan`). |
| `dom/` | MutationObserver, buffer, identity, `TableFrameBuilder`, `domResync`, O2 |
| `cssom/` | Idle poll, `CssomPlane` (`blockingScan` / `takePending` / `halt`), table×live CSSOM O2 |
| `frame/` | Pipe only. Concatenates pending CSSOM ops before `CHECK`; CSSOM-only frames when DOM is quiet (I5) |

CSSOM live work is eventual: idle slices → `takePending` on the next `FrameEmitter` boundary. **Resync**
cancels idle and **blocking-scans** CSSOM (full `SHEET_NEW`+`RULE_NEW` snapshot). Snapshot default `none`
does not wait for CSSOM. Client phase 2 does not materialize owned CSSOM (C6).

§5.8 `resyncVirtual` in the protocol = `rebuildAndResync` here. `emitResyncFrame` is the trusted-map strength of the same use case.

## Console paste (manual bring-up)

1. Build: `npm run build:virtual` from `Refactor/sidecar`.
2. In a normal browser DevTools console on any page:

```js
globalThis.__SPECULUM_PROJECTION__ = { transport: 'console', frameRateHz: 60 };
```

3. Paste the contents of `dist/browser/mirror/projection/virtual.js`, then mutate:

```js
document.body.appendChild(document.createElement('div')).textContent = 'x';
```

4. Expect `[FrameTransport] send #N len=…` lines starting with hex `50 50` (`PP` magic).
   Automated check: `node scripts/smoke-virtual-console.js` (asserts `sends` + magic bytes).
