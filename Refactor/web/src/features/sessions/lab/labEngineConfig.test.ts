import { describe, expect, it } from 'vitest'
import {
  createLabReadyNavigation,
  createLabScriptingBaseline,
  createLabTelemetryBaseline,
  formatAllowlistLines,
  parseAllowlistLines,
  parseHostingDomainLines,
} from './labEngineConfig'

describe('parseAllowlistLines', () => {
  it('emits Scope.Any when open', () => {
    expect(parseAllowlistLines('', true)).toEqual([
      { domain: { scope: 'Any', labels: [] } },
    ])
  })

  it('parses exact and wildcard hosts', () => {
    const rules = parseAllowlistLines('google.com\n*.olx.com.br', false)
    expect(rules).toHaveLength(2)
    expect(rules[0]?.domain.scope).toBe('Pattern')
    expect(rules[0]?.domain.labels.map((label) => label.value)).toEqual(['google', 'com'])
    expect(rules[1]?.domain.labels[0]?.match).toBe('Any')
    expect(rules[1]?.domain.labels.slice(1).map((label) => label.value)).toEqual([
      'olx',
      'com',
      'br',
    ])
  })

  it('preserves path match from previous rules', () => {
    const previous = [
      {
        domain: {
          scope: 'Pattern' as const,
          labels: [
            { match: 'Exact' as const, value: 'fixture' },
            { match: 'Exact' as const, value: 'test' },
          ],
        },
        path: { scope: 'Pattern' as const, segments: [{ match: 'Exact', value: 'api' }] },
      },
    ]
    const rules = parseAllowlistLines('fixture.test', false, previous)
    expect(rules[0]?.path).toEqual(previous[0]?.path)
  })
})

describe('formatAllowlistLines', () => {
  it('round-trips open allowlist', () => {
    expect(formatAllowlistLines([{ domain: { scope: 'Any', labels: [] } }])).toEqual({
      allowAny: true,
      text: '',
    })
  })
})

describe('parseHostingDomainLines', () => {
  it('parses mirroring suffix', () => {
    expect(parseHostingDomainLines('speculum.test +mirror')).toEqual([
      { domain: 'speculum.test', isSubdomainMirroringEnabled: true },
    ])
  })

  it('preserves certificate and dns challenge from previous domains', () => {
    expect(
      parseHostingDomainLines('speculum.test +mirror', [
        {
          domain: 'speculum.test',
          isSubdomainMirroringEnabled: false,
          certificateEmail: 'ops@speculum.test',
          dnsChallenge: { provider: 'Cloudflare' },
        },
      ]),
    ).toEqual([
      {
        domain: 'speculum.test',
        isSubdomainMirroringEnabled: true,
        certificateEmail: 'ops@speculum.test',
        dnsChallenge: { provider: 'Cloudflare' },
      },
    ])
  })
})

describe('createLabReadyNavigation', () => {
  it('opens Scope.Any on the chosen host', () => {
    expect(createLabReadyNavigation('www.google.com')).toEqual({
      defaultTargetHost: 'www.google.com',
      allowedMainFrameUrls: [{ domain: { scope: 'Any', labels: [] } }],
    })
  })
})

describe('createLabScriptingBaseline', () => {
  it('starts with no injections', () => {
    expect(createLabScriptingBaseline()).toEqual({ injections: [] })
  })
})

describe('createLabTelemetryBaseline', () => {
  it('starts disabled with lab-friendly section defaults', () => {
    const baseline = createLabTelemetryBaseline()
    expect(baseline.isEnabled).toBe(false)
    expect(baseline.intervalSeconds).toBe(15)
    expect(baseline.host.isEnabled).toBe(true)
    expect(baseline.sessions.includePerSession).toBe(false)
    expect(baseline.docker.isEnabled).toBe(false)
  })

  it('includes the full Telemetry.Sessions event catalog (off by default)', () => {
    const baseline = createLabTelemetryBaseline()
    expect(baseline.clientObservation).toEqual({
      isEnabled: false,
      sessionWire: true,
      videoStreamingInput: false,
      pageProjectionDiff: false,
      pageProjectionIntent: false,
    })
    expect(Object.keys(baseline.events).sort()).toEqual(
      [
        'Telemetry.Sessions.Browse.LocationChanged',
        'Telemetry.Sessions.Capacity.NoSlotAvailable',
        'Telemetry.Sessions.Capacity.SlotAcquired',
        'Telemetry.Sessions.Capacity.SlotReleased',
        'Telemetry.Sessions.Client.AttachedCommandFailed',
        'Telemetry.Sessions.PageProjection.Diff.FrameReceived',
        'Telemetry.Sessions.PageProjection.Diff.GenerationBumped',
        'Telemetry.Sessions.PageProjection.Diff.QueueDropped',
        'Telemetry.Sessions.PageProjection.Diff.FanOutEnqueued',
        'Telemetry.Sessions.PageProjection.Diff.OutputStreamClosed',
        'Telemetry.Sessions.PageProjection.Diff.OutputStreamOpened',
        'Telemetry.Sessions.PageProjection.Diff.ResyncRequested',
        'Telemetry.Sessions.PageProjection.Diff.ResyncServed',
        'Telemetry.Sessions.PageProjection.Diff.SoftNavObserved',
        'Telemetry.Sessions.PageProjection.Diff.StreamDequeued',
        'Telemetry.Sessions.PageProjection.Diff.WireDelivered',
        'Telemetry.Sessions.PageProjection.Input.AdmissionDropped',
        'Telemetry.Sessions.PageProjection.Input.Applied',
        'Telemetry.Sessions.PageProjection.Input.CdpDropped',
        'Telemetry.Sessions.PageProjection.Input.DataPlaneReceived',
        'Telemetry.Sessions.PageProjection.Input.Rejected',
        'Telemetry.Sessions.PageProjection.Input.ScrollEchoHit',
        'Telemetry.Sessions.PageProjection.Input.SidecarAdmitted',
        'Telemetry.Sessions.PageProjection.Input.SidecarPushWritten',
        'Telemetry.Sessions.Navigate.UrlResolved',
        'Telemetry.Sessions.Persist.SkippedNoConnection',
        'Telemetry.Sessions.Persist.SkippedProfileNotFound',
        'Telemetry.Sessions.Resize.Applied',
        'Telemetry.Sessions.Resize.Rejected',
        'Telemetry.Sessions.Sidecar.AllocationFaulted',
        'Telemetry.Sessions.Sidecar.DisplayAllocated',
        'Telemetry.Sessions.Sidecar.DisplayReleased',
        'Telemetry.Sessions.Sidecar.SessionAllocated',
        'Telemetry.Sessions.Sidecar.SessionReleased',
        'Telemetry.Sessions.Start.UrlResolveFailed',
        'Telemetry.Sessions.Start.UrlResolved',
        'Telemetry.Sessions.VideoStreamingInput.Applied',
        'Telemetry.Sessions.VideoStreamingInput.ControlReceived',
        'Telemetry.Sessions.VideoStreamingInput.DataPlaneReceived',
        'Telemetry.Sessions.VideoStreamingInput.Rejected',
        'Telemetry.Sessions.VideoStreamingInput.SidecarAdmitted',
        'Telemetry.Sessions.VideoStreamingInput.SidecarPushWritten',
      ].sort(),
    )
    expect(Object.values(baseline.events).every((on) => on === false)).toBe(true)
  })
})
