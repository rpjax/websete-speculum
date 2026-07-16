using Speculum.Api.BrowserPersistence;
using Speculum.Api.Config.Bootstrap;
using Speculum.Api.Config.Store;
using Speculum.Api.Diagnostics.Abstractions;
using Speculum.Api.Diagnostics.Configuration;
using Speculum.Api.Diagnostics.Pipeline;
using Speculum.Api.Diagnostics.Probes;
using Speculum.Api.Motor.Live;

namespace Speculum.Api.Diagnostics.Telemetry;

/// <summary>
/// Collector for a single telemetry section ("one question per source"). Sources are pulled
/// lazily by <see cref="ITelemetrySampleComposer"/> only when their toggle is enabled.
/// </summary>
public interface ITelemetrySource
{
    string Section { get; }
}

public interface IHostTelemetrySource : ITelemetrySource
{
    HostTelemetry Collect(TelemetryHostOptions options);
}

public interface IApiProcessTelemetrySource : ITelemetrySource
{
    ApiProcessTelemetry Collect(TelemetryApiProcessOptions options);
}

public interface IMotorTelemetrySource : ITelemetrySource
{
    MotorTelemetry Collect(IReadOnlyList<MotorSessionDiagnosticsSnapshot> snapshots, TelemetryMotorOptions options);
}

public interface ISidecarTelemetrySource : ITelemetrySource
{
    SidecarTelemetry Collect(IReadOnlyList<MotorSessionDiagnosticsSnapshot> snapshots, TelemetrySidecarOptions options);
}

public interface IPersistenceTelemetrySource : ITelemetrySource
{
    Task<PersistenceTelemetry> CollectAsync(TelemetryPersistenceOptions options, CancellationToken ct = default);
}

public interface IPipelineTelemetrySource : ITelemetrySource
{
    PipelineTelemetry Collect(TelemetryPipelineOptions options);
}

/// <summary>Host (machine) section — wraps the shared <see cref="MachineResourceProbe"/>.</summary>
public sealed class HostTelemetrySource : IHostTelemetrySource
{
    private readonly MachineResourceProbe _host;

    public HostTelemetrySource(MachineResourceProbe host)
    {
        _host = host;
    }

    public string Section => "host";

    public HostTelemetry Collect(TelemetryHostOptions options)
        => _host.Sample(options);
}

/// <summary>API process + CLR section — wraps the shared <see cref="ApiProcessResourceProbe"/>.</summary>
public sealed class ApiProcessTelemetrySource : IApiProcessTelemetrySource
{
    private readonly ApiProcessResourceProbe _api;

    public ApiProcessTelemetrySource(ApiProcessResourceProbe api)
    {
        _api = api;
    }

    public string Section => "apiProcess";

    public ApiProcessTelemetry Collect(TelemetryApiProcessOptions options)
        => _api.Sample(options);
}

/// <summary>Motor section — aggregates the per-session snapshots into live-motor signals.</summary>
public sealed class MotorTelemetrySource : IMotorTelemetrySource
{
    private static readonly string[] PhaseNames =
        Enum.GetNames<MotorSessionPhase>();

    private readonly Lazy<ISpeculumConfigStore> _configStore;

    public MotorTelemetrySource(Lazy<ISpeculumConfigStore> configStore)
    {
        _configStore = configStore;
    }

    public string Section => "motor";

    public MotorTelemetry Collect(
        IReadOnlyList<MotorSessionDiagnosticsSnapshot> snapshots,
        TelemetryMotorOptions options)
    {
        var byPhase = PhaseNames.ToDictionary(p => p, _ => 0);
        var live = 0;
        var starting = 0;
        var stopping = 0;
        var inputQueueTotal = 0;
        var frameChannelDepthTotal = 0;
        var statusChannelDepthTotal = 0;

        double sumFps = 0, minFps = double.MaxValue, maxFps = 0;
        var liveCount = 0;

        foreach (var s in snapshots)
        {
            byPhase[s.Phase.ToString()] = byPhase.GetValueOrDefault(s.Phase.ToString()) + 1;
            switch (s.Phase)
            {
                case MotorSessionPhase.Running: live++; break;
                case MotorSessionPhase.Starting: starting++; break;
                case MotorSessionPhase.Stopping: stopping++; break;
            }

            inputQueueTotal += s.InputQueueApprox;
            frameChannelDepthTotal += s.FrameChannelDepth;
            statusChannelDepthTotal += s.StatusChannelDepth;

            if (s.Phase == MotorSessionPhase.Running)
            {
                sumFps += s.Fps;
                minFps = Math.Min(minFps, s.Fps);
                maxFps = Math.Max(maxFps, s.Fps);
                liveCount++;
            }
        }

        var avgFps = liveCount > 0 ? Math.Round(sumFps / liveCount, 2) : 0;
        var min = liveCount > 0 ? Math.Round(minFps, 2) : 0;
        var max = liveCount > 0 ? Math.Round(maxFps, 2) : 0;

        var capacityMax = _configStore.Value.Current.MaxSessions ?? 0;
        var used = live + starting;
        var capacityUsedPct = capacityMax > 0
            ? Math.Round((double)used / capacityMax * 100.0, 1)
            : 0;

        IReadOnlyList<string>? liveSessionIds = options.IncludeSessionIds
            ? snapshots.Select(s => s.ConnectionId).ToArray()
            : null;

        IReadOnlyList<MotorSessionTelemetry>? sessions = options.IncludePerSession
            ? snapshots.Select(s => new MotorSessionTelemetry(
                ConnectionId: s.ConnectionId,
                Phase: s.Phase.ToString(),
                Fps: Math.Round(s.Fps, 2),
                UptimeMs: s.UptimeMs,
                InputQueue: s.InputQueueApprox,
                SidecarConnected: s.SidecarConnected,
                JsBridgeEnabled: s.JsBridgeEnabled,
                LastFault: s.LastFault,
                UrlHost: options.IncludeUrlHost ? HostOf(s.CurrentUrl) : null)).ToArray()
            : null;

        return new MotorTelemetry(
            Total: snapshots.Count,
            Live: live,
            Starting: starting,
            Stopping: stopping,
            ByPhase: byPhase,
            AvgFps: avgFps,
            MinFps: min,
            MaxFps: max,
            InputQueueTotal: inputQueueTotal,
            FrameChannelDepthTotal: frameChannelDepthTotal,
            StatusChannelDepthTotal: statusChannelDepthTotal,
            CapacityMax: capacityMax,
            CapacityUsedPct: capacityUsedPct,
            LiveSessionIds: liveSessionIds,
            Sessions: sessions);
    }

