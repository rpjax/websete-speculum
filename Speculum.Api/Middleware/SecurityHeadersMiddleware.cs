namespace Speculum.Api.Middleware;

public sealed class SecurityHeadersMiddleware
{
    private readonly RequestDelegate _next;

    public SecurityHeadersMiddleware(RequestDelegate next) => _next = next;

    public async Task InvokeAsync(HttpContext context)
    {
        var headers = context.Response.Headers;
        headers["X-Content-Type-Options"] = "nosniff";
        headers["Referrer-Policy"]         = "strict-origin-when-cross-origin";
        headers["Permissions-Policy"]     = "camera=(), microphone=(), geolocation=()";

        await _next(context);
    }
}
