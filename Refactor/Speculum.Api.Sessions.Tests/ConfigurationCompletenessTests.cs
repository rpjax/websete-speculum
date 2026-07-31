using Speculum.Api.Configurations.Models.Hosting;
using Speculum.Api.Configurations.Services;

namespace Speculum.Api.Sessions.Tests;

public sealed class ConfigurationCompletenessTests
{
    [Fact]
    public void MissingRequired_DoesNotIncludeHosting()
    {
        var engine = SessionsTestHarness.Engine();
        engine.Hosting = new HostingConfiguration(); // empty — still optional

        var missing = ConfigurationCompleteness.MissingRequired(engine);
        Assert.Empty(missing);
        Assert.DoesNotContain("Hosting", missing);
    }

    [Fact]
    public void MissingRequired_ReportsNavigationWhenHostEmpty()
    {
        var engine = SessionsTestHarness.Engine();
        engine.Navigation = new Configurations.Models.Navigation.NavigationConfiguration
        {
            DefaultTargetHost = "",
        };

        var missing = ConfigurationCompleteness.MissingRequired(engine);
        Assert.Contains("Navigation", missing);
    }
}
