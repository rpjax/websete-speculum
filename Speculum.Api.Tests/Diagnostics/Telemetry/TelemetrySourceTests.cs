using Speculum.Api.Diagnostics.Abstractions;
using Speculum.Api.Diagnostics.Configuration;
using Speculum.Api.Diagnostics.Telemetry;
using Speculum.Api.Motor.Live;
using static Speculum.Api.Tests.Telemetry.TelemetryTestSupport;

namespace Speculum.Api.Tests.Telemetry;

public sealed class TelemetrySourceTests
{
    // ---- MotorTelemetrySource ----

    [Fact]
    public void Motor_aggregates_phases_fps_queues_and_capacity()
    {
        var source = new MotorTelemetrySource(ConfigStore(maxSessions: 4));
        var snaps = new List<MotorSessionDiagnosticsSnapshot>
        {
            Snap("a", MotorSessionPhase.Running, fps: 10, inputQueue: 1, frameChannelDepth: 2, statusChannelDepth: 3),
            Snap("b", MotorSessionPhase.Running, fps: 20, inputQueue: 4, frameChannelDepth: 5, statusChannelDepth: 6),
            Snap("c", MotorSessionPhase.Running, fps: 30, inputQueue: 0, frameChannelDepth: 0, statusChannelDepth: 0),
            Snap("d", MotorSessionPhase.Starting, fps: 0),
        };

        var motor = source.Collect(snaps, new TelemetryMotorOptions());

        Assert.Equal(4, motor.Total);
        Assert.Equal(3, motor.Live);
        Assert.Equal(1, motor.Starting);
        Assert.Equal(0, motor.Stopping);
        Assert.Equal(3, motor.ByPhase["Running"]);
        Assert.Equal(1, motor.ByPhase["Starting"]);
        Assert.Equal(0, motor.ByPhase["Stopped"]);
        Assert.Equal(20, motor.AvgFps);
        Assert.Equal(10, motor.MinFps);
        Assert.Equal(30, motor.MaxFps);
        Assert.Equal(5, motor.InputQueueTotal);
        Assert.Equal(7, motor.FrameChannelDepthTotal);
        Assert.Equal(9, motor.StatusChannelDepthTotal);
        Assert.Equal(4, motor.CapacityMax);
        Assert.Equal(100, motor.CapacityUsedPct);
    }

    [Fact]
    public void Motor_identity_omitted_by_default()
    {
        var source = new MotorTelemetrySource(ConfigStore(4));
        var snaps = new List<MotorSessionDiagnosticsSnapshot> { Snap("a", currentUrl: "https://example.com/x") };

        var motor = source.Collect(snaps, new TelemetryMotorOptions());

        Assert.Null(motor.LiveSessionIds);
        Assert.Null(motor.Sessions);
    }

    [Fact]
    public void Motor_identity_included_with_opt_ins()
    {
        var source = new MotorTelemetrySource(ConfigStore(4));
        var snaps = new List<MotorSessionDiagnosticsSnapshot>
        {
            Snap("a", jsBridgeEnabled: true, lastFault: "boom", currentUrl: "https://example.com/path"),
        };
        var opts = new TelemetryMotorOptions
        {
            Enabled = true,
            IncludeSessionIds = true,
            IncludePerSession = true,
            IncludeUrlHost = true,
        };

        var motor = source.Collect(snaps, opts);

        Assert.Equal(["a"], motor.LiveSessionIds!);
        var s = Assert.Single(motor.Sessions!);
        Assert.Equal("a", s.ConnectionId);
        Assert.True(s.JsBridgeEnabled);
        Assert.Equal("boom", s.LastFault);
        Assert.Equal("example.com", s.UrlHost);
    }

    [Fact]
    public void Motor_urlHost_null_when_opt_in_off()
    {
        var source = new MotorTelemetrySource(ConfigStore(4));
        var snaps = new List<MotorSessionDiagnosticsSnapshot> { Snap("a", currentUrl: "https://secret.example.com/p") };
        var opts = new TelemetryMotorOptions { Enabled = true, IncludePerSession = true, IncludeUrlHost = false };

        var motor = source.Collect(snaps, opts);

        Assert.Null(Assert.Single(motor.Sessions!).UrlHost);
    }

    [Fact]
    public void Motor_capacity_pct_zero_when_capacity_unset()
    {
        var source = new MotorTelemetrySource(ConfigStore(maxSessions: null));
        var snaps = new List<MotorSessionDiagnosticsSnapshot> { Snap("a") };

        var motor = source.Collect(snaps, new TelemetryMotorOptions());

        Assert.Equal(0, motor.CapacityMax);
        Assert.Equal(0, motor.CapacityUsedPct);
    }

