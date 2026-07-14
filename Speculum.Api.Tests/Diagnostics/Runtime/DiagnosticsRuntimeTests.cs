using Speculum.Api.Diagnostics.Abstractions;
using Speculum.Api.Diagnostics.Configuration;
using Speculum.Api.Diagnostics.Pipeline;

namespace Speculum.Api.Tests;

public sealed class DiagnosticsRuntimeTests
{
    [Fact]
    public void Off_disables_IsEnabled()
    {
        var runtime = new DiagnosticsRuntime();
        runtime.ApplyOptions(new DiagnosticsOptions { Enabled = false });

        Assert.False(runtime.IsEnabled(DiagnosticsDomain.MotorLive, DiagnosticsLevel.Metrics));
        Assert.Equal(DiagnosticsLevel.Off, runtime.GetEffectiveLevel(DiagnosticsDomain.MotorLive));
    }

    [Fact]
    public void Elevate_raises_BrowserQuery()
    {
        var runtime = new DiagnosticsRuntime();
        runtime.ApplyOptions(DiagnosticsSeedProfiles.Production());
        runtime.SetElevate(DiagnosticsLevel.BrowserQuery, TimeSpan.FromMinutes(5));

        Assert.True(runtime.IsEnabled(DiagnosticsDomain.BrowserQuery, DiagnosticsLevel.BrowserQuery));
        Assert.Equal(DiagnosticsLevel.BrowserQuery, runtime.GetEffectiveLevel(DiagnosticsDomain.BrowserQuery));
    }

    [Fact]
    public void Degraded_caps_at_Metrics()
    {
        var runtime = new DiagnosticsRuntime();
        runtime.ApplyOptions(DiagnosticsSeedProfiles.Development());
        runtime.SetDegraded(true);

        Assert.False(runtime.IsEnabled(DiagnosticsDomain.MotorLive, DiagnosticsLevel.Events));
        Assert.True(runtime.IsEnabled(DiagnosticsDomain.MotorLive, DiagnosticsLevel.Metrics));
        Assert.Equal(DiagnosticsLevel.Metrics, runtime.GetEffectiveLevel(DiagnosticsDomain.MotorLive));
    }
}
