using Speculum.Api.Configurations.Services.Contracts;
using Speculum.Api.Journal.Services.Contracts;
using Speculum.Api.Telemetry.Models;

namespace Speculum.Api.Telemetry;

public interface ITelemetryEmitter
{
    Task EmitAsync(CancellationToken ct = default);
}

public sealed class TelemetryEmitter(
    IConfigurationService configuration,
    ITelemetrySampleComposer composer,
    IJournalWriter journal) : ITelemetryEmitter
{
    public async Task EmitAsync(CancellationToken ct = default)
    {
        var options = configuration.GetCurrent().Telemetry;
        if (!options.IsEnabled)
            return;

        var sample = await composer.ComposeAsync(options, ct).ConfigureAwait(false);
        journal.Append(sample);
        if (!options.Sessions.IncludePerSession || sample.Sessions?.Sessions is null)
            return;

        foreach (var item in sample.Sessions.Sessions)
        {
            journal.Append(new SessionSampleCollected(
                item.SessionId,
                item.ProfileId,
                item.JsBridgeEnabled,
                item.ConnectionOpen,
                item.UptimeMs,
                item.Fps,
                item.UrlHost));
        }
    }
}
