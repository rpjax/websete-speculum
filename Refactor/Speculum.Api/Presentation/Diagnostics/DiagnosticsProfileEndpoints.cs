using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Speculum.Api.Profiles.Aggregates;
using Speculum.Api.Profiles.Requests;
using Speculum.Api.Profiles.Services.Contracts;
using Speculum.Api.Sessions.Models;

namespace Speculum.Api.Presentation.Diagnostics;

/// <summary>
/// Minimal diagnostics surface for persisted profile state (E8b dirty-cookie path).
/// Full Diagnostics HTTP remains out of scope for this axis.
/// </summary>
public static class DiagnosticsProfileEndpoints
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public static IEndpointRouteBuilder MapDiagnosticsProfileEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        var g = endpoints.MapGroup("/api/admin/diagnostics/v1/profiles");

        g.MapGet("/{profileId:guid}", async (
            Guid profileId,
            IProfileRepository profiles,
            CancellationToken ct) =>
        {
            var loaded = await profiles.LoadAsync(profileId, ct).ConfigureAwait(false);
            if (loaded is null)
                return Results.NotFound(new { errorCode = "profile_gone" });

            return Results.Ok(new
            {
                profileId = loaded.Id,
                detail = new
                {
                    cookies = loaded.State.Cookies,
                    localStorage = loaded.State.LocalStorage,
                    idbRecords = loaded.State.IdbRecords,
                    history = loaded.State.History,
                },
            });
        });

        g.MapPut("/{profileId:guid}/state", async (
            Guid profileId,
            HttpContext http,
            IProfileService profiles,
            CancellationToken ct) =>
        {
            ProfileStateDto? dto;
            try
            {
                dto = await JsonSerializer.DeserializeAsync<ProfileStateDto>(
                    http.Request.Body,
                    JsonOptions,
                    ct).ConfigureAwait(false);
            }
            catch (JsonException)
            {
                return Results.Json(new { errorCode = "invalid_state" }, statusCode: StatusCodes.Status400BadRequest);
            }

            if (dto is null)
                return Results.Json(new { errorCode = "invalid_state" }, statusCode: StatusCodes.Status400BadRequest);

            var result = await profiles.ReplaceProfileStateAsync(
                new ReplaceProfileState
                {
                    ProfileId = profileId,
                    State = dto.ToProfileState(),
                    CorrelationId = http.Request.Headers.TryGetValue("X-Correlation-Id", out var corr)
                        ? corr.ToString()
                        : null,
                },
                ct).ConfigureAwait(false);

            if (result.IsFailure)
            {
                var message = result.Errors.FirstOrDefault()?.Message ?? "replace_failed";
                if (message.Contains("not found", StringComparison.OrdinalIgnoreCase))
                    return Results.NotFound(new { errorCode = "profile_gone" });
                return Results.Json(new { errorCode = "invalid_state", message }, statusCode: StatusCodes.Status400BadRequest);
            }

            return Results.Ok(new { ok = true, profileId });
        });

        return endpoints;
    }

    private sealed class ProfileStateDto
    {
        public List<BrowserCookieState>? Cookies { get; set; }
        public List<BrowserLocalStorageState>? LocalStorage { get; set; }
        public List<BrowserIdbRecordState>? IdbRecords { get; set; }
        public List<BrowserHistoryState>? History { get; set; }

        public ProfileState ToProfileState()
        {
            var state = new ProfileState();
            if (Cookies is { Count: > 0 })
                state.Cookies.AddRange(Cookies);
            if (LocalStorage is { Count: > 0 })
                state.LocalStorage.AddRange(LocalStorage);
            if (IdbRecords is { Count: > 0 })
                state.IdbRecords.AddRange(IdbRecords);
            if (History is { Count: > 0 })
                state.History.AddRange(History);
            return state;
        }
    }
}
