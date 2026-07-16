using Speculum.Api.Diagnostics.Abstractions;
using Speculum.Api.Diagnostics.Configuration;
using Speculum.Api.Diagnostics.Pipeline;

namespace Speculum.Api.Tests;

public sealed class DiagnosticsRuntimeTests
{
    [Fact]
    public void Off_disables_every_capability()
    {
        var runtime = new DiagnosticsRuntime();
        runtime.ApplyOptions(new DiagnosticsOptions { Enabled = false });

        Assert.False(runtime.IsCapabilityEnabled(DiagnosticsDomain.MotorLive, DiagnosticsCapability.Metric));
        Assert.False(runtime.IsCapabilityEnabled(DiagnosticsDomain.MotorLive, DiagnosticsCapability.Event));
        Assert.False(runtime.IsCapabilityEnabled(DiagnosticsDomain.DiagnosticsSelf, DiagnosticsCapability.Metric));
    }

    [Fact]
    public void Self_is_always_on_when_enabled()
    {
        var runtime = new DiagnosticsRuntime();
        runtime.ApplyOptions(DiagnosticsSeedProfiles.Production());
        runtime.SetDegraded(true);

        Assert.True(runtime.IsCapabilityEnabled(DiagnosticsDomain.DiagnosticsSelf, DiagnosticsCapability.Metric));
    }

    [Fact]
    public void Toggles_gate_per_capability()
    {
        var runtime = new DiagnosticsRuntime();
        runtime.ApplyOptions(new DiagnosticsOptions
        {
            Enabled = true,
            Domains = new DiagnosticsDomainsOptions
            {
                Motor = new DiagnosticsMotorOptions { Metrics = true, Events = false, Snapshots = false },
                Sidecar = new DiagnosticsSidecarOptions { Metrics = true, Events = false },
                BrowserQuery = new DiagnosticsBrowserQueryOptions { Probe = false },
                Persisted = new DiagnosticsPersistedOptions { Snapshots = false },
            },
        });

        Assert.True(runtime.IsCapabilityEnabled(DiagnosticsDomain.MotorLive, DiagnosticsCapability.Metric));
        Assert.False(runtime.IsCapabilityEnabled(DiagnosticsDomain.MotorLive, DiagnosticsCapability.Event));
        Assert.False(runtime.IsCapabilityEnabled(DiagnosticsDomain.MotorLive, DiagnosticsCapability.Snapshot));
        Assert.False(runtime.IsCapabilityEnabled(DiagnosticsDomain.BrowserQuery, DiagnosticsCapability.Probe));
        Assert.False(runtime.IsCapabilityEnabled(DiagnosticsDomain.PersistedSessions, DiagnosticsCapability.Snapshot));
    }

    [Fact]
    public void Elevate_forces_BrowserQuery_probe_and_sidecar_on()
    {
        var runtime = new DiagnosticsRuntime();
        runtime.ApplyOptions(DiagnosticsSeedProfiles.Production());
        Assert.False(runtime.IsCapabilityEnabled(DiagnosticsDomain.BrowserQuery, DiagnosticsCapability.Probe));

        runtime.SetElevate(TimeSpan.FromMinutes(5));

        Assert.True(runtime.IsCapabilityEnabled(DiagnosticsDomain.BrowserQuery, DiagnosticsCapability.Probe));
        Assert.True(runtime.IsCapabilityEnabled(DiagnosticsDomain.SidecarBrowser, DiagnosticsCapability.Metric));
        Assert.True(runtime.IsCapabilityEnabled(DiagnosticsDomain.SidecarBrowser, DiagnosticsCapability.Event));
    }

    [Fact]
    public void Elevate_expiry_is_pending_after_ttl_and_clears_floor()
    {
        var runtime = new DiagnosticsRuntime();
        runtime.ApplyOptions(DiagnosticsSeedProfiles.Production());
        runtime.SetElevate(TimeSpan.FromMilliseconds(-1)); // already expired

        Assert.False(runtime.IsCapabilityEnabled(DiagnosticsDomain.BrowserQuery, DiagnosticsCapability.Probe));
        Assert.True(runtime.TryConsumeElevateExpired());
        Assert.False(runtime.TryConsumeElevateExpired());
    }

    [Fact]
    public void Degraded_caps_at_metric_but_elevate_still_overrides()
    {
        var runtime = new DiagnosticsRuntime();
        runtime.ApplyOptions(DiagnosticsSeedProfiles.Development());
        runtime.SetDegraded(true);

        // Metric survives; Event/Snapshot are capped off.
        Assert.True(runtime.IsCapabilityEnabled(DiagnosticsDomain.MotorLive, DiagnosticsCapability.Metric));
        Assert.False(runtime.IsCapabilityEnabled(DiagnosticsDomain.MotorLive, DiagnosticsCapability.Event));
        Assert.False(runtime.IsCapabilityEnabled(DiagnosticsDomain.MotorLive, DiagnosticsCapability.Snapshot));

        // Elevate wins over degraded for BrowserQuery.Probe.
        runtime.SetElevate(TimeSpan.FromMinutes(5));
        Assert.True(runtime.IsCapabilityEnabled(DiagnosticsDomain.BrowserQuery, DiagnosticsCapability.Probe));
    }

    [Fact]
    public void Snapshot_reports_effective_capabilities_and_storage_max()
    {
        var runtime = new DiagnosticsRuntime();
        runtime.ApplyOptions(DiagnosticsSeedProfiles.Development());

        var snap = runtime.GetSnapshot();
        Assert.Equal(16L * 1024 * 1024 * 1024, snap.StorageMaxBytes);
        Assert.True(snap.EffectiveCapabilities[nameof(DiagnosticsDomain.MotorLive)][nameof(DiagnosticsCapability.Metric)]);
        Assert.True(snap.EffectiveCapabilities[nameof(DiagnosticsDomain.BrowserQuery)][nameof(DiagnosticsCapability.Probe)]);

        // Elevate projection is always present.
        var elevate = snap.Elevate!;
        var activeProp = elevate.GetType().GetProperty("active")!;
        Assert.False((bool)activeProp.GetValue(elevate)!);
    }
}
