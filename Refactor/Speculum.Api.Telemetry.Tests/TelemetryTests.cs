using Speculum.Api.Configurations.Models.Journal;
using Speculum.Api.Configurations.Models.Telemetry;
using Speculum.Api.Configurations.Services.Contracts;
using Speculum.Api.Journal.Services.Contracts;
using Speculum.Api.Telemetry;
using Speculum.Api.Telemetry.Models;
using Speculum.Api.Telemetry.Sources;
using Microsoft.Extensions.Logging.Abstractions;

namespace Speculum.Api.Telemetry.Tests;

public sealed class ComposerTests
{
    [Fact]
    public async Task DisabledSectionsAreNull()
    {
        var sources = new FakeSources();
        var composer = new TelemetrySampleComposer(
            sources, sources, sources, sources, sources, sources, sources,
            NullLogger<TelemetrySampleComposer>.Instance);

        var sample = await composer.ComposeAsync(new TelemetryConfiguration
        {
            Host = new() { IsEnabled = false },
            ApiProcess = new() { IsEnabled = false },
            Sessions = new() { IsEnabled = false },
            Sidecar = new() { IsEnabled = false },
            Profiles = new() { IsEnabled = false },
            Journal = new() { IsEnabled = false },
            Docker = new() { IsEnabled = false },
        });

        Assert.Null(sample.Host);
        Assert.Null(sample.ApiProcess);
        Assert.Null(sample.Sessions);
        Assert.Null(sample.Sidecar);
        Assert.Null(sample.Profiles);
        Assert.Null(sample.Journal);
        Assert.Null(sample.Docker);
        Assert.Equal(0, sources.Calls);
    }

    [Fact]
    public async Task FailedSectionIsOmittedWithoutDroppingWholeSample()
    {
        var composer = new TelemetrySampleComposer(
            new GoodHostSource(),
            new GoodApiProcessSource(),
            new ThrowingSessionsSource(),
            new NullSidecarSource(),
            new GoodProfilesSource(),
            new GoodJournalSource(),
            new NullDockerSource(),
            NullLogger<TelemetrySampleComposer>.Instance);

        var sample = await composer.ComposeAsync(new TelemetryConfiguration
        {
            IsEnabled = true,
            Host = new() { IsEnabled = true },
            ApiProcess = new() { IsEnabled = true },
            Sessions = new() { IsEnabled = true },
            Profiles = new() { IsEnabled = true },
            Journal = new() { IsEnabled = true },
        });

        Assert.NotNull(sample.Host);
        Assert.NotNull(sample.ApiProcess);
        Assert.Null(sample.Sessions);
        Assert.NotNull(sample.Profiles);
        Assert.NotNull(sample.Journal);
    }

    [Fact]
    public async Task CancellationPropagatesInsteadOfPublishingPartialSample()
    {
        var composer = new TelemetrySampleComposer(
            new GoodHostSource(),
            new GoodApiProcessSource(),
            new CancelledSessionsSource(),
            new NullSidecarSource(),
            new GoodProfilesSource(),
            new GoodJournalSource(),
            new NullDockerSource(),
            NullLogger<TelemetrySampleComposer>.Instance);

        await Assert.ThrowsAsync<OperationCanceledException>(() => composer.ComposeAsync(new TelemetryConfiguration
        {
            IsEnabled = true,
            Host = new() { IsEnabled = true },
            ApiProcess = new() { IsEnabled = true },
            Sessions = new() { IsEnabled = true },
        }));
    }
}

public sealed class EmitterTests
{
    [Fact]
    public async Task MasterSwitchOffDoesNotComposeOrAppend()
    {
        var configuration = new FakeConfiguration(new EngineConfiguration
        {
            Telemetry = new TelemetryConfiguration { IsEnabled = false },
        });
        var composer = new CountingComposer();
        var writer = new CountingWriter();
        var emitter = new TelemetryEmitter(configuration, composer, writer);

        await emitter.EmitAsync();

        Assert.Equal(0, composer.Calls);
        Assert.Equal(0, writer.Count);
    }

    [Fact]
    public async Task SamplerMasterSwitchOffDoesNotEmit()
    {
        var configuration = new FakeConfiguration(new EngineConfiguration
        {
            Telemetry = new TelemetryConfiguration { IsEnabled = false },
        });
        var emitter = new CountingEmitter();
        var sampler = new TelemetrySamplerHostedService(
            emitter,
            configuration,
            NullLogger<TelemetrySamplerHostedService>.Instance);

        await sampler.StartAsync(CancellationToken.None);
        await Task.Delay(50);
        await sampler.StopAsync(CancellationToken.None);

        Assert.Equal(0, emitter.Calls);
    }

