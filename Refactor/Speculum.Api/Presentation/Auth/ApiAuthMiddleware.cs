using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Speculum.Api.Auth.Services.Contracts;

namespace Speculum.Api.Presentation.Auth;

/// <summary>
/// Control-plane HTTP requires <c>Authorization: Bearer &lt;accessToken&gt;</c> from
/// <c>/api/auth/login</c> or <c>/api/auth/refresh</c>, unless
/// <c>SPECULUM_BYPASS_API_AUTH</c> is set (lab/CI only). Hub and WebTransport stay open.
/// Default for <c>/api/*</c> is require auth; only an explicit public set is open.
/// </summary>
public sealed class ApiAuthMiddleware
{
    public const string BypassEnvironmentVariable = "SPECULUM_BYPASS_API_AUTH";
    public const string OperatorItemKey = "Speculum.Operator";

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

    public async Task InvokeAsync(HttpContext context, IAuthService auth)
    {
        var path = context.Request.Path.Value ?? string.Empty;

        // change-password always needs a real operator identity (even under lab bypass).
        var forceAuth = path.StartsWith("/api/auth/change-password", StringComparison.OrdinalIgnoreCase);

        if (!forceAuth && (IsBypassEnabled() || IsPublicPath(path)))
        {
            await _next(context).ConfigureAwait(false);
            return;
        }

        if (!forceAuth && !RequiresAuth(path))
        {
            await _next(context).ConfigureAwait(false);
            return;
        }

        if (!TryGetBearerToken(context.Request, out var accessToken))
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            await context.Response.WriteAsJsonAsync(new
            {
                error = "authorization_required",
                message = "Authorization: Bearer <accessToken> required. POST /api/auth/login first.",
            }).ConfigureAwait(false);
            return;
        }

        var validated = await auth.ValidateAccessTokenAsync(accessToken, context.RequestAborted)
            .ConfigureAwait(false);
        if (validated.IsFailure)
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            await context.Response.WriteAsJsonAsync(new
            {
                error = "authorization_required",
                message = "Invalid or expired access token.",
            }).ConfigureAwait(false);
            return;
        }

        context.Items[OperatorItemKey] = validated.Value;
        await _next(context).ConfigureAwait(false);
    }

    private static bool IsPublicPath(string path)
        => IsExactOrChild(path, "/api/auth/login")
            || IsExactOrChild(path, "/api/auth/refresh")
            || path.StartsWith("/api/public/", StringComparison.OrdinalIgnoreCase)
            || path.StartsWith("/health", StringComparison.OrdinalIgnoreCase)
            || path.Equals("/vhub", StringComparison.OrdinalIgnoreCase)
            || path.StartsWith("/vhub/", StringComparison.OrdinalIgnoreCase);

    private static bool IsExactOrChild(string path, string root)
        => path.Equals(root, StringComparison.OrdinalIgnoreCase)
            || path.StartsWith(root + "/", StringComparison.OrdinalIgnoreCase);

    /// <summary>Deny-by-default for /api/* except public auth/bootstrap paths.</summary>
    private static bool RequiresAuth(string path)
    {
        if (!path.StartsWith("/api/", StringComparison.OrdinalIgnoreCase))
            return false;

        if (IsPublicPath(path))
            return false;

        return true;
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
}

public static class ApiAuthMiddlewareExtensions
{
    public static IApplicationBuilder UseSpeculumApiAuth(this IApplicationBuilder app)
    {
        ArgumentNullException.ThrowIfNull(app);
        return app.UseMiddleware<ApiAuthMiddleware>();
    }
}
