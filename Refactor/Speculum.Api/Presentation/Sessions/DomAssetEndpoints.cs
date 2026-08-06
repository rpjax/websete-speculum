using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Speculum.Api.Configurations.Models.Sessions;
using Speculum.Api.Sessions.Mirror;
using Speculum.Api.Sessions.Mirror.DomProjection;
using Speculum.Api.Sessions.Services.Contracts;

namespace Speculum.Api.Presentation.Sessions;

/// <summary>
/// Dom Projection virtual-asset / blob / data serve + file uploads.
/// Paths are after PathBase <c>/w7s</c>.
/// </summary>
public static class DomAssetEndpoints
{
    public static IEndpointRouteBuilder MapDomAssetEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        endpoints.MapGet("/virtual-assets/{host}/{**path}", ServeVirtualAsset)
            .WithTags("Sessions");
        endpoints.MapGet("/virtual-blob/{id}", ServeVirtualBlob)
            .WithTags("Sessions");
        endpoints.MapGet("/virtual-data/{id}", ServeVirtualData)
            .WithTags("Sessions");
        endpoints.MapPost("/api/sessions/{sessionId:guid}/dom-uploads", PostDomUpload)
            .WithTags("Sessions");

        return endpoints;
    }

    private static async Task<IResult> ServeVirtualAsset(
        string host,
        string path,
        HttpRequest request,
        ILiveSessionService liveSessions,
        ISessionBindingRegistry bindings,
        CancellationToken ct)
    {
        if (!SessionBindingAuth.TryAuthorize(request, bindings, liveSessions, out var live, out _))
        {
            return Results.Unauthorized();
        }

        if (live.MirrorMode != MirrorMode.DomProjection)
        {
            return Results.BadRequest(new
            {
                errorCode = SessionMirrorErrors.MirrorModeMismatchErrorCode,
                message = SessionMirrorErrors.DomProjectionRequiredMessage,
            });
        }

        var query = request.QueryString.HasValue ? request.QueryString.Value! : "";
        // Drop only Speculum-reserved parameters. Upstream query — including a
        // site's own `token=` — is part of the key the producer materialized.
        query = SessionBindingAuth.StripReservedFromQuery(query);
        var key = $"{host}/{path}{query}";
        var range = request.Headers.Range.ToString();
        return await ServeKeyAsync(live, key, "asset", range, ct).ConfigureAwait(false);
    }

    private static async Task<IResult> ServeVirtualBlob(
        string id,
        HttpRequest request,
        ILiveSessionService liveSessions,
        ISessionBindingRegistry bindings,
        CancellationToken ct)
    {
        if (!SessionBindingAuth.TryAuthorize(request, bindings, liveSessions, out var live, out _))
        {
            return Results.Unauthorized();
        }

        if (live.MirrorMode != MirrorMode.DomProjection)
        {
            return Results.BadRequest(new
            {
                errorCode = SessionMirrorErrors.MirrorModeMismatchErrorCode,
                message = SessionMirrorErrors.DomProjectionRequiredMessage,
            });
        }

        return await ServeKeyAsync(live, id, "blob", null, ct).ConfigureAwait(false);
    }

    private static async Task<IResult> ServeVirtualData(
        string id,
        HttpRequest request,
        ILiveSessionService liveSessions,
        ISessionBindingRegistry bindings,
        CancellationToken ct)
    {
        if (!SessionBindingAuth.TryAuthorize(request, bindings, liveSessions, out var live, out _))
        {
            return Results.Unauthorized();
        }

        if (live.MirrorMode != MirrorMode.DomProjection)
        {
            return Results.BadRequest(new
            {
                errorCode = SessionMirrorErrors.MirrorModeMismatchErrorCode,
                message = SessionMirrorErrors.DomProjectionRequiredMessage,
            });
        }

        return await ServeKeyAsync(live, id, "data", null, ct).ConfigureAwait(false);
    }

    private static async Task<IResult> PostDomUpload(
        Guid sessionId,
        HttpRequest request,
        ILiveSessionService liveSessions,
        ISessionBindingRegistry bindings,
        CancellationToken ct)
    {
        if (!SessionBindingAuth.TryAuthorize(
                request,
                bindings,
                liveSessions,
                out var live,
                out _,
                expectedSessionId: sessionId))
        {
            return Results.Unauthorized();
        }

        if (live.MirrorMode != MirrorMode.DomProjection)
        {
            return Results.BadRequest(new
            {
                errorCode = SessionMirrorErrors.MirrorModeMismatchErrorCode,
                message = SessionMirrorErrors.DomProjectionRequiredMessage,
            });
        }

        var uploadId = request.Query["uploadId"].ToString();
        if (string.IsNullOrWhiteSpace(uploadId))
        {
            uploadId = Guid.NewGuid().ToString("N");
        }

        var name = request.Query["name"].ToString();
        if (string.IsNullOrWhiteSpace(name)) name = "file";
        var contentType = request.ContentType ?? "application/octet-stream";

        await using var ms = new MemoryStream();
        await request.Body.CopyToAsync(ms, ct).ConfigureAwait(false);
        var body = ms.ToArray();
        if (body.Length == 0)
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["body"] = ["Upload body is required."],
            });
        }

        var result = await live
            .PutDomUploadAsync(uploadId.Trim(), body, contentType, name, ct)
            .ConfigureAwait(false);
        if (result.IsFailure)
        {
            return Results.BadRequest(new
            {
                errorCode = "upload_failed",
                message = string.Join("; ", result.Errors.Select(e => e.Message)),
            });
        }

        return Results.Json(new { uploadId = uploadId.Trim() });
    }

    private static async Task<IResult> ServeKeyAsync(
        ILiveSession live,
        string key,
        string kind,
        string? rangeHeader,
        CancellationToken ct)
    {
        var result = await live
            .GetDomAssetAsync(key, ct, kind, string.IsNullOrWhiteSpace(rangeHeader) ? null : rangeHeader)
            .ConfigureAwait(false);
        if (result.IsFailure)
        {
            return Results.NotFound(new
            {
                errorCode = "asset_missing",
                message = string.Join("; ", result.Errors.Select(e => e.Message)),
            });
        }

        var asset = result.Value;
        if (asset.Body.Length == 0 && asset.StatusCode is 0 or 404)
        {
            return Results.NotFound(new { errorCode = "asset_missing" });
        }

        var contentType = string.IsNullOrWhiteSpace(asset.ContentType)
            ? "application/octet-stream"
            : asset.ContentType;

        return new DomAssetHttpResult(asset, contentType);
    }

    private sealed class DomAssetHttpResult(DomAsset asset, string contentType) : IResult
    {
        public async Task ExecuteAsync(HttpContext httpContext)
        {
            var status = asset.StatusCode is >= 200 and < 300 ? asset.StatusCode : 200;
            httpContext.Response.StatusCode = status;
            httpContext.Response.ContentType = contentType;
            if (!string.IsNullOrWhiteSpace(asset.ContentRange))
            {
                httpContext.Response.Headers.ContentRange = asset.ContentRange;
            }

            httpContext.Response.ContentLength = asset.Body.LongLength;
            await httpContext.Response.Body.WriteAsync(asset.Body).ConfigureAwait(false);
        }
    }

}
