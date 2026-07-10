using System.Text.Json;
using Websete.Speculum.Host.Config.Runtime;
using Websete.Speculum.Host.Config.Store;

namespace Websete.Speculum.Host.Admin;

public sealed class AdminAuthMiddleware
{
    private readonly RequestDelegate _next;

    public AdminAuthMiddleware(RequestDelegate next) => _next = next;

    public async Task InvokeAsync(HttpContext context, ISpeculumConfigStore store)
    {
        var path = context.Request.Path.Value ?? "";
        if (!path.StartsWith("/api/admin/config/", StringComparison.OrdinalIgnoreCase)
            || path.Equals("/api/admin/config/status", StringComparison.OrdinalIgnoreCase))
        {
            await _next(context);
            return;
        }

        var apiKey = store.Current.AdminApiKey;
        if (!TryGetBearerToken(context.Request.Headers.Authorization, out var token)
            || !string.Equals(token, apiKey, StringComparison.Ordinal))
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            await context.Response.WriteAsJsonAsync(new { error = "Unauthorized" });
            return;
        }

        await _next(context);
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
    }
}
