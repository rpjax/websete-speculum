# D-UI-20 — ABS uinput → Chromium spike

**Gate:** peripherals §10.3 before deleting REL/OsInputBackend.

## Steps

1. Create ABS uinput device, range = R, `INPUT_PROP_POINTER`.
2. Bind via Xorg `InputDevice` with explicit `/dev/input/eventN` path (`Display.ts`).
3. Launch Chromium headful on dummy display R, window W×H at (0,0).
4. `moveTo(x,y)` + click → verify hit at `(x,y)` (DOM probe or screenshot oracle).
5. Repeat after soft resize; validate viewport stamp rejection on mismatch.

## Env

- Linux + Xorg dummy + uinput
- `Refactor/sidecar/browser/patchright/Display.ts` display allocator
- `AbsPointerPeripheral` writer over ABS uinput

## Pass criteria

Hit-test oracle at stamped coords 1:1 after moveTo+click. Record in `docs/page-projection/spec/decision-log.md`.

**Oracle script:** `Refactor/sidecar/scripts/spike-abs-pointer.js`  
**Run (Docker):** `npm run lab:docker:spike` from `Refactor/sidecar` (requires `/dev/uinput`).

## Fail policy

Iterate bind/device props — **no REL fallback**.
