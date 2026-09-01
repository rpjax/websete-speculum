using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Speculum.Api.Configurations.Models.Diagnostics;
using Speculum.Api.Configurations.Models.Hosting;
using Speculum.Api.Configurations.Models.Journal;
using Speculum.Api.Configurations.Models.Profiles;
using Speculum.Api.Configurations.Models.Scripting;
using Speculum.Api.Configurations.Persistence;
using Speculum.Api.Configurations.Services;
using Speculum.Api.Configurations.Services.Contracts;
using Speculum.Api.Journal.Services;
using Speculum.Api.Sessions.Services;
using Speculum.Api.Sessions.Services.Contracts;

namespace Speculum.Api.Sessions.Tests;

public sealed class ConfigurationApplyDrainTests
{
    [Fact]
    public async Task PutAndApply_Navigation_DrainsBeforePersist()
    {
        var timeline = new List<string>();
        var store = new RecordingStore(timeline);
        var drain = new RecordingDrain(timeline);
        var apply = CreateApply(store, drain);

        var error = await apply.PutAndApplyAsync(
            ConfigSectionKeys.Navigation,
            """{"defaultTargetHost":"shop.target.test"}""");

        Assert.Null(error);
        Assert.Equal(["drain", "upsert"], timeline);
        Assert.Equal("Navigation", drain.LastTrigger);
        Assert.Equal(SessionDrainTriggers.ConfigForceAfter, drain.LastForceAfter);
        Assert.True(store.Sections.ContainsKey(ConfigSectionKeys.Navigation));
    }

    [Fact]
    public async Task PutAndApply_Hosting_DrainsBeforePersist()
    {
        var timeline = new List<string>();
        var store = new RecordingStore(timeline);
        var drain = new RecordingDrain(timeline);
        var apply = CreateApply(store, drain);

        var error = await apply.PutAndApplyAsync(
            ConfigSectionKeys.Hosting,
            """{"defaultCertificateEmail":"ops@speculum.test","domains":[]}""");

        Assert.Null(error);
        Assert.Equal(["drain", "upsert"], timeline);
        Assert.Equal("Hosting", drain.LastTrigger);
    }

    [Fact]
    public async Task PutAndApply_ResourceManagement_DoesNotDrain()
    {
        var timeline = new List<string>();
        var store = new RecordingStore(timeline);
        var drain = new RecordingDrain(timeline);
        var apply = CreateApply(store, drain);

        var error = await apply.PutAndApplyAsync(
            ConfigSectionKeys.ResourceManagement,
            """{"sessions":{"maxConcurrentSessions":4}}""");

        Assert.Null(error);
        Assert.Equal(["upsert"], timeline);
        Assert.Empty(drain.Triggers);
    }

    [Fact]
    public async Task PutAndApply_WhenDrainFails_DoesNotPersist()
    {
        var timeline = new List<string>();
        var store = new RecordingStore(timeline);
        var drain = new RecordingDrain(timeline) { ThrowOnDrain = true };
        var apply = CreateApply(store, drain);

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            apply.PutAndApplyAsync(
                ConfigSectionKeys.Navigation,
                """{"defaultTargetHost":"shop.target.test"}"""));

