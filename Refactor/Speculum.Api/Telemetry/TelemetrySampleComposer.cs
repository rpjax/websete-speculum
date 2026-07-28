using Speculum.Api.Configurations.Models.Telemetry;
using Speculum.Api.Telemetry.Models;
using Speculum.Api.Telemetry.Sources;

namespace Speculum.Api.Telemetry;

public interface ITelemetrySampleComposer
{
    Task<SampleCollected> ComposeAsync(TelemetryConfiguration configuration, CancellationToken ct = default);
}

public sealed class TelemetrySampleComposer(
    IHostTelemetrySource host,
    IApiProcessTelemetrySource apiProcess,
    ISessionsTelemetrySource sessions,
    ISidecarTelemetrySource sidecar,
    IProfilesTelemetrySource profiles,
    IJournalTelemetrySource journal,
    IDockerTelemetrySource docker,
    ILogger<TelemetrySampleComposer> logger) : ITelemetrySampleComposer
{
    public async Task<SampleCollected> ComposeAsync(
        TelemetryConfiguration configuration,
        CancellationToken ct = default)
        => new(
            await TryCollectAsync("host", configuration.Host.IsEnabled, () => Task.FromResult(host.Collect(configuration.Host))).ConfigureAwait(false),
            await TryCollectAsync("apiProcess", configuration.ApiProcess.IsEnabled, () => Task.FromResult(apiProcess.Collect(configuration.ApiProcess))).ConfigureAwait(false),
            await TryCollectAsync("sessions", configuration.Sessions.IsEnabled, () => sessions.CollectAsync(configuration.Sessions, ct)).ConfigureAwait(false),
            await TryCollectAsync("sidecar", configuration.Sidecar.IsEnabled, () => sidecar.CollectAsync(configuration.Sidecar, ct)).ConfigureAwait(false),
            await TryCollectAsync("profiles", configuration.Profiles.IsEnabled, () => profiles.CollectAsync(configuration.Profiles, ct)).ConfigureAwait(false),
            await TryCollectAsync("journal", configuration.Journal.IsEnabled, () => Task.FromResult(journal.Collect(configuration.Journal))).ConfigureAwait(false),
            await TryCollectAsync("docker", configuration.Docker.IsEnabled, () => docker.CollectAsync(configuration.Docker, ct)).ConfigureAwait(false));

    private async Task<T?> TryCollectAsync<T>(string section, bool enabled, Func<Task<T>> collect)
    {
        if (!enabled)
            return default;

        try
        {
            return await collect().ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (enabled)
        {
            throw;
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Telemetry section {Section} collection failed; omitting section.", section);
            return default;
        }
    }
}
