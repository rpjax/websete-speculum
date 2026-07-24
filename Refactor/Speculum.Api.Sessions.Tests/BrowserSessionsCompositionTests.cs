using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Speculum.Api.Database;
using Speculum.Api.Journal;
using Speculum.Api.Journal.Services.Contracts;
using Speculum.Api.Profiles.Services.Contracts;
using Speculum.Api.Sessions;
using Speculum.Api.Sessions.Events.Models;
using Speculum.Api.Sessions.Events.Services.Contracts;
using Speculum.Api.Sessions.Pipes.Services.Contracts;
using Speculum.Api.Sessions.Services;
using Speculum.Api.Sessions.Services.Contracts;
using Speculum.Api.Shared.Services.Contracts;

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

        Assert.Contains(services, d => d.ServiceType == typeof(ISessionPipeService));
        Assert.Contains(services, d => d.ServiceType == typeof(IScopedMutex));

        using var provider = services.BuildServiceProvider();
        Assert.NotNull(provider.GetService<ISessionRepository>());
        Assert.NotNull(provider.GetService<IProfileRepository>());
        Assert.NotNull(provider.GetService<ISessionSlotRegistry>());
        Assert.NotNull(provider.GetService<ISessionCollector>());
        Assert.NotNull(provider.GetService<ISessionEventsFactory>());
        Assert.NotNull(provider.GetService<ISessionTokenGenerator>());
        Assert.Null(provider.GetService<ISessionService>());
        Assert.Null(provider.GetService<IUrlResolver>());
        Assert.Null(provider.GetService<ISessionLifecycleEvents>());
        Assert.Null(provider.GetService<ISessionStartEvents>());
        Assert.Null(provider.GetService<ISessionStopEvents>());

        var catalog = provider.GetRequiredService<IJournalCatalog>();
        Assert.True(catalog.TryGet<SessionStopped>(out _));
        Assert.True(catalog.TryGet<SessionAborted>(out _));
        Assert.True(catalog.TryGet<SessionTimedOut>(out _));
        Assert.True(catalog.TryGet<SessionStarting>(out _));
        Assert.True(catalog.TryGet<SlotAcquired>(out _));
    }
}
