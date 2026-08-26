# Projection lab — Docker (canonical for OS input)

Lab + PP sessions that need **uinput ABS** run on Linux with `/dev/uinput`.
On Windows hosts, use Compose — not bare `npm run lab:projection` for input E2E.

## WSL custom kernel (uinput + Docker Desktop)

OS ABS needs `CONFIG_INPUT_UINPUT=y`. Docker Desktop’s OOM tracer needs BTF
(`/sys/kernel/btf/vmlinux`). The custom kernel at `%USERPROFILE%\wsl-kernel` must
keep **both** — do not disable `CONFIG_DEBUG_INFO_BTF` in `build.sh`.

If Desktop dies with `oom tracer` / `no BTF found`:

```bash
# inside Ubuntu WSL
bash /mnt/c/Users/rodri/wsl-kernel/rebuild.sh
# then from PowerShell: wsl --shutdown  → start Docker Desktop
test -f /sys/kernel/btf/vmlinux && echo BTF_OK
```

After that, `docker` on **Windows** should work even before WSL integration is toggled.
Enable **Settings → Resources → WSL integration → Ubuntu** if you want `docker` inside the Ubuntu distro.

Verify host devices for the lab image:

```powershell
docker run --rm --device /dev/uinput alpine ls -la /dev/uinput
```

## Run

From `Refactor/`:

```bash
docker compose -f sidecar/docker-compose.lab.yml up --build
```

Or from `Refactor/sidecar/`:

```bash
npm run lab:docker
```

Lab UI: http://127.0.0.1:4103/

## Input battery (OS)

All of these **require** `/dev/uinput`. On Windows, use the `:docker` scripts.

| Command | What |
|---------|------|
| `npm run lab:docker:spike` | D-UI-20 ABS hit-test oracle |
| `npm run smoke:input-os` | Spike + suite (compose if no local uinput) |
| `npm run lab:input-suite:docker` | All `input-*` blueprints (click/forms/scroll/iframe/stress) |
| `npm run lab:input-e2e:docker` | UI-driven capture → OS path (browse scenarios) |
| `npm run lab:input-e2e-stress:docker` | Stress fixture + census cost report (snapshot + Phase A RTT + click/type/scroll) |

Blueprints assert Virtual effect (DOM/scroll). Suite also asserts `probes/input-pipeline.json` has `backend: "os"`.

## Spike D-UI-20

```bash
npm run lab:docker:spike
```

## Env

| Var | Default | Meaning |
|-----|---------|---------|
| Host port | 4103 | Published lab HTTP/WS |
| `SPECULUM_LAB_HEADED` | 1 | Chromium on Xorg dummy (required for ABS) |
| `SPECULUM_INPUT_BACKEND` | os | Fail closed without uinput |
| `SPECULUM_LAB_EXTERNAL` | — | `1` = E2E attaches to already-running lab |

Bare Windows Node lab remains usable only for DOM/CSSOM/assets experiments that do not need OS pointer inject. Input blueprints and cutover E2E **require** this Docker path.

## Chrome LNA (loopback / local WS)

Display Chrome in this image loads **system-wide** managed policies from
`/etc/opt/chrome/policies/managed/` (see `sidecar/chrome-policies/managed/`).
`LoopbackNetworkAllowedForUrls` + `LocalNetworkAccessAllowedForUrls` are set to
`*` so Document rewrite (`Fetch.fulfill` / Patchright init routes) does not
trip Local Network Access deny on `ws://127.0.0.1` (Chrome 147+). This is
browser-wide in the container, not per session profile.
