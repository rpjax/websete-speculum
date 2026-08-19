# Data plane (Chromium ↔ Sidecar)

Generic **mux** between a PageProjection **algorithm instance** and the sidecar ingest.
E-03: **frame bodies** travel here (not CDP). One connection per session; the impl routes
every `send` onto it. Child instances get a `DataPlane` that forwards — they do not open
a second socket.

The **algorithm** only sees `DataPlane.send(channel, payload)`. `FrameTransport` is a facade
over `PlaneChannel.Frame` on that same plane. Telemetry and control use the same contract.
Do not add a second outbound path.

`PlaneChannel` is the **kind** of message. The plane does **not** track documents.
`contextId` lives on the PP frame header ([multi-document.md](../../../../../../docs/page-projection/spec/multi-document.md)).

## Envelope

```text
magic   u16 LE  0x5053 ('SP')
version u8      1
channel u8      PlaneChannel
flags   u8      0 reserved
payload …
```

One WS message = one envelope. `PlaneChannel.Frame` payload = raw PP part bytes.
The plane MUST NOT parse PP. Envelope does **not** grow a `contextId` field.

## Channels (wire-stable)

| Id | Name | Today |
|----|------|--------|
| 1 | `frame` | Live / establish frame parts |
| 2 | `control` | Reserved |
| 3 | `telemetry` | Virtual → sidecar push (JSON); sidecar fans out |

## Seams

- `DataPlane` — open/send/handler
- `FrameTransport` — thin adapter that only sends `PlaneChannel.Frame`
- `ProjectionTelemetry` — Virtual push on `Telemetry`
- CDP remains the browser **control plane** (nav, cookies, input inject, …)

## Layout

```text
plane/           shared (browser + Node)
virtual/transport/loopbackDataPlane.ts   browser WS client
virtual/transport/planeFrameTransport.ts FrameTransport adapter
virtual/telemetry/                       Virtual emitters
lab/nodeDataPlane.ts                     Node `ws` adapter
lab/projectionTelemetrySink.ts           session port (fan-out)
```
