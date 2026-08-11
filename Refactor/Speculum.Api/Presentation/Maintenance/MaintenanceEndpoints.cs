using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Speculum.Api.Maintenance.Requests;
using Speculum.Api.Maintenance.Services.Contracts;

namespace Speculum.Api.Presentation.Maintenance;

/// <summary>
/// Operator-only cleanup surface. Every route here delegates to <see cref="IMaintenanceService"/> —
/// the single choke point that owns the session/Journal/profile deletion rules. No other
/// endpoint in the API deletes a session row or a Journal fact.
/// </summary>
public static class MaintenanceEndpoints
{
    public static IEndpointRouteBuilder MapMaintenanceEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        endpoints.MapGet("/api/admin/maintenance/summary", async (
            IMaintenanceService maintenance,
            CancellationToken ct) =>
        {
            var result = await maintenance.GetSummaryAsync(ct).ConfigureAwait(false);
            return result.IsSuccess
                ? Results.Ok(result.Value)
                : Results.BadRequest(new { error = result.Errors.FirstOrDefault()?.ToString() ?? "Summary failed" });
        }).WithTags("Maintenance");

        endpoints.MapDelete("/api/admin/maintenance/sessions/{sessionId:guid}", async (
            Guid sessionId,
            IMaintenanceService maintenance,
            CancellationToken ct) =>
        {
            var result = await maintenance.DeleteSessionAsync(sessionId, ct).ConfigureAwait(false);
            return result.IsSuccess
                ? Results.Ok(result.Value)
                : Results.BadRequest(new { error = result.Errors.FirstOrDefault()?.ToString() ?? "Delete failed" });
        }).WithTags("Maintenance");

        endpoints.MapPost("/api/admin/maintenance/sessions/delete-ended", async (
            DeleteEndedSessions? body,
            IMaintenanceService maintenance,
            CancellationToken ct) =>
        {
            var result = await maintenance
                .DeleteEndedSessionsAsync(body ?? new DeleteEndedSessions(), ct)
                .ConfigureAwait(false);
            return result.IsSuccess
                ? Results.Ok(result.Value)
                : Results.BadRequest(new { error = result.Errors.FirstOrDefault()?.ToString() ?? "Delete failed" });
        }).WithTags("Maintenance");

        endpoints.MapPost("/api/admin/maintenance/journal/delete-independent", async (
            DeleteIndependentFacts? body,
            IMaintenanceService maintenance,
            CancellationToken ct) =>
        {
            var result = await maintenance
                .DeleteIndependentFactsAsync(body ?? new DeleteIndependentFacts(), ct)
                .ConfigureAwait(false);
            return result.IsSuccess
                ? Results.Ok(result.Value)
                : Results.BadRequest(new { error = result.Errors.FirstOrDefault()?.ToString() ?? "Delete failed" });
        }).WithTags("Maintenance");

        endpoints.MapPost("/api/admin/maintenance/profiles/delete-inactive", async (
            DeleteInactiveProfiles body,
            IMaintenanceService maintenance,
            CancellationToken ct) =>
        {
            var result = await maintenance.DeleteInactiveProfilesAsync(body, ct).ConfigureAwait(false);
            return result.IsSuccess
                ? Results.Ok(result.Value)
                : Results.BadRequest(new { error = result.Errors.FirstOrDefault()?.ToString() ?? "Delete failed" });
        }).WithTags("Maintenance");

        endpoints.MapPost("/api/admin/maintenance/lab-reset", async (
            LabResetRequest? body,
            IMaintenanceService maintenance,
            CancellationToken ct) =>
        {
            var result = await maintenance
                .LabResetAsync(body ?? new LabResetRequest(), ct)
                .ConfigureAwait(false);
            return result.IsSuccess
                ? Results.Ok(result.Value)
                : Results.BadRequest(new { error = result.Errors.FirstOrDefault()?.ToString() ?? "Lab reset failed" });
        }).WithTags("Maintenance");

        return endpoints;
    }
}
