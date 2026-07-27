using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Http;

namespace Speculum.Api.Presentation.Auth;

/// <summary>
/// When <c>SPECULUM_BYPASS_API_AUTH</c> is not true, configuration / journal catalog /
/// and session harness HTTP APIs require <c>Authorization: Bearer &lt;token&gt;</c>
/// matching <c>SPECULUM_API_AUTH_TOKEN</c>. Hub and WebTransport stay open:
/// browsers cannot attach custom headers to WebTransport; session tokens gate the data plane.
/// </summary>
public sealed class ApiAuthMiddleware
{
    public const string BypassEnvironmentVariable = "SPECULUM_BYPASS_API_AUTH";
    public const string TokenEnvironmentVariable = "SPECULUM_API_AUTH_TOKEN";

    private readonly RequestDelegate _next;

    public ApiAuthMiddleware(RequestDelegate next)
    {
        _next = next;
    }

    public static bool IsBypassEnabled()
    {
        var value = Environment.GetEnvironmentVariable(BypassEnvironmentVariable);
        return string.Equals(value, "true", StringComparison.OrdinalIgnoreCase)
            || string.Equals(value, "1", StringComparison.OrdinalIgnoreCase);
    }

    public static string? GetConfiguredToken()
    {
        var token = Environment.GetEnvironmentVariable(TokenEnvironmentVariable);
        return string.IsNullOrWhiteSpace(token) ? null : token.Trim();
    }

    public async Task InvokeAsync(HttpContext context)
    {
        if (IsBypassEnabled() || !RequiresAuth(context.Request.Path))
        {
            await _next(context).ConfigureAwait(false);
            return;
        }

        var expected = GetConfiguredToken();
        if (expected is null)
        {
            context.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
            await context.Response.WriteAsJsonAsync(new
            {
                error = "auth_not_configured",
                message =
                    $"Set {TokenEnvironmentVariable} (Bearer token) or enable {BypassEnvironmentVariable} for lab/test only.",
            }).ConfigureAwait(false);
            return;
        }

        if (!TryGetBearerToken(context.Request, out var provided)
            || !FixedTimeEqualsUtf8(provided, expected))
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            await context.Response.WriteAsJsonAsync(new
            {
                error = "authorization_required",
                message = "Authorization: Bearer <token> required when SPECULUM_BYPASS_API_AUTH is not enabled.",
            }).ConfigureAwait(false);
            return;
        }

        await _next(context).ConfigureAwait(false);
    }

    private static bool RequiresAuth(PathString path)
    {
        var value = path.Value ?? string.Empty;
        return value.StartsWith("/api/configurations", StringComparison.OrdinalIgnoreCase)
            || value.StartsWith("/api/journal", StringComparison.OrdinalIgnoreCase)
            || value.StartsWith("/api/sessions", StringComparison.OrdinalIgnoreCase);
    }

    private static bool TryGetBearerToken(HttpRequest request, out string token)
    {
        token = string.Empty;
        var header = request.Headers.Authorization.ToString();
        if (string.IsNullOrWhiteSpace(header))
            return false;

        const string prefix = "Bearer ";
        if (!header.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            return false;

        token = header[prefix.Length..].Trim();
        return token.Length > 0;
    }

    private static bool FixedTimeEqualsUtf8(string left, string right)
    {
        var leftBytes = Encoding.UTF8.GetBytes(left);
        var rightBytes = Encoding.UTF8.GetBytes(right);
        return leftBytes.Length == rightBytes.Length
            && CryptographicOperations.FixedTimeEquals(leftBytes, rightBytes);
    }
}

public static class ApiAuthMiddlewareExtensions
{
    public static IApplicationBuilder UseSpeculumApiAuth(this IApplicationBuilder app)
    {
        ArgumentNullException.ThrowIfNull(app);
        return app.UseMiddleware<ApiAuthMiddleware>();
    }
}
