using Speculum.Api.Journal.Models;
using Speculum.Api.Journal.Services.Contracts;
using Speculum.Api.ResourceMonitoring.Models;
using Speculum.Api.ResourceMonitoring.Services.Contracts;
using Speculum.Api.Telemetry;

namespace Speculum.Api.ResourceMonitoring.Services;

public sealed class ResourceSignalDetectorHostedService(
    IServiceScopeFactory scopeFactory,
    ILogger<ResourceSignalDetectorHostedService> logger) : BackgroundService
{
    internal static readonly TimeSpan Interval = TimeSpan.FromSeconds(15);
    internal const int LookbackLimit = 60;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await TickAsync(stoppingToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Resource signal detector tick failed.");
            }

            try
            {
                await Task.Delay(Interval, stoppingToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
        }
    }

    private async Task TickAsync(CancellationToken ct)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        var journal = sp.GetRequiredService<IJournalReader>();
        var signals = sp.GetRequiredService<IResourceSignalStore>();
        var time = sp.GetRequiredService<TimeProvider>();
        var now = time.GetUtcNow();

        var entries = await journal.ReadAsync(new JournalQuery
        {
            Limit = LookbackLimit,
            Filter = new JournalQueryFilter
            {
                Type = TelemetryJournalFacts.SampleCollected,
                PublishedSince = now.AddHours(-2),
                PublishedUntil = now,
            },
            Orders =
            [
                new JournalQueryOrder
                {
                    Property = JournalOrderProperty.PublishedAt,
                    Direction = JournalSortDirection.Ascending,
                },
            ],
        }, ct).ConfigureAwait(false);

        var window = new List<(Guid Id, DateTimeOffset At, Telemetry.Events.Models.Sampling.SampleCollected Sample)>();
        foreach (var entry in entries)
        {
            var sample = ResourceHistoryService.TryDeserialize(entry.Payload);
            if (sample is null)
                continue;
            window.Add((entry.Id, entry.PublishedAt, sample));
        }

        var detected = ResourceSignalDetector.Evaluate(window, now);
        var activeKinds = detected.Select(d => d.Kind).ToHashSet();
        var existingActive = await signals.ListActiveByKindsAsync(
            Enum.GetValues<ResourceSignalKind>(), ct).ConfigureAwait(false);

        foreach (var signal in detected)
            await signals.UpsertActiveAsync(signal, ct).ConfigureAwait(false);

        foreach (var existing in existingActive)
        {
            if (!activeKinds.Contains(existing.Kind))
                await signals.ResolveAsync(existing.Id, now, ct).ConfigureAwait(false);
        }
    }
}
