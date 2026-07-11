using System.Text.Json;
using Websete.Speculum.Host.Config.Runtime;
using Websete.Speculum.Host.Config.Store;
using Websete.Speculum.Host.Scripts;
using Websete.Speculum.Host.Virtualization.Persistence;

namespace Websete.Speculum.Host.Admin;

public sealed class AdminAuthMiddleware
{
    private static readonly string[] PublicExactPaths =
    [
        "/health",
        "/ready",
        "/setup",
        "/setup.html",
        "/api/admin/config/status",
    ];

    private static readonly string[] PublicPrefixes =
    [
        "/libs/",
        "/js/",
        "/workers/",
        "/vhub",
    ];

    private readonly RequestDelegate _next;

    public AdminAuthMiddleware(RequestDelegate next) => _next = next;

    public async Task InvokeAsync(HttpContext context, ISpeculumConfigStore store)
    {
        var path = context.Request.Path.Value ?? "";

        if (IsPublic(path))
        {
            await _next(context);
            return;
        }

        if (path.StartsWith("/openapi", StringComparison.OrdinalIgnoreCase)
            || path.StartsWith("/api/admin/", StringComparison.OrdinalIgnoreCase))
        {
            var apiKey = store.Current.AdminApiKey;
            if (string.IsNullOrEmpty(apiKey)
                || !TryGetBearerToken(context.Request.Headers.Authorization, out var token)
                || !string.Equals(token, apiKey, StringComparison.Ordinal))
            {
                context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                await context.Response.WriteAsJsonAsync(new { error = "Unauthorized" });
                return;
            }
        }

        await _next(context);
    }

    private static bool IsPublic(string path)
    {
        foreach (var exact in PublicExactPaths)
        {
            if (path.Equals(exact, StringComparison.OrdinalIgnoreCase))
                return true;
        }

        foreach (var prefix in PublicPrefixes)
        {
            if (path.Equals(prefix.TrimEnd('/'), StringComparison.OrdinalIgnoreCase)
                || path.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                return true;
        }

        return path == "/" || path.Equals("/index.html", StringComparison.OrdinalIgnoreCase);
    }

    private static bool TryGetBearerToken(string? header, out string token)
    {
        token = "";
        if (string.IsNullOrEmpty(header) || !header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
            return false;

        token = header["Bearer ".Length..].Trim();
        return token.Length > 0;
    }
}

public static class AdminEndpoints
{
    public static void MapAdminEndpoints(this WebApplication app)
    {
        app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

        app.MapGet("/ready", (ISpeculumConfigStore store) =>
            store.IsOperational
                ? Results.Ok(new { ready = true })
                : Results.Json(new { ready = false, missing = store.MissingRequired },
                    statusCode: StatusCodes.Status503ServiceUnavailable));

        app.MapGet("/api/admin/config/status", (ISpeculumConfigStore store) =>
            Results.Ok(new
            {
                operational = store.IsOperational,
                missing     = store.MissingRequired,
            }));

        app.MapGet("/api/admin/config/{section}", async (string section, ISpeculumConfigStore store) =>
        {
            var value = await store.GetSectionAsync(section);
            if (value is null)
                return Results.NotFound(new { error = $"Section '{section}' is not configured." });

            if (section.Equals(ConfigSectionKeys.Admin, StringComparison.OrdinalIgnoreCase))
                return Results.Json(new { configured = true });

            return Results.Json(value.Value);
        });

        app.MapPut("/api/admin/config/{section}", async (
            string section,
            HttpContext http,
            ISpeculumConfigStore store) =>
        {
            JsonElement body;
            try
            {
                body = await JsonSerializer.DeserializeAsync<JsonElement>(http.Request.Body);
            }
            catch
            {
                return Results.BadRequest(new { error = "Invalid JSON body." });
            }

            var result = await store.PutSectionAsync(section, body);
            return result.Success
                ? Results.Ok(result)
                : Results.BadRequest(result);
        });

        app.MapDelete("/api/admin/config/{section}", async (string section, ISpeculumConfigStore store) =>
        {
            var result = await store.DeleteSectionAsync(section);
            return result.Success
                ? Results.Ok(result)
                : Results.BadRequest(result);
        });

        app.MapGet("/api/admin/snapshots", async (IBrowserSnapshotStore snapshots) =>
            Results.Ok(await snapshots.ListAsync()));

        app.MapGet("/api/admin/snapshots/{cookieId}", async (string cookieId, IBrowserSnapshotStore snapshots) =>
        {
            var list = await snapshots.ListAsync();
            var meta = list.FirstOrDefault(s => s.CookieId == cookieId);
            return meta is null
                ? Results.NotFound(new { error = "Snapshot not found." })
                : Results.Ok(meta);
        });

        app.MapDelete("/api/admin/snapshots/{cookieId}", async (string cookieId, IBrowserSnapshotStore snapshots) =>
        {
            var deleted = await snapshots.DeleteAsync(cookieId);
            return deleted
                ? Results.Ok(new { deleted = true })
                : Results.NotFound(new { error = "Snapshot not found." });
        });

        app.MapGet("/api/admin/scripts", async (IInjectedScriptStore scripts) =>
            Results.Ok(await scripts.ListAsync()));

        app.MapPost("/api/admin/scripts", async (HttpRequest request, IInjectedScriptStore scripts) =>
        {
            if (!request.HasFormContentType)
                return Results.BadRequest(new { error = "multipart/form-data required." });

            var form = await request.ReadFormAsync();
            var file = form.Files.GetFile("file");
            if (file is null || file.Length == 0)
                return Results.BadRequest(new { error = "file field is required." });

            if (!file.FileName.EndsWith(".js", StringComparison.OrdinalIgnoreCase))
                return Results.BadRequest(new { error = "Only .js files are accepted." });

            if (file.Length > 5 * 1024 * 1024)
                return Results.BadRequest(new { error = "File exceeds 5 MB limit." });

            await using var stream = file.OpenReadStream();
            using var reader = new StreamReader(stream);
            var content = await reader.ReadToEndAsync();
            var name    = form.TryGetValue("name", out var nameVal) && !string.IsNullOrWhiteSpace(nameVal)
                ? nameVal.ToString()
                : Path.GetFileNameWithoutExtension(file.FileName);

            var meta = await scripts.SaveAsync(name, content);
            return Results.Created($"/api/admin/scripts/{meta.Id}", meta);
        });

        app.MapDelete("/api/admin/scripts/{id}", async (string id, IInjectedScriptStore scripts) =>
        {
            var deleted = await scripts.DeleteAsync(id);
            return deleted
                ? Results.Ok(new { deleted = true })
                : Results.NotFound(new { error = "Script not found." });
        });
    }
}
