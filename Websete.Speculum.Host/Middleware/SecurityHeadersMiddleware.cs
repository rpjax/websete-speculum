namespace Websete.Speculum.Host.Middleware;

public sealed class SecurityHeadersMiddleware
{
    private const string Csp =
        "default-src 'self'; " +
        "script-src 'self'; " +
        "worker-src 'self'; " +
        "connect-src 'self'; " +
        "img-src blob: data:; " +
        "style-src 'self' 'unsafe-inline'; " +
        "font-src 'self'; " +
        "frame-ancestors 'none'; " +
        "base-uri 'self'; " +
        "form-action 'self'";

    private readonly RequestDelegate _next;

    public SecurityHeadersMiddleware(RequestDelegate next) => _next = next;

    public async Task InvokeAsync(HttpContext context)
    {
        var headers = context.Response.Headers;
        headers["Content-Security-Policy"]   = Csp;
        headers["X-Content-Type-Options"]    = "nosniff";
        headers["Referrer-Policy"]             = "strict-origin-when-cross-origin";
        headers["Permissions-Policy"]        = "camera=(), microphone=(), geolocation=()";
        headers["X-Frame-Options"]           = "DENY";

        await _next(context);
    }
}