    [Fact]
    public void SamplerResolveDelay_RespectsHighAppliedInterval()
    {
        var delay = TelemetrySamplerHostedService.ResolveDelay(new TelemetryConfiguration
        {
            IsEnabled = true,
            IntervalSeconds = 1_800,
        });

        Assert.Equal(TimeSpan.FromSeconds(1_800), delay);
    }
}

public sealed class TelemetryJournalFactsTests
{
    [Fact]
    public void ApplyToCatalog_MapsMasterAndPerSessionToggles()
    {
        var catalog = new FakeJournalCatalog();

        TelemetryJournalFacts.ApplyToCatalog(catalog, new TelemetryConfiguration
        {
            IsEnabled = true,
            Sessions = new() { IncludePerSession = false },
        });
        Assert.True(catalog.IsTypeEnabled(TelemetryJournalFacts.SampleCollected));
        Assert.False(catalog.IsTypeEnabled(TelemetryJournalFacts.SessionSampleCollected));

        TelemetryJournalFacts.ApplyToCatalog(catalog, new TelemetryConfiguration
        {
            IsEnabled = true,
            Sessions = new() { IncludePerSession = true },
        });
        Assert.True(catalog.IsTypeEnabled(TelemetryJournalFacts.SampleCollected));
        Assert.True(catalog.IsTypeEnabled(TelemetryJournalFacts.SessionSampleCollected));

        TelemetryJournalFacts.ApplyToCatalog(catalog, new TelemetryConfiguration
        {
            IsEnabled = false,
            Sessions = new() { IncludePerSession = true },
        });
        Assert.False(catalog.IsTypeEnabled(TelemetryJournalFacts.SampleCollected));
        Assert.False(catalog.IsTypeEnabled(TelemetryJournalFacts.SessionSampleCollected));
    }

    [Theory]
    [InlineData(TelemetryJournalFacts.SampleCollected, true)]
    [InlineData(TelemetryJournalFacts.SessionSampleCollected, true)]
    [InlineData("Sessions.InputApplied", false)]
    public void Owns_TelemetryFactTypesOnly(string type, bool expected)
        => Assert.Equal(expected, TelemetryJournalFacts.Owns(type));
}

internal sealed class FakeJournalCatalog : IJournalCatalog
{
    private readonly Dictionary<string, bool> _enabled = new(StringComparer.Ordinal);

    public bool RejectUnregisteredTypes { get; set; }
    public IReadOnlyList<Speculum.Api.Journal.Catalog.JournalEntryDescriptor> Types => [];

    public void Register(Speculum.Api.Journal.Catalog.JournalEntryDescriptor descriptor) { }
    public void Register(Type clrType) { }
    public void Register<T>() { }
    public void RegisterFromAssemblies(params System.Reflection.Assembly[] assemblies) { }

    public bool TryGet(
        string type,
        int schemaVersion,
        [System.Diagnostics.CodeAnalysis.NotNullWhen(true)]
        out Speculum.Api.Journal.Catalog.JournalEntryDescriptor? descriptor)
    {
        descriptor = null;
        return false;
    }

    public bool TryGet(
        Type clrType,
        [System.Diagnostics.CodeAnalysis.NotNullWhen(true)]
        out Speculum.Api.Journal.Catalog.JournalEntryDescriptor? descriptor)
    {
        descriptor = null;
        return false;
    }

    public bool TryGet<T>(
        [System.Diagnostics.CodeAnalysis.NotNullWhen(true)]
        out Speculum.Api.Journal.Catalog.JournalEntryDescriptor? descriptor)
    {
        descriptor = null;
        return false;
    }

    public bool IsCanonical(string type) => false;
    public bool IsTypeEnabled(string type) => _enabled.TryGetValue(type, out var enabled) && enabled;
    public void SetEnabled(string type, bool enabled) => _enabled[type] = enabled;
    public bool IsEnabled(Speculum.Api.Journal.Models.JournalEntry entry) => IsTypeEnabled(entry.Type);
}

