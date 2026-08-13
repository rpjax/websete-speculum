# Virtual-side checklist (TEMPORARY)

Each domain folder holds **its port(s) + implementation(s)**.

| Domain | Port(s) | Impl(s) |
|--------|---------|---------|
| `config/` | — | `projectionConfig.ts` (read-once from pre-script global) |
| `clock/` | `frameClock.ts` | `timerFrameClock.ts` |
| `frame/` | `frameBuilder.ts`, `frameEncoder.ts` | `netEffectFrameBuilder`, `binaryFrameEncoder`, `binaryWriter`, `fVisible`, `frameEmitter` |
| `transport/` | `frameTransport.ts` | `loopbackFrameTransport`, `consoleFrameTransport`, `NullFrameTransport` |
| `dom/` | (table/observer are concrete today) | `domNodeTable`, `domMutationObserver`, `domMutationAccumulator` |
| `models/` | — | Virtual-only data (`dirtySets`) |

`bootstrap.ts` wires ports → chosen impls only.

Host inject: `loadVirtualInjectionScripts({ dataPlaneUrl })` → pre-script then main bundle.

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

Establish / Cssom / sensors are not in this bundle path yet — only post-inject live mutations.
