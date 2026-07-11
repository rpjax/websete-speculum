namespace Websete.Speculum.Host.Virtualization.Persistence;

public sealed class SessionCookieMiddleware
{
    public const string CookieName = "speculum_sid";

    private static readonly string[] NoCookiePrefixes =
    [
        "/api/",
        "/openapi",
        "/libs/",
        "/js/",
        "/workers/",
    ];

    private readonly RequestDelegate _next;
    private readonly IHostEnvironment _env;

    public SessionCookieMiddleware(RequestDelegate next, IHostEnvironment env)
    {
        _next = next;
        _env  = env;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        if (ShouldIssueCookie(context))
            EnsureCookie(context);

        await _next(context);
    }

    private static bool ShouldIssueCookie(HttpContext context)
    {
        if (context.Request.Method != HttpMethods.Get) return false;

        var path = context.Request.Path.Value ?? "";

        if (path.Equals("/health", StringComparison.OrdinalIgnoreCase)
            || path.Equals("/ready", StringComparison.OrdinalIgnoreCase))
            return false;

        foreach (var prefix in NoCookiePrefixes)
        {
            if (path.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                return false;
        }

        // SPA deep links (MapFallbackToFile), /, /vhub negotiate, /setup, etc.
        return true;
    }

    private void EnsureCookie(HttpContext context)
    {
        if (context.Request.Cookies.ContainsKey(CookieName))
            return;

        var value = Guid.NewGuid().ToString("N");
        context.Response.Cookies.Append(CookieName, value, new CookieOptions
        {
            HttpOnly = true,
            Secure   = !_env.IsDevelopment(),
            SameSite = SameSiteMode.Lax,
            Path     = "/",
            MaxAge   = TimeSpan.FromDays(400),
        });
    }

    public static string? GetCookieId(HttpContext? context)
    {
        if (context is null) return null;
        var value = context.Request.Cookies[CookieName];
        return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    }
}