internal sealed class FakeSources :
    IHostTelemetrySource,
    IApiProcessTelemetrySource,
    ISessionsTelemetrySource,
    ISidecarTelemetrySource,
    IProfilesTelemetrySource,
    IJournalTelemetrySource,
    IDockerTelemetrySource
{
    public int Calls { get; private set; }
    public HostTelemetry Collect(HostTelemetryConfiguration options)
        => throw Called();
    public ApiProcessTelemetry Collect(ApiProcessTelemetryConfiguration options)
        => throw Called();
    public Task<SessionsTelemetry> CollectAsync(SessionTelemetryConfiguration options, CancellationToken ct)
        => throw Called();
    public Task<SidecarTelemetrySample?> CollectAsync(
        SidecarTelemetryConfiguration options,
        CancellationToken ct)
        => throw Called();
    public Task<ProfilesTelemetry> CollectAsync(ProfileTelemetryConfiguration options, CancellationToken ct)
        => throw Called();
    public JournalTelemetry Collect(JournalTelemetryConfiguration options)
        => throw Called();
    public Task<DockerTelemetry?> CollectAsync(DockerTelemetryConfiguration options, CancellationToken ct)
        => throw Called();

    private Exception Called()
    {
        Calls++;
        return new InvalidOperationException("Disabled source was called.");
    }
}

internal sealed class GoodHostSource : IHostTelemetrySource
{
    public HostTelemetry Collect(HostTelemetryConfiguration options)
        => new("host", "machine", 1, 2, 4, 10, 20, 30, 40, 50, null, null, null, null, null, null, null, null, null);
}

internal sealed class GoodApiProcessSource : IApiProcessTelemetrySource
{
    public ApiProcessTelemetry Collect(ApiProcessTelemetryConfiguration options)
        => new(1, 2, 3, 4, null, null, null, null, null, null, null);
}

internal sealed class ThrowingSessionsSource : ISessionsTelemetrySource
{
    public Task<SessionsTelemetry> CollectAsync(SessionTelemetryConfiguration options, CancellationToken ct)
        => throw new InvalidOperationException("boom");
}

internal sealed class CancelledSessionsSource : ISessionsTelemetrySource
{
    public Task<SessionsTelemetry> CollectAsync(SessionTelemetryConfiguration options, CancellationToken ct)
        => throw new OperationCanceledException(ct);
}

internal sealed class NullSidecarSource : ISidecarTelemetrySource
{
    public Task<SidecarTelemetrySample?> CollectAsync(SidecarTelemetryConfiguration options, CancellationToken ct)
        => Task.FromResult<SidecarTelemetrySample?>(null);
}

internal sealed class GoodProfilesSource : IProfilesTelemetrySource
{
    public Task<ProfilesTelemetry> CollectAsync(ProfileTelemetryConfiguration options, CancellationToken ct)
        => Task.FromResult(new ProfilesTelemetry(1, 2));
}

internal sealed class GoodJournalSource : IJournalTelemetrySource
{
    public JournalTelemetry Collect(JournalTelemetryConfiguration options)
        => new(1, 2, false, null, null, null, null, null, null);
}

internal sealed class NullDockerSource : IDockerTelemetrySource
{
    public Task<DockerTelemetry?> CollectAsync(DockerTelemetryConfiguration options, CancellationToken ct)
        => Task.FromResult<DockerTelemetry?>(null);
}

internal sealed class CountingComposer : ITelemetrySampleComposer
{
    public int Calls { get; private set; }
    public Task<SampleCollected> ComposeAsync(
        TelemetryConfiguration configuration,
        CancellationToken ct = default)
    {
        Calls++;
        return Task.FromResult(new SampleCollected(null, null, null, null, null, null, null));
    }
}

internal sealed class CountingWriter : IJournalWriter
{
    public int Count { get; private set; }
    public void Append<T>(T payload) => Count++;
}

internal sealed class CountingEmitter : ITelemetryEmitter
{
    public int Calls { get; private set; }
    public Task EmitAsync(CancellationToken ct = default)
    {
        Calls++;
        return Task.CompletedTask;
    }
}

internal sealed class FakeConfiguration(EngineConfiguration current) : IConfigurationService
{
    public EngineConfiguration GetCurrent() => current;
    public JournalEventsConfiguration GetJournalEvents() => new();
    public bool AreMandatorySettingsSatisfied => true;
    public IReadOnlyList<string> MissingRequired => [];
    public void ReplaceApplied(
        EngineConfiguration configuration,
        JournalEventsConfiguration journalEvents,
        IReadOnlyList<string> missingRequired)
        => throw new NotSupportedException();
}
