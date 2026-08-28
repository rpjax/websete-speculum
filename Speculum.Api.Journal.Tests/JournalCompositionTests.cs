using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Speculum.Api.Database;
using Speculum.Api.Journal.Services.Contracts;
using Speculum.Api.Sessions.Events.Models;

namespace Speculum.Api.Journal.Tests;

public sealed class JournalCompositionTests
{
    [Fact]
    public void AddJournal_WithoutAddDatabase_Throws()
    {
        var services = new ServiceCollection();
        Assert.Throws<InvalidOperationException>(() => services.AddJournal());
    }

    [Fact]
    public void DiscoverJournalFacts_WithoutAddJournal_Throws()
    {
        var services = new ServiceCollection();
        Assert.Throws<InvalidOperationException>(() => services.DiscoverJournalFacts());
    }

    [Fact]
    public void DiscoverJournalFacts_IsIdempotent_OnAssemblies()
    {
        var services = new ServiceCollection();
        services.AddSingleton<IConfiguration>(new ConfigurationBuilder().Build());
        services.AddLogging();
        services.AddDbContext<SpeculumDbContext>(o => o.UseSqlite("Data Source=:memory:"));

        services.AddJournal();
        services.DiscoverJournalFacts();
        services.DiscoverJournalFacts();

        using var provider = services.BuildServiceProvider();
        var discovery = provider.GetRequiredService<JournalFactDiscovery>();
        Assert.Single(discovery.Assemblies);

        var catalog = provider.GetRequiredService<IJournalCatalog>();
        Assert.True(catalog.TryGet<SessionStarted>(out _));
    }
}