    private static string? HostOf(string url)
        => Uri.TryCreate(url, UriKind.Absolute, out var uri) ? uri.Host : null;
}

/// <summary>Sidecar section — connectivity aggregate from the same per-session snapshots.</summary>
public sealed class SidecarTelemetrySource : ISidecarTelemetrySource
{
    public string Section => "sidecar";

    public SidecarTelemetry Collect(
        IReadOnlyList<MotorSessionDiagnosticsSnapshot> snapshots,
        TelemetrySidecarOptions options)
    {
        var connected = 0;
        var faulted = 0;
        List<string>? faultedIds = options.IncludeFaultedIds ? [] : null;

        foreach (var s in snapshots)
        {
            if (s.SidecarConnected) connected++;
            if (!string.IsNullOrEmpty(s.LastFault))
            {
                faulted++;
                faultedIds?.Add(s.ConnectionId);
            }
        }

        return new SidecarTelemetry(connected, faulted, faultedIds);
    }
}

/// <summary>Persistence section — persisted browser-state store counts + optional on-disk size.</summary>
public sealed class PersistenceTelemetrySource : IPersistenceTelemetrySource
{
    private readonly IBrowserSessionStore _store;
    private readonly BootstrapConfig _bootstrap;

    public PersistenceTelemetrySource(IBrowserSessionStore store, BootstrapConfig bootstrap)
    {
        _store = store;
        _bootstrap = bootstrap;
    }

    public string Section => "persistence";

    public async Task<PersistenceTelemetry> CollectAsync(
        TelemetryPersistenceOptions options,
        CancellationToken ct = default)
    {
        var sessions = await _store.ListSessionsAsync(ct);
        var now = DateTimeOffset.UtcNow;
        var soonWindow = now.AddHours(1);

        var totalCookies = 0;
        var totalHistory = 0;
        var expiringSoon = 0;
        foreach (var s in sessions)
        {
            totalCookies += s.CookieCount;
            totalHistory += s.HistoryCount;
            if (s.ExpiresAt <= soonWindow)
                expiringSoon++;
        }

        return new PersistenceTelemetry(
            StoredSessions: sessions.Count,
            TotalCookies: totalCookies,
            TotalHistory: totalHistory,
            ExpiringSoon: expiringSoon,
            StoreBytes: options.IncludeBytes ? StoreBytes() : null);
    }

    private long? StoreBytes()
    {
        try
        {
            var info = new FileInfo(_bootstrap.DatabasePath);
            return info.Exists ? info.Length : 0;
        }
        catch
        {
            return null;
        }
    }
}

/// <summary>Pipeline section — diagnostics back-pressure from the runtime + breaker window.</summary>
public sealed class PipelineTelemetrySource : IPipelineTelemetrySource
{
    private readonly IDiagnosticsRuntime _runtime;
    private readonly IDiagnosticsEventBus _bus;

    public PipelineTelemetrySource(IDiagnosticsRuntime runtime, IDiagnosticsEventBus bus)
    {
        _runtime = runtime;
        _bus = bus;
    }

    public string Section => "pipeline";

    public PipelineTelemetry Collect(TelemetryPipelineOptions options)
    {
        var snap = _runtime.GetSnapshot();
        var usedPct = snap.StorageMaxBytes > 0
            ? Math.Round((double)snap.BytesUsed / snap.StorageMaxBytes * 100.0, 1)
            : 0;

        long? recentDrops = null;
        long? recentSlowWrites = null;
        if (options.IncludeBreakerPressure && _bus is DiagnosticsEventBus concrete)
        {
            var pressure = concrete.GetBreakerPressure();
            recentDrops = pressure.RecentDrops;
            recentSlowWrites = pressure.RecentSlowWrites;
        }

        return new PipelineTelemetry(
            BytesUsed: snap.BytesUsed,
            StorageMaxBytes: snap.StorageMaxBytes,
            UsedPct: usedPct,
            EventsStored: snap.EventsStored,
            EventsDropped: snap.EventsDropped,
            OverflowCount: snap.OverflowCount,
            ProbeInFlight: snap.ProbeInFlight,
            Degraded: snap.Degraded,
            ElevateActive: snap.ElevateActive,
            RecentDrops: recentDrops,
            RecentSlowWrites: recentSlowWrites);
    }
}