    // ---- SidecarTelemetrySource ----

    [Fact]
    public void Sidecar_counts_connected_and_faulted()
    {
        var source = new SidecarTelemetrySource();
        var snaps = new List<MotorSessionDiagnosticsSnapshot>
        {
            Snap("a", sidecarConnected: true),
            Snap("b", sidecarConnected: true, lastFault: "sidecar_fault"),
            Snap("c", sidecarConnected: false, lastFault: "sidecar_channel_closed"),
        };

        var sidecar = source.Collect(snaps, new TelemetrySidecarOptions());

        Assert.Equal(2, sidecar.Connected);
        Assert.Equal(2, sidecar.Faulted);
        Assert.Null(sidecar.FaultedSessionIds);
    }

    [Fact]
    public void Sidecar_faulted_ids_included_with_opt_in()
    {
        var source = new SidecarTelemetrySource();
        var snaps = new List<MotorSessionDiagnosticsSnapshot>
        {
            Snap("a"),
            Snap("b", lastFault: "sidecar_fault"),
        };

        var sidecar = source.Collect(snaps, new TelemetrySidecarOptions { Enabled = true, IncludeFaultedIds = true });

        Assert.Equal(["b"], sidecar.FaultedSessionIds!);
    }

    // ---- PersistenceTelemetrySource ----

    [Fact]
    public async Task Persistence_counts_cookies_history_and_expiring_soon()
    {
        var store = new FakeBrowserSessionStore(
        [
            SessionMeta("s1", cookies: 3, history: 5, expiresAt: DateTimeOffset.UtcNow.AddMinutes(30)),
            SessionMeta("s2", cookies: 2, history: 1, expiresAt: DateTimeOffset.UtcNow.AddHours(48)),
        ]);
        var source = new PersistenceTelemetrySource(store, Bootstrap(TempDbPath()));

        var persistence = await source.CollectAsync(new TelemetryPersistenceOptions());

        Assert.Equal(2, persistence.StoredSessions);
        Assert.Equal(5, persistence.TotalCookies);
        Assert.Equal(6, persistence.TotalHistory);
        Assert.Equal(1, persistence.ExpiringSoon);
        Assert.Null(persistence.StoreBytes);
    }

    [Fact]
    public async Task Persistence_storeBytes_reflects_db_file_when_opt_in()
    {
        var dbPath = TempDbPath();
        var bytes = new byte[123];
        await File.WriteAllBytesAsync(dbPath, bytes);
        try
        {
            var source = new PersistenceTelemetrySource(new FakeBrowserSessionStore([]), Bootstrap(dbPath));

            var persistence = await source.CollectAsync(
                new TelemetryPersistenceOptions { Enabled = true, IncludeBytes = true });

            Assert.Equal(123, persistence.StoreBytes);
        }
        finally
        {
            File.Delete(dbPath);
        }
    }

    // ---- PipelineTelemetrySource ----

    [Fact]
    public void Pipeline_projects_runtime_backpressure()
    {
        var runtime = Runtime(DiagnosticsSeedProfiles.Development());
        var source = new PipelineTelemetrySource(runtime, RealBus(runtime));

        var pipeline = source.Collect(new TelemetryPipelineOptions { Enabled = true, IncludeBreakerPressure = false });

        Assert.True(pipeline.StorageMaxBytes > 0);
        Assert.InRange(pipeline.UsedPct, 0, 100);
        Assert.False(pipeline.Degraded);
        Assert.False(pipeline.ElevateActive);
        Assert.Null(pipeline.RecentDrops);
        Assert.Null(pipeline.RecentSlowWrites);
    }

    [Fact]
    public void Pipeline_breaker_pressure_surfaced_with_opt_in()
    {
        var runtime = Runtime(DiagnosticsSeedProfiles.Development());
        var source = new PipelineTelemetrySource(runtime, RealBus(runtime));

        var pipeline = source.Collect(new TelemetryPipelineOptions { Enabled = true, IncludeBreakerPressure = true });

        Assert.NotNull(pipeline.RecentDrops);
        Assert.NotNull(pipeline.RecentSlowWrites);
    }

    [Fact]
    public void Pipeline_reports_elevate_active()
    {
        var runtime = Runtime(DiagnosticsSeedProfiles.Development());
        runtime.SetElevate(TimeSpan.FromMinutes(5));
        var source = new PipelineTelemetrySource(runtime, RealBus(runtime));

        var pipeline = source.Collect(new TelemetryPipelineOptions());

        Assert.True(pipeline.ElevateActive);
    }

    private static string TempDbPath()
        => Path.Combine(Path.GetTempPath(), $"speculum-telemetry-{Guid.NewGuid():N}.db");
}
