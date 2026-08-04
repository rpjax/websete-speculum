using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Speculum.Api.Configurations.Models.Sessions;
using Speculum.Api.Sessions.Services;
using Speculum.Api.Sessions.Services.Contracts;

namespace Speculum.Api.Presentation.Sessions;

/// <summary>
/// Dom Projection asset proxy — session-token gated GET by content hash.
/// </summary>
public static class DomAssetEndpoints
{
    public const string AssetPath = "/api/sessions/{sessionId:guid}/dom-assets/{hash}";

    public static IEndpointRouteBuilder MapDomAssetEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        endpoints.MapGet(AssetPath, async (
            Guid sessionId,
            string hash,
            HttpRequest request,
            ILiveSessionService liveSessions,
            ISessionBindingRegistry bindings,
            CancellationToken ct) =>
        {
            var token = request.Query["token"].ToString();
            if (string.IsNullOrWhiteSpace(token))
            {
                return Results.Unauthorized();
            }

            if (string.IsNullOrWhiteSpace(hash) || hash.Length > 64)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["hash"] = ["A non-empty asset hash is required."],
                });
            }

            if (!bindings.TryGetLive(sessionId, token.Trim(), out _)
                || !liveSessions.TryGet(sessionId, out var live))
            {
                return Results.NotFound(new { errorCode = "session_gone" });
            }

            if (live.MirrorMode != MirrorMode.DomProjection)
            {
                return Results.BadRequest(new
                {
                    errorCode = "mirror_mode_mismatch",
                    message = LiveSession.MirrorModeDomProjectionRequiredMessage,
                });
            }

            var result = await live.GetDomAssetAsync(hash.Trim(), ct).ConfigureAwait(false);
            if (result.IsFailure)
            {
                return Results.NotFound(new
                {
                    errorCode = "asset_missing",
                    message = string.Join("; ", result.Errors.Select(e => e.Message)),
                });
            }

            var asset = result.Value;
            return Results.File(
                asset.Body,
                contentType: string.IsNullOrWhiteSpace(asset.ContentType)
                    ? "application/octet-stream"
                    : asset.ContentType);
        }).WithTags("Sessions");

        return endpoints;
    }
}
