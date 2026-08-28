using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Speculum.Api.Profiles.Aggregates;
using Speculum.Api.Profiles.Requests;
using Speculum.Api.Profiles.Services.Contracts;
using Speculum.Api.Sessions.Services.Contracts;

namespace Speculum.Api.Presentation.Profiles;

public static class ProfileEndpoints
{
    public static IEndpointRouteBuilder MapProfileEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        endpoints.MapGet("/api/profiles", async (
            int? skip,
            int? take,
            Guid? profileId,
            ProfileSortBy? sortBy,
            bool? sortDescending,
            IProfileService profiles,
            ILiveSessionService liveSessions,
            CancellationToken ct) =>
        {
            var result = await profiles.ListProfilesAsync(
                new ListProfiles
                {
                    Skip = skip ?? 0,
                    Take = take ?? ListProfiles.DefaultTake,
                    ProfileId = profileId,
                    SortBy = sortBy ?? ProfileSortBy.CreatedAt,
                    SortDescending = sortDescending ?? true,
                },
                ct).ConfigureAwait(false);

            if (result.IsFailure)
                return Results.BadRequest(new { error = result.Errors.FirstOrDefault() ?? "Profile listing failed" });

            var live = liveSessions.ListSnapshots()
                .Select(session => session.ProfileId)
                .ToHashSet();
            var items = result.Value.Items.Select(item => new
            {
                item.ProfileId,
                item.CreatedAt,
                item.LastUsedAt,
                hasLiveSession = live.Contains(item.ProfileId),
            });

            return Results.Ok(new { items, total = result.Value.Total });
        }).WithTags("Profiles");

        endpoints.MapGet("/api/profiles/{profileId:guid}", async (
            Guid profileId,
            IProfileService profiles,
            ILiveSessionService liveSessions,
            CancellationToken ct) =>
        {
            var result = await profiles.GetProfileAsync(profileId, ct).ConfigureAwait(false);
            if (result.IsFailure)
                return Results.NotFound(new { error = result.Errors.FirstOrDefault() ?? "Profile not found" });

            var summary = result.Value;
            return Results.Ok(new
            {
                summary.ProfileId,
                summary.CreatedAt,
                summary.LastUsedAt,
                summary.CookieCount,
                summary.LocalStorageCount,
                summary.IdbRecordCount,
                summary.HistoryCount,
                hasLiveSession = liveSessions.ListSnapshots().Any(session => session.ProfileId == profileId),
            });
        }).WithTags("Profiles");

        endpoints.MapDelete("/api/profiles/{profileId:guid}", async (
            Guid profileId,
            HttpContext http,
            IProfileService profiles,
            CancellationToken ct) =>
        {
            var result = await profiles.DeleteProfileAsync(
                new DeleteProfile
                {
                    ProfileId = profileId,
                    Reason = ProfileDeletionReason.UserRequested,
                    CorrelationId = http.Request.Headers.TryGetValue("X-Correlation-Id", out var correlationId)
                        ? correlationId.ToString()
                        : null,
                },
                ct).ConfigureAwait(false);

            if (result.IsSuccess)
                return Results.Ok(new { ok = true, profileId });

            var error = result.Errors.Select(static e => e.ToString())
                .FirstOrDefault(static e => !string.IsNullOrWhiteSpace(e))
                ?? "Profile deletion failed";
            if (string.Equals(error, "Profile not found", StringComparison.Ordinal))
                return Results.NotFound(new { error });
            if (string.Equals(error, "Profile has a live session", StringComparison.Ordinal))
                return Results.Conflict(new { error });
            return Results.BadRequest(new { error });
        }).WithTags("Profiles");

        return endpoints;
    }
}
