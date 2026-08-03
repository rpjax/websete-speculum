using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Speculum.Api.ResourceMonitoring.Models;
using Speculum.Api.ResourceMonitoring.Services.Contracts;
using Speculum.Api.ResourceMonitoring.Storage;

namespace Speculum.Api.Presentation.Diagnostics;

public static class ResourceMonitoringEndpoints
{
    public static IEndpointRouteBuilder MapResourceMonitoringEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        var g = endpoints.MapGroup("/api/admin/diagnostics/v1").WithTags("Diagnostics.Resources");

        g.MapGet("/resources/latest", async (IResourceHistoryService history, CancellationToken ct) =>
        {
            var latest = await history.GetLatestAsync(ct).ConfigureAwait(false);
            return Results.Ok(latest);
        });

        g.MapGet("/resources/history", async (
            DateTimeOffset? from,
            DateTimeOffset? to,
            int? limit,
            int? bucketSeconds,
            string? cursor,
            IResourceHistoryService history,
            CancellationToken ct) =>
        {
            if (from is null || to is null)
                return Results.BadRequest(new { error = "from_and_to_required" });

            try
            {
                var result = await history.GetHistoryAsync(
                    from.Value, to.Value, limit, bucketSeconds, cursor, ct).ConfigureAwait(false);
                return Results.Ok(result);
            }
            catch (ArgumentException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        });

        g.MapGet("/signals", async (
            string? status,
            string? kind,
            IResourceSignalStore store,
            CancellationToken ct) =>
        {
            ResourceSignalStatus? statusEnum = ResourceSignalStatus.Active;
            if (!string.IsNullOrWhiteSpace(status))
            {
                if (string.Equals(status, "all", StringComparison.OrdinalIgnoreCase))
                    statusEnum = null;
                else
                {
                    try { statusEnum = ResourceMonitoringJson.DeserializeEnum<ResourceSignalStatus>(status); }
                    catch (Exception)
                    {
                        return Results.BadRequest(new { error = "invalid_status" });
                    }
                }
            }

            ResourceSignalKind? kindEnum = null;
            if (!string.IsNullOrWhiteSpace(kind))
            {
                try { kindEnum = ResourceMonitoringJson.DeserializeEnum<ResourceSignalKind>(kind); }
                catch (Exception)
                {
                    return Results.BadRequest(new { error = "invalid_kind" });
                }
            }

            var list = await store.ListAsync(statusEnum, kindEnum, ct).ConfigureAwait(false);
            return Results.Ok(list);
        });

        g.MapGet("/signals/{id:guid}", async (Guid id, IResourceSignalStore store, CancellationToken ct) =>
        {
            var signal = await store.GetAsync(id, ct).ConfigureAwait(false);
            return signal is null ? Results.NotFound(new { error = "signal_gone" }) : Results.Ok(signal);
        });

        g.MapGet("/reports", async (
            string? kind,
            IResourceReportStore store,
            CancellationToken ct) =>
        {
            ResourceReportKind? kindEnum = null;
            if (!string.IsNullOrWhiteSpace(kind))
            {
                try { kindEnum = ResourceMonitoringJson.DeserializeEnum<ResourceReportKind>(kind); }
                catch (Exception)
                {
                    return Results.BadRequest(new { error = "invalid_kind" });
                }
            }

            var list = await store.ListAsync(kindEnum, ct).ConfigureAwait(false);
            return Results.Ok(list);
        });

        g.MapPost("/reports", async (
            CreateResourceReportRequest? body,
            IResourceReportStore store,
            IResourceReportQueue queue,
            CancellationToken ct) =>
        {
            if (body is null)
                return Results.BadRequest(new { error = "body_required" });
            if (body.To < body.From)
                return Results.BadRequest(new { error = "invalid_window" });

            var created = await store.CreatePendingAsync(body.Kind, body.From, body.To, ct)
                .ConfigureAwait(false);
            await queue.EnqueueAsync(created.Id, ct).ConfigureAwait(false);
            return Results.Created($"/api/admin/diagnostics/v1/reports/{created.Id}", created);
        });

        g.MapGet("/reports/{id:guid}", async (Guid id, IResourceReportStore store, CancellationToken ct) =>
        {
            var report = await store.GetAsync(id, ct).ConfigureAwait(false);
            return report is null ? Results.NotFound(new { error = "report_gone" }) : Results.Ok(report);
        });

        return endpoints;
    }
}
