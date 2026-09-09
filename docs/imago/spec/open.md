# Open items

Do not close one of these in code. Append a row to [decision-log.md](decision-log.md), then update here.

| id | Item | Why it is open | Blocks |
|---|---|---|---|
| ~~OPEN-6~~ | ~~Panel stack~~ | **closed by D-022** — Fastify + React/Vite, own front end | — |
| ~~OPEN-9~~ | ~~Where the project lives~~ | **closed by D-021** — `imago/` at repo root, own build + CI + boundary check | — |
| **OPEN-1** | Source maps on the target | If the origin publishes `.map`, the source tree is recoverable and `flat` stops being reconstruction and becomes a port. Changes its value entirely. | first session (F1) |
| **OPEN-2** | WebSocket / SSE | Not in the HTTP record. Frames are reachable via CDP (`Network.webSocketFrame*`), but the contract has no shape for a stream, and `rehost` needs a live peer or a configured stub. | streaming targets |
| **OPEN-3** | Authenticated sessions | Cookies, CSRF and expiry make conflict reporting noisy and fixtures sensitive. Needs a redaction + volatile policy, and a decision on whether the Chrome profile persists between sessions. | logged-in surfaces |
| **OPEN-4** | Service workers | Must be unregistered at capture (they intercept the very traffic being recorded). If the origin depends on one, `rehost` fidelity is affected and the replacement is ours. | targets with SW |
| **OPEN-5** | Canvas / WebGL / video | Not serializable. Typed placeholder + optional still, always listed as a substitution. Charts on canvas are the common real case. | targets with canvas UI |
| **OPEN-7** | Target not chosen | No URL yet. The first browse answers most of the probe by itself. | first session |
| **OPEN-8** | Rights over the target front-end | `rehost` redistributes someone's HTML/JS/CSS/assets. Confirm ownership or written permission per target before output leaves a sandbox. Recorded so it is a decision, not an oversight. | `rehost` shipping |
| **OPEN-10** | Fixture staleness | Fixtures are recorded bodies with no expiry; if origin shapes drift, the dev adapter serves last year's world. Minimum: surface the capture date at runtime. | F2 |
| **OPEN-11** | Long-session limits | How long can a browse run before RAM, journal size, or snapshot count become the operator's problem? Unknown until a real session. May force session splitting. | after F1 |
| **OPEN-13** | Embedded pane vs real browser | The panel offers both ([preview.md](preview.md) §6), but some pages behave differently inside a frame (`top` checks, frame-busting in `rehost` bundles). Whether the embedded pane is trustworthy enough to be the default is unknown until a real bundle. | F5 |
| **OPEN-14** | Preview port stability | Ports are stable per run while the app lives. If they change across restarts the bundle's `localStorage` origin changes with them, resetting anything it stored. Pinning a port per run is possible; whether it matters depends on the target. | after F4 |
| **OPEN-12** | Multi-origin sessions | A human will wander across hosts (SSO, CDNs, embeds, an unrelated tab). What belongs to the session and what is noise is a capture-filter policy nobody has written. | F1 |
