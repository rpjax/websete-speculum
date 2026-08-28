using Speculum.Api.ResourceMonitoring.Models;
using Speculum.Api.ResourceMonitoring.Services.Contracts;

namespace Speculum.Api.ResourceMonitoring.Services;

public sealed class ReportMaterializerHostedService(
    IResourceReportQueue queue,
    IServiceScopeFactory scopeFactory,
    ILogger<ReportMaterializerHostedService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await foreach (var reportId in queue.ReadAllAsync(stoppingToken))
        {
            try
            {
                await MaterializeAsync(reportId, stoppingToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Report materialization failed for {ReportId}.", reportId);
                try
                {
                    await using var scope = scopeFactory.CreateAsyncScope();
                    var store = scope.ServiceProvider.GetRequiredService<IResourceReportStore>();
                    await store.MarkFailedAsync(reportId, "materialize_failed", "exception", stoppingToken)
                        .ConfigureAwait(false);
                }
                catch (Exception markEx)
                {
                    logger.LogWarning(markEx, "Could not mark report {ReportId} failed.", reportId);
                }
            }
        }
    }

    private async Task MaterializeAsync(Guid reportId, CancellationToken ct)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        var reports = sp.GetRequiredService<IResourceReportStore>();
        var history = sp.GetRequiredService<IResourceHistoryService>();
        var signals = sp.GetRequiredService<IResourceSignalStore>();
        var time = sp.GetRequiredService<TimeProvider>();

        var report = await reports.GetAsync(reportId, ct).ConfigureAwait(false);
        if (report is null)
        {
            await reports.MarkFailedAsync(reportId, "report_gone", "load", ct).ConfigureAwait(false);
            return;
        }

        if (report.Status != ResourceReportStatus.Pending)
            return;

        try
        {
            var hist = await history.GetHistoryAsync(
                report.From,
                report.To,
                limit: 2000,
                bucketSeconds: null,
                cursor: null,
                ct).ConfigureAwait(false);

            var signalList = await signals.ListAsync(status: null, kind: null, ct).ConfigureAwait(false);
            var inWindow = signalList.Items
                .Where(s => s.DetectedAt >= report.From && s.DetectedAt <= report.To)
                .ToList();

            var (summary, chapters) = ResourceReportMaterializer.Build(
                report.Kind,
                report.From,
                report.To,
                hist.Items,
                inWindow);

            await reports.MarkReadyAsync(reportId, summary, chapters, time.GetUtcNow(), ct)
                .ConfigureAwait(false);
        }
        catch (ArgumentException)
        {
            await reports.MarkFailedAsync(reportId, "invalid_window", "history_query", ct)
                .ConfigureAwait(false);
        }
    }
}
