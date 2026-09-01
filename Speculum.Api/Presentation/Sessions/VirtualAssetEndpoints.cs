using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Speculum.Api.Configurations.Models.Sessions;
using Speculum.Api.Sessions.Mirror;
using Speculum.Api.Sessions.Models;
using Speculum.Api.Sessions.Services.Contracts;

namespace Speculum.Api.Presentation.Sessions;

/// <summary>
/// PageProjection virtual-asset / blob / data serve + file uploads.
/// Paths are after PathBase <c>/w7s</c>.
/// </summary>
public static class VirtualAssetEndpoints
{
    public static IEndpointRouteBuilder MapVirtualAssetEndpoints(this IEndpointRouteBuilder endpoints)
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
        var token = SessionBindingAuth.ReadToken(request);
        return await ServeKeyAsync(live, key, "asset", range, token, ct).ConfigureAwait(false);
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

        return await ServeKeyAsync(live, id, "blob", null, SessionBindingAuth.ReadToken(request), ct).ConfigureAwait(false);
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

        return await ServeKeyAsync(live, id, "data", null, SessionBindingAuth.ReadToken(request), ct).ConfigureAwait(false);
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

        uint contextId = 1;
        if (uint.TryParse(request.Query["contextId"], out var cid) && cid > 0) contextId = cid;
        var reason = request.Query["reason"].ToString();

        var result = await live
            .RequestResyncAsync(contextId, string.IsNullOrWhiteSpace(reason) ? null : reason, ct)
            .ConfigureAwait(false);
        if (result.IsFailure)
        {
            var first = result.Errors.FirstOrDefault();
            return Results.BadRequest(new
            {
                errorCode = "resync_failed",
                phase = "request",
                message = string.Join("; ", result.Errors.Select(e => e.Message)),
                detail = first?.Message,
            });
        }

        // Sealed path: resync frame is delivered on the Frames stream, not in this HTTP body.
        return Results.Json(new { ok = true, contextId });
    }

    private static async Task<IResult> ServeKeyAsync(
        ILiveSession live,
        string key,
        string kind,
        string? rangeHeader,
        string? sessionToken,
        CancellationToken ct)
    {
        var result = await live
            .GetVirtualAssetAsync(key, ct, kind, string.IsNullOrWhiteSpace(rangeHeader) ? null : rangeHeader)
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

        return new VirtualAssetHttpResult(asset, contentType, sessionToken);
    }

    private sealed class VirtualAssetHttpResult(VirtualResourceResponse asset, string contentType, string? sessionToken) : IResult
    {
        public async Task ExecuteAsync(HttpContext httpContext)
        {
            var status = asset.StatusCode is >= 200 and < 300 ? asset.StatusCode : 200;
            httpContext.Response.StatusCode = status;
            httpContext.Response.ContentType = contentType;

            var body = asset.Body;
            if (!string.IsNullOrEmpty(sessionToken)
                && NeedsNestedAuthStamp(contentType))
            {
                var text = System.Text.Encoding.UTF8.GetString(body);
                var stamped = StampAuthInServedBody(text, contentType, sessionToken);
                body = System.Text.Encoding.UTF8.GetBytes(stamped);
            }

            if (!string.IsNullOrWhiteSpace(asset.ContentRange))
            {
                httpContext.Response.Headers.ContentRange = asset.ContentRange;
            }

            httpContext.Response.ContentLength = body.LongLength;
            await httpContext.Response.Body.WriteAsync(body).ConfigureAwait(false);
        }
    }

    private static bool NeedsNestedAuthStamp(string contentType)
    {
        var ct = contentType.ToLowerInvariant();
        return ct.Contains("text/css", StringComparison.Ordinal)
            || ct.Contains("mpegurl", StringComparison.Ordinal)
            || ct.Contains("dash+xml", StringComparison.Ordinal)
            || ct.Contains("x-mpegurl", StringComparison.Ordinal)
            || ct.Contains("apple.mpegurl", StringComparison.Ordinal);
    }

    /// <summary>
    /// Stamp <c>speculum-session-token</c> onto nested <c>/w7s/virtual-*</c> URLs inside
    /// CSS / HLS / DASH bodies so the browser's own subresource fetches authenticate.
    /// </summary>
    internal static string StampAuthInServedBody(string body, string contentType, string token)
    {
        if (string.IsNullOrEmpty(body) || string.IsNullOrEmpty(token)) return body;
        var ct = contentType.ToLowerInvariant();
        if (ct.Contains("text/css", StringComparison.Ordinal))
        {
            return StampCssUrls(body, token);
        }

        if (ct.Contains("mpegurl", StringComparison.Ordinal)
            || ct.Contains("dash+xml", StringComparison.Ordinal)
            || ct.Contains("x-mpegurl", StringComparison.Ordinal)
            || ct.Contains("apple.mpegurl", StringComparison.Ordinal))
        {
            return StampManifestUrls(body, token);
        }

        return body;
    }

    private static string StampCssUrls(string css, string token)
    {
        var withUrl = System.Text.RegularExpressions.Regex.Replace(
            css,
            @"url\(\s*(['""]?)([^)'""]+)\1\s*\)",
            m =>
            {
                var raw = m.Groups[2].Value;
                if (!IsVirtualAssetUrl(raw)) return m.Value;
                return $"url({m.Groups[1].Value}{AppendSessionAuth(raw, token)}{m.Groups[1].Value})";
            },
            System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        return System.Text.RegularExpressions.Regex.Replace(
            withUrl,
            @"@import\s+(['""])([^'""]+)\1",
            m =>
            {
                var raw = m.Groups[2].Value;
                if (!IsVirtualAssetUrl(raw)) return m.Value;
                return $"@import {m.Groups[1].Value}{AppendSessionAuth(raw, token)}{m.Groups[1].Value}";
            },
            System.Text.RegularExpressions.RegexOptions.IgnoreCase);
    }

    private static string StampManifestUrls(string body, string token)
    {
        var lines = body.Split('\n');
        for (var i = 0; i < lines.Length; i++)
        {
            var line = lines[i];
            var trimmed = line.Trim();
            if (trimmed.Length == 0) continue;
            if (trimmed.StartsWith('#'))
            {
                lines[i] = System.Text.RegularExpressions.Regex.Replace(
                    line,
                    @"URI=""([^""]+)""",
                    m =>
                    {
                        var raw = m.Groups[1].Value;
                        return IsVirtualAssetUrl(raw) ? $"URI=\"{AppendSessionAuth(raw, token)}\"" : m.Value;
                    },
                    System.Text.RegularExpressions.RegexOptions.IgnoreCase);
                continue;
            }

            if (!IsVirtualAssetUrl(trimmed)) continue;
            var leadLen = line.Length - line.TrimStart().Length;
            var lead = leadLen > 0 ? line[..leadLen] : "";
            lines[i] = lead + AppendSessionAuth(trimmed, token);
        }

        return string.Join('\n', lines);
    }

    private static bool IsVirtualAssetUrl(string url)
        => url.StartsWith("/w7s/virtual-", StringComparison.Ordinal)
           || url.Contains("/virtual-", StringComparison.Ordinal);

    private static string AppendSessionAuth(string url, string token)
        => SessionBindingAuth.SetReservedParam(url, SessionBindingAuth.QueryParameterName, token);
}