        Assert.Equal(["drain"], timeline);
        Assert.False(store.Sections.ContainsKey(ConfigSectionKeys.Navigation));
    }

    [Fact]
    public async Task PutManyAndApply_DrainsOnce_ForNavigationAndHosting()
    {
        var timeline = new List<string>();
        var store = new RecordingStore(timeline);
        var drain = new RecordingDrain(timeline);
        var apply = CreateApply(store, drain);

        var error = await apply.PutManyAndApplyAsync(
        [
            (ConfigSectionKeys.Journal, """{"events":{}}"""),
            (ConfigSectionKeys.Navigation, """{"defaultTargetHost":"shop.target.test"}"""),
            (ConfigSectionKeys.Hosting, """{"defaultCertificateEmail":"","domains":[]}"""),
        ]);

        Assert.Null(error);
        Assert.Single(drain.Triggers);
        Assert.Equal("Hosting,Navigation", drain.LastTrigger);
        Assert.Equal("drain", timeline[0]);
        Assert.Contains("upsert", timeline);
    }

    [Fact]
    public async Task ApplyAllFromStore_DoesNotDrain()
    {
        var timeline = new List<string>();
        var store = new RecordingStore(timeline);
        store.Sections[ConfigSectionKeys.Navigation] =
            """{"defaultTargetHost":"shop.target.test"}""";
        var drain = new RecordingDrain(timeline);
        var apply = CreateApply(store, drain);

        await apply.ApplyAllFromStoreAsync();

        Assert.Empty(drain.Triggers);
        Assert.DoesNotContain("drain", timeline);
    }

    private static ConfigurationApplyService CreateApply(
        RecordingStore store,
        RecordingDrain drain)
    {
        var catalog = new JournalCatalog();
        catalog.RegisterFromAssemblies(typeof(ConfigurationApplyService).Assembly);
        return new ConfigurationApplyService(
            store,
            new ConfigurationService(),
            catalog,
            new StaticMonitor<ProfilesConfiguration>(new ProfilesConfiguration()),
            new StaticMonitor<ScriptingConfiguration>(new ScriptingConfiguration()),
            new StaticMonitor<DiagnosticsConfiguration>(new DiagnosticsConfiguration()),
            drain,
            NullLogger<ConfigurationApplyService>.Instance);
    }

    private sealed class RecordingDrain : ISessionDrainOrchestrator
    {
        private readonly List<string> _timeline;

        public RecordingDrain(List<string> timeline) => _timeline = timeline;

        public bool IsDraining => false;
        public bool ThrowOnDrain { get; init; }
        public List<string> Triggers { get; } = [];
        public string? LastTrigger => Triggers.Count == 0 ? null : Triggers[^1];
        public TimeSpan? LastForceAfter { get; private set; }

        public Task DrainAsync(SessionDrainRequest request, CancellationToken ct = default)
        {
            _timeline.Add("drain");
            Triggers.Add(request.Trigger);
            LastForceAfter = request.ForceAfter;
            if (ThrowOnDrain)
            {
                throw new InvalidOperationException("drain failed");
            }

            return Task.CompletedTask;
        }
    }

    private sealed class RecordingStore : IConfigSectionStore
    {
        private readonly List<string> _timeline;

        public RecordingStore(List<string> timeline) => _timeline = timeline;

        public Dictionary<string, string?> Sections { get; } = new(StringComparer.Ordinal);

        public Task EnsureSchemaAsync(CancellationToken ct = default) => Task.CompletedTask;

        public Task<bool> GetIsFirstBootAsync(CancellationToken ct = default) => Task.FromResult(false);

        public Task SetIsFirstBootAsync(bool value, CancellationToken ct = default) => Task.CompletedTask;

        public Task<string?> GetSectionJsonAsync(string key, CancellationToken ct = default)
            => Task.FromResult(Sections.TryGetValue(key, out var json) ? json : null);

        public Task UpsertSectionJsonAsync(string key, string? valueJson, CancellationToken ct = default)
        {
            _timeline.Add("upsert");
            Sections[key] = valueJson;
            return Task.CompletedTask;
        }

        public Task<IReadOnlyDictionary<string, string?>> GetAllSectionJsonAsync(
            CancellationToken ct = default)
            => Task.FromResult<IReadOnlyDictionary<string, string?>>(Sections);
    }

    private sealed class StaticMonitor<T>(T value) : IOptionsMonitor<T>
    {
        public T CurrentValue => value;

        public T Get(string? name) => value;

        public IDisposable? OnChange(Action<T, string?> listener) => null;
    }
}
