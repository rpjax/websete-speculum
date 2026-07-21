using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Speculum.Api.BrowserProfiles.Services.Contracts;
using Speculum.Api.BrowserSessions;
using Speculum.Api.BrowserSessions.Journal;
using Speculum.Api.BrowserSessions.Services.Contracts;
using Speculum.Api.Database;
using Speculum.Api.Journal;
using Speculum.Api.Journal.Services.Contracts;

namespace Speculum.Api.Sessions.Tests;

public sealed class BrowserSessionsCompositionTests
{
    [Fact]
    public void AddBrowserSessions_WithoutAddDatabase_Throws()
    {
        var services = new ServiceCollection();
        Assert.Throws<InvalidOperationException>(() => services.AddBrowserSessions());
    }

    [Fact]
    public void AddBrowserSessions_WithoutAddJournal_Throws()
    {
        var services = new ServiceCollection();
        services.AddDbContext<SpeculumDbContext>(o => o.UseSqlite("Data Source=:memory:"));
        Assert.Throws<InvalidOperationException>(() => services.AddBrowserSessions());
    }

    [Fact]
    public void AddBrowserSessions_RegistersInfrastructure()
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ResourceManagement:Sessions:MaxConcurrentSessions"] = "4",
                ["Sessions:DetachedSessionTimeout"] = "00:01:00",
            })
            .Build();

        var services = new ServiceCollection();
        services.AddSingleton<IConfiguration>(config);
        services.AddLogging();
        services.AddDbContext<SpeculumDbContext>(o => o.UseSqlite("Data Source=:memory:"));
        services.AddJournal();
        services.DiscoverJournalFacts();
        services.AddBrowserSessions();

        using var provider = services.BuildServiceProvider();
        Assert.NotNull(provider.GetService<ISessionRepository>());
        Assert.NotNull(provider.GetService<IProfileRepository>());
        Assert.NotNull(provider.GetService<ISessionSlotRegistry>());
        Assert.NotNull(provider.GetService<ISessionCollector>());
        Assert.Null(provider.GetService<ISessionService>());
        Assert.Null(provider.GetService<IInitialUrlResolver>());

        var catalog = provider.GetRequiredService<IJournalCatalog>();
        Assert.True(catalog.TryGet<SessionStopped>(out _));
        Assert.True(catalog.TryGet<SessionAborted>(out _));
        Assert.True(catalog.TryGet<SessionTimedOut>(out _));
    }
}
