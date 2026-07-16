using Speculum.Api.Diagnostics.Configuration;

namespace Speculum.Api.Tests.Telemetry;

/// <summary>
/// Presets are just pre-applied toggle bundles. Locks the Telemetry expansion per profile so
/// the "enum-as-preset" contract can't silently drift.
/// </summary>
public sealed class DiagnosticsSeedProfileTelemetryTests
{
    [Fact]
    public void Development_expands_all_telemetry_opt_ins()
    {
        var t = DiagnosticsSeedProfiles.Development().Telemetry;

        Assert.True(t.Enabled);
        Assert.Equal(15, t.IntervalSeconds);
        Assert.True(t.Motor.IncludeSessionIds);
        Assert.True(t.Motor.IncludePerSession);
        Assert.True(t.Motor.IncludeUrlHost);
        Assert.True(t.Sidecar.IncludeFaultedIds);
        Assert.True(t.Persistence.IncludeBytes);
        Assert.True(t.Pipeline.IncludeBreakerPressure);
    }

    [Fact]
    public void Production_keeps_telemetry_operable_without_per_session()
    {
        var options = DiagnosticsSeedProfiles.Production();
        var t = options.Telemetry;

        Assert.Equal("Production", options.Profile);
        Assert.True(t.Enabled);
        Assert.Equal(30, t.IntervalSeconds);
        // Cheap identity signals on; expensive per-session slices stay off.
        Assert.True(t.Motor.IncludeSessionIds);
        Assert.False(t.Motor.IncludePerSession);
        Assert.True(t.Motor.IncludeUrlHost);
        Assert.True(t.Sidecar.IncludeFaultedIds);
        Assert.True(t.Persistence.IncludeBytes);
        Assert.True(t.Pipeline.IncludeBreakerPressure);
    }

    [Fact]
    public void Assertive_is_maximally_verbose()
    {
        var options = DiagnosticsSeedProfiles.Assertive();
        var t = options.Telemetry;

        Assert.Equal("Assertive", options.Profile);
        Assert.Equal(10, t.IntervalSeconds);
        Assert.True(t.Motor.IncludePerSession);
        Assert.True(t.Sidecar.IncludeFaultedIds);
        Assert.True(t.Persistence.IncludeBytes);
        Assert.True(t.Pipeline.IncludeBreakerPressure);
    }

    [Fact]
    public void Profiles_seed_domain_toggles_consistently()
    {
        var dev = DiagnosticsSeedProfiles.Development().Domains;
        var prod = DiagnosticsSeedProfiles.Production().Domains;

        Assert.True(dev.Sidecar.Events);
        Assert.True(dev.BrowserQuery.Probe);

        Assert.False(prod.BrowserQuery.Probe);
        Assert.True(prod.Sidecar.Events);
        Assert.True(prod.Motor.Metrics);
        Assert.True(prod.Persisted.Snapshots);
    }
}
