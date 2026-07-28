using Speculum.Api.Configurations.Services.Contracts;
using Speculum.Api.Sessions.Services.Contracts;
using Speculum.Api.Telemetry.Ports;

namespace Speculum.Api.Sessions.Telemetry;

/// <summary>Adapter: live sessions → Telemetry sampling port.</summary>
public sealed class LiveSessionTelemetrySampleSource(
    ILiveSessionService liveSessions,
    IConfigurationService configuration) : ISessionTelemetrySampleSource
{
    public IReadOnlyList<SessionTelemetryLiveSnapshot> ListSnapshots()
        => liveSessions.ListSnapshots()
            .Select(s => new SessionTelemetryLiveSnapshot(
                s.SessionId,
                s.ProfileId,
                s.JsBridgeEnabled,
                s.ConnectionOpen,
                s.UptimeMs))
            .ToArray();

    public async Task<SessionTelemetryLiveStatus?> TryGetStatusAsync(
        Guid sessionId,
        CancellationToken ct)
    {
        if (!liveSessions.TryGet(sessionId, out var session))
            return null;

        var status = await session.GetStatusAsync(ct).ConfigureAwait(false);
        if (!status.IsSuccess)
            return null;

        return new SessionTelemetryLiveStatus(
            sessionId,
            status.Value.Fps,
            status.Value.Url);
    }

    public int GetConfiguredCapacityMax()
        => Math.Max(0, configuration.GetCurrent().ResourceManagement.Sessions.MaxConcurrentSessions);
}
