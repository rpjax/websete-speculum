# Data plane (Chromium ↔ Sidecar)

Generic **muxed loopback WebSocket** between Virtual Chromium and the sidecar.
E-03: **frame bodies** travel here (not CDP). Envelope allows other channels on
the same socket later.

## Envelope

```text
magic   u16 LE  0x5053 ('SP')
version u8      1
channel u8      PlaneChannel
flags   u8      0 reserved
payload …
```

One WS message = one envelope. `PlaneChannel.Frame` payload = raw PP part bytes
(unchanged §5.5). The plane MUST NOT parse PP.

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
