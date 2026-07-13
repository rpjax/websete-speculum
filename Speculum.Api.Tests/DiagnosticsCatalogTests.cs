using Speculum.Api.Diagnostics.Abstractions;

namespace Speculum.Api.Tests;

public sealed class DiagnosticsCatalogTests
{
    [Fact]
    public void All_is_non_empty_and_contains_expected_events()
    {
        Assert.NotEmpty(DiagnosticsEventCatalog.All);
        Assert.Contains("Motor.SessionStarted", DiagnosticsEventCatalog.All);
        Assert.Contains("Diagnostics.Degraded", DiagnosticsEventCatalog.All);
    }
}
