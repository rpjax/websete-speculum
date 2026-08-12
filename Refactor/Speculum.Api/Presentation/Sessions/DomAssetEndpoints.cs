using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Speculum.Api.Configurations.Models.Sessions;
using Speculum.Api.Sessions.Mirror;
using Speculum.Api.Sessions.Mirror.PageProjection;
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
        endpoints.MapPost("/api/sessions/{sessionId:guid}/page-projection/resync", PostPageProjectionResync)
            .WithTags("Sessions");
        endpoints.MapPost("/api/sessions/{sessionId:guid}/page-projection/client-state", PostPageProjectionClientState)
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

        if (live.MirrorMode != MirrorMode.PageProjection)
        {
            return Results.BadRequest(new
            {
                errorCode = SessionMirrorErrors.MirrorModeMismatchErrorCode,
                message = SessionMirrorErrors.PageProjectionRequiredMessage,
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

        if (live.MirrorMode != MirrorMode.PageProjection)
        {
            return Results.BadRequest(new
            {
                errorCode = SessionMirrorErrors.MirrorModeMismatchErrorCode,
                message = SessionMirrorErrors.PageProjectionRequiredMessage,
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

        if (live.MirrorMode != MirrorMode.PageProjection)
        {
            return Results.BadRequest(new
            {
                errorCode = SessionMirrorErrors.MirrorModeMismatchErrorCode,
                message = SessionMirrorErrors.PageProjectionRequiredMessage,
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

        if (live.MirrorMode != MirrorMode.PageProjection)
        {
            return Results.BadRequest(new
            {
                errorCode = SessionMirrorErrors.MirrorModeMismatchErrorCode,
                message = SessionMirrorErrors.PageProjectionRequiredMessage,
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

    private static async Task<IResult> PostPageProjectionResync(
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

        if (live.MirrorMode != MirrorMode.PageProjection)
        {
            return Results.BadRequest(new
            {
                errorCode = SessionMirrorErrors.MirrorModeMismatchErrorCode,
                message = SessionMirrorErrors.PageProjectionRequiredMessage,
            });
        }

        long generation = 0;
        long sequence = 0;
        if (long.TryParse(request.Query["generation"], out var g)) generation = g;
        if (long.TryParse(request.Query["sequence"], out var s)) sequence = s;

        var result = await live
            .GetPageProjectionResyncAsync(generation, sequence, ct)
            .ConfigureAwait(false);
        if (result.IsFailure)
        {
            var first = result.Errors.FirstOrDefault();
            return Results.BadRequest(new
            {
                errorCode = "resync_failed",
                phase = "capture",
                message = string.Join("; ", result.Errors.Select(e => e.Message)),
                detail = first?.Message,
            });
        }

        var snap = result.Value;
        // §5.7.2 W3 — length-prefixed §5.5 parts (u32 LE length + bytes). Generation /
        // coversThroughSequence ride response headers so the body stays pure opaque wire.
        var total = 0;
        foreach (var part in snap.FrameParts)
        {
            total = checked(total + 4 + part.Length);
        }

        var body = new byte[total];
        var offset = 0;
        foreach (var part in snap.FrameParts)
        {
            System.Buffers.Binary.BinaryPrimitives.WriteUInt32LittleEndian(
                body.AsSpan(offset, 4),
                (uint)part.Length);
            offset += 4;
            Buffer.BlockCopy(part, 0, body, offset, part.Length);
            offset += part.Length;
        }

        return Results.Bytes(body, "application/octet-stream");
        // Note: generation / coversThroughSequence are recoverable from the §5.5 part
        // headers themselves (encode.ts); HTTP response status is the only extra signal.
    }

    /// <summary>
    /// Client → server control channel (§5.9.5) wire body. A control report, not a diff —
    /// never advances the live `sequence`.
    /// </summary>
    private sealed class PageProjectionClientStateHttpRequest
    {
        /// <summary>"visible" | "hidden" (§5.3.5.3).</summary>
        public string Visibility { get; set; } = "visible";

        public long AppliedThroughSequence { get; set; }

        public int QueuedFrames { get; set; }

        public double ApplyP50Ms { get; set; }

        public double ApplyP95Ms { get; set; }

        /// <summary>Applies exceeding `applyBudgetMs` (E9) since the last report.</summary>
        public int OverrunCount { get; set; }
    }

    private static async Task<IResult> PostPageProjectionClientState(
        Guid sessionId,
        PageProjectionClientStateHttpRequest? body,
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

        if (live.MirrorMode != MirrorMode.PageProjection)
        {
            return Results.BadRequest(new
            {
                errorCode = SessionMirrorErrors.MirrorModeMismatchErrorCode,
                message = SessionMirrorErrors.PageProjectionRequiredMessage,
            });
        }

        if (body is null)
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["body"] = ["A PageProjectionClientState body is required."],
            });
        }

        var visibility = string.Equals(body.Visibility?.Trim(), "hidden", StringComparison.OrdinalIgnoreCase)
            ? "hidden"
            : "visible";

        var result = await live
            .ReportPageProjectionClientStateAsync(
                new PageProjectionClientStateReport
                {
                    Visibility = visibility,
                    AppliedThroughSequence = body.AppliedThroughSequence,
                    QueuedFrames = body.QueuedFrames,
                    ApplyP50Ms = body.ApplyP50Ms,
                    ApplyP95Ms = body.ApplyP95Ms,
                    OverrunCount = body.OverrunCount,
                },
                ct)
            .ConfigureAwait(false);
        if (result.IsFailure)
        {
            return Results.BadRequest(new
            {
                errorCode = "client_state_report_failed",
                message = string.Join("; ", result.Errors.Select(e => e.Message)),
            });
        }

        return Results.Json(new { ok = true });
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
